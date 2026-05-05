"""
Download API Lambda
Validates clip selection, creates Download_Records, and starts Download_State_Machine executions.
This is a thin orchestration trigger — all processing is handled by Step Functions.
"""

import json
import os
import uuid
from datetime import datetime
from decimal import Decimal

import boto3
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="download-api")

dynamodb = boto3.resource("dynamodb")
sfn_client = boto3.client("stepfunctions")
s3_client = boto3.client("s3")

CLIPS_TABLE = os.environ["CLIPS_TABLE"]
DOWNLOAD_JOBS_TABLE = os.environ["DOWNLOAD_JOBS_TABLE"]
VIDEO_ASSETS_BUCKET = os.environ["VIDEO_ASSETS_BUCKET"]
DOWNLOAD_STATE_MACHINE_ARN = os.environ["DOWNLOAD_STATE_MACHINE_ARN"]
MC_ROLE_ARN = os.environ.get("MC_ROLE_ARN", "")

MAX_ITEMS_PER_REQUEST = 20
PRESIGNED_URL_EXPIRY = 3600  # 1 hour

# Allowed S3 key prefixes for presigned URL generation
ALLOWED_PRESIGN_PREFIXES = ("harvested-clips/", "downloads/")


def lambda_handler(event: dict, context: LambdaContext) -> dict:
    logger.info("Processing download request", extra={"event": event})

    try:
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        path_params = event.get("pathParameters") or {}

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            raw_path = event.get("rawPath", "")
            if raw_path.endswith("/presign"):
                return _presign_url(body)
            return _create_download_jobs(body)

        if method == "GET" and path_params.get("jobId"):
            return _get_download_status(path_params["jobId"])

        return _response(405, {"message": "Method not allowed"})
    except Exception:
        logger.exception("Unhandled error processing request")
        return _response(500, {"message": "Internal server error"})


def _create_download_jobs(request: dict) -> dict:
    items = request.get("items")
    orientation = request.get("orientation", "portrait")

    if not items or not isinstance(items, list) or len(items) == 0:
        return _response(400, {"message": "At least one item is required"})

    if len(items) > MAX_ITEMS_PER_REQUEST:
        return _response(400, {"message": f"Maximum {MAX_ITEMS_PER_REQUEST} items per request"})

    if orientation not in ("landscape", "portrait", "both"):
        return _response(400, {"message": "orientation must be 'landscape', 'portrait', or 'both'"})

    clips_table = dynamodb.Table(CLIPS_TABLE)
    download_jobs_table = dynamodb.Table(DOWNLOAD_JOBS_TABLE)

    processed = []
    skipped = []

    for item in items:
        item_id = item.get("id")
        if not item_id or not isinstance(item_id, str) or not item_id.strip():
            skipped.append({"id": None, "reason": "Missing or invalid item id"})
            continue

        # Look up clip
        clip_resp = clips_table.get_item(Key={"id": item_id})
        clip = clip_resp.get("Item")
        if not clip:
            skipped.append({"id": item_id, "reason": "Clip not found"})
            continue

        # Check for existing in-progress download
        existing_job_id = clip.get("downloadJobId")
        if existing_job_id:
            existing_job_resp = download_jobs_table.get_item(Key={"jobId": existing_job_id})
            existing_job = existing_job_resp.get("Item")
            if existing_job and existing_job.get("download_status") in ("processing", "harvesting", "pending"):
                skipped.append({
                    "id": item_id,
                    "jobId": existing_job_id,
                    "executionArn": existing_job.get("executionArn", ""),
                    "reason": "Download already in progress",
                })
                continue

        # Determine orientations to request
        orientations = ["landscape", "portrait"] if orientation == "both" else [orientation]

        now = datetime.utcnow().isoformat() + "Z"
        job_id = str(uuid.uuid4())

        # Create Download_Record
        download_record = {
            "jobId": job_id,
            "itemId": item_id,
            "itemType": "clip",
            "download_status": "processing",
            "orientations": orientations,
            "createdAt": now,
            "updatedAt": now,
        }

        # Build state machine input
        channel_id = clip.get("mediaLiveChannel") or clip.get("channelId", "")
        start_time = clip.get("startTime", "")
        end_time = clip.get("endTime", "")

        # Normalize epoch timestamps to ISO strings
        if isinstance(start_time, (int, float, Decimal)):
            start_time = datetime.utcfromtimestamp(float(start_time)).isoformat() + "Z"
        if isinstance(end_time, (int, float, Decimal)):
            end_time = datetime.utcfromtimestamp(float(end_time)).isoformat() + "Z"

        channel_config = clip.get("channelConfig") or {}

        sfn_input = {
            "clipId": item_id,
            "orientations": orientations,
            "downloadJobId": job_id,
            "channelId": channel_id,
            "startTime": start_time,
            "endTime": end_time,
            "channelConfig": channel_config,
            "mcRoleArn": MC_ROLE_ARN,
            "bucket": VIDEO_ASSETS_BUCKET,
        }

        try:
            execution = sfn_client.start_execution(
                stateMachineArn=DOWNLOAD_STATE_MACHINE_ARN,
                name=f"download-{job_id}",
                input=json.dumps(sfn_input, default=str),
            )
            execution_arn = execution["executionArn"]
        except Exception:
            logger.exception("Failed to start state machine execution", extra={"clipId": item_id})
            download_record["download_status"] = "failed"
            download_record["errorMessage"] = "Failed to start download workflow"
            download_jobs_table.put_item(Item=download_record)
            skipped.append({"id": item_id, "jobId": job_id, "reason": "Failed to start download workflow"})
            continue

        download_record["executionArn"] = execution_arn
        download_record["correlationId"] = execution_arn
        download_jobs_table.put_item(Item=download_record)

        # Update clip with downloadJobId
        clips_table.update_item(
            Key={"id": item_id},
            UpdateExpression="SET downloadJobId = :jid",
            ExpressionAttributeValues={":jid": job_id},
        )

        processed.append({
            "id": item_id,
            "jobId": job_id,
            "executionArn": execution_arn,
        })

    return _response(202, {"processed": processed, "skipped": skipped})


