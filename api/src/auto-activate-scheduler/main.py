#!/usr/bin/env python3
"""
Auto-Activate Scheduler Lambda

Runs every minute via EventBridge to automatically activate and deactivate
inference clipping for events based on their startDateTime and endDateTime.

Reads system settings to determine if auto-activation is enabled and which
conflict resolution strategy to use when multiple events overlap on the
same channel.

Supported conflict resolution strategies:
- prefer_running: keep the currently active event, skip new activations
- prefer_latest_start: activate the event with the most recent startDateTime
"""

import os
import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from collections import defaultdict

import boto3
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger(service="auto-activate-scheduler")
tracer = Tracer(service="auto-activate-scheduler")
metrics = Metrics(namespace="AutoActivateScheduler", service="auto-activate-scheduler")

# Initialize AWS clients
dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")

# Environment variables
EVENTS_TABLE = os.environ.get("EVENTS_TABLE", "")
SYSTEM_SETTINGS_TABLE = os.environ.get("SYSTEM_SETTINGS_TABLE", "")
CHANNELS_TABLE = os.environ.get("CHANNELS_TABLE", "")
CREATE_FEED_FUNCTION_NAME = os.environ.get("CREATE_FEED_FUNCTION_NAME", "")


def read_system_setting(table_name: str, setting_key: str, default_value: str) -> str:
    """Read a setting from the System Settings table.

    Args:
        table_name: Name of the System Settings DynamoDB table.
        setting_key: The setting key to look up.
        default_value: Value to return if the setting is missing or an error occurs.

    Returns:
        The setting value if found, otherwise default_value.
    """
    try:
        table = dynamodb.Table(table_name)
        response = table.get_item(Key={"settingKey": setting_key})
        item = response.get("Item")
        if item and "settingValue" in item:
            return item["settingValue"]
        logger.info("Setting not found, using default",
                     extra={"setting_key": setting_key, "default_value": default_value})
        return default_value
    except Exception as e:
        logger.warning("Failed to read system setting, using default",
                       extra={"setting_key": setting_key, "default_value": default_value, "error": str(e)})
        return default_value


def scan_all_events(table_name: str) -> List[Dict[str, Any]]:
    """Scan all events from the Events table with pagination.

    Returns:
        List of all event records.
    """
    table = dynamodb.Table(table_name)
    items: List[Dict[str, Any]] = []
    last_evaluated_key = None

    while True:
        scan_kwargs: Dict[str, Any] = {}
        if last_evaluated_key:
            scan_kwargs["ExclusiveStartKey"] = last_evaluated_key

        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_evaluated_key = response.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break

    return items


def deactivate_event(table_name: str, event_id: str, now_iso: str) -> None:
    """Set isActiveForStarfish=false and update updatedAt on an event."""
    table = dynamodb.Table(table_name)
    table.update_item(
        Key={"id": event_id},
        UpdateExpression="SET isActiveForStarfish = :false_val, updatedAt = :now",
        ExpressionAttributeValues={
            ":false_val": False,
            ":now": now_iso,
        },
    )


def activate_event(table_name: str, event_id: str, now_iso: str) -> None:
    """Set isActiveForStarfish=true and update updatedAt on an event."""
    table = dynamodb.Table(table_name)
    table.update_item(
        Key={"id": event_id},
        UpdateExpression="SET isActiveForStarfish = :true_val, updatedAt = :now",
        ExpressionAttributeValues={
            ":true_val": True,
            ":now": now_iso,
        },
    )


def get_channel_feed_info(table_name: str, channel_id: str) -> Optional[Dict[str, str]]:
    """Look up the feedId and channel name for a channel from the Channels table.

    Returns:
        Dict with feedId and channelName, or None if not found.
    """
    try:
        table = dynamodb.Table(table_name)
        response = table.get_item(Key={"id": channel_id})
        item = response.get("Item")
        if item and "feedId" in item:
            return {
                "feedId": item["feedId"],
                "channelName": item.get("name", ""),
            }
        logger.warning("Channel has no feedId", extra={"channel_id": channel_id})
        return None
    except Exception as e:
        logger.warning("Failed to read channel record",
                       extra={"channel_id": channel_id, "error": str(e)})
        return None


