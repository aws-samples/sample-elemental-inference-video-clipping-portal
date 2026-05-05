#!/usr/bin/env python3
"""
Channels API Lambda Function (Python)

Handles channel creation orchestration with native Elemental Inference support.
Replaces the TypeScript channels handler to leverage boto3's elementalinference client.

Supported operations:
- GET /api/channels - List all channels
- GET /api/channels/{id} - Get specific channel
- POST /api/channels - Create new channel (orchestrates MediaPackageV2, Elemental Inference, MediaLive)
"""

import os
import json
from typing import Dict, Any, Optional
from datetime import datetime
from urllib.parse import unquote

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="channels-api")
tracer = Tracer(service="channels-api")
metrics = Metrics(namespace="ChannelsAPI", service="channels-api")

# Environment variables
CHANNELS_TABLE_NAME = os.environ.get("CHANNELS_TABLE_NAME", "")
MEDIALIVE_API_CLIENT_FUNCTION_NAME = os.environ.get("MEDIALIVE_API_CLIENT_FUNCTION_NAME", "")
CLOUDFORMATION_STACK_NAME = os.environ.get("CLOUDFORMATION_STACK_NAME", "elemental-clip-portal")
CHANNEL_GROUP_NAME = os.environ.get("CHANNEL_GROUP_NAME", "")
CHANNEL_CREATION_STATE_MACHINE_ARN = os.environ.get("CHANNEL_CREATION_STATE_MACHINE_ARN", "")
CHANNEL_DELETION_STATE_MACHINE_ARN = os.environ.get("CHANNEL_DELETION_STATE_MACHINE_ARN", "")
INFERENCE_STAGE = os.environ.get("INFERENCE_STAGE", "prod")
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

# AWS clients
dynamodb = boto3.resource("dynamodb")
cfn_client = boto3.client("cloudformation")
lambda_client = boto3.client("lambda")
sfn_client = boto3.client("stepfunctions")

# Cache for CloudFormation outputs
_cached_cfn_outputs: Optional[Dict[str, str]] = None

RESPONSE_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
}


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """Route API Gateway requests to appropriate handler."""
    logger.info("Received event", extra={"event": event})

    try:
        http_method = event["requestContext"]["http"]["method"]
        path_params = event.get("pathParameters") or {}
        channel_id = path_params.get("id")
        execution_arn_param = path_params.get("executionArn")

        if http_method == "GET" and execution_arn_param:
            decoded_arn = unquote(execution_arn_param)
            return handle_get_status(decoded_arn)

        if http_method == "POST" and not channel_id:
            return handle_create_channel(event)

        if http_method == "GET" and not channel_id:
            return handle_list_channels()

        if http_method == "GET" and channel_id:
            return handle_get_channel(channel_id)

        if http_method == "DELETE" and channel_id:
            return handle_delete_channel(channel_id)

        return _response(404, {"error": "Not found"})

    except Exception as e:
        logger.error("Unhandled error", exc_info=True)
        return _response(500, {"error": str(e)})


@tracer.capture_method
def handle_list_channels() -> Dict[str, Any]:
    """List all channels from DynamoDB."""
    table = dynamodb.Table(CHANNELS_TABLE_NAME)
    items = []
    last_key = None

    while True:
        scan_kwargs = {}
        if last_key:
            scan_kwargs["ExclusiveStartKey"] = last_key
        result = table.scan(**scan_kwargs)
        items.extend(result.get("Items", []))
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break

    return _response(200, items)


@tracer.capture_method
def handle_get_channel(channel_id: str) -> Dict[str, Any]:
    """Get a specific channel by ID."""
    table = dynamodb.Table(CHANNELS_TABLE_NAME)
    result = table.get_item(Key={"id": channel_id})
    item = result.get("Item")
    if not item:
        return _response(404, {"error": "Channel not found"})
    return _response(200, item)



