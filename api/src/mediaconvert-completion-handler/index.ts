/**
 * MediaConvert Completion Handler
 *
 * Triggered by EventBridge when a MediaConvert job reaches COMPLETE, ERROR, or
 * CANCELED state. Updates the corresponding DynamoDB records (video jobs,
 * download jobs, clips, reels) based on userMetadata set during job creation.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "mediaconvert-completion" });
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CLIPS_TABLE = process.env.CLIPS_TABLE!;
const REELS_TABLE = process.env.REELS_TABLE!;
const DOWNLOAD_JOBS_TABLE = process.env.DOWNLOAD_JOBS_TABLE!;
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE!;

// --- Types ---

interface MediaConvertEvent {
    source: string;
    "detail-type": string;
    detail: {
        jobId: string;
        status: "COMPLETE" | "ERROR" | "CANCELED";
        errorCode?: number;
        errorMessage?: string;
        userMetadata?: {
            jobType: "editing" | "download";
            appJobId: string;
            assetType?: "clip" | "reel";
        };
        outputGroupDetails?: OutputGroupDetail[];
    };
}

interface OutputGroupDetail {
    outputDetails: Array<{
        outputFilePaths: string[];
        durationInMs?: number;
        videoDetails?: { widthInPx: number; heightInPx: number };
    }>;
}

// --- Orientation helpers ---

const LANDSCAPE_WIDTH = 1280;

function classifyOrientation(widthInPx: number): "landscape" | "portrait" {
    return widthInPx >= LANDSCAPE_WIDTH ? "landscape" : "portrait";
}

/**
 * Extract the S3 key from a MediaConvert output file path.
 * Paths look like: s3://bucket/prefix/filename.mp4
 */
