/**
 * Events Lambda Function
 * 
 * Handles CRUD operations for video events (live streams, scheduled events, etc.)
 * 
 * Endpoints:
 * - GET /api/events - List all events
 * - GET /api/events/{id} - Get specific event by ID
 * - POST /api/events - Create new event
 * - PUT /api/events/{id} - Update existing event
 * - DELETE /api/events/{id} - Delete event
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
    UpdateCommand,
    DeleteCommand,
    QueryCommand,
    BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// Initialize AWS Lambda Powertools for observability
const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

// Initialize DynamoDB client with tracing
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Initialize Lambda client for invoking helper functions
const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));

// Environment variables
const EVENTS_TABLE = process.env.EVENTS_TABLE!;
const CLIPS_TABLE = process.env.CLIPS_TABLE!;
const CHANNELS_TABLE = process.env.CHANNELS_TABLE || "";
const CREATE_FEED_FUNCTION_NAME = process.env.CREATE_FEED_FUNCTION_NAME || "";

export interface Template {
    name: string;
    id: string;
    resolution: string;
    format: string;
    backgroundMusic: boolean;
    clipLength: number;
}


/**
 * Event interface matching the application's data model
 */
interface Event {
    id: string;
    name: string;
    description?: string;
    status: "live" | "ended" | "scheduled";
    startDateTime: string;
    endDateTime: string;
    duration: number;
    mediaLiveChannel: string;
    generateMP4: boolean;
    createdAt: string;
    updatedAt: string;
    clips: number;
    autoGenerateHighlight: boolean;
    highlightTemplateId?: string;
    outputSettings?: Template;
    videoUrl?: string;
    isActiveForStarfish?: boolean;
}

/**
 * Compute event status based on current time and event timestamps
 */
function computeEventStatus(event: Event): Event {
    const now = new Date().getTime();
    const startTime = new Date(event.startDateTime).getTime();
    const endTime = new Date(event.endDateTime).getTime();
    
    let status: "scheduled" | "live" | "ended";
    if (now < startTime) {
        status = "scheduled";
    } else if (now >= startTime && now <= endTime) {
        status = "live";
    } else {
        status = "ended";
    }
    
    return { ...event, status };
}

/**
 * Main Lambda handler function
 * Routes requests to appropriate CRUD operations based on HTTP method and path
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResult> => {
    logger.info("Processing request", { event });
    logger.info("Processing request", { event });

    try {
        const method = event.requestContext.http.method;
        const pathParameters = event.pathParameters;

        // Route requests based on HTTP method
        switch (method) {
            case "GET":
                if (pathParameters?.id) {
                    return await getEvent(pathParameters.id);
                } else {
                    return await listEvents();
                }
            case "POST":
                return await createEvent(JSON.parse(event.body || "{}"));
            case "PUT":
                if (pathParameters?.id) {
                    // Check for activate/deactivate action in path
                    if (event.rawPath?.includes('/activate')) {
                        return await activateEvent(pathParameters.id);
                    }
                    if (event.rawPath?.includes('/deactivate')) {
                        return await deactivateEvent(pathParameters.id);
                    }
                    return await updateEvent(pathParameters.id, JSON.parse(event.body || "{}"));
                }
                break;
            case "DELETE":
                if (pathParameters?.id) {
                    const deleteClips = event.queryStringParameters?.deleteClips === 'true';
                    return await deleteEvent(pathParameters.id, deleteClips);
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
 * Retrieve all events from the database
 * @returns Promise<APIGatewayProxyResult> - List of all events
 */
