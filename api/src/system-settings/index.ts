/**
 * System Settings API Lambda
 * Provides GET and PUT endpoints for managing system-wide configuration settings.
 */

import { APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const logger = new Logger();
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const SYSTEM_SETTINGS_TABLE = process.env.SYSTEM_SETTINGS_TABLE!;

const VALID_BOOLEANS = new Set(["true", "false"]);
const MIN_BUFFER_SECONDS = 0;
const MAX_BUFFER_SECONDS = 5;

interface SettingValidation {
    validate: (value: string) => string | null;
}

const booleanValidator: SettingValidation = {
    validate: (value: string) => {
        if (!VALID_BOOLEANS.has(value)) {
            return `Invalid value. Must be one of: true, false`;
        }
        return null;
    },
};

const VALID_CONFLICT_RESOLUTIONS = new Set(["prefer_running", "prefer_latest_start"]);

const KNOWN_SETTING_KEYS = new Set([
    "autoHarvest",
    "harvestBufferSeconds",
    "autoActivateInference",
    "autoActivateConflictResolution",
    "harvestRetentionDays",
    "harvestCleanupDryRun",
]);

const SETTING_VALIDATORS: Record<string, SettingValidation> = {
    autoHarvest: booleanValidator,
    harvestBufferSeconds: {
        validate: (value: string) => {
            const num = Number(value);
            if (!Number.isInteger(num) || num < MIN_BUFFER_SECONDS || num > MAX_BUFFER_SECONDS) {
                return `Invalid value for harvestBufferSeconds. Must be an integer between ${MIN_BUFFER_SECONDS} and ${MAX_BUFFER_SECONDS}`;
            }
            return null;
        },
    },
    autoActivateInference: booleanValidator,
    autoActivateConflictResolution: {
        validate: (value: string) => {
            if (!VALID_CONFLICT_RESOLUTIONS.has(value)) {
                return `Invalid value. Must be one of: prefer_running, prefer_latest_start`;
            }
            return null;
        },
    },
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResult> => {
    logger.info("Processing settings request", { event });

    try {
        const method = event.requestContext.http.method;
        const settingKey = event.pathParameters?.settingKey;

        if (!settingKey) {
            return createResponse(400, { message: "Setting key is required" });
        }

        if (method === "GET") {
            return await getSetting(settingKey);
        }

        if (method === "PUT") {
            return await putSetting(settingKey, event.body);
        }

        return createResponse(405, { message: "Method not allowed" });
    } catch (error) {
        logger.error("Error processing settings request", { error });
        return createResponse(500, { message: "Internal server error" });
    }
};

async function getSetting(settingKey: string): Promise<APIGatewayProxyResult> {
    logger.info("Getting setting", { settingKey });

    const result = await docClient.send(
        new GetCommand({
            TableName: SYSTEM_SETTINGS_TABLE,
            Key: { settingKey },
        })
    );

    if (!result.Item) {
        return createResponse(404, { message: `Setting '${settingKey}' not found` });
    }

    return createResponse(200, result.Item);
}

async function putSetting(settingKey: string, body: string | undefined): Promise<APIGatewayProxyResult> {
    logger.info("Updating setting", { settingKey });

    if (!KNOWN_SETTING_KEYS.has(settingKey)) {
        return createResponse(400, { message: `Unknown setting key: '${settingKey}'` });
    }

    if (!body) {
        return createResponse(400, { message: "Request body is required" });
    }

    let parsed: { settingValue?: string };
    try {
        parsed = JSON.parse(body);
    } catch {
        return createResponse(400, { message: "Invalid JSON in request body" });
    }

    if (parsed.settingValue === undefined || parsed.settingValue === null) {
        return createResponse(400, { message: "settingValue is required" });
    }

    const settingValue = String(parsed.settingValue);

    const validator = SETTING_VALIDATORS[settingKey];
    if (validator) {
        const error = validator.validate(settingValue);
        if (error) {
            return createResponse(400, { message: error });
        }
    }

    const updatedAt = new Date().toISOString();

    await docClient.send(
        new PutCommand({
            TableName: SYSTEM_SETTINGS_TABLE,
            Item: {
                settingKey,
                settingValue,
                updatedAt,
            },
        })
    );

    return createResponse(200, { settingKey, settingValue, updatedAt });
}

function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
        },
        body: JSON.stringify(body),
    };
}