def invoke_update_callback(function_name: str, feed_id: str, feed_name: str, event_name: str) -> None:
    """Invoke the Create Feed Lambda with update_callback action.

    This is non-fatal — errors are logged and swallowed.
    """
    try:
        payload = {
            "action": "update_callback",
            "feedId": feed_id,
            "feedName": feed_name,
            "callbackMetadata": event_name,
        }
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload).encode("utf-8"),
        )
        # Check for Lambda execution errors
        if "FunctionError" in response:
            error_payload = json.loads(response["Payload"].read().decode("utf-8"))
            logger.error("Create Feed Lambda returned an error",
                         extra={"feed_id": feed_id, "event_name": event_name,
                                "error": error_payload.get("errorMessage", "unknown")})
            return
        logger.info("Feed callbackMetadata updated",
                     extra={"feed_id": feed_id, "event_name": event_name})
    except Exception as e:
        logger.error("Failed to invoke Create Feed Lambda (non-fatal)",
                     extra={"feed_id": feed_id, "event_name": event_name, "error": str(e)})


def invoke_disable_feed(function_name: str, feed_id: str, feed_name: str) -> None:
    """Invoke the Create Feed Lambda with disable_feed action to stop Inference clip generation.

    This is non-fatal — errors are logged and swallowed.
    """
    try:
        payload = {
            "action": "disable_feed",
            "feedId": feed_id,
            "feedName": feed_name,
        }
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload).encode("utf-8"),
        )
        if "FunctionError" in response:
            error_payload = json.loads(response["Payload"].read().decode("utf-8"))
            logger.error("Create Feed Lambda returned an error on disable",
                         extra={"feed_id": feed_id,
                                "error": error_payload.get("errorMessage", "unknown")})
            return
        logger.info("Feed output disabled",
                     extra={"feed_id": feed_id})
    except Exception as e:
        logger.error("Failed to disable feed (non-fatal)",
                     extra={"feed_id": feed_id, "error": str(e)})


def process_activation(event_record: Dict[str, Any], now_iso: str) -> None:
    """Activate a single event and update its channel feed callback.

    Handles channel feed lookup and Create Feed Lambda invocation.
    Feed update failures are non-fatal.
    """
    event_id = event_record["id"]
    event_name = event_record.get("name", "")
    channel_id = event_record.get("mediaLiveChannel", "")

    activate_event(EVENTS_TABLE, event_id, now_iso)
    logger.info("Event activated", extra={"event_id": event_id})
    metrics.add_metric(name="EventsActivated", unit=MetricUnit.Count, value=1)

    # Look up channel feedId and invoke Create Feed Lambda
    if channel_id and CHANNELS_TABLE and CREATE_FEED_FUNCTION_NAME:
        feed_info = get_channel_feed_info(CHANNELS_TABLE, channel_id)
        if feed_info:
            feed_name = f"{feed_info['channelName']}-feed" if feed_info["channelName"] else ""
            invoke_update_callback(CREATE_FEED_FUNCTION_NAME, feed_info["feedId"], feed_name, event_name)