async function listEvents(): Promise<APIGatewayProxyResult> {
    logger.info("Listing all events");
    
    const items: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;

    do {
        let command: ScanCommand = new ScanCommand({
            TableName: EVENTS_TABLE,
            ExclusiveStartKey: lastEvaluatedKey,
        });

        let result = await docClient.send(command);
        items.push(...(result.Items || []));
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    // Compute status for all events based on current time
    const eventsWithStatus = items.map(event => computeEventStatus(event as Event));
    
    // Add custom metric for monitoring
    metrics.addMetric("EventsListed", "Count", eventsWithStatus.length);
    
    return createResponse(200, eventsWithStatus);
}

/**
 * Retrieve a specific event by ID
 * @param id - Event ID to retrieve
 * @returns Promise<APIGatewayProxyResult> - Event data or 404 if not found
 */
async function getEvent(id: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting event", { eventId: id });
    
    const command = new GetCommand({
        TableName: EVENTS_TABLE,
        Key: { id },
    });

    const result = await docClient.send(command);

    if (!result.Item) {
        logger.warn("Event not found", { eventId: id });
        return createResponse(404, { message: "Event not found" });
    }

    // Compute status based on current time
    const eventWithStatus = computeEventStatus(result.Item as Event);

    return createResponse(200, eventWithStatus);
}

/**
 * Create a new event
 * @param eventData - Partial event data from request body
 * @returns Promise<APIGatewayProxyResult> - Created event data
 */
async function createEvent(eventData: Partial<Event>): Promise<APIGatewayProxyResult> {
    logger.info("Creating new event", { eventData });

    // Input validation
    if (!eventData.name || typeof eventData.name !== "string" || eventData.name.trim().length === 0) {
        return createResponse(400, { message: "name is required" });
    }
    if (!eventData.mediaLiveChannel || typeof eventData.mediaLiveChannel !== "string") {
        return createResponse(400, { message: "mediaLiveChannel is required" });
    }
    if (!eventData.startDateTime || !eventData.endDateTime) {
        return createResponse(400, { message: "startDateTime and endDateTime are required" });
    }
    const start = new Date(eventData.startDateTime);
    const end = new Date(eventData.endDateTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return createResponse(400, { message: "startDateTime and endDateTime must be valid ISO 8601 dates" });
    }
    if (start >= end) {
        return createResponse(400, { message: "startDateTime must be before endDateTime" });
    }
    
    const now = new Date().toISOString();
    
    // Build complete event object with defaults
    const event: Event = {
        id: `event-${Date.now()}`,
        name: eventData.name || "",
        description: eventData.description || "",
        status: eventData.status || "scheduled",
        startDateTime: eventData.startDateTime || now,
        endDateTime: eventData.endDateTime || now,
        duration: eventData.duration || 90,
        mediaLiveChannel: eventData.mediaLiveChannel || "",
        generateMP4: eventData.generateMP4 || false,
        createdAt: now,
        updatedAt: now,
        clips: 0,
        autoGenerateHighlight: eventData.autoGenerateHighlight || false,
        highlightTemplateId: eventData.highlightTemplateId,
        outputSettings: eventData.outputSettings,
        videoUrl: eventData.videoUrl,
    };

    const command = new PutCommand({
        TableName: EVENTS_TABLE,
        Item: event,
    });

    await docClient.send(command);
    
    // Add custom metric for monitoring
    metrics.addMetric("EventCreated", "Count", 1);
    
    logger.info("Event created successfully", { eventId: event.id });
    
    return createResponse(201, event);
}

/**
 * Update an existing event
 * @param id - Event ID to update
 * @param updates - Partial event data with updates
 * @returns Promise<APIGatewayProxyResult> - Updated event data
 */
async function updateEvent(id: string, updates: Partial<Event>): Promise<APIGatewayProxyResult> {
    logger.info("Updating event", { eventId: id, updates });
    
    const now = new Date().toISOString();

    // Build update expression and attribute values dynamically
    let updateExpression = "SET #updatedAt = :updatedAt";
    const expressionAttributeNames: Record<string, string> = {
        "#updatedAt": "updatedAt",
    };
    const expressionAttributeValues: Record<string, any> = {
        ":updatedAt": now,
    };

    // Fields that can be updated
    const updateFields: (keyof Event)[] = [
        "name",
        "status",
        "startDateTime",
        "duration",
        "mediaLiveChannel",
        "generateMP4",
        "autoGenerateHighlight",
        "videoUrl",
    ];

    // Add fields to update expression if they exist in the updates
    updateFields.forEach((field) => {
        if (updates[field] !== undefined) {
            const attributeName = `#${field}`;
            const attributeValue = `:${field}`;
            
            updateExpression += `, ${attributeName} = ${attributeValue}`;
            expressionAttributeNames[attributeName] = field;
            expressionAttributeValues[attributeValue] = updates[field];
        }
    });

    const command = new UpdateCommand({
        TableName: EVENTS_TABLE,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
    });

    const result = await docClient.send(command);
    
    // Add custom metric for monitoring
    metrics.addMetric("EventUpdated", "Count", 1);
    
    logger.info("Event updated successfully", { eventId: id });

    return createResponse(200, result.Attributes);
}

/**
 * Delete an event and optionally its associated clips
 * @param id - Event ID to delete
 * @param deleteClips - Whether to also delete associated clips
 * @returns Promise<APIGatewayProxyResult> - Empty response with 204 status
 */
async function deleteEvent(id: string, deleteClips: boolean = false): Promise<APIGatewayProxyResult> {
    logger.info("Deleting event", { eventId: id, deleteClips });
    
    let deletedClipsCount = 0;
    
    // If deleteClips is true, find and delete associated clips
    if (deleteClips) {
        try {
            // Query clips by eventId using the EventIdIndex GSI
            const queryCommand = new QueryCommand({
                TableName: CLIPS_TABLE,
                IndexName: "EventIdIndex",
                KeyConditionExpression: "eventId = :eventId",
                ExpressionAttributeValues: {
                    ":eventId": id,
                },
            });

            const clipResults = await docClient.send(queryCommand);
            const clips = clipResults.Items || [];
            
            if (clips.length > 0) {
                // Batch delete clips (DynamoDB allows max 25 items per batch)
                const batchSize = 25;
                for (let i = 0; i < clips.length; i += batchSize) {
                    const batch = clips.slice(i, i + batchSize);
                    
                    const batchDeleteCommand = new BatchWriteCommand({
                        RequestItems: {
                            [CLIPS_TABLE]: batch.map(clip => ({
                                DeleteRequest: {
                                    Key: { id: clip.id }
                                }
                            }))
                        }
                    });
                    
                    await docClient.send(batchDeleteCommand);
                    deletedClipsCount += batch.length;
                }
                
                logger.info("Deleted associated clips", { eventId: id, deletedClipsCount });
            }
        } catch (error) {
            // Best effort: log error but don't fail event deletion
            logger.error("Failed to delete some clips", { eventId: id, error });
        }
    }

    // Always delete the event
    const command = new DeleteCommand({
        TableName: EVENTS_TABLE,
        Key: { id },
    });

    await docClient.send(command);
    
    // Add custom metrics for monitoring
    metrics.addMetric("EventDeleted", "Count", 1);
    if (deleteClips) {
        metrics.addMetric("ClipsDeleted", "Count", deletedClipsCount);
    }
    
    logger.info("Event deleted successfully", { eventId: id, deletedClipsCount });

    return createResponse(204, { 
        status: "Successfully deleted event",
        deletedClipsCount: deleteClips ? deletedClipsCount : undefined
    });
}

/**
 * Activate an event for Starfish clip generation
 * Deactivates only events on the same MediaLive channel, then activates the target event
 * @param id - Event ID to activate
 * @returns Promise<APIGatewayProxyResult> - Updated event data
 */
async function activateEvent(id: string): Promise<APIGatewayProxyResult> {
    logger.info("Activating event for Starfish", { eventId: id });
    
    try {
        // 1. Get the target event to find its mediaLiveChannel
        const getCommand = new GetCommand({
            TableName: EVENTS_TABLE,
            Key: { id },
        });
        const targetResult = await docClient.send(getCommand);

        if (!targetResult.Item) {
            logger.warn("Event not found for activation", { eventId: id });
            return createResponse(404, { message: "Event not found" });
        }

        const targetEvent = targetResult.Item as Event;
        const channelId = targetEvent.mediaLiveChannel;

        // 2. Find events on the same channel and deactivate them
        if (channelId) {
            // Use the MediaLiveChannelIndex GSI to query events by channel
            const sameChannelEvents: any[] = [];
            let lastEvaluatedKey: Record<string, any> | undefined = undefined;

            do {
                let queryCommand: QueryCommand = new QueryCommand({
                    TableName: EVENTS_TABLE,
                    IndexName: "MediaLiveChannelIndex",
                    KeyConditionExpression: "mediaLiveChannel = :channelId",
                    ExpressionAttributeValues: {
                        ":channelId": channelId,
                    },
                    ExclusiveStartKey: lastEvaluatedKey,
                });

                let queryResult = await docClient.send(queryCommand);
                sameChannelEvents.push(...(queryResult.Items || []));
                lastEvaluatedKey = queryResult.LastEvaluatedKey;
            } while (lastEvaluatedKey);

            // Deactivate only same-channel events
            for (const event of sameChannelEvents) {
                if (event.isActiveForStarfish) {
                    const deactivateCommand = new UpdateCommand({
                        TableName: EVENTS_TABLE,
                        Key: { id: event.id },
                        UpdateExpression: "SET isActiveForStarfish = :false, #updatedAt = :updatedAt",
                        ExpressionAttributeNames: {
                            "#updatedAt": "updatedAt",
                        },
                        ExpressionAttributeValues: {
                            ":false": false,
                            ":updatedAt": new Date().toISOString(),
                        },
                    });
                    await docClient.send(deactivateCommand);
                }
            }
        } else {
            logger.warn("Target event has no mediaLiveChannel, skipping channel-scoped deactivation", { eventId: id });
        }

        // 3. Activate the target event
        const activateCommand = new UpdateCommand({
            TableName: EVENTS_TABLE,
            Key: { id },
            UpdateExpression: "SET isActiveForStarfish = :true, #updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#updatedAt": "updatedAt",
            },
            ExpressionAttributeValues: {
                ":true": true,
                ":updatedAt": new Date().toISOString(),
            },
            ReturnValues: "ALL_NEW",
        });

        const result = await docClient.send(activateCommand);

        // 4. Enable the channel's inference feed clipping output for the active event.
        //    This is a hard requirement — if the feed cannot be enabled, roll back
        //    the activation so the UI doesn't show an active event with no clipping.
        if (channelId && CHANNELS_TABLE && CREATE_FEED_FUNCTION_NAME) {
            try {
                // Look up the channel record to get the feedId
                const channelGetCommand = new GetCommand({
                    TableName: CHANNELS_TABLE,
                    Key: { id: channelId },
                });
                const channelResult = await docClient.send(channelGetCommand);
                const channelRecord = channelResult.Item;

                if (channelRecord?.feedId) {
                    // Invoke the create-feed-lambda with update_callback action
                    // (this also sets status: ENABLED on the clipping output)
                    const feedName = channelRecord.name ? `${channelRecord.name}-feed` : "";
                    const invokeCommand = new InvokeCommand({
                        FunctionName: CREATE_FEED_FUNCTION_NAME,
                        InvocationType: "RequestResponse",
                        Payload: Buffer.from(JSON.stringify({
                            action: "update_callback",
                            feedId: channelRecord.feedId,
                            feedName,
                            callbackMetadata: targetEvent.name,
                        })),
                    });
                    const invokeResult = await lambdaClient.send(invokeCommand);

                    // Check for Lambda-level errors (function error, not HTTP error)
                    if (invokeResult.FunctionError) {
                        const errorPayload = invokeResult.Payload
                            ? JSON.parse(Buffer.from(invokeResult.Payload).toString())
                            : {};
                        throw new Error(errorPayload.errorMessage || "Feed update Lambda returned an error");
                    }

                    logger.info("Feed clipping enabled", {
                        feedId: channelRecord.feedId,
                        eventName: targetEvent.name,
                    });
                } else {
                    logger.warn("Channel has no feedId, skipping feed update", {
                        channelId,
                    });
                }
            } catch (feedError) {
                // Roll back: deactivate the event since clipping won't be running
                logger.error("Failed to enable feed clipping, rolling back activation", {
                    channelId,
                    eventId: id,
                    error: feedError,
                });

                const rollbackCommand = new UpdateCommand({
                    TableName: EVENTS_TABLE,
                    Key: { id },
                    UpdateExpression: "SET isActiveForStarfish = :false, #updatedAt = :updatedAt",
                    ExpressionAttributeNames: { "#updatedAt": "updatedAt" },
                    ExpressionAttributeValues: {
                        ":false": false,
                        ":updatedAt": new Date().toISOString(),
                    },
                });
                await docClient.send(rollbackCommand);

                metrics.addMetric("EventActivationRolledBack", "Count", 1);
                return createResponse(502, {
                    message: "Failed to enable inference clipping for this event. The event was not activated. Please try again.",
                });
            }
        }

        // Add custom metric for monitoring
        metrics.addMetric("EventActivatedForStarfish", "Count", 1);
        
        logger.info("Event activated for Starfish successfully", { 
            eventId: id, 
            channelId: channelId || "none",
        });

        return createResponse(200, result.Attributes);
    } catch (error) {
        logger.error("Error activating event for Starfish", { eventId: id, error });
        return createResponse(500, { message: "Failed to activate event" });
    }
}

