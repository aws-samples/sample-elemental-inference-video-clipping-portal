/**
 * Clips Lambda Function
 *
 * Handles CRUD operations for video clips extracted from events
 * Supports querying clips by event ID for efficient data retrieval
 *
 * Endpoints:
 * - GET /api/clips - List all clips
 * - GET /api/clips?eventId={id} - Get clips by event ID
 * - GET /api/clips/{id} - Get specific clip by ID
 * - POST /api/clips - Create new clip
 * - PUT /api/clips/{id} - Update existing clip
 * - DELETE /api/clips/{id} - Delete clip
 */

import { APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics } from "@aws-lambda-powertools/metrics";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    ScanCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand
} from "@aws-sdk/lib-dynamodb";

// Initialize AWS Lambda Powertools for observability
const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

// Initialize DynamoDB client with tracing
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const CLIPS_TABLE = process.env.CLIPS_TABLE!;

/**
 * Clip interface matching the application's data model
 */
interface Clip {
    id: string;
    name: string;
    description?: string;
    eventId: string;
    eventName: string;
    startTime: number;
    endTime: number;
    duration: number;
    status:
        | "original"
        | "modified"
        | "review_in_progress"
        | "edit_in_progress"
        | "discarded"
        | "reviewed"
        | "published"
        | "scheduled";
    resolution: string;
    format: string;
    mediaPackage: string;
    mediaLiveChannel: string;
    age: number;
    createdAt: string;
    updatedAt: string;
    tags: string[];
    customTags: string[];
    latency?: number;
    editTime?: number;
    sourceKey?: string; // S3 key for getting signedUrl (current version)
    originalSourceKey?: string; // Original source key before any modifications
    originalAssetId?: string; // Reference to original clip this was generated from
    videoUrl?: string;
    processedVideoUrl?: string;
    locked?: boolean; // Lock state to prevent editing
    mp4Key?: string; // S3 key for the MP4 file (direct download)
}

/**
 * Main Lambda handler function
 * Routes requests to appropriate CRUD operations based on HTTP method and path
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResult> => {
    logger.info("Processing request", { event });

    try {
        const method = event.requestContext.http.method;
        const pathParameters = event.pathParameters;
        const queryParameters = event.queryStringParameters;

        // Route requests based on HTTP method and parameters
        switch (method) {
            case "GET":
                if (pathParameters?.id) {
                    return await getClip(pathParameters.id);
                } else if (queryParameters?.eventId) {
                    return await getClipsByEvent(queryParameters.eventId);
                } else {
                    const limit = queryParameters?.limit ? parseInt(queryParameters.limit) : 50;
                    const nextToken = queryParameters?.nextToken;
                    return await listClips(limit, nextToken);
                }
            case "POST":
                return await createClip(JSON.parse(event.body || "{}"));
            case "PUT":
                if (pathParameters?.id) {
                    return await updateClip(pathParameters.id, JSON.parse(event.body || "{}"));
                }
                break;
            case "DELETE":
                if (pathParameters?.id) {
                    return await deleteClip(pathParameters.id);
                }
                break;
        }

        // Return 400 for invalid requests
        return createResponse(400, { message: "Invalid request" });
    } catch (error) {
        logger.error("Error processing request", { error });
        return createResponse(500, { message: "Internal server error" });
    }
};

/**
 * Retrieve clips from the database with pagination
 * @param limit - Maximum number of clips to return (default: 50)
 * @param nextToken - Base64 encoded pagination token for next page
 * @returns Promise<APIGatewayProxyResult> - Paginated list of clips
 */
