"""
Transcode Task Lambda

Submits a MediaConvert job to convert HLS to MP4 for a single orientation.
Invoked by the Download Step Functions state machine.
"""

import os
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="transcode-task")

MC_ENDPOINT = os.environ.get("MC_ENDPOINT", "")
VIDEO_ASSETS_BUCKET = os.environ.get("VIDEO_ASSETS_BUCKET", "")

mc_client = boto3.client("mediaconvert", endpoint_url=MC_ENDPOINT) if MC_ENDPOINT else boto3.client("mediaconvert")

# Orientation-specific video settings (per design: 1920x1080 landscape, 1080x1920 portrait)
VIDEO_SETTINGS = {
    "landscape": {"width": 1920, "height": 1080},
    "portrait": {"width": 1080, "height": 1920},
}


def build_job_settings(s3_input_uri: str, orientation: str, output_s3_uri: str, clip_id: str = "") -> Dict[str, Any]:
    """Build MediaConvert job settings for the given orientation."""
    dims = VIDEO_SETTINGS.get(orientation, VIDEO_SETTINGS["landscape"])
    name_modifier = f"-{clip_id}-{orientation}" if clip_id else f"-{orientation}"

    return {
        "Inputs": [
            {
                "FileInput": s3_input_uri,
                "TimecodeSource": "ZEROBASED",
                "AudioSelectors": {"Audio Selector 1": {"DefaultSelection": "DEFAULT"}},
                "VideoSelector": {},
            }
        ],
        "OutputGroups": [
            {
                "Name": f"Download-{orientation}",
                "OutputGroupSettings": {
                    "Type": "FILE_GROUP_SETTINGS",
                    "FileGroupSettings": {"Destination": output_s3_uri},
                },
                "Outputs": [
                    {
                        "ContainerSettings": {"Container": "MP4", "Mp4Settings": {}},
                        "NameModifier": name_modifier,
                        "VideoDescription": {
                            "CodecSettings": {
                                "Codec": "H_264",
                                "H264Settings": {
                                    "RateControlMode": "QVBR",
                                    "MaxBitrate": 5000000,
                                    "QvbrSettings": {"QvbrQualityLevel": 7},
                                    "CodecProfile": "HIGH",
                                    "FramerateControl": "INITIALIZE_FROM_SOURCE",
                                },
                            },
                            "Width": dims["width"],
                            "Height": dims["height"],
                            "ScalingBehavior": "DEFAULT",
                            "AntiAlias": "ENABLED",
                        },
                        "AudioDescriptions": [
                            {
                                "CodecSettings": {
                                    "Codec": "AAC",
                                    "AacSettings": {
                                        "Bitrate": 128000,
                                        "CodingMode": "CODING_MODE_2_0",
                                        "SampleRate": 48000,
                                    },
                                },
                            }
                        ],
                    }
                ],
            }
        ],
    }


@logger.inject_lambda_context
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Submit a MediaConvert transcode job for a single orientation.

    Input:
        s3SourceKey, orientation, outputPrefix, mcRoleArn, correlationId, downloadJobId

    Output:
        mediaConvertJobId, outputPrefix
    """
    s3_source_key = event.get("s3SourceKey", "")
    orientation = event["orientation"]
    output_prefix = event["outputPrefix"]
    mc_role_arn = event["mcRoleArn"]
    correlation_id = event.get("correlationId", "unknown")
    download_job_id = event.get("downloadJobId", "unknown")

    logger.append_keys(correlationId=correlation_id, orientation=orientation, downloadJobId=download_job_id)

    if not s3_source_key or not s3_source_key.strip("/"):
        logger.error("Empty or invalid s3SourceKey — cannot submit transcode job", extra={
            "s3SourceKey": s3_source_key,
        })
        raise ValueError(
            f"s3SourceKey is empty or invalid for orientation '{orientation}'. "
            "This usually means the harvest step did not produce a valid S3 prefix."
        )

    # Derive HLS manifest input URI — append /main.m3u8 if the source key is a prefix
    if s3_source_key.endswith("/") or not s3_source_key.endswith(".m3u8"):
        s3_input_key = s3_source_key.rstrip("/") + "/main.m3u8"
    else:
        s3_input_key = s3_source_key

    s3_input_uri = f"s3://{VIDEO_ASSETS_BUCKET}/{s3_input_key}"
    output_s3_uri = f"s3://{VIDEO_ASSETS_BUCKET}/{output_prefix}"

    logger.info("Submitting MediaConvert job", extra={
        "s3InputUri": s3_input_uri, "outputPrefix": output_prefix, "orientation": orientation,
    })

    job_settings = build_job_settings(s3_input_uri, orientation, output_s3_uri, clip_id=event.get("clipId", ""))

    try:
        response = mc_client.create_job(
            Role=mc_role_arn,
            Settings=job_settings,
            UserMetadata={
                "correlationId": correlation_id,
                "downloadJobId": download_job_id,
                "orientation": orientation,
            },
        )
        job_id = response["Job"]["Id"]
    except ClientError as e:
        logger.error("Failed to create MediaConvert job", extra={"error": str(e)})
        raise

    logger.info("MediaConvert job submitted", extra={"mediaConvertJobId": job_id})

    return {
        "mediaConvertJobId": job_id,
        "outputPrefix": output_prefix,
    }