/**
 * Deactivate an event — sets isActiveForStarfish to false
 * @param id - Event ID to deactivate
 */
async function deactivateEvent(id: string): Promise<APIGatewayProxyResult> {
    logger.info("Deactivating event for Starfish", { eventId: id });

    try {
        // First, get the event to find its channel
        const getCommand = new GetCommand({
            TableName: EVENTS_TABLE,
            Key: { id },
        });
        const getResult = await docClient.send(getCommand);
        const targetEvent = getResult.Item;

        const command = new UpdateCommand({
            TableName: EVENTS_TABLE,
            Key: { id },
            UpdateExpression: "SET isActiveForStarfish = :false, #updatedAt = :updatedAt",
            ExpressionAttributeNames: { "#updatedAt": "updatedAt" },
            ExpressionAttributeValues: {
                ":false": false,
                ":updatedAt": new Date().toISOString(),
            },
            ReturnValues: "ALL_NEW",
        });

        const result = await docClient.send(command);

        // Disable the Inference feed output to stop clip generation
        let feedDisableWarning: string | undefined;
        const channelId = targetEvent?.mediaLiveChannel;
        if (channelId && CHANNELS_TABLE && CREATE_FEED_FUNCTION_NAME) {
            try {
                const channelGetCommand = new GetCommand({
                    TableName: CHANNELS_TABLE,
                    Key: { id: channelId },
                });
                const channelResult = await docClient.send(channelGetCommand);
                const channelRecord = channelResult.Item;

                if (channelRecord?.feedId) {
                    const feedName = channelRecord.name ? `${channelRecord.name}-feed` : "";
                    const invokeCommand = new InvokeCommand({
                        FunctionName: CREATE_FEED_FUNCTION_NAME,
                        InvocationType: "RequestResponse",
                        Payload: Buffer.from(JSON.stringify({
                            action: "disable_feed",
                            feedId: channelRecord.feedId,
                            feedName,
                        })),
                    });
                    const invokeResult = await lambdaClient.send(invokeCommand);

                    if (invokeResult.FunctionError) {
                        const errorPayload = invokeResult.Payload
                            ? JSON.parse(Buffer.from(invokeResult.Payload).toString())
                            : {};
                        throw new Error(errorPayload.errorMessage || "Feed disable Lambda returned an error");
                    }

                    logger.info("Feed output disabled on deactivation", {
                        feedId: channelRecord.feedId,
                        channelId,
                    });
                }
            } catch (feedError) {
                // Event is already deactivated — warn but don't fail
                feedDisableWarning = "Event was deactivated but inference clipping may still be running. It will stop automatically within 1 minute.";
                logger.error("Failed to disable feed on deactivation", {
                    channelId,
                    eventId: id,
                    error: feedError,
                });
            }
        }

        metrics.addMetric("EventDeactivatedForStarfish", "Count", 1);
        logger.info("Event deactivated for Starfish", { eventId: id });

        const responseBody: any = { ...result.Attributes };
        if (feedDisableWarning) {
            responseBody.warning = feedDisableWarning;
        }
        return createResponse(200, responseBody);
    } catch (error) {
        logger.error("Error deactivating event", { eventId: id, error });
        return createResponse(500, { message: "Failed to deactivate event" });
    }
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
        body: JSON.stringify(body),
    };
}