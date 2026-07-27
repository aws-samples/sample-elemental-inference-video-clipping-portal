#!/usr/bin/env python3
"""
Create Feed Lambda Function

Thin helper Lambda invoked by Step Functions to create or delete
Elemental Inference feeds. Step Functions cannot call the Elemental
Inference SDK directly, so this Lambda wraps the two operations needed
by the CreateChannel state machine.

Supported actions:
- create (default): Create a feed and return feedId/feedArn
- delete: Delete a feed by feedId (used for saga compensation)
"""

import os
import json
from typing import Dict, Any

import boto3
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="create-feed-lambda")
tracer = Tracer(service="create-feed-lambda")
metrics = Metrics(namespace="CreateFeedLambda", service="create-feed-lambda")

# Smart Subtitles configuration constants.
# The subtitling output is named consistently so the MediaLive caption selector
# (InferenceFeedOutput) can reference it, and so build_updated_outputs preserves it
# across clipping enable/disable.
SUBTITLING_OUTPUT_NAME = "subtitling-output"
# Languages supported by Elemental Inference Smart Subtitles (ISO 639-2/T, optional region subtag).
VALID_SUBTITLE_LANGUAGES = {"eng", "eng-au", "eng-gb", "eng-us", "fra", "ita", "deu", "spa", "por"}
VALID_PROFANITY_MODES = {"DISABLED", "CENSOR", "DROP"}

# Environment variables
INFERENCE_STAGE = os.environ.get("INFERENCE_STAGE", "prod")
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

# Initialize Elemental Inference client based on stage
if INFERENCE_STAGE == "prod":
    inference_client = boto3.client("elementalinference", region_name=AWS_REGION)
else:
    endpoint = f"https://elemental-inference-{INFERENCE_STAGE}.{AWS_REGION}.amazonaws.com"
    inference_client = boto3.client(
        "elementalinference", region_name=AWS_REGION, endpoint_url=endpoint
    )

mpv2_client = boto3.client("mediapackagev2", region_name=AWS_REGION)


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Lambda handler for Elemental Inference feed operations.

    Create payload (default):
        {"channelName": "my-channel"}

    Delete payload (saga compensation):
        {"action": "delete", "feedId": "feed-123"}
    """
    logger.info("Received event", extra={"event": event})

    action = event.get("action", "create")

    if action == "delete":
        return handle_delete(event)

    if action == "update_callback":
        return handle_update_callback(event)

    if action == "disable_feed":
        return handle_disable_feed(event)

    if action == "set_endpoint_policies":
        return handle_set_endpoint_policies(event)

    if action == "delete_endpoint_policies":
        return handle_delete_endpoint_policies(event)

    return handle_create(event)


@tracer.capture_method
def handle_create(event: Dict[str, Any]) -> Dict[str, Any]:
    """Create an Elemental Inference feed with callbackMetadata set to the channel name."""
    channel_name = event.get("channelName")
    if not channel_name:
        raise ValueError("Missing required field: channelName")

    feed_name = f"{channel_name}-feed"
    logger.info("Creating inference feed", extra={"feed_name": feed_name, "channel_name": channel_name})

    outputs = [
        {
            "name": "clipping-output",
            "outputConfig": {
                "clipping": {
                    "callbackMetadata": channel_name,
                }
            },
            "status": "DISABLED",
        }
    ]

    # Optionally add a Smart Subtitles output. Unlike clipping (which is gated to
    # event activation), the subtitling output is created ENABLED so subtitles are
    # generated whenever the channel is streaming. build_updated_outputs preserves it
    # through the clipping enable/disable lifecycle.
    subtitles = event.get("subtitles")
    subtitles_enabled = bool(subtitles and subtitles.get("enabled"))
    if subtitles_enabled:
        outputs.append(build_subtitling_output(subtitles))
        logger.info("Subtitling output added to feed", extra={
            "channel_name": channel_name,
            "language": subtitles.get("language"),
        })

    response = inference_client.create_feed(name=feed_name, outputs=outputs)

    feed_id = response["id"]
    feed_arn = response["arn"]

    logger.info("Feed created", extra={"feed_id": feed_id, "feed_arn": feed_arn})
    metrics.add_metric(name="FeedCreated", unit=MetricUnit.Count, value=1)
    if subtitles_enabled:
        metrics.add_metric(name="FeedCreatedWithSubtitles", unit=MetricUnit.Count, value=1)

    return {
        "feedId": feed_id,
        "feedArn": feed_arn,
        "subtitlingOutputName": SUBTITLING_OUTPUT_NAME if subtitles_enabled else None,
    }


@tracer.capture_method
def build_subtitling_output(subtitles: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build an Elemental Inference subtitling feed output from a subtitle config dict.

    Expected shape:
        {
            "enabled": true,
            "language": "eng-us",              # required, must be a supported language
            "aspectRatio": {"width": 16, "height": 9},   # optional
            "dictionary": "abc123",            # optional custom dictionary id
            "profanityFilter": "DISABLED"      # optional: DISABLED | CENSOR | DROP
        }
    """
    language = subtitles.get("language")
    if language not in VALID_SUBTITLE_LANGUAGES:
        raise ValueError(
            f"Invalid subtitle language: {language!r}. "
            f"Must be one of {sorted(VALID_SUBTITLE_LANGUAGES)}"
        )

    subtitling_config: Dict[str, Any] = {"language": language}

    aspect = subtitles.get("aspectRatio")
    if aspect:
        try:
            subtitling_config["aspectRatio"] = {
                "width": int(aspect["width"]),
                "height": int(aspect["height"]),
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                "subtitles.aspectRatio must contain integer 'width' and 'height'"
            ) from exc

    dictionary = subtitles.get("dictionary")
    if dictionary:
        subtitling_config["dictionary"] = dictionary

    profanity_filter = subtitles.get("profanityFilter")
    if profanity_filter:
        if profanity_filter not in VALID_PROFANITY_MODES:
            raise ValueError(
                f"Invalid profanityFilter: {profanity_filter!r}. "
                f"Must be one of {sorted(VALID_PROFANITY_MODES)}"
            )
        subtitling_config["profanityFilter"] = profanity_filter

    return {
        "name": SUBTITLING_OUTPUT_NAME,
        "outputConfig": {"subtitling": subtitling_config},
        "status": "ENABLED",
    }


