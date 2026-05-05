"""
Harvest Task Lambda

Creates a MediaPackage V2 harvest job for a single orientation.
Invoked by Step Functions (Download and AutoHarvest state machines).
"""

import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="harvest-task")

mediapackagev2_client = boto3.client("mediapackagev2")
dynamodb = boto3.resource("dynamodb")

# Environment variable defaults for legacy channels
MEDIAPACKAGE_CHANNEL_GROUP = os.environ.get("MEDIAPACKAGE_CHANNEL_GROUP", "")
MEDIAPACKAGE_CHANNEL_NAME = os.environ.get("MEDIALIVE_CHANNEL_NAME", "")
MEDIAPACKAGE_LANDSCAPE_ENDPOINT = os.environ.get("MEDIAPACKAGE_LANDSCAPE_ENDPOINT", "")
MEDIAPACKAGE_VERTICAL_ENDPOINT = os.environ.get("MEDIAPACKAGE_VERTICAL_ENDPOINT", "")
VIDEO_ASSETS_BUCKET = os.environ.get("VIDEO_ASSETS_BUCKET", "")
HARVEST_JOBS_TABLE_NAME = os.environ.get("HARVEST_JOBS_TABLE_NAME", "")
CHANNELS_TABLE_NAME = os.environ.get("CHANNELS_TABLE_NAME", "")
SYSTEM_SETTINGS_TABLE = os.environ.get("SYSTEM_SETTINGS_TABLE", "")


def read_system_setting(table_name: str, setting_key: str, default_value: str) -> str:
    """Read a setting from the System Settings table."""
    if not table_name:
        return default_value
    try:
        table = dynamodb.Table(table_name)
        response = table.get_item(Key={"settingKey": setting_key})
        item = response.get("Item")
        if item and "settingValue" in item:
            return item["settingValue"]
        return default_value
    except Exception as e:
        logger.warning("Failed to read system setting", extra={
            "setting_key": setting_key, "default_value": default_value, "error": str(e),
        })
        return default_value