@tracer.capture_method
def handle_delete_channel(channel_id: str) -> Dict[str, Any]:
    """
    Start Step Functions execution for channel deletion.

    Reads the channel record to get all resource IDs, sets provisioningStatus
    to DELETING, then starts the DeleteChannel state machine.
    Returns the execution ARN immediately (async).
    """
    logger.info("Starting channel deletion workflow", extra={"channel_id": channel_id})

    # Read channel record to get resource IDs for the state machine input
    table = dynamodb.Table(CHANNELS_TABLE_NAME)
    try:
        result = table.get_item(Key={"id": channel_id})
        channel = result.get("Item")
    except Exception as e:
        logger.error("Failed to read channel record", exc_info=True)
        return _response(500, {"error": f"Failed to read channel record: {e}"})

    if not channel:
        return _response(404, {"error": "Channel not found"})

    # Update provisioningStatus to DELETING
    try:
        table.update_item(
            Key={"id": channel_id},
            UpdateExpression="SET provisioningStatus = :status, updatedAt = :now",
            ExpressionAttributeValues={
                ":status": "DELETING",
                ":now": datetime.now().isoformat() + "Z",
            },
        )
    except Exception as e:
        logger.error("Failed to update provisioningStatus", exc_info=True)
        return _response(500, {"error": f"Failed to update channel status: {e}"})

    # Build state machine input from channel record
    sfn_input = {
        "channelId": channel_id,
        "channelGroupName": channel.get("channelGroupName", CHANNEL_GROUP_NAME),
        "mediaPackageChannelName": channel.get("mediaPackageChannelName", ""),
        "inputId": channel.get("inputId", ""),
        "feedId": channel.get("feedId", ""),
        "originEndpointName": channel.get("originEndpointName", ""),
        "landscapeEndpointName": channel.get("landscapeEndpointName", ""),
        "verticalEndpointName": channel.get("verticalEndpointName", ""),
    }

    try:
        execution_response = sfn_client.start_execution(
            stateMachineArn=CHANNEL_DELETION_STATE_MACHINE_ARN,
            name=f"delete-{channel_id}-{int(datetime.now().timestamp())}",
            input=json.dumps(sfn_input, default=str),
        )

        execution_arn = execution_response["executionArn"]
        logger.info("DeleteChannel execution started", extra={
            "execution_arn": execution_arn,
            "channel_id": channel_id,
        })
        metrics.add_metric(name="ChannelDeletionStarted", unit=MetricUnit.Count, value=1)

        return _response(202, {
            "executionArn": execution_arn,
            "status": "DELETING",
        })

    except ClientError as e:
        logger.error("Failed to start channel deletion workflow", exc_info=True)
        return _response(500, {"error": str(e)})


@tracer.capture_method
def handle_get_status(execution_arn: str) -> Dict[str, Any]:
    """Poll Step Functions execution status for channel creation progress."""
    try:
        result = sfn_client.describe_execution(executionArn=execution_arn)
        status = result["status"]

        if status == "RUNNING":
            return _response(200, {
                "status": "CREATING",
                "executionArn": execution_arn,
            })

        if status == "SUCCEEDED":
            output = json.loads(result.get("output", "{}"))
            return _response(200, {
                "status": "ACTIVE",
                "executionArn": execution_arn,
                "output": output,
            })

        # FAILED, TIMED_OUT, ABORTED
        error = result.get("error", status)
        cause = result.get("cause", "")
        return _response(200, {
            "status": "FAILED",
            "executionArn": execution_arn,
            "error": {"error": error, "cause": cause},
        })

    except ClientError as e:
        logger.error("Failed to describe execution", exc_info=True)
        return _response(500, {"error": str(e)})


