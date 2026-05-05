"""
Harvest Validate Lambda

Multi-action Lambda invoked by Step Functions for:
- Default: validate that harvested S3 content is non-empty
- resolve_orientations: determine which orientations need harvest vs skip-to-transcode
- build_orientation_list: build list of enabled orientations from settings
- finalize_auto_harvest: update Clip_Record status after auto-harvest completes
"""

import os
import uuid
from typing import Any, Dict, List

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="harvest-validate")

s3_client = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

CLIPS_TABLE = os.environ.get("CLIPS_TABLE", "")
DOWNLOAD_JOBS_TABLE = os.environ.get("DOWNLOAD_JOBS_TABLE", "")


def validate_harvest(event: Dict[str, Any]) -> Dict[str, Any]:
    """Validate that harvested S3 content contains video segments."""
    s3_prefix = event["s3Prefix"]
    bucket = event["bucket"]
    correlation_id = event.get("correlationId", "unknown")
    clip_id = event.get("clipId", "unknown")

    logger.info("Validating harvest content", extra={
        "correlationId": correlation_id, "clipId": clip_id, "bucket": bucket, "s3Prefix": s3_prefix,
    })

    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        segment_count = 0
        total_size = 0
        all_keys: List[str] = []

        for page in paginator.paginate(Bucket=bucket, Prefix=s3_prefix):
            for obj in page.get("Contents", []):
                all_keys.append(obj["Key"])
                # CMAF containers produce .m4s/.mp4 segments; TS containers produce .ts segments
                if obj["Key"].endswith(".ts") or obj["Key"].endswith(".m4s") or obj["Key"].endswith(".mp4"):
                    segment_count += 1
                    total_size += obj["Size"]

        if segment_count > 0:
            logger.info("Harvest validation passed", extra={
                "correlationId": correlation_id, "fileCount": segment_count, "totalSizeBytes": total_size,
            })
            return {
                "valid": True,
                "fileCount": segment_count,
                "totalSizeBytes": total_size,
                "reason": None,
            }

        # Empty harvest — clean up placeholder objects
        logger.warning("Empty harvest detected, cleaning up placeholders", extra={
            "correlationId": correlation_id, "objectCount": len(all_keys),
            "allKeys": all_keys[:20],
            "note": "No .ts, .m4s, or .mp4 segment files found — check container type (CMAF uses .m4s/.mp4, TS uses .ts)",
        })
        for key in all_keys:
            try:
                s3_client.delete_object(Bucket=bucket, Key=key)
            except Exception as e:
                logger.warning("Failed to delete placeholder", extra={"key": key, "error": str(e)})

        return {
            "valid": False,
            "fileCount": 0,
            "totalSizeBytes": 0,
            "reason": "No video segment files found",
        }

    except ClientError as e:
        logger.error("S3 validation failed", extra={"correlationId": correlation_id, "error": str(e)})
        raise


def resolve_orientations(event: Dict[str, Any]) -> Dict[str, Any]:
    """Determine which orientations need harvest vs can skip to transcode."""
    clip_id = event["clipId"]
    requested_orientations = event["requestedOrientations"]

    logger.info("Resolving orientations", extra={"clipId": clip_id, "requested": requested_orientations})

    table = dynamodb.Table(CLIPS_TABLE)
    response = table.get_item(Key={"id": clip_id})
    clip = response.get("Item")

    if not clip:
        raise ValueError(f"Clip not found: {clip_id}")

    harvested = set(clip.get("harvestedOrientations", set()))
    source_keys = clip.get("sourceKeys", {})

    orientations = []
    for orientation in requested_orientations:
        needs_harvest = orientation not in harvested
        s3_prefix = source_keys.get(orientation, "")
        download_job_id = str(uuid.uuid4())

        orientations.append({
            "orientation": orientation,
            "needsHarvest": needs_harvest,
            "s3Prefix": s3_prefix,
            "downloadJobId": download_job_id,
        })

    logger.info("Orientations resolved", extra={
        "clipId": clip_id,
        "orientations": [{"o": o["orientation"], "needsHarvest": o["needsHarvest"]} for o in orientations],
    })

    return {"orientations": orientations}


def build_orientation_list(event: Dict[str, Any]) -> Dict[str, Any]:
    """Build list of enabled orientation strings from single autoHarvest setting."""
    auto_harvest = event.get("autoHarvest", "false")

    if str(auto_harvest).lower() == "true":
        orientations = ["landscape", "portrait"]
    else:
        orientations = []

    logger.info("Built orientation list", extra={
        "autoHarvest": auto_harvest,
        "orientations": orientations,
    })

    return {"orientations": orientations}


def finalize_auto_harvest(event: Dict[str, Any]) -> Dict[str, Any]:
    """Update Clip_Record status after auto-harvest completes."""
    clip_id = event["clipId"]
    harvest_results = event["harvestResults"]

    logger.info("Finalizing auto-harvest", extra={"clipId": clip_id, "resultCount": len(harvest_results)})

    successes = [r for r in harvest_results if r.get("status") == "success"]
    failures = [r for r in harvest_results if r.get("status") == "failed"]

    table = dynamodb.Table(CLIPS_TABLE)

    if successes:
        # At least one orientation succeeded — set status to "archived"
        update_expr = "SET #status = :archived"
        expr_names = {"#status": "status"}
        expr_values = {":archived": "archived"}

        # Record failures in harvestFailures map if any
        if failures:
            update_expr += ", harvestFailures = :failures"
            failure_map = {f["orientation"]: "Harvest failed" for f in failures}
            expr_values[":failures"] = failure_map

        table.update_item(
            Key={"id": clip_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
        logger.info("Clip status updated to archived", extra={
            "clipId": clip_id, "successCount": len(successes), "failureCount": len(failures),
        })
    else:
        # All branches failed — leave status as "detected", record failures
        if failures:
            failure_map = {f["orientation"]: "Harvest failed" for f in failures}
            table.update_item(
                Key={"id": clip_id},
                UpdateExpression="SET harvestFailures = :failures",
                ExpressionAttributeValues={":failures": failure_map},
            )
        logger.warning("All harvest branches failed", extra={
            "clipId": clip_id, "failureCount": len(failures),
        })

    return {"clipId": clip_id, "archived": len(successes) > 0}


# Action dispatch map
ACTION_HANDLERS = {
    "resolve_orientations": resolve_orientations,
    "build_orientation_list": build_orientation_list,
    "finalize_auto_harvest": finalize_auto_harvest,
}


@logger.inject_lambda_context
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Multi-action Lambda handler.

    Routes to the appropriate action based on the 'action' field in the input.
    Default (no action field) performs S3 harvest validation.
    """
    action = event.get("action")

    if action and action in ACTION_HANDLERS:
        return ACTION_HANDLERS[action](event)

    # Default: validate harvest content
    return validate_harvest(event)