def process_events(events: List[Dict[str, Any]], conflict_resolution: str, now: datetime) -> None:
    """Core scheduling logic: deactivate expired events, then activate eligible ones.

    Args:
        events: All event records from the Events table.
        conflict_resolution: Either "prefer_running" or "prefer_latest_start".
        now: Current UTC datetime.
    """
    now_iso = now.isoformat()

    # Phase 1: Deactivate expired active events
    for event_record in events:
        try:
            is_active = event_record.get("isActiveForStarfish", False)
            # Handle string booleans from DynamoDB if needed
            if isinstance(is_active, str):
                is_active = is_active.lower() == "true"

            end_dt_str = event_record.get("endDateTime", "")
            if not end_dt_str:
                continue

            end_dt = datetime.fromisoformat(end_dt_str.replace("Z", "+00:00"))

            if is_active and end_dt < now:
                event_id = event_record["id"]
                deactivate_event(EVENTS_TABLE, event_id, now_iso)
                logger.info("Deactivated expired event",
                            extra={"event_id": event_id, "end_date_time": end_dt_str})
                metrics.add_metric(name="EventsDeactivated", unit=MetricUnit.Count, value=1)

                # Disable the Inference feed output to stop clip generation and cost
                channel_id = event_record.get("mediaLiveChannel", "")
                if channel_id and CHANNELS_TABLE and CREATE_FEED_FUNCTION_NAME:
                    feed_info = get_channel_feed_info(CHANNELS_TABLE, channel_id)
                    if feed_info:
                        # Only disable if no other active event remains on this channel
                        other_active = any(
                            e.get("id") != event_id
                            and e.get("mediaLiveChannel") == channel_id
                            and e.get("isActiveForStarfish") is True
                            for e in events
                        )
                        if not other_active:
                            feed_name = f"{feed_info['channelName']}-feed" if feed_info["channelName"] else ""
                            invoke_disable_feed(CREATE_FEED_FUNCTION_NAME, feed_info["feedId"], feed_name)

                # Mark as inactive in our local copy so grouping logic sees updated state
                event_record["isActiveForStarfish"] = False
        except Exception as e:
            logger.error("Error deactivating expired event",
                         extra={"event_id": event_record.get("id", "unknown"), "error": str(e)})

    # Phase 2: Group eligible events by channel and apply conflict resolution
    channel_events: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for event_record in events:
        try:
            start_dt_str = event_record.get("startDateTime", "")
            end_dt_str = event_record.get("endDateTime", "")
            if not start_dt_str or not end_dt_str:
                continue

            start_dt = datetime.fromisoformat(start_dt_str.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(end_dt_str.replace("Z", "+00:00"))

            # Eligible: startDateTime <= now AND endDateTime > now
            if start_dt <= now and end_dt > now:
                channel_id = event_record.get("mediaLiveChannel", "")
                if channel_id:
                    channel_events[channel_id].append(event_record)
        except Exception as e:
            logger.error("Error evaluating event eligibility",
                         extra={"event_id": event_record.get("id", "unknown"), "error": str(e)})

    # Phase 3: Apply conflict resolution per channel
    for channel_id, eligible_events in channel_events.items():
        try:
            _resolve_channel(eligible_events, conflict_resolution, now_iso)
        except Exception as e:
            logger.error("Error processing channel",
                         extra={"channel_id": channel_id, "error": str(e)})


def _resolve_channel(eligible_events: List[Dict[str, Any]], conflict_resolution: str, now_iso: str) -> None:
    """Apply conflict resolution for a single channel's eligible events."""
    # Check if any eligible event is already active on this channel
    active_events = []
    inactive_eligible = []

    for ev in eligible_events:
        is_active = ev.get("isActiveForStarfish", False)
        if isinstance(is_active, str):
            is_active = is_active.lower() == "true"
        if is_active:
            active_events.append(ev)
        else:
            inactive_eligible.append(ev)

    if conflict_resolution == "prefer_running":
        # If there's already an active event on this channel, skip activation
        if active_events:
            logger.info("prefer_running: channel already has active event, skipping",
                        extra={"active_event_id": active_events[0]["id"],
                               "skipped_count": len(inactive_eligible)})
            return

        # No active event — activate the one with the most recent startDateTime
        if inactive_eligible:
            best = max(inactive_eligible, key=lambda e: e.get("startDateTime", ""))
            process_activation(best, now_iso)

    elif conflict_resolution == "prefer_latest_start":
        # Find the eligible event with the most recent startDateTime (active or not)
        all_eligible = active_events + inactive_eligible
        if not all_eligible:
            return

        best = max(all_eligible, key=lambda e: e.get("startDateTime", ""))
        best_id = best["id"]
        best_is_active = best.get("isActiveForStarfish", False)
        if isinstance(best_is_active, str):
            best_is_active = best_is_active.lower() == "true"

        # Deactivate any other active events on this channel
        for ev in active_events:
            if ev["id"] != best_id:
                deactivate_event(EVENTS_TABLE, ev["id"], now_iso)
                logger.info("prefer_latest_start: deactivated competing event",
                            extra={"event_id": ev["id"]})
                metrics.add_metric(name="EventsDeactivated", unit=MetricUnit.Count, value=1)

        # Activate the best event if not already active
        if not best_is_active:
            process_activation(best, now_iso)


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """Scheduled handler invoked every minute by EventBridge.

    1. Check if auto-activate is enabled; exit if not.
    2. Read conflict resolution strategy.
    3. Scan events and apply activation/deactivation logic.
    """
    logger.info("Auto-activate scheduler invoked")

    # Step 1: Check if auto-activate is enabled
    auto_activate = read_system_setting(SYSTEM_SETTINGS_TABLE, "autoActivateInference", "false")
    if auto_activate != "true":
        logger.info("Auto-activate is disabled, exiting",
                     extra={"auto_activate_value": auto_activate})
        return {"status": "disabled"}

    # Step 2: Read conflict resolution strategy
    conflict_resolution = read_system_setting(
        SYSTEM_SETTINGS_TABLE, "autoActivateConflictResolution", "prefer_running"
    )
    logger.info("Conflict resolution strategy", extra={"conflict_resolution": conflict_resolution})

    # Step 3: Scan all events
    all_events = scan_all_events(EVENTS_TABLE)
    logger.info("Scanned events", extra={"event_count": len(all_events)})

    # Step 4: Process events
    now = datetime.now(timezone.utc)
    process_events(all_events, conflict_resolution, now)

    metrics.add_metric(name="SchedulerRuns", unit=MetricUnit.Count, value=1)
    logger.info("Scheduler run complete")

    return {"status": "complete", "events_scanned": len(all_events)}
