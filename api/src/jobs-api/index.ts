/**
 * Jobs API Lambda Function
 * 
 * Handles job management endpoints for video processing
 * - GET /api/jobs - List jobs
 * - GET /api/jobs/{jobId}/status - Get job status
 * - GET /api/jobs/{jobId} - Get job details
 * - PUT /api/jobs/{jobId} - Update job
 * - DELETE /api/jobs/{jobId} - Delete job
 */

import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { MediaConvertClient, CreateJobCommand } from "@aws-sdk/client-mediaconvert";
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
    ScanCommand,
    DeleteCommand,
    PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda";
import { buildOrientedEditingJob, type OrientedEditingJobConfig } from "../shared/mediaconvert-job-builder";

// Initialize AWS Lambda Powertools
const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

// Initialize AWS clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});

// Environment variables
const JOBS_TABLE = process.env.JOBS_TABLE!;
const CLIPS_TABLE = process.env.CLIPS_TABLE!;
const REELS_TABLE = process.env.REELS_TABLE!;
const MC_ROLE_ARN = process.env.MC_ROLE_ARN!;
const MC_ENDPOINT = process.env.MC_ENDPOINT!;
const VIDEO_ASSETS_BUCKET = process.env.VIDEO_ASSETS_BUCKET!;
const HARVEST_API_FUNCTION_NAME = process.env.HARVEST_API_FUNCTION_NAME || "";

const mediaConvertClient = tracer.captureAWSv3Client(
    new MediaConvertClient({ endpoint: MC_ENDPOINT })
);

interface OrientationSource {
    orientation: "landscape" | "portrait";
    sourceKey: string;
}

// Types
type VideoProcessingStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

interface VideoProcessingJob {
    assetType?: string;
    jobId: string;
    clipId?: string;
    reelId?: string;
    eventId?: string;
    status: VideoProcessingStatus;
    progress: number;
    sourceUrl: string;
    outputUrl?: string;
    originalAssetId?: string;
    parameters: any;
    createdAt: string;
    updatedAt: string;
    errorMessage?: string;
}

/**
 * Main Lambda handler for Jobs API
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResult> => {
    const requestStartTime = Date.now();
    
    logger.info("Processing jobs API request", {
        method: event.requestContext.http.method,
        path: event.requestContext.http.path,
        hasBody: !!event.body,
    });

    try {
        const method = event.requestContext.http.method;
        const path = event.requestContext.http.path;

        // Route requests based on HTTP method and path
        if (method === "GET" && path === "/api/jobs") {
            const queryParams: Record<string, string> = {};
            if (event.queryStringParameters) {
                for (const [key, value] of Object.entries(event.queryStringParameters)) {
                    if (value !== null && value !== undefined) {
                        queryParams[key] = value;
                    }
                }
            }
            return await getAllJobs(queryParams);
        } else if (method === "POST" && path === "/api/jobs") {
            const jobData = JSON.parse(event.body || "{}");
            return await createVideoEditingJob(jobData);
        } else if (method === "GET" && path.startsWith("/api/jobs/") && path.endsWith("/status")) {
            const pathParts = path.split("/");
            const jobId = pathParts[pathParts.length - 2];
            return await getJobStatus(jobId);
        } else if (method === "GET" && path.startsWith("/api/jobs/")) {
            const jobId = path.split("/").pop();
            return await getJob(jobId!);
        } else if (method === "PUT" && path.startsWith("/api/jobs/")) {
            const jobId = path.split("/").pop();
            const updateData = JSON.parse(event.body || "{}");
            return await updateJob(jobId!, updateData);
        } else if (method === "DELETE" && path.startsWith("/api/jobs/")) {
            const jobId = path.split("/").pop();
            return await deleteJob(jobId!);
        }

        return createResponse(400, { message: "Invalid request" });
    } catch (error) {
        const requestTime = Date.now() - requestStartTime;
        logger.error("Error processing jobs API request", {
            error,
            requestTimeMs: requestTime,
        });
        return createResponse(500, { message: "Internal server error" });
    } finally {
        const requestTime = Date.now() - requestStartTime;
        logger.info("Jobs API request completed", {
            requestTimeMs: requestTime,
        });
    }
};

// Additional types for video editing
type VideoEditOperationType = "trim" | "split" | "delete" | "merge";

interface VideoProcessingParameters {
    operations: VideoEditOperation[];
    outputSettings: VideoOutputSettings;
    clipName?: string;
}

interface VideoOutputSettings {
    format: "mp4" | "mov" | "webm" | "hls";
    quality: "high" | "medium" | "low";
    resolution?: string;
    frameRate?: number;
    bitrate?: number;
}

interface VideoEditOperation {
    id: string;
    type: VideoEditOperationType;
    startTime: number;
    endTime: number;
    order: number;
    enabled: boolean;
    description?: string;
}

type Orientation = "landscape" | "portrait" | "both";

interface ProcessingRequest {
    sourceUrl: string;
    parameters: VideoProcessingParameters;
    clipId?: string;
    reelId?: string;
    eventId?: string;
    assetType: "clip" | "reel";
    orientation?: Orientation;
}

/**
 * Create video editing job (submit to MediaConvert)
 */