@tracer.capture_method
def get_feed(feed_id: str) -> Dict[str, Any]:
    """Retrieve the current feed state from Elemental Inference."""
    return inference_client.get_feed(id=feed_id)


@tracer.capture_method
def build_updated_outputs(
    existing_outputs: list,
    clipping_callback: str,
    clipping_status: str,
) -> list:
    """Build an updated outputs list, replacing only the clipping-output while preserving all others."""
    updated = []
    clipping_found = False

    for output in existing_outputs:
        if output.get("name") == "clipping-output":
            clipping_found = True
            updated.append({
                "name": "clipping-output",
                "outputConfig": {
                    "clipping": {
                        "callbackMetadata": clipping_callback,
                    }
                },
                "status": clipping_status,
            })
        else:
            updated.append(output)

    # If no clipping-output existed, add one
    if not clipping_found:
        updated.append({
            "name": "clipping-output",
            "outputConfig": {
                "clipping": {
                    "callbackMetadata": clipping_callback,
                }
            },
            "status": clipping_status,
        })

    return updated


@tracer.capture_method
def handle_update_callback(event: Dict[str, Any]) -> Dict[str, Any]:
    """Update an Elemental Inference feed's callbackMetadata and enable clipping."""
    feed_id = event.get("feedId")
    callback_metadata = event.get("callbackMetadata")
    if not feed_id:
        raise ValueError("Missing required field: feedId")
    if not callback_metadata:
        raise ValueError("Missing required field: callbackMetadata")

    logger.info("Updating feed callbackMetadata", extra={"feed_id": feed_id, "callback_metadata": callback_metadata})

    # Fetch current feed to preserve existing outputs (e.g. cropping)
    current_feed = get_feed(feed_id)
    existing_outputs = current_feed.get("outputs", [])
    feed_name = current_feed.get("name", event.get("feedName", ""))

    outputs = build_updated_outputs(existing_outputs, callback_metadata, "ENABLED")

    update_kwargs: Dict[str, Any] = {"id": feed_id, "outputs": outputs}
    if feed_name:
        update_kwargs["name"] = feed_name

    inference_client.update_feed(**update_kwargs)

    logger.info("Feed callbackMetadata updated", extra={"feed_id": feed_id, "callback_metadata": callback_metadata})
    metrics.add_metric(name="FeedCallbackUpdated", unit=MetricUnit.Count, value=1)

    return {"updated": True, "feedId": feed_id, "callbackMetadata": callback_metadata}