function extractS3Key(outputFilePath: string): string {
    // Strip "s3://bucket/" prefix
    const withoutScheme = outputFilePath.replace(/^s3:\/\/[^/]+\//, "");
    return withoutScheme;
}

/**
 * Classify an output group as HLS or MP4 based on its output path.
 * Checks for /hls/ or /mp4/ in the path, falling back to file extension.
 */
function classifyOutputGroup(outputPath: string): "hls" | "mp4" | "unknown" {
    if (outputPath.includes("/hls/")) return "hls";
    if (outputPath.includes("/mp4/")) return "mp4";
    if (outputPath.endsWith(".m3u8") || outputPath.endsWith(".ts")) return "hls";
    if (outputPath.endsWith(".mp4")) return "mp4";
    return "unknown";
}

/**
 * Derive the sourceKey for an edited clip from the output path.
 * For HLS output the path ends with e.g. ".../main.m3u8" — strip the filename
 * so sourceKey points to the directory prefix.
 */
function deriveSourceKey(outputFilePath: string): string {
    const key = extractS3Key(outputFilePath);
    // Strip trailing filename (e.g. main.m3u8 or output.mp4) to get the directory prefix
    const lastSlash = key.lastIndexOf("/");
    return lastSlash > 0 ? key.substring(0, lastSlash + 1) : key;
}

// --- Handler ---

export const handler = async (event: MediaConvertEvent): Promise<void> => {
    const { detail } = event;
    const { jobId, status, userMetadata } = detail;

    logger.info("Received MediaConvert event", { jobId, status, userMetadata });

    if (!userMetadata?.appJobId || !userMetadata?.jobType) {
        logger.warn("Event missing userMetadata, skipping", { jobId });
        return;
    }

    const { jobType, appJobId, assetType } = userMetadata;

    if (jobType === "download") {
        await handleDownloadJob(appJobId, status, detail);
    } else if (jobType === "editing") {
        await handleEditingJob(appJobId, status, detail, assetType);
    } else {
        logger.warn("Unknown jobType in userMetadata", { jobType, jobId });
    }
};

// --- Download job handling ---

async function handleDownloadJob(
    appJobId: string,
    status: string,
    detail: MediaConvertEvent["detail"],
): Promise<void> {
    // Look up the download job record
    const record = await getRecord(DOWNLOAD_JOBS_TABLE, "jobId", appJobId);
    if (!record) {
        logger.warn("No download job record found", { appJobId });
        return;
    }

    if (status === "COMPLETE") {
        const outputGroups = detail.outputGroupDetails ?? [];

        if (outputGroups.length > 1) {
            // "Both" orientation — each output group maps to a different orientation
            await handleBothOrientationDownload(appJobId, outputGroups);
        } else {
            const outputPath = outputGroups[0]?.outputDetails?.[0]?.outputFilePaths?.[0];
            const s3OutputKey = outputPath ? extractS3Key(outputPath) : undefined;

            await updateRecord(DOWNLOAD_JOBS_TABLE, "jobId", appJobId, {
                download_status: "completed",
                progress: 100,
                ...(s3OutputKey && { s3OutputKey }),
            });
        }
    } else {
        // ERROR or CANCELED
        await updateRecord(DOWNLOAD_JOBS_TABLE, "jobId", appJobId, {
            download_status: "failed",
            errorMessage: detail.errorMessage ?? status,
        });
    }
}

async function handleBothOrientationDownload(
    appJobId: string,
    outputGroups: OutputGroupDetail[],
): Promise<void> {
    for (const group of outputGroups) {
        const firstOutput = group.outputDetails?.[0];
        const outputPath = firstOutput?.outputFilePaths?.[0];
        if (!outputPath) continue;

        const orientation = firstOutput?.videoDetails
            ? classifyOrientation(firstOutput.videoDetails.widthInPx)
            : "portrait";

        // For "both" orientation, the appJobId stored on each Download_Record includes
        // the orientation suffix: e.g. "<baseId>-landscape", "<baseId>-portrait"
        const orientedJobId = `${appJobId}-${orientation}`;
        const record = await getRecord(DOWNLOAD_JOBS_TABLE, "jobId", orientedJobId);

        if (record) {
            await updateRecord(DOWNLOAD_JOBS_TABLE, "jobId", orientedJobId, {
                download_status: "completed",
                progress: 100,
                s3OutputKey: extractS3Key(outputPath),
            });
        } else {
            logger.warn("No download record for orientation", { orientedJobId, orientation });
        }
    }
}

// --- Editing job handling ---

async function handleEditingJob(
    appJobId: string,
    status: string,
    detail: MediaConvertEvent["detail"],
    assetType?: string,
): Promise<void> {
    // Look up the video job record
    const record = await getRecord(VIDEO_JOBS_TABLE, "jobId", appJobId);
    if (!record) {
        logger.warn("No video job record found", { appJobId });
        return;
    }

    const tableName = assetType === "reel" ? REELS_TABLE : CLIPS_TABLE;

    if (status === "COMPLETE") {
        const outputGroups = detail.outputGroupDetails ?? [];
        const assetId = record.assetId ?? record.clipId ?? record.reelId;

        // Check if this is a "both" orientation job (multiple orientations, each with HLS+MP4)
        const hasBothOrientations = outputGroups.some((g) => {
            const vid = g.outputDetails?.[0]?.videoDetails;
            return vid !== undefined;
        }) && outputGroups.length > 2;

        if (hasBothOrientations) {
            // "Both" orientation — process each output group per orientation
            await handleBothOrientationEditing(appJobId, outputGroups, tableName);
        } else if (assetId) {
            // Single orientation — iterate over output groups to extract HLS and MP4 paths
            let sourceKey: string | undefined;
            let mp4Key: string | undefined;

            for (const group of outputGroups) {
                const outputPath = group.outputDetails?.[0]?.outputFilePaths?.[0];
                if (!outputPath) continue;

                const groupType = classifyOutputGroup(outputPath);
                if (groupType === "hls") {
                    sourceKey = deriveSourceKey(outputPath);
                } else if (groupType === "mp4") {
                    mp4Key = extractS3Key(outputPath);
                }
            }

            // Backward compatibility: if only one output group and nothing classified, use existing logic
            if (!sourceKey && !mp4Key && outputGroups.length === 1) {
                const outputPath = outputGroups[0]?.outputDetails?.[0]?.outputFilePaths?.[0];
                if (outputPath) {
                    sourceKey = deriveSourceKey(outputPath);
                }
            }

            await updateRecord(tableName, "id", assetId, {
                ...(sourceKey && { sourceKey }),
                ...(mp4Key && { mp4Key }),
                status: "completed",
            });
        }

        // Update the job record
        await updateRecord(VIDEO_JOBS_TABLE, "jobId", appJobId, {
            status: "completed",
            progress: 100,
        });
    } else {
        // ERROR or CANCELED
        // Mark new asset record(s) as failed without modifying the original
        const assetId = record.assetId ?? record.clipId ?? record.reelId;
        if (assetId) {
            await updateRecord(tableName, "id", assetId, {
                status: "failed",
            });
        }

        // Also check for "both" orientation asset IDs
        if (record.landscapeAssetId) {
            await updateRecord(tableName, "id", record.landscapeAssetId, { status: "failed" });
        }
        if (record.portraitAssetId) {
            await updateRecord(tableName, "id", record.portraitAssetId, { status: "failed" });
        }

        await updateRecord(VIDEO_JOBS_TABLE, "jobId", appJobId, {
            status: "failed",
            errorMessage: detail.errorMessage ?? status,
        });
    }
}

async function handleBothOrientationEditing(
    appJobId: string,
    outputGroups: OutputGroupDetail[],
    tableName: string,
): Promise<void> {
    // Look up the job record to find per-orientation asset IDs
    const record = await getRecord(VIDEO_JOBS_TABLE, "jobId", appJobId);
    if (!record) return;

    // Group output groups by orientation, collecting HLS and MP4 paths for each
    const orientationData: Record<string, { sourceKey?: string; mp4Key?: string }> = {};

    for (const group of outputGroups) {
        const firstOutput = group.outputDetails?.[0];
        const outputPath = firstOutput?.outputFilePaths?.[0];
        if (!outputPath) continue;

        const orientation = firstOutput?.videoDetails
            ? classifyOrientation(firstOutput.videoDetails.widthInPx)
            : "portrait";

        if (!orientationData[orientation]) {
            orientationData[orientation] = {};
        }

        const groupType = classifyOutputGroup(outputPath);
        if (groupType === "hls") {
            orientationData[orientation].sourceKey = deriveSourceKey(outputPath);
        } else if (groupType === "mp4") {
            orientationData[orientation].mp4Key = extractS3Key(outputPath);
        }
    }

    for (const [orientation, data] of Object.entries(orientationData)) {
        const assetId =
            orientation === "landscape" ? record.landscapeAssetId : record.portraitAssetId;

        if (assetId) {
            await updateRecord(tableName, "id", assetId, {
                ...(data.sourceKey && { sourceKey: data.sourceKey }),
                ...(data.mp4Key && { mp4Key: data.mp4Key }),
                status: "completed",
            });
        } else {
            logger.warn("No asset ID for orientation", { appJobId, orientation });
        }
    }
}

// --- DynamoDB helpers ---

async function getRecord(
    tableName: string,
    keyName: string,
    keyValue: string,
): Promise<Record<string, any> | undefined> {
    const result = await docClient.send(
        new GetCommand({
            TableName: tableName,
            Key: { [keyName]: keyValue },
        }),
    );
    return result.Item;
}

async function updateRecord(
    tableName: string,
    keyName: string,
    keyValue: string,
    attributes: Record<string, any>,
): Promise<void> {
    const entries = Object.entries(attributes).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const expressionParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, any> = {};

    for (const [key, value] of entries) {
        const attrAlias = `#${key}`;
        const valAlias = `:${key}`;
        expressionParts.push(`${attrAlias} = ${valAlias}`);
        names[attrAlias] = key;
        values[valAlias] = value;
    }

    await docClient.send(
        new UpdateCommand({
            TableName: tableName,
            Key: { [keyName]: keyValue },
            UpdateExpression: `SET ${expressionParts.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        }),
    );

    logger.info("Updated record", { tableName, keyName, keyValue, attributes: Object.keys(attributes) });
}