async function createVideoEditingJob(requestData: ProcessingRequest): Promise<APIGatewayProxyResult> {
    logger.info("Creating video editing job", { requestData });

    try {
        // Validate request data
        if (!requestData.sourceUrl) {
            return createResponse(400, { message: "sourceUrl is required" });
        }

        if (!requestData.parameters) {
            return createResponse(400, { message: "parameters are required" });
        }

        if (!requestData.assetType || !["clip", "reel"].includes(requestData.assetType)) {
            return createResponse(400, { message: "assetType must be 'clip' or 'reel'" });
        }

        // Validate operations
        const validationErrors = validateOperations(requestData.parameters.operations || []);
        if (validationErrors.length > 0) {
            return createResponse(400, {
                message: "Invalid operations",
                errors: validationErrors,
            });
        }

        const orientation: Orientation = requestData.orientation || "portrait";

        const originalAssetId = requestData.assetType === "clip" ? requestData.clipId : requestData.reelId;
        if (!originalAssetId) {
            return createResponse(400, { message: "Invalid assetType or missing asset ID" });
        }

        // Look up the clip/reel record to check harvestedOrientations
        const assetTableName = requestData.assetType === "clip" ? CLIPS_TABLE : REELS_TABLE;
        const assetResult = await docClient.send(
            new GetCommand({
                TableName: assetTableName,
                Key: { id: originalAssetId },
            })
        );

        if (!assetResult.Item) {
            return createResponse(404, { message: `${requestData.assetType} not found: ${originalAssetId}` });
        }

        // Resolve which orientations are ready and which need harvesting
        const { ready, needsHarvest } = await resolveOrientationSources(assetResult.Item, orientation);

        // If any orientations still need harvesting, return 400
        if (needsHarvest.length > 0) {
            const missing = needsHarvest.join(", ");
            return createResponse(400, {
                message: `Orientation(s) '${missing}' not yet harvested for ${requestData.assetType} '${originalAssetId}'. ` +
                    `Harvest has been triggered — please retry after harvesting completes.`,
            });
        }

        const now = new Date().toISOString();
        const createdJobs: Array<{ jobId: string; orientation: string }> = [];

        // Create one job record and one MediaConvert job per orientation
        for (const source of ready) {
            const jobId = require("crypto").randomUUID();

            // Create new asset item with "processing" status
            const newAssetId = await createNewProcessingAsset(
                requestData.assetType,
                originalAssetId,
                requestData.eventId,
                requestData.parameters,
                source.orientation
            );

            // Create DynamoDB record for tracking
            const job: VideoProcessingJob = {
                jobId,
                clipId: requestData.assetType === "clip" ? newAssetId : undefined,
                originalAssetId,
                reelId: requestData.assetType === "reel" ? newAssetId : undefined,
                eventId: requestData.eventId,
                assetType: requestData.assetType,
                status: "pending",
                sourceUrl: requestData.sourceUrl,
                parameters: requestData.parameters,
                createdAt: now,
                updatedAt: now,
                progress: 0,
            };

            await docClient.send(
                new PutCommand({
                    TableName: JOBS_TABLE,
                    Item: job,
                })
            );

            // Derive the HLS manifest S3 URI from the orientation-specific sourceKey
            let hlsPath = source.sourceKey;
            if (!hlsPath.endsWith(".m3u8")) {
                hlsPath = hlsPath.endsWith("/") ? `${hlsPath}main.m3u8` : `${hlsPath}/main.m3u8`;
            }
            const inputS3Uri = `s3://${VIDEO_ASSETS_BUCKET}/${hlsPath}`;

            const outputKeyPrefix = `edited/${requestData.assetType}/${newAssetId}/`;

            // Build and submit orientation-specific MediaConvert job
            const jobConfig: OrientedEditingJobConfig = {
                type: "editing",
                inputS3Uri,
                orientation: source.orientation,
                outputBucket: VIDEO_ASSETS_BUCKET,
                outputKeyPrefix,
                roleArn: MC_ROLE_ARN,
                operations: requestData.parameters.operations,
                outputFormat: "hls",
                quality: requestData.parameters.outputSettings.quality,
                userMetadata: {
                    jobType: "editing",
                    appJobId: jobId,
                    assetType: requestData.assetType,
                },
            };

            const jobRequest = buildOrientedEditingJob(jobConfig);
            const result = await mediaConvertClient.send(new CreateJobCommand(jobRequest));
            const mcJobId = result.Job?.Id;

            // Store MediaConvert job ID in the video job record
            await docClient.send(
                new UpdateCommand({
                    TableName: JOBS_TABLE,
                    Key: { jobId },
                    UpdateExpression: "SET mediaConvertJobId = :mcId, updatedAt = :now",
                    ExpressionAttributeValues: {
                        ":mcId": mcJobId,
                        ":now": now,
                    },
                })
            );

            logger.info("Video editing job submitted to MediaConvert", {
                jobId,
                mcJobId,
                orientation: source.orientation,
            });
            metrics.addMetric("VideoEditingJobQueued", "Count", 1);

            createdJobs.push({ jobId, orientation: source.orientation });
        }

        return createResponse(202, {
            jobId: createdJobs[0].jobId,
            jobs: createdJobs,
            status: "pending",
            message: `Video editing job(s) submitted for ${createdJobs.length} orientation(s). Processing will begin shortly.`,
        });

    } catch (error) {
        logger.error("Error creating video editing job", {
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
        });
        return createResponse(500, {
            message: "Failed to create video editing job",
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Create new processing asset item in DynamoDB with "processing" status
 */
async function createNewProcessingAsset(
    assetType: "clip" | "reel",
    originalAssetId: string,
    eventId: string | undefined,
    parameters: VideoProcessingParameters,
    orientation: "landscape" | "portrait"
): Promise<string> {
    const newAssetId = require("crypto").randomUUID();
    const tableName = assetType === "clip" ? CLIPS_TABLE : REELS_TABLE;
    const currentTime = new Date().toISOString();

    // Get original asset to copy metadata
    const originalAsset = await docClient.send(
        new GetCommand({
            TableName: tableName,
            Key: { id: originalAssetId },
        })
    );

    if (!originalAsset.Item) {
        throw new Error(`Original ${assetType} not found: ${originalAssetId}`);
    }

    // Create new asset with processing status
    const newAsset = {
        ...originalAsset.Item,
        id: newAssetId,
        status: "processing",
        name: (parameters.clipName || `${originalAsset.Item.name}`) + "(Edited)",
        sourceKey: null,
        sourceKeys: null,
        downloadJobId: null,
        mp4Key: null,
        createdAt: currentTime,
        updatedAt: currentTime,
        lastProcessedAt: currentTime,
        editOperations: parameters.operations || [],
        originalAssetId,
        orientation,
    };

    await docClient.send(
        new PutCommand({
            TableName: tableName,
            Item: newAsset,
        })
    );

    logger.info(`Created new processing ${assetType}`, {
        newAssetId,
        originalAssetId,
        assetType,
        orientation,
    });

    return newAssetId;
}

/**
 * Validate video edit operations
 */
function validateOperations(operations: VideoEditOperation[]): string[] {
    const errors: string[] = [];

    if (!operations || operations.length === 0) {
        errors.push("At least one operation is required");
        return errors;
    }

    for (const op of operations) {
        if (op.startTime < 0) {
            errors.push(`Operation ${op.id}: Start time cannot be negative`);
        }

        if (op.type === "split") {
            if (op.endTime !== op.startTime) {
                errors.push(
                    `Operation ${op.id}: Split operations must have startTime equal to endTime`
                );
            }
        } else {
            if (op.endTime <= op.startTime) {
                errors.push(`Operation ${op.id}: End time must be greater than start time`);
            }
        }

        if (op.type === "trim" && op.endTime - op.startTime < 1) {
            errors.push(`Operation ${op.id}: Trim duration must be at least 1 second`);
        }
    }

    return errors;
}

/**
 * Get job status
 */
async function getJobStatus(jobId: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting job status", { jobId });

    try {
        const result = await docClient.send(
            new GetCommand({
                TableName: JOBS_TABLE,
                Key: { jobId },
            })
        );

        if (!result.Item) {
            return createResponse(404, { message: "Job not found" });
        }

        const job = result.Item as VideoProcessingJob;

        return createResponse(200, {
            jobId: job.jobId,
            status: job.status,
            progress: job.progress || 0,
            outputUrl: job.outputUrl,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        });
    } catch (error) {
        logger.error("Failed to get job status", { jobId, error });
        return createResponse(500, { message: "Failed to get job status" });
    }
}

/**
 * Get all video processing jobs with optional filtering
 */
async function getAllJobs(queryParams: Record<string, string>): Promise<APIGatewayProxyResult> {
    logger.info("Getting all jobs", { queryParams });

    try {
        const scanParams: any = {
            TableName: JOBS_TABLE,
        };

        // Add filtering if clipId is provided
        if (queryParams.clipId) {
            scanParams.FilterExpression = "clipId = :clipId";
            scanParams.ExpressionAttributeValues = {
                ":clipId": queryParams.clipId,
            };
        }

        // Add status filtering if provided
        if (queryParams.status) {
            if (scanParams.FilterExpression) {
                scanParams.FilterExpression += " AND #status = :status";
            } else {
                scanParams.FilterExpression = "#status = :status";
            }
            
            if (!scanParams.ExpressionAttributeValues) {
                scanParams.ExpressionAttributeValues = {};
            }
            scanParams.ExpressionAttributeValues[":status"] = queryParams.status;
            
            if (!scanParams.ExpressionAttributeNames) {
                scanParams.ExpressionAttributeNames = {};
            }
            scanParams.ExpressionAttributeNames["#status"] = "status";
        }

        // Paginate through all results
        const jobs: VideoProcessingJob[] = [];
        let lastEvaluatedKey: Record<string, any> | undefined = undefined;

        do {
            let command: ScanCommand = new ScanCommand({
                ...scanParams,
                ExclusiveStartKey: lastEvaluatedKey,
            });

            let result = await docClient.send(command);
            jobs.push(...(result.Items || []) as VideoProcessingJob[]);
            lastEvaluatedKey = result.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        // Sort by creation date (newest first)
        jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return createResponse(200, jobs.map(job => ({
            assetType: job.assetType,
            jobId: job.jobId,
            clipId: job.clipId,
            reelId: job.reelId,
            eventId: job.eventId,
            status: job.status,
            progress: job.progress || 0,
            sourceUrl: job.sourceUrl,
            outputUrl: job.outputUrl,
            originalAssetId: job.originalAssetId,
            parameters: job.parameters,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        })));
    } catch (error) {
        logger.error("Failed to get jobs", { error });
        return createResponse(500, { message: "Failed to get jobs" });
    }
}

/**
 * Get a specific job
 */
async function getJob(jobId: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting job", { jobId });

    try {
        const result = await docClient.send(
            new GetCommand({
                TableName: JOBS_TABLE,
                Key: { jobId },
            })
        );

        if (!result.Item) {
            return createResponse(404, { message: "Job not found" });
        }

        const job = result.Item as VideoProcessingJob;
        return createResponse(200, job);
    } catch (error) {
        logger.error("Failed to get job", { jobId, error });
        return createResponse(500, { message: "Failed to get job" });
    }
}

/**
 * Update a job
 */
async function updateJob(jobId: string, updateData: Partial<VideoProcessingJob>): Promise<APIGatewayProxyResult> {
    logger.info("Updating job", { jobId, updateData });

    try {
        // Build update expression dynamically
        const updateExpressions: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};

        // Always update the updatedAt timestamp
        updateExpressions.push("updatedAt = :updatedAt");
        expressionAttributeValues[":updatedAt"] = new Date().toISOString();

        // Handle status updates
        if (updateData.status) {
            updateExpressions.push("#status = :status");
            expressionAttributeNames["#status"] = "status";
            expressionAttributeValues[":status"] = updateData.status;
        }

        // Handle progress updates
        if (updateData.progress !== undefined) {
            updateExpressions.push("progress = :progress");
            expressionAttributeValues[":progress"] = updateData.progress;
        }

        // Handle error message updates
        if (updateData.errorMessage) {
            updateExpressions.push("errorMessage = :errorMessage");
            expressionAttributeValues[":errorMessage"] = updateData.errorMessage;
        }

        const updateExpression = "SET " + updateExpressions.join(", ");

        await docClient.send(
            new UpdateCommand({
                TableName: JOBS_TABLE,
                Key: { jobId },
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
                ExpressionAttributeValues: expressionAttributeValues,
            })
        );

        return createResponse(200, { message: "Job updated successfully" });
    } catch (error) {
        logger.error("Failed to update job", { jobId, error });
        return createResponse(500, { message: "Failed to update job" });
    }
}

/**
 * Delete a job
 */
async function deleteJob(jobId: string): Promise<APIGatewayProxyResult> {
    logger.info("Deleting job", { jobId });

    try {
        await docClient.send(
            new DeleteCommand({
                TableName: JOBS_TABLE,
                Key: { jobId },
            })
        );

        return createResponse(200, { message: "Job deleted successfully" });
    } catch (error) {
        logger.error("Failed to delete job", { jobId, error });
        return createResponse(500, { message: "Failed to delete job" });
    }
}

/**
 * Create standardized API Gateway response
 */
function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        body: JSON.stringify(body),
    };
}

/**
 * Expand an orientation value to the list of individual orientations it represents.
 */
function expandOrientation(orientation: Orientation): Array<"landscape" | "portrait"> {
    if (orientation === "both") {
        return ["landscape", "portrait"];
    }
    return [orientation];
}

/**
 * Resolve orientation sources for a clip/reel. Checks which orientations are already
 * harvested and which need new harvest jobs.
 *
 * - Clips without `harvestedOrientations` are treated as having no orientations harvested
 *   (backward compatibility).
 * - For already-harvested orientations, reads `sourceKeys.{orientation}` from the record.
 * - For missing orientations, triggers the Harvest Pipeline via Lambda invoke.
 */
async function resolveOrientationSources(
    clip: Record<string, any>,
    orientation: Orientation
): Promise<{ ready: OrientationSource[]; needsHarvest: string[] }> {
    const needed = expandOrientation(orientation);

    // Backward compatibility: treat missing harvestedOrientations as empty
    const harvested: Set<string> = new Set(
        Array.isArray(clip.harvestedOrientations)
            ? clip.harvestedOrientations
            : clip.harvestedOrientations instanceof Set
              ? Array.from(clip.harvestedOrientations as Set<string>)
              : []
    );

    const sourceKeys: Record<string, string> = clip.sourceKeys || {};

    const ready: OrientationSource[] = [];
    const needsHarvest: string[] = [];

    for (const orient of needed) {
        if (sourceKeys[orient]) {
            // Orientation has a source key — it's ready regardless of harvestedOrientations flag
            ready.push({ orientation: orient, sourceKey: sourceKeys[orient] });
        } else if (harvested.has(orient) && clip.sourceKey) {
            // Legacy: single sourceKey with harvestedOrientations tracking
            ready.push({ orientation: orient, sourceKey: clip.sourceKey });
        } else {
            needsHarvest.push(orient);
        }
    }

    // Trigger harvest for each missing orientation
    for (const orient of needsHarvest) {
        await triggerHarvest(clip, orient);
    }

    return { ready, needsHarvest };
}

/**
 * Trigger a harvest job for a specific orientation by invoking the Harvest API Lambda.
 */
async function triggerHarvest(clip: Record<string, any>, orientation: string): Promise<void> {
    if (!HARVEST_API_FUNCTION_NAME) {
        throw new Error("HARVEST_API_FUNCTION_NAME environment variable is not configured");
    }

    // Normalize timestamps to ISO strings — DynamoDB stores them as epoch ints
    const startTime = typeof clip.startTime === "number"
        ? new Date(clip.startTime * 1000).toISOString()
        : clip.startTime;
    const endTime = typeof clip.endTime === "number"
        ? new Date(clip.endTime * 1000).toISOString()
        : clip.endTime;

    const payload = {
        httpMethod: "POST",
        path: "/api/harvest-jobs/trigger",
        body: JSON.stringify({
            clipId: clip.id,
            orientation,
            channelId: clip.mediaLiveChannel || clip.channelId,
            startTime,
            endTime,
        }),
    };

    logger.info("Triggering harvest for orientation", {
        clipId: clip.id,
        orientation,
        functionName: HARVEST_API_FUNCTION_NAME,
    });

    const response = await lambdaClient.send(
        new InvokeCommand({
            FunctionName: HARVEST_API_FUNCTION_NAME,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify(payload),
        })
    );

    if (!response.Payload) {
        throw new Error(`No response from Harvest API for orientation ${orientation}`);
    }

    const result = JSON.parse(new TextDecoder().decode(response.Payload));

    if (result.statusCode && result.statusCode >= 400) {
        const errorBody = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
        throw new Error(
            `Harvest trigger failed for orientation ${orientation}: ${errorBody?.message || "Unknown error"}`
        );
    }

    logger.info("Harvest triggered successfully", {
        clipId: clip.id,
        orientation,
        response: result,
    });
}