async function listClips(limit: number = 50, nextToken?: string): Promise<APIGatewayProxyResult> {
    logger.info("Listing clips with pagination", { limit, hasNextToken: !!nextToken });

    // Parse nextToken if provided
    let exclusiveStartKey: Record<string, any> | undefined;
    if (nextToken) {
        try {
            exclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
        } catch (error) {
            logger.warn("Invalid nextToken provided", { nextToken, error });
            return createResponse(400, { message: "Invalid pagination token" });
        }
    }

    const command = new ScanCommand({
        TableName: CLIPS_TABLE,
        Limit: Math.min(limit, 100), // Cap at 100 items max
        ExclusiveStartKey: exclusiveStartKey,
    });

    const result = await docClient.send(command);
    const items = result.Items || [];

    // Add custom metric for monitoring
    metrics.addMetric("ClipsListed", "Count", items.length);

    // Prepare response with pagination
    const response: any = {
        clips: items,
        count: items.length,
    };

    // Include nextToken if there are more items
    if (result.LastEvaluatedKey) {
        response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return createResponse(200, response);
}

/**
 * Retrieve a specific clip by ID
 * @param id - Clip ID to retrieve
 * @returns Promise<APIGatewayProxyResult> - Clip data or 404 if not found
 */
async function getClip(id: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting clip", { clipId: id });

    const command = new GetCommand({
        TableName: CLIPS_TABLE,
        Key: { id },
    });

    const result = await docClient.send(command);

    if (!result.Item) {
        logger.warn("Clip not found", { clipId: id });
        return createResponse(404, { message: "Clip not found" });
    }

    return createResponse(200, result.Item);
}

/**
 * Retrieve clips associated with a specific event
 * Uses the EventIdIndex GSI for efficient querying
 * @param eventId - Event ID to filter clips by
 * @returns Promise<APIGatewayProxyResult> - List of clips for the event
 */
async function getClipsByEvent(eventId: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting clips by event", { eventId });

    const command = new QueryCommand({
        TableName: CLIPS_TABLE,
        IndexName: "EventIdIndex",
        KeyConditionExpression: "eventId = :eventId",
        ExpressionAttributeValues: {
            ":eventId": eventId,
        },
    });

    const result = await docClient.send(command);
    const items = result.Items || [];

    // Add custom metric for monitoring
    metrics.addMetric("ClipsByEventQueried", "Count", items.length);

    // Return consistent format with listClips
    const response = {
        clips: items,
        count: items.length,
    };

    return createResponse(200, response);
}

/**
 * Create a new clip
 * Automatically calculates duration from start and end times
 * @param clipData - Partial clip data from request body
 * @returns Promise<APIGatewayProxyResult> - Created clip data
 */
async function createClip(clipData: Partial<Clip>): Promise<APIGatewayProxyResult> {
    logger.info("Creating new clip", { clipData });

    // Input validation
    if (!clipData.name || typeof clipData.name !== "string" || clipData.name.trim().length === 0) {
        return createResponse(400, { message: "name is required" });
    }
    if (clipData.startTime !== undefined && (typeof clipData.startTime !== "number" || clipData.startTime < 0)) {
        return createResponse(400, { message: "startTime must be a non-negative number" });
    }
    if (clipData.endTime !== undefined && (typeof clipData.endTime !== "number" || clipData.endTime < 0)) {
        return createResponse(400, { message: "endTime must be a non-negative number" });
    }
    if (clipData.startTime !== undefined && clipData.endTime !== undefined && clipData.startTime >= clipData.endTime) {
        return createResponse(400, { message: "startTime must be before endTime" });
    }

    const now = new Date().toISOString();

    // Build complete clip object with defaults
    const shortUid = require("crypto").randomUUID().slice(0, 8);
    const clip: Clip = {
        id: `clip-${clipData.eventId || "manual"}-${shortUid}`,
        name: clipData.name || "",
        description: clipData.description,
        eventId: clipData.eventId || "",
        eventName: clipData.eventName || "",
        startTime: clipData.startTime || 0,
        endTime: clipData.endTime || 0,
        duration: (clipData.endTime || 0) - (clipData.startTime || 0),
        status: clipData.status || "original",
        resolution: clipData.resolution || "1080p",
        format: clipData.format || "MP4",
        mediaPackage: clipData.mediaPackage || "",
        mediaLiveChannel: clipData.mediaLiveChannel || "",
        age: 0,
        createdAt: now,
        updatedAt: now,
        tags: clipData.tags || [],
        customTags: clipData.customTags || [],
        latency: clipData.latency,
        editTime: clipData.editTime,
        videoUrl: clipData.videoUrl,
    };

    const command = new PutCommand({
        TableName: CLIPS_TABLE,
        Item: clip,
    });

    await docClient.send(command);

    // Add custom metric for monitoring
    metrics.addMetric("ClipCreated", "Count", 1);

    logger.info("Clip created successfully", { clipId: clip.id });

    return createResponse(201, clip);
}

/**
 * Update an existing clip
 * Automatically recalculates duration if start or end time changes
 * @param id - Clip ID to update
 * @param updates - Partial clip data with updates
 * @returns Promise<APIGatewayProxyResult> - Updated clip data
 */
async function updateClip(id: string, updates: Partial<Clip>): Promise<APIGatewayProxyResult> {
    logger.info("Updating clip", { clipId: id, updates });

    const now = new Date().toISOString();

    // Build update expression and attribute values dynamically
    let updateExpression = "SET updatedAt = :updatedAt";
    const expressionAttributeValues: Record<string, any> = {
        ":updatedAt": now,
    };
    const expressionAttributeNames: Record<string, string> = {};

    // Fields that can be updated
    const updateFields: (keyof Clip)[] = [
        "name",
        "description",
        "startTime",
        "endTime",
        "status",
        "customTags",
        "sourceKey",
        "originalSourceKey",
        "originalAssetId",
        "videoUrl",
        "processedVideoUrl",
        "locked",
        "mp4Key",
    ];

    // Add fields to update expression if they exist in the updates
    updateFields.forEach((field) => {
        if (updates[field] !== undefined) {
            // Handle reserved keywords by using expression attribute names
            if (field === "status") {
                updateExpression += `, #status = :status`;
                expressionAttributeNames["#status"] = "status";
                expressionAttributeValues[":status"] = updates[field];
            } else if (field === "name") {
                updateExpression += `, #name = :name`;
                expressionAttributeNames["#name"] = "name";
                expressionAttributeValues[":name"] = updates[field];
            } else {
                updateExpression += `, ${field} = :${field}`;
                expressionAttributeValues[`:${field}`] = updates[field];
            }
        }
    });

    // Recalculate duration if both start and end time are provided
    if (updates.startTime !== undefined && updates.endTime !== undefined) {
        updateExpression += `, #duration = :duration`;
        expressionAttributeNames["#duration"] = "duration";
        expressionAttributeValues[":duration"] = updates.endTime - updates.startTime;
    }

    logger.info("Update expressions", {
        updateExpression,
        expressionAttributeNames,
        expressionAttributeValues,
    });

    const commandParams: any = {
        TableName: CLIPS_TABLE,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
    };

    if (Object.keys(expressionAttributeNames).length > 0) {
        commandParams.ExpressionAttributeNames = expressionAttributeNames;
    }

    const command = new UpdateCommand(commandParams);

    const result = await docClient.send(command);

    // Add custom metric for monitoring
    metrics.addMetric("ClipUpdated", "Count", 1);

    logger.info("Clip updated successfully", { clipId: id });

    return createResponse(200, result.Attributes);
}

/**
 * Delete a clip
 * @param id - Clip ID to delete
 * @returns Promise<APIGatewayProxyResult> - Empty response with 204 status
 */
async function deleteClip(id: string): Promise<APIGatewayProxyResult> {
    logger.info("Deleting clip", { clipId: id });

    const command = new DeleteCommand({
        TableName: CLIPS_TABLE,
        Key: { id },
    });

    await docClient.send(command);

    // Add custom metric for monitoring
    metrics.addMetric("ClipDeleted", "Count", 1);

    logger.info("Clip deleted successfully", { clipId: id });

    return createResponse(204, "");
}

/**
 * Helper function to create standardized API Gateway responses
 * @param statusCode - HTTP status code
 * @param body - Response body data
 * @returns APIGatewayProxyResult - Formatted response with CORS headers
 */
function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
            "Access-Control-Allow-Headers":
                "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        body: statusCode === 204 ? "" : JSON.stringify(body),
    };
}
