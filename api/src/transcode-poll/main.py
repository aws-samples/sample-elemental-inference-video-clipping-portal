"""
Transcode Poll Lambda

Polls MediaConvert job status.
Invoked by the Download Step Functions state machine.
"""

import os
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="transcode-poll")

MC_ENDPOINT = os.environ.get("MC_ENDPOINT", "")

mc_client = boto3.client("mediaconvert", endpoint_url=MC_ENDPOINT) if MC_ENDPOINT else boto3.client("mediaconvert")


@logger.inject_lambda_context
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Poll a MediaConvert job for its current status.

    Input:
        mediaConvertJobId, correlationId

    Output:
        status ("COMPLETE" | "PROGRESSING" | "ERROR" | "CANCELED"),
        outputFilePath (when complete),
        errorMessage (when error)
    """
    job_id = event["mediaConvertJobId"]
    correlation_id = event.get("correlationId", "unknown")

    logger.append_keys(correlationId=correlation_id, mediaConvertJobId=job_id)

    try:
        response = mc_client.get_job(Id=job_id)
        job = response["Job"]
        status = job["Status"]
    except ClientError as e:
        logger.error("Failed to poll MediaConvert job", extra={"error": str(e)})
        raise

    result: Dict[str, Any] = {
        "status": status,
        "outputFilePath": None,
        "errorMessage": None,
    }

    if status == "COMPLETE":
        try:
            output_group = job["Settings"]["OutputGroups"][0]
            destination = output_group["OutputGroupSettings"].get("FileGroupSettings", {}).get("Destination", "")

            # Try to get the actual output path from OutputGroupDetails
            output_details = job.get("OutputGroupDetails", [{}])[0]
            output_file = output_details.get("OutputDetails", [{}])[0].get("OutputFilePaths", [""])[0]

            logger.info("MediaConvert output details", extra={
                "rawOutputFile": output_file,
                "destination": destination,
                "outputGroupDetails": job.get("OutputGroupDetails"),
            })

            if output_file:
                # Strip s3://bucket/ prefix to get just the S3 key
                if output_file.startswith("s3://"):
                    without_scheme = output_file[5:]
                    slash_idx = without_scheme.find("/")
                    result["outputFilePath"] = without_scheme[slash_idx + 1:] if slash_idx >= 0 else without_scheme
                else:
                    result["outputFilePath"] = output_file
            else:
                # OutputFilePaths empty — construct from destination + NameModifier + .mp4
                name_modifier = ""
                try:
                    outputs = output_group.get("Outputs", [{}])
                    name_modifier = outputs[0].get("NameModifier", "")
                except (KeyError, IndexError):
                    pass

                # Strip s3://bucket/ from destination
                dest_key = destination
                if dest_key.startswith("s3://"):
                    without_scheme = dest_key[5:]
                    slash_idx = without_scheme.find("/")
                    dest_key = without_scheme[slash_idx + 1:] if slash_idx >= 0 else without_scheme

                # Construct: destination_prefix + "main" + name_modifier + ".mp4"
                dest_key = dest_key.rstrip("/")
                result["outputFilePath"] = f"{dest_key}/main{name_modifier}.mp4"

            logger.info("Transcode complete", extra={"outputFilePath": result["outputFilePath"]})
        except (KeyError, IndexError) as e:
            logger.error("Failed to extract output path", extra={"error": str(e)})
            result["outputFilePath"] = ""

    elif status == "ERROR":
        error_msg = job.get("ErrorMessage", "Unknown MediaConvert error")
        error_code = job.get("ErrorCode", 0)
        result["errorMessage"] = f"[{error_code}] {error_msg}"
        logger.error("Transcode failed", extra={"errorMessage": result["errorMessage"]})

    else:
        logger.info("Transcode in progress", extra={"status": status})

    return result
