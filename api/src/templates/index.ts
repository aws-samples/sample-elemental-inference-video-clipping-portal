/**
 * Templates Lambda Function
 * 
 * Handles CRUD operations for reel templates - predefined configurations for creating reels
 * Templates define output settings, formats, and default parameters
 * 
 * Endpoints:
 * - GET /api/templates - List all templates
 * - GET /api/templates/{id} - Get specific template by ID
 * - POST /api/templates - Create new template
 * - PUT /api/templates/{id} - Update existing template
 * - DELETE /api/templates/{id} - Delete template
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
} from "@aws-sdk/lib-dynamodb";

// Initialize AWS Lambda Powertools for observability
const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

// Initialize DynamoDB client with tracing
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE!;

/**
 * Template interface - unified for both regular templates and auto-highlight templates
 */
interface Template {
    id: string;
    name: string;
    resolution: string;
    format: string;
    backgroundMusic: boolean;
    clipLength: number;
    createdAt: string;
    updatedAt: string;
    keyMoments: string[];
    gameType: string;
    // Auto-highlight specific fields
    eventId?: string;           // Optional: associate with specific event
    autoGenerate?: boolean;     // Whether to auto-generate highlights (default: false)
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

        // Route requests based on HTTP method
        switch (method) {
            case "GET":
                if (pathParameters?.id) {
                    return await getTemplate(pathParameters.id);
                } else {
                    // Check for query parameters to filter by eventId or gameType
                    const queryParams = event.queryStringParameters;
                    if (queryParams?.eventId) {
                        return await getTemplatesByEvent(queryParams.eventId);
                    } else if (queryParams?.gameType) {
                        return await getTemplatesByGameType(queryParams.gameType);
                    } else if (queryParams?.autoGenerate) {
                        return await getAutoGenerateTemplates();
                    } else {
                        return await listTemplates();
                    }
                }
            case "POST":
                return await createTemplate(JSON.parse(event.body || "{}"));
            case "PUT":
                if (pathParameters?.id) {
                    return await updateTemplate(pathParameters.id, JSON.parse(event.body || "{}"));
                }
                break;
            case "DELETE":
                if (pathParameters?.id) {
                    return await deleteTemplate(pathParameters.id);
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
 * Retrieve all templates from the database
 * @returns Promise<APIGatewayProxyResult> - List of all templates
 */
async function listTemplates(): Promise<APIGatewayProxyResult> {
    logger.info("Listing all templates");
    
    const items: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;

    do {
        let command: ScanCommand = new ScanCommand({
            TableName: TEMPLATES_TABLE,
            ExclusiveStartKey: lastEvaluatedKey,
        });

        let result = await docClient.send(command);
        items.push(...(result.Items || []));
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    // Add custom metric for monitoring
    metrics.addMetric("TemplatesListed", "Count", items.length);
    
    return createResponse(200, items);
}

/**
 * Get templates by event ID
 */
async function getTemplatesByEvent(eventId: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting templates by event", { eventId });
    
    const items: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;

    do {
        let command: ScanCommand = new ScanCommand({
            TableName: TEMPLATES_TABLE,
            FilterExpression: "eventId = :eventId",
            ExpressionAttributeValues: {
                ":eventId": eventId,
            },
            ExclusiveStartKey: lastEvaluatedKey,
        });

        let result = await docClient.send(command);
        items.push(...(result.Items || []));
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    return createResponse(200, items);
}

/**
 * Get templates by game type
 */
async function getTemplatesByGameType(gameType: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting templates by game type", { gameType });
    
    const items: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;

    do {
        let command: ScanCommand = new ScanCommand({
            TableName: TEMPLATES_TABLE,
            FilterExpression: "gameType = :gameType",
            ExpressionAttributeValues: {
                ":gameType": gameType,
            },
            ExclusiveStartKey: lastEvaluatedKey,
        });

        let result = await docClient.send(command);
        items.push(...(result.Items || []));
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    return createResponse(200, items);
}

/**
 * Get auto-generate templates
 */
async function getAutoGenerateTemplates(): Promise<APIGatewayProxyResult> {
    logger.info("Getting auto-generate templates");
    
    const items: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;

    do {
        let command: ScanCommand = new ScanCommand({
            TableName: TEMPLATES_TABLE,
            FilterExpression: "autoGenerate = :autoGenerate",
            ExpressionAttributeValues: {
                ":autoGenerate": true,
            },
            ExclusiveStartKey: lastEvaluatedKey,
        });

        let result = await docClient.send(command);
        items.push(...(result.Items || []));
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    return createResponse(200, items);
}

/**
 * Retrieve a specific template by ID
 * @param id - Template ID to retrieve
 * @returns Promise<APIGatewayProxyResult> - Template data or 404 if not found
 */
async function getTemplate(id: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting template", { templateId: id });
    
    const command = new GetCommand({
        TableName: TEMPLATES_TABLE,
        Key: { id },
    });

    const result = await docClient.send(command);

    if (!result.Item) {
        logger.warn("Template not found", { templateId: id });
        return createResponse(404, { message: "Template not found" });
    }

    return createResponse(200, result.Item);
}

/**
 * Create a new template
 * Sets up default configuration for reel creation
 * @param templateData - Partial template data from request body
 * @returns Promise<APIGatewayProxyResult> - Created template data
 */
async function createTemplate(templateData: Partial<Template>): Promise<APIGatewayProxyResult> {
    logger.info("Creating new template", { templateData });
    
    const now = new Date().toISOString();
    
    // Build complete template object with defaults
    const template: Template = {
        id: `template-${Date.now()}`,
        name: templateData.name || "",
        resolution: templateData.resolution || "1080p",
        format: templateData.format || "MP4",
        backgroundMusic: templateData.backgroundMusic || false,
        clipLength: templateData.clipLength || 30,
        createdAt: now,
        updatedAt: now,
        keyMoments: templateData.keyMoments || [],
        gameType: templateData.gameType || "football",
        autoGenerate: templateData.autoGenerate || false,
        ...(templateData.eventId && { eventId: templateData.eventId }),
    };

    const command = new PutCommand({
        TableName: TEMPLATES_TABLE,
        Item: template,
    });

    await docClient.send(command);
    
    // Add custom metric for monitoring
    metrics.addMetric("TemplateCreated", "Count", 1);
    
    logger.info("Template created successfully", { templateId: template.id });

    return createResponse(201, template);
}

/**
 * Update an existing template
 * Can modify all template settings and parameters
 * @param id - Template ID to update
 * @param updates - Partial template data with updates
 * @returns Promise<APIGatewayProxyResult> - Updated template data
 */
async function updateTemplate(id: string, updates: Partial<Template>): Promise<APIGatewayProxyResult> {
    logger.info("Updating template", { templateId: id, updates });
    
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
    const updateFields: (keyof Template)[] = [
        "name", "resolution", "format", "backgroundMusic", "clipLength", 
        "gameType", "keyMoments", "eventId", "autoGenerate"
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
        TableName: TEMPLATES_TABLE,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
    });

    const result = await docClient.send(command);
    
    // Add custom metric for monitoring
    metrics.addMetric("TemplateUpdated", "Count", 1);
    
    logger.info("Template updated successfully", { templateId: id });

    return createResponse(200, result.Attributes);
}

/**
 * Delete a template
 * @param id - Template ID to delete
 * @returns Promise<APIGatewayProxyResult> - Empty response with 204 status
 */
async function deleteTemplate(id: string): Promise<APIGatewayProxyResult> {
    logger.info("Deleting template", { templateId: id });
    
    const command = new DeleteCommand({
        TableName: TEMPLATES_TABLE,
        Key: { id },
    });

    await docClient.send(command);
    
    // Add custom metric for monitoring
    metrics.addMetric("TemplateDeleted", "Count", 1);
    
    logger.info("Template deleted successfully", { templateId: id });

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