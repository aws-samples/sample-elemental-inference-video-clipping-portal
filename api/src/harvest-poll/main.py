"""
Harvest Poll Lambda

Polls MediaPackage V2 harvest job status.
Invoked by Step Functions (Download and AutoHarvest state machines).
"""

import os
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="harvest-poll")

mediapackagev2_client = boto3.client("mediapackagev2")

# Environment variable defaults for legacy channels
MEDIAPACKAGE_CHANNEL_GROUP = os.environ.get("MEDIAPACKAGE_CHANNEL_GROUP", "")
MEDIAPACKAGE_CHANNEL_NAME = os.environ.get("MEDIALIVE_CHANNEL_NAME", "")
MEDIAPACKAGE_ORIGIN_ENDPOINT = os.environ.get("MEDIAPACKAGE_ORIGIN_ENDPOINT_ID", "")


@logger.inject_lambda_context
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Poll a MediaPackage V2 harvest job for its current status.

    Input:
        harvestJobName, channelConfig, correlationId

    Output:
        status ("QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED"), harvestJobName
    """
    harvest_job_name = event["harvestJobName"]
    correlation_id = event.get("correlationId", "unknown")
    channel_config = event.get("channelConfig") or {}

    logger.append_keys(correlationId=correlation_id, harvestJobName=harvest_job_name)

    # Resolve channel group, channel name, and origin endpoint from config or defaults
    channel_group = channel_config.get("channelGroup", MEDIAPACKAGE_CHANNEL_GROUP)
    channel_name = channel_config.get("channelName", MEDIAPACKAGE_CHANNEL_NAME)
    origin_endpoint = channel_config.get("originEndpoint", MEDIAPACKAGE_ORIGIN_ENDPOINT)

    try:
        response = mediapackagev2_client.get_harvest_job(
            ChannelGroupName=channel_group,
            ChannelName=channel_name,
            OriginEndpointName=origin_endpoint,
            HarvestJobName=harvest_job_name,
        )
        status = response.get("Status", "QUEUED")
    except ClientError as e:
        logger.error("Failed to poll harvest job", extra={"error": str(e)})
        raise

    logger.info("Harvest job status", extra={"status": status})

    return {
        "status": status,
        "harvestJobName": harvest_job_name,
    }