def _presign_url(request: dict) -> dict:
    s3_key = request.get("s3Key", "")
    if not s3_key or not isinstance(s3_key, str) or not s3_key.strip():
        return _response(400, {"message": "s3Key is required and must be a non-empty string"})

    s3_key = s3_key.strip()

    # Block path traversal
    if ".." in s3_key:
        logger.warning("Rejected presign request with path traversal", extra={"s3Key": s3_key})
        return _response(400, {"message": "Invalid s3Key"})

    # Restrict to allowed prefixes
    if not s3_key.startswith(ALLOWED_PRESIGN_PREFIXES):
        logger.warning("Rejected presign request for disallowed prefix", extra={"s3Key": s3_key})
        return _response(403, {"message": "Access denied for the requested key"})

    try:
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": VIDEO_ASSETS_BUCKET, "Key": s3_key},
            ExpiresIn=PRESIGNED_URL_EXPIRY,
        )
        return _response(200, {"downloadUrl": url, "expiresIn": PRESIGNED_URL_EXPIRY})
    except Exception:
        logger.exception("Failed to generate presigned URL for direct download", extra={"s3Key": s3_key})
        return _response(500, {"message": "Failed to generate presigned URL"})


def _get_download_status(job_id: str) -> dict:
    download_jobs_table = dynamodb.Table(DOWNLOAD_JOBS_TABLE)
    resp = download_jobs_table.get_item(Key={"jobId": job_id})
    job = resp.get("Item")

    if not job:
        return _response(404, {"message": "Job not found"})

    status = job.get("download_status", "unknown")

    result = {
        "jobId": job_id,
        "status": status,
        "correlationId": job.get("correlationId", ""),
    }

    if status == "completed":
        # Parse branch results to generate per-orientation download URLs
        branch_results_str = job.get("branchResults", "[]")
        try:
            branch_results = json.loads(branch_results_str) if isinstance(branch_results_str, str) else branch_results_str
        except (json.JSONDecodeError, TypeError):
            branch_results = []

        downloads = []
        logger.info("Processing branch results for download URLs", extra={
            "jobId": job_id,
            "branchResultsRaw": branch_results_str[:500] if isinstance(branch_results_str, str) else str(branch_results)[:500],
            "branchCount": len(branch_results),
        })
        for br in branch_results:
            orientation = br.get("orientation", "unknown")
            s3_key = br.get("s3OutputKey", "")
            br_status = br.get("status", "unknown")
            logger.info("Branch result", extra={
                "orientation": orientation,
                "s3OutputKey": s3_key,
                "branchStatus": br_status,
            })
            # Safety: strip s3://bucket/ prefix if present
            if s3_key.startswith("s3://"):
                without_scheme = s3_key[5:]
                slash_idx = without_scheme.find("/")
                s3_key = without_scheme[slash_idx + 1:] if slash_idx >= 0 else without_scheme
            if br_status == "completed" and s3_key:
                try:
                    download_url = s3_client.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": VIDEO_ASSETS_BUCKET, "Key": s3_key},
                        ExpiresIn=PRESIGNED_URL_EXPIRY,
                    )
                    downloads.append({
                        "orientation": orientation,
                        "downloadUrl": download_url,
                        "s3OutputKey": s3_key,
                        "expiresIn": PRESIGNED_URL_EXPIRY,
                    })
                except Exception:
                    logger.exception("Failed to generate presigned URL", extra={"jobId": job_id, "orientation": orientation})
                    downloads.append({"orientation": orientation, "error": "Failed to generate URL"})
            elif br_status == "failed":
                downloads.append({"orientation": orientation, "error": br.get("errorMessage", "Failed")})

        result["downloads"] = downloads

        # Backward compat: if single s3OutputKey exists on the record, include downloadUrl
        if job.get("s3OutputKey"):
            try:
                result["downloadUrl"] = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": VIDEO_ASSETS_BUCKET, "Key": job["s3OutputKey"]},
                    ExpiresIn=PRESIGNED_URL_EXPIRY,
                )
                result["expiresIn"] = PRESIGNED_URL_EXPIRY
            except Exception:
                pass

    if status == "failed":
        result["errorMessage"] = job.get("errorMessage", "")

    return _response(200, result)


def _response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
        },
        "body": json.dumps(body, default=str),
    }