@tracer.capture_method
def handle_disable_feed(event: Dict[str, Any]) -> Dict[str, Any]:
    """Disable an Elemental Inference feed's clipping output to stop clip generation."""
    feed_id = event.get("feedId")
    if not feed_id:
        raise ValueError("Missing required field: feedId")

    logger.info("Disabling feed output", extra={"feed_id": feed_id})

    # Fetch current feed to preserve existing outputs (e.g. cropping)
    current_feed = get_feed(feed_id)
    existing_outputs = current_feed.get("outputs", [])
    feed_name = current_feed.get("name", event.get("feedName", ""))

    outputs = build_updated_outputs(existing_outputs, "", "DISABLED")

    update_kwargs: Dict[str, Any] = {"id": feed_id, "outputs": outputs}
    if feed_name:
        update_kwargs["name"] = feed_name

    inference_client.update_feed(**update_kwargs)

    logger.info("Feed output disabled", extra={"feed_id": feed_id})
    metrics.add_metric(name="FeedDisabled", unit=MetricUnit.Count, value=1)

    return {"disabled": True, "feedId": feed_id}


@tracer.capture_method
def handle_set_endpoint_policies(event: Dict[str, Any]) -> Dict[str, Any]:
    """Set public access + harvest policies on all three origin endpoints."""
    channel_group = event.get("channelGroupName")
    channel_name = event.get("channelName")
    if not channel_group or not channel_name:
        raise ValueError("Missing required fields: channelGroupName, channelName")

    # Get account ID for resource ARNs
    sts_client = boto3.client("sts")
    account_id = sts_client.get_caller_identity()["Account"]

    endpoints = [
        f"{channel_name}-main",
        f"{channel_name}-landscape",
        f"{channel_name}-vertical",
    ]

    for ep_name in endpoints:
        resource_arn = f"arn:aws:mediapackagev2:{AWS_REGION}:{account_id}:channelGroup/{channel_group}/channel/{channel_name}/originEndpoint/{ep_name}"
        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "AllowPublicGetObjectAccess",
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": ["mediapackagev2:GetHeadObject", "mediapackagev2:GetObject"],
                    "Resource": resource_arn,
                },
                {
                    "Sid": "AllowMediaPackageHarvestObjectAccess",
                    "Effect": "Allow",
                    "Principal": {"Service": "mediapackagev2.amazonaws.com"},
                    "Action": "mediapackagev2:HarvestObject",
                    "Resource": resource_arn,
                    "Condition": {
                        "StringEquals": {
                            "AWS:SourceAccount": account_id,
                        }
                    },
                },
            ],
        }

        logger.info("Setting endpoint policy", extra={"endpoint": ep_name, "resource_arn": resource_arn})
        mpv2_client.put_origin_endpoint_policy(
            ChannelGroupName=channel_group,
            ChannelName=channel_name,
            OriginEndpointName=ep_name,
            Policy=json.dumps(policy),
        )
        logger.info("Endpoint policy set", extra={"endpoint": ep_name})

    metrics.add_metric(name="EndpointPoliciesSet", unit=MetricUnit.Count, value=1)
    return {"policiesSet": True, "endpoints": endpoints}


@tracer.capture_method
def handle_delete_endpoint_policies(event: Dict[str, Any]) -> Dict[str, Any]:
    """Delete origin endpoint policies (best-effort, continues on error)."""
    channel_group = event.get("channelGroupName")
    channel_name = event.get("channelName")
    endpoints = event.get("endpoints", [])
    if not channel_group or not channel_name:
        raise ValueError("Missing required fields: channelGroupName, channelName")

    errors = []
    for ep_name in endpoints:
        if not ep_name:
            continue
        try:
            logger.info("Deleting endpoint policy", extra={"endpoint": ep_name})
            mpv2_client.delete_origin_endpoint_policy(
                ChannelGroupName=channel_group,
                ChannelName=channel_name,
                OriginEndpointName=ep_name,
            )
        except Exception as e:
            errors.append(f"{ep_name}: {str(e)}")
            logger.warning("Failed to delete endpoint policy (continuing)", extra={"endpoint": ep_name, "error": str(e)})

    metrics.add_metric(name="EndpointPoliciesDeleted", unit=MetricUnit.Count, value=1)
    return {"policiesDeleted": True, "errors": errors}


@tracer.capture_method
def handle_delete(event: Dict[str, Any]) -> Dict[str, Any]:
    """Delete an Elemental Inference feed (saga compensation)."""
    feed_id = event.get("feedId")
    if not feed_id:
        raise ValueError("Missing required field: feedId")

    logger.info("Deleting inference feed", extra={"feed_id": feed_id})

    inference_client.delete_feed(id=feed_id)

    logger.info("Feed deleted", extra={"feed_id": feed_id})
    metrics.add_metric(name="FeedDeleted", unit=MetricUnit.Count, value=1)

    return {"deleted": True, "feedId": feed_id}
