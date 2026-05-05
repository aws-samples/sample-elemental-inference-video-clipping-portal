import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambdaClient = new LambdaClient({});
const MEDIALIVE_API_CLIENT_FUNCTION_NAME = process.env.MEDIALIVE_API_CLIENT_FUNCTION_NAME!;

const CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

async function invokeMediaLiveClient(action: string, params: Record<string, any>): Promise<any> {
    const command = new InvokeCommand({
        FunctionName: MEDIALIVE_API_CLIENT_FUNCTION_NAME,
        Payload: JSON.stringify({ action, params }),
    });
    const response = await lambdaClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    if (result.statusCode !== 200) {
        const errorBody = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
        throw new Error(errorBody?.error || "MediaLive API error");
    }
    return typeof result.body === "string" ? JSON.parse(result.body) : result.body;
}

async function invokeAndRespond(action: string, params: Record<string, any>): Promise<APIGatewayProxyResultV2> {
    try {
        const data = await invokeMediaLiveClient(action, params);
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
    } catch (error: any) {
        console.error("Error in " + action + ":", error);
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: error.message }) };
    }
}

async function handleStatus(channelId: string): Promise<APIGatewayProxyResultV2> {
    const data = await invokeMediaLiveClient("describe_channel", { channel_id: channelId });
    const ch = data.channel;
    return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
            id: ch.Id,
            name: ch.Name,
            state: ch.State,
            arn: ch.Arn,
            mediaPackageSettings: ch.Destinations?.[0]?.MediaPackageSettings?.[0],
            starfishSettings: ch.StarfishSettings,
            sourceEndBehavior: ch.InputAttachments?.[0]?.InputSettings?.SourceEndBehavior,
        }),
    };
}

async function handleThumbnail(channelId: string): Promise<APIGatewayProxyResultV2> {
    const data = await invokeMediaLiveClient("describe_channel", { channel_id: channelId });
    const thumbnails: Array<{ body: string }> = [];
    if (data.channel.State === "RUNNING") {
        try {
            const thumbData = await invokeMediaLiveClient("describe_thumbnails", {
                channel_id: channelId, pipeline_id: "0", thumbnail_type: "CURRENT_ACTIVE",
            });
            for (const detail of thumbData?.thumbnails?.ThumbnailDetails || []) {
                for (const thumb of detail.Thumbnails || []) {
                    if (thumb.Body) thumbnails.push({ body: thumb.Body });
                }
            }
        } catch (e) { console.warn("DescribeThumbnails unavailable:", e); }
    }
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ thumbnails }) };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    console.log("Event:", JSON.stringify(event, null, 2));
    const channelId = event.pathParameters?.channelId;
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (!channelId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing channelId" }) };
    }

    try {
        if (method === "POST" && path.endsWith("/start")) return await invokeAndRespond("start_channel", { channel_id: channelId });
        if (method === "POST" && path.endsWith("/stop")) return await invokeAndRespond("stop_channel", { channel_id: channelId });
        if (method === "GET" && path.endsWith("/thumbnail")) return await handleThumbnail(channelId);
        return await handleStatus(channelId);
    } catch (error: any) {
        console.error("Error:", error);
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Internal server error" }) };
    }
};