@tracer.capture_method
def handle_create_channel(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Start Step Functions execution for channel creation.

    Passes channel parameters as input to the state machine which orchestrates:
    MediaPackageV2 channel, origin endpoints, endpoint policies, inference feed,
    MediaLive input/channel, and DynamoDB persistence (saga pattern).

    Returns the execution ARN immediately (async).
    """
    try:
        body = event.get("body")
        if not body:
            return _response(400, {"error": "Missing request body"})

        request = json.loads(body)

        # Validate required fields
        required = ["channelName", "inputType", "inputName", "encoderSettings"]
        missing = [f for f in required if not request.get(f)]
        if missing:
            return _response(400, {"error": f"Missing required fields: {', '.join(missing)}"})

        # Validate inputUrl is a valid S3 URI if provided
        input_url_raw = request.get("inputUrl", "")
        if input_url_raw and not input_url_raw.startswith("s3://"):
            return _response(400, {"error": "inputUrl must be an S3 URI (s3://bucket/key)"})
        if input_url_raw and ".." in input_url_raw:
            return _response(400, {"error": "inputUrl contains invalid path"})

        channel_name = request["channelName"]
        logger.info("Starting channel creation workflow", extra={"channel_name": channel_name})

        # Resolve channel group name
        channel_group_name = _get_channel_group_name()

        # Build input sources from request
        input_sources = request.get("inputSources", [])
        if not input_sources and request.get("inputUrl"):
            input_url = request["inputUrl"]
            # Use s3ssl:// for S3 sources to ensure MediaLive uses TLS/HTTPS
            if input_url.startswith("s3://"):
                input_url = "s3ssl://" + input_url[5:]
            input_sources = [
                {"Url": input_url},
                {"Url": input_url},
            ]

        # Build Step Functions input matching the state machine ASL expectations
        sfn_input = {
            "channelName": channel_name,
            "channelGroupName": channel_group_name,
            "inputName": request["inputName"],
            "inputType": request["inputType"],
            "inputSources": input_sources,
            "encoderSettings": request["encoderSettings"],
            "region": AWS_REGION,
        }

        # Start the Step Functions execution
        execution_response = sfn_client.start_execution(
            stateMachineArn=CHANNEL_CREATION_STATE_MACHINE_ARN,
            name=f"create-{channel_name}-{int(datetime.now().timestamp())}",
            input=json.dumps(sfn_input, default=str),
        )

        execution_arn = execution_response["executionArn"]
        logger.info("Step Functions execution started", extra={
            "execution_arn": execution_arn,
            "channel_name": channel_name,
        })
        metrics.add_metric(name="ChannelCreationStarted", unit=MetricUnit.Count, value=1)

        return _response(202, {
            "executionArn": execution_arn,
            "status": "CREATING",
        })

    except ClientError as e:
        logger.error("Failed to start channel creation workflow", exc_info=True)
        metrics.add_metric(name="ChannelCreationFailed", unit=MetricUnit.Count, value=1)
        return _response(500, {"error": str(e)})



# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _get_channel_group_name() -> str:
    """
    Resolve the MediaPackageV2 channel group name.
    Prefers the CHANNEL_GROUP_NAME env var (set directly from CDK).
    Falls back to CloudFormation stack outputs.
    """
    if CHANNEL_GROUP_NAME:
        return CHANNEL_GROUP_NAME

    global _cached_cfn_outputs
    if _cached_cfn_outputs and "MediaPackageV2ChannelGroupName" in _cached_cfn_outputs:
        return _cached_cfn_outputs["MediaPackageV2ChannelGroupName"]

    response = cfn_client.describe_stacks(StackName=CLOUDFORMATION_STACK_NAME)
    stacks = response.get("Stacks", [])
    if not stacks or not stacks[0].get("Outputs"):
        raise RuntimeError("CloudFormation stack outputs not found")

    _cached_cfn_outputs = {
        o["OutputKey"]: o["OutputValue"]
        for o in stacks[0]["Outputs"]
        if o.get("OutputKey") and o.get("OutputValue")
    }

    name = _cached_cfn_outputs.get("MediaPackageV2ChannelGroupName")
    if not name:
        raise RuntimeError("MediaPackageV2ChannelGroupName not found in stack outputs")
    return name


@tracer.capture_method
def _invoke_medialive_client(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Invoke the medialive-api-client Lambda and return parsed body."""
    response = lambda_client.invoke(
        FunctionName=MEDIALIVE_API_CLIENT_FUNCTION_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload),
    )

    result = json.loads(response["Payload"].read())

    if result.get("statusCode") != 200:
        error_body = json.loads(result.get("body", "{}"))
        raise RuntimeError(error_body.get("error", "MediaLive API Client error"))

    return json.loads(result["body"])






def _response(status_code: int, body: Any) -> Dict[str, Any]:
    """Build an API Gateway proxy response."""
    return {
        "statusCode": status_code,
        "headers": RESPONSE_HEADERS,
        "body": json.dumps(body, default=str),
    }
