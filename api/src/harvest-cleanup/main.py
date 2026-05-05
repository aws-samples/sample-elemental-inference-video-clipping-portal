"""
Harvest Cleanup Lambda

Scheduled Lambda that scans the Clips table and purges expired clip records
and their associated S3 harvested content based on a configurable retention period.

Triggered by EventBridge schedule (rate: 1 day).
"""

import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="harvest-cleanup")

dynamodb = boto3.resource("dynamodb")
s3_client = boto3.client("s3")

CLIPS_TABLE_NAME = os.environ.get("CLIPS_TABLE_NAME", "")
SYSTEM_SETTINGS_TABLE = os.environ.get("SYSTEM_SETTINGS_TABLE", "")
VIDEO_ASSETS_BUCKET = os.environ.get("VIDEO_ASSETS_BUCKET", "")

BATCH_SIZE = 25  # DynamoDB scan page size


def read_system_setting(setting_key: str, default_value: str) -> str:
    """Read a setting from the System Settings table."""
    if not SYSTEM_SETTINGS_TABLE:
        return default_value
    try:
        table = dynamodb.Table(SYSTEM_SETTINGS_TABLE)
        response = table.get_item(Key={"settingKey": setting_key})
        item = response.get("Item")
        if item and "settingValue" in item:
            return item["settingValue"]
        return default_value
    except Exception as e:
        logger.warning("Failed to read system setting", extra={
            "setting_key": setting_key, "error": str(e),
        })
        return default_value


def get_s3_prefixes_for_clip(clip: Dict[str, Any]) -> List[str]:
    """Extract all harvested-clips/ S3 prefixes from a clip record."""
    prefixes = []

    # New-style: sourceKeys map (orientation → S3 prefix)
    source_keys = clip.get("sourceKeys") or {}
    for orientation, prefix in source_keys.items():
        if prefix and prefix.startswith("harvested-clips/"):
            prefixes.append(prefix)

    # Legacy: single sourceKey field
    legacy_key = clip.get("sourceKey", "")
    if legacy_key and legacy_key.startswith("harvested-clips/") and legacy_key not in prefixes:
        prefixes.append(legacy_key)

    return prefixes


def has_harvested_content(clip: Dict[str, Any]) -> bool:
    """Check if a clip has any harvested content."""
    harvested = clip.get("harvestedOrientations")
    if harvested and len(harvested) > 0:
        return True
    source_keys = clip.get("sourceKeys") or {}
    if source_keys:
        return True
    legacy_key = clip.get("sourceKey", "")
    if legacy_key:
        return True
    return False


def is_clip_expired(clip: Dict[str, Any], retention_days: int) -> bool:
    """Check if a clip's createdAt is older than the retention period."""
    created_at = clip.get("createdAt") or clip.get("created_at")
    if not created_at:
        return False
    try:
        created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        return created_dt < cutoff
    except (ValueError, TypeError):
        logger.warning("Invalid createdAt format", extra={"clipId": clip.get("id"), "createdAt": created_at})
        return False


def clip_age_days(clip: Dict[str, Any]) -> int:
    """Calculate the age of a clip in days."""
    created_at = clip.get("createdAt") or clip.get("created_at")
    if not created_at:
        return -1
    try:
        created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - created_dt).days
    except (ValueError, TypeError):
        return -1


def delete_s3_prefix(bucket: str, prefix: str, dry_run: bool) -> int:
    """Delete all S3 objects under a prefix. Returns count of deleted objects."""
    deleted = 0
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        objects = page.get("Contents", [])
        if not objects:
            continue
        keys = [{"Key": obj["Key"]} for obj in objects]
        if dry_run:
            deleted += len(keys)
            continue
        response = s3_client.delete_objects(
            Bucket=bucket,
            Delete={"Objects": keys, "Quiet": True},
        )
        errors = response.get("Errors", [])
        deleted += len(keys) - len(errors)
        for err in errors:
            logger.warning("Failed to delete S3 object", extra={
                "key": err.get("Key"), "error": err.get("Message"),
            })
    return deleted


def delete_clip_record(clip_id: str, dry_run: bool) -> None:
    """Delete a Clip_Record from DynamoDB."""
    if dry_run:
        return
    table = dynamodb.Table(CLIPS_TABLE_NAME)
    table.delete_item(Key={"id": clip_id})


def process_clip(clip: Dict[str, Any], bucket: str, dry_run: bool) -> bool:
    """Process a single clip for cleanup. Returns True if successful."""
    clip_id = clip.get("id", "unknown")
    age = clip_age_days(clip)
    prefixes = get_s3_prefixes_for_clip(clip)

    action = "Would purge" if dry_run else "Purging"
    logger.info(f"{action} clip", extra={
        "clipId": clip_id,
        "ageDays": age,
        "s3Prefixes": prefixes,
        "dryRun": dry_run,
    })

    total_deleted = 0
    for prefix in prefixes:
        total_deleted += delete_s3_prefix(bucket, prefix, dry_run)

    delete_clip_record(clip_id, dry_run)

    logger.info(f"{'Would delete' if dry_run else 'Deleted'} S3 objects for clip", extra={
        "clipId": clip_id,
        "s3ObjectsDeleted": total_deleted,
        "prefixesProcessed": len(prefixes),
        "dryRun": dry_run,
    })
    return True


@logger.inject_lambda_context
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Harvest cleanup handler. Triggered by EventBridge schedule.

    Reads retention settings, scans for expired clips with harvested content,
    and purges S3 objects + DynamoDB records (or logs what would be purged in dry-run mode).
    """
    retention_days = int(read_system_setting("harvestRetentionDays", "30"))
    dry_run = read_system_setting("harvestCleanupDryRun", "true").lower() == "true"

    logger.info("Starting harvest cleanup", extra={
        "retentionDays": retention_days,
        "dryRun": dry_run,
        "bucket": VIDEO_ASSETS_BUCKET,
    })

    clips_table = dynamodb.Table(CLIPS_TABLE_NAME)
    processed = 0
    purged = 0
    errors = 0

    # Scan clips table in batches
    scan_kwargs: Dict[str, Any] = {"Limit": BATCH_SIZE}
    while True:
        response = clips_table.scan(**scan_kwargs)
        items = response.get("Items", [])

        for clip in items:
            clip_id = clip.get("id", "unknown")

            # Skip locked clips
            if clip.get("locked") is True:
                continue

            # Skip clips without harvested content
            if not has_harvested_content(clip):
                continue

            # Skip clips that haven't expired
            if not is_clip_expired(clip, retention_days):
                continue

            processed += 1
            try:
                if process_clip(clip, VIDEO_ASSETS_BUCKET, dry_run):
                    purged += 1
            except Exception as e:
                errors += 1
                logger.error("Failed to process clip for cleanup", extra={
                    "clipId": clip_id, "error": str(e),
                })

        # Check for more pages
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    logger.info("Harvest cleanup complete", extra={
        "clipsProcessed": processed,
        "clipsPurged": purged,
        "errors": errors,
        "dryRun": dry_run,
    })

    return {
        "clipsProcessed": processed,
        "clipsPurged": purged,
        "errors": errors,
        "dryRun": dry_run,
    }