def get_channel_record(channel_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve channel record from the Channels table."""
    if not channel_id or not CHANNELS_TABLE_NAME:
        return None
    try:
        table = dynamodb.Table(CHANNELS_TABLE_NAME)
        response = table.get_item(Key={"id": channel_id})
        return response.get("Item")
    except Exception as e:
        logger.warning("Failed to get channel record, using defaults", extra={
            "channel_id": channel_id, "error": str(e),
        })
        return None


def resolve_channel_config(channel_id: str, channel_config: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Resolve MediaPackage resource names from channel config or DynamoDB, falling back to env defaults."""
    # If caller provided explicit channel config, use it
    if channel_config and channel_config.get("channelGroup"):
        return {
            "channelGroup": channel_config["channelGroup"],
            "channelName": channel_config["channelName"],
            "landscapeEndpoint": channel_config.get("landscapeEndpoint", MEDIAPACKAGE_LANDSCAPE_ENDPOINT),
            "verticalEndpoint": channel_config.get("verticalEndpoint", MEDIAPACKAGE_VERTICAL_ENDPOINT),
        }

    # Try to resolve from Channels table
    record = get_channel_record(channel_id)
    if record:
        return {
            "channelGroup": record.get("channelGroupName", MEDIAPACKAGE_CHANNEL_GROUP),
            "channelName": record.get("mediaPackageChannelName", MEDIAPACKAGE_CHANNEL_NAME),
            "landscapeEndpoint": record.get("landscapeEndpointName", MEDIAPACKAGE_LANDSCAPE_ENDPOINT),
            "verticalEndpoint": record.get("verticalEndpointName", MEDIAPACKAGE_VERTICAL_ENDPOINT),
        }

    # Fall back to environment variable defaults
    return {
        "channelGroup": MEDIAPACKAGE_CHANNEL_GROUP,
        "channelName": MEDIAPACKAGE_CHANNEL_NAME,
        "landscapeEndpoint": MEDIAPACKAGE_LANDSCAPE_ENDPOINT,
        "verticalEndpoint": MEDIAPACKAGE_VERTICAL_ENDPOINT,
    }


def get_origin_endpoint(config: Dict[str, str], orientation: str) -> str:
    """Return the origin endpoint name for the given orientation."""
    if orientation == "portrait":
        return config["verticalEndpoint"]
    return config["landscapeEndpoint"]


def apply_harvest_buffer(start_time_iso: str, end_time_iso: str, buffer_seconds: int) -> tuple:
    """Apply symmetric buffer to harvest window."""
    if buffer_seconds <= 0:
        return start_time_iso, end_time_iso
    start_dt = datetime.fromisoformat(start_time_iso.replace("Z", "+00:00"))
    end_dt = datetime.fromisoformat(end_time_iso.replace("Z", "+00:00"))
    start_dt -= timedelta(seconds=buffer_seconds)
    end_dt += timedelta(seconds=buffer_seconds)
    fmt = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return fmt(start_dt), fmt(end_dt)


def build_s3_prefix(channel_id: str, clip_id: str, orientation: str) -> str:
    """Build the S3 prefix for harvest output."""
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    return f"harvested-clips/{channel_id}/{date_str}/{clip_id}/{orientation}/"


def save_harvest_job_record(
    job_id: str, clip_id: str, channel_id: str, orientation: str,
    harvest_job_name: str, s3_prefix: str, correlation_id: str,
) -> None:
    """Save a Harvest_Job_Record to the HarvestJobs DynamoDB table."""
    table = dynamodb.Table(HARVEST_JOBS_TABLE_NAME)
    now = datetime.utcnow().isoformat() + "Z"
    table.put_item(Item={
        "job_id": job_id,
        "clip_id": clip_id,
        "channel_id": channel_id,
        "orientation": orientation,
        "status": "pending",
        "mediapackage_job_id": harvest_job_name,
        "s3_location": s3_prefix,
        "correlation_id": correlation_id,
        "created_at": now,
        "updated_at": now,
    })


@logger.inject_lambda_context
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Create a MediaPackage V2 harvest job for a single orientation.

    Input:
        clipId, channelId, orientation, startTime, endTime, correlationId,
        channelConfig (optional)

    Output:
        harvestJobName, s3Prefix, orientation, harvestJobRecordId
    """
    clip_id = event["clipId"]
    channel_id = event["channelId"]
    orientation = event["orientation"]
    start_time = event["startTime"]
    end_time = event["endTime"]
    correlation_id = event.get("correlationId", "unknown")
    channel_config_input = event.get("channelConfig")

    logger.append_keys(correlationId=correlation_id, clipId=clip_id, orientation=orientation)
    logger.info("Starting harvest task", extra={
        "channelId": channel_id, "startTime": start_time, "endTime": end_time,
    })

    # Resolve channel config
    config = resolve_channel_config(channel_id, channel_config_input)
    logger.info("Channel config resolved", extra={
        "channelGroup": config["channelGroup"],
        "channelName": config["channelName"],
    })

    # Note: harvest buffer is already applied by the harvest pipeline before passing
    # startTime/endTime to the state machine. Do NOT re-apply here.
    buffered_start = start_time
    buffered_end = end_time

    # Build harvest job parameters
    harvest_job_name = f"harvest-{clip_id}-{orientation}-{int(datetime.utcnow().timestamp())}"
    s3_prefix = build_s3_prefix(channel_id, clip_id, orientation)
    origin_endpoint = get_origin_endpoint(config, orientation)

    logger.info("Creating MediaPackage V2 harvest job", extra={
        "harvestJobName": harvest_job_name,
        "originEndpoint": origin_endpoint,
        "s3Prefix": s3_prefix,
        "bucket": VIDEO_ASSETS_BUCKET,
    })

    try:
        mediapackagev2_client.create_harvest_job(
            ChannelGroupName=config["channelGroup"],
            ChannelName=config["channelName"],
            OriginEndpointName=origin_endpoint,
            HarvestJobName=harvest_job_name,
            HarvestedManifests={"HlsManifests": [{"ManifestName": "main"}]},
            ScheduleConfiguration={
                "StartTime": datetime.fromisoformat(buffered_start.replace("Z", "+00:00")),
                "EndTime": datetime.fromisoformat(buffered_end.replace("Z", "+00:00")),
            },
            Destination={
                "S3Destination": {
                    "BucketName": VIDEO_ASSETS_BUCKET,
                    "DestinationPath": s3_prefix,
                }
            },
            Tags={"Correlation_ID": correlation_id},
        )
    except ClientError as e:
        logger.error("Failed to create harvest job", extra={
            "error": str(e), "harvestJobName": harvest_job_name,
        })
        raise

    # Save harvest job record to DynamoDB
    job_record_id = str(uuid.uuid4())
    save_harvest_job_record(
        job_id=job_record_id,
        clip_id=clip_id,
        channel_id=channel_id,
        orientation=orientation,
        harvest_job_name=harvest_job_name,
        s3_prefix=s3_prefix,
        correlation_id=correlation_id,
    )

    logger.info("Harvest job created successfully", extra={
        "harvestJobName": harvest_job_name, "harvestJobRecordId": job_record_id,
    })

    return {
        "harvestJobName": harvest_job_name,
        "s3Prefix": s3_prefix,
        "orientation": orientation,
        "harvestJobRecordId": job_record_id,
        "resolvedChannelConfig": {
            "channelGroup": config["channelGroup"],
            "channelName": config["channelName"],
            "originEndpoint": origin_endpoint,
        },
    }
