"""
Unit tests for the Harvest Task Lambda.

Tests channel config resolution, buffer application, harvest job creation,
DynamoDB record saving, and error handling.
"""

import os
import pytest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError

# Set required environment variables before importing the module
os.environ.setdefault("VIDEO_ASSETS_BUCKET", "test-bucket")
os.environ.setdefault("HARVEST_JOBS_TABLE_NAME", "test-harvest-jobs")
os.environ.setdefault("CHANNELS_TABLE_NAME", "test-channels")
os.environ.setdefault("SYSTEM_SETTINGS_TABLE", "test-settings")
os.environ.setdefault("MEDIAPACKAGE_CHANNEL_GROUP", "default-group")
os.environ.setdefault("MEDIALIVE_CHANNEL_NAME", "default-channel")
os.environ.setdefault("MEDIAPACKAGE_LANDSCAPE_ENDPOINT", "default-landscape")
os.environ.setdefault("MEDIAPACKAGE_VERTICAL_ENDPOINT", "default-vertical")

from main import (
    lambda_handler,
    resolve_channel_config,
    get_origin_endpoint,
    apply_harvest_buffer,
    build_s3_prefix,
    read_system_setting,
)


# --- Fixtures ---

@pytest.fixture
def base_event():
    return {
        "clipId": "clip-abc-123",
        "channelId": "channel-1",
        "orientation": "landscape",
        "startTime": "2024-06-15T10:00:00.000Z",
        "endTime": "2024-06-15T10:05:00.000Z",
        "correlationId": "exec-id-123",
    }


@pytest.fixture
def mock_context():
    ctx = MagicMock()
    ctx.function_name = "harvest-task"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:harvest-task"
    ctx.aws_request_id = "test-request-id"
    return ctx


# --- Channel Config Resolution ---

def test_resolve_channel_config_uses_explicit_config():
    """When caller provides channelConfig with channelGroup, use it directly."""
    config = resolve_channel_config("channel-1", {
        "channelGroup": "explicit-group",
        "channelName": "explicit-channel",
        "landscapeEndpoint": "explicit-landscape",
        "verticalEndpoint": "explicit-vertical",
    })
    assert config["channelGroup"] == "explicit-group"
    assert config["channelName"] == "explicit-channel"
    assert config["landscapeEndpoint"] == "explicit-landscape"
    assert config["verticalEndpoint"] == "explicit-vertical"


@patch("main.get_channel_record")
def test_resolve_channel_config_from_dynamodb(mock_get_record):
    """When no explicit config, resolve from Channels table record."""
    mock_get_record.return_value = {
        "id": "channel-1",
        "channelGroupName": "db-group",
        "mediaPackageChannelName": "db-channel",
        "landscapeEndpointName": "db-landscape",
        "verticalEndpointName": "db-vertical",
    }
    config = resolve_channel_config("channel-1", None)
    assert config["channelGroup"] == "db-group"
    assert config["channelName"] == "db-channel"
    mock_get_record.assert_called_once_with("channel-1")


@patch("main.get_channel_record")
def test_resolve_channel_config_falls_back_to_env_defaults(mock_get_record):
    """When no explicit config and no channel record, fall back to env defaults."""
    mock_get_record.return_value = None
    config = resolve_channel_config("channel-1", None)
    assert config["channelGroup"] == "default-group"
    assert config["channelName"] == "default-channel"
    assert config["landscapeEndpoint"] == "default-landscape"
    assert config["verticalEndpoint"] == "default-vertical"


@patch("main.get_channel_record")
def test_resolve_channel_config_partial_record_uses_env_fallback(mock_get_record):
    """Channel record with missing fields falls back to env defaults for those fields."""
    mock_get_record.return_value = {
        "id": "channel-1",
        "channelGroupName": "db-group",
        # missing mediaPackageChannelName, landscapeEndpointName, verticalEndpointName
    }
    config = resolve_channel_config("channel-1", None)
    assert config["channelGroup"] == "db-group"
    assert config["channelName"] == "default-channel"
    assert config["landscapeEndpoint"] == "default-landscape"


def test_resolve_channel_config_empty_channel_config_uses_fallback():
    """Empty channelConfig dict (no channelGroup) triggers DynamoDB/env fallback."""
    with patch("main.get_channel_record", return_value=None):
        config = resolve_channel_config("channel-1", {})
    assert config["channelGroup"] == "default-group"


# --- Orientation Endpoint ---

def test_get_origin_endpoint_landscape():
    config = {"landscapeEndpoint": "land-ep", "verticalEndpoint": "vert-ep"}
    assert get_origin_endpoint(config, "landscape") == "land-ep"


def test_get_origin_endpoint_portrait():
    config = {"landscapeEndpoint": "land-ep", "verticalEndpoint": "vert-ep"}
    assert get_origin_endpoint(config, "portrait") == "vert-ep"


# --- Harvest Buffer ---

def test_apply_harvest_buffer_zero():
    """Zero buffer returns original times unchanged."""
    start, end = apply_harvest_buffer("2024-06-15T10:00:00.000Z", "2024-06-15T10:05:00.000Z", 0)
    assert start == "2024-06-15T10:00:00.000Z"
    assert end == "2024-06-15T10:05:00.000Z"


def test_apply_harvest_buffer_positive():
    """Positive buffer subtracts from start and adds to end."""
    start, end = apply_harvest_buffer("2024-06-15T10:00:00.000Z", "2024-06-15T10:05:00.000Z", 30)
    assert start == "2024-06-15T09:59:30.000Z"
    assert end == "2024-06-15T10:05:30.000Z"


def test_apply_harvest_buffer_negative():
    """Negative buffer returns original times unchanged."""
    start, end = apply_harvest_buffer("2024-06-15T10:00:00.000Z", "2024-06-15T10:05:00.000Z", -5)
    assert start == "2024-06-15T10:00:00.000Z"
    assert end == "2024-06-15T10:05:00.000Z"


# --- S3 Prefix ---

@patch("main.datetime")
def test_build_s3_prefix_includes_orientation(mock_dt):
    mock_dt.utcnow.return_value.strftime.return_value = "2024-06-15"
    result = build_s3_prefix("channel-1", "clip-abc", "landscape")
    assert result == "harvested-clips/channel-1/2024-06-15/clip-abc/landscape/"


@patch("main.datetime")
def test_build_s3_prefix_portrait(mock_dt):
    mock_dt.utcnow.return_value.strftime.return_value = "2024-06-15"
    result = build_s3_prefix("channel-1", "clip-abc", "portrait")
    assert result == "harvested-clips/channel-1/2024-06-15/clip-abc/portrait/"


# --- System Settings ---

@patch("main.dynamodb")
def test_read_system_setting_returns_value(mock_dynamodb):
    mock_table = MagicMock()
    mock_table.get_item.return_value = {"Item": {"settingKey": "harvestBufferSeconds", "settingValue": "30"}}
    mock_dynamodb.Table.return_value = mock_table
    assert read_system_setting("test-settings", "harvestBufferSeconds", "0") == "30"


@patch("main.dynamodb")
def test_read_system_setting_returns_default_on_missing(mock_dynamodb):
    mock_table = MagicMock()
    mock_table.get_item.return_value = {}
    mock_dynamodb.Table.return_value = mock_table
    assert read_system_setting("test-settings", "harvestBufferSeconds", "0") == "0"


def test_read_system_setting_returns_default_when_table_empty():
    assert read_system_setting("", "harvestBufferSeconds", "0") == "0"


@patch("main.dynamodb")
def test_read_system_setting_returns_default_on_error(mock_dynamodb):
    mock_table = MagicMock()
    mock_table.get_item.side_effect = Exception("DynamoDB error")
    mock_dynamodb.Table.return_value = mock_table
    assert read_system_setting("test-settings", "harvestBufferSeconds", "0") == "0"


# --- Lambda Handler Integration ---

@patch("main.save_harvest_job_record")
@patch("main.mediapackagev2_client")
@patch("main.read_system_setting", return_value="0")
@patch("main.resolve_channel_config")
def test_lambda_handler_creates_harvest_job(mock_resolve, mock_setting, mock_mp, mock_save, base_event, mock_context):
    """Handler creates a MediaPackage harvest job and saves a DynamoDB record."""
    mock_resolve.return_value = {
        "channelGroup": "grp", "channelName": "ch",
        "landscapeEndpoint": "land-ep", "verticalEndpoint": "vert-ep",
    }
    mock_mp.create_harvest_job.return_value = {}

    result = lambda_handler(base_event, mock_context)

    assert result["orientation"] == "landscape"
    assert result["harvestJobName"].startswith("harvest-clip-abc-123-landscape-")
    assert "s3Prefix" in result
    assert "harvestJobRecordId" in result
    mock_mp.create_harvest_job.assert_called_once()
    mock_save.assert_called_once()

    # Verify the Correlation_ID tag was passed
    call_kwargs = mock_mp.create_harvest_job.call_args[1]
    assert call_kwargs["Tags"]["Correlation_ID"] == "exec-id-123"


@patch("main.save_harvest_job_record")
@patch("main.mediapackagev2_client")
@patch("main.resolve_channel_config")
def test_lambda_handler_passes_times_unchanged(mock_resolve, mock_mp, mock_save, base_event, mock_context):
    """Handler passes start/end times through without re-applying buffer (buffer already applied by pipeline)."""
    mock_resolve.return_value = {
        "channelGroup": "grp", "channelName": "ch",
        "landscapeEndpoint": "land-ep", "verticalEndpoint": "vert-ep",
    }
    mock_mp.create_harvest_job.return_value = {}

    lambda_handler(base_event, mock_context)

    call_kwargs = mock_mp.create_harvest_job.call_args[1]
    schedule = call_kwargs["ScheduleConfiguration"]
    # Times should be passed through as-is (10:00:00 and 10:05:00 from base_event)
    assert schedule["StartTime"].minute == 0
    assert schedule["StartTime"].second == 0
    assert schedule["EndTime"].minute == 5
    assert schedule["EndTime"].second == 0


@patch("main.save_harvest_job_record")
@patch("main.mediapackagev2_client")
@patch("main.read_system_setting", return_value="0")
@patch("main.resolve_channel_config")
def test_lambda_handler_portrait_uses_vertical_endpoint(mock_resolve, mock_setting, mock_mp, mock_save, base_event, mock_context):
    """Portrait orientation uses the vertical endpoint."""
    mock_resolve.return_value = {
        "channelGroup": "grp", "channelName": "ch",
        "landscapeEndpoint": "land-ep", "verticalEndpoint": "vert-ep",
    }
    mock_mp.create_harvest_job.return_value = {}
    base_event["orientation"] = "portrait"

    result = lambda_handler(base_event, mock_context)

    assert result["orientation"] == "portrait"
    call_kwargs = mock_mp.create_harvest_job.call_args[1]
    assert call_kwargs["OriginEndpointName"] == "vert-ep"


@patch("main.mediapackagev2_client")
@patch("main.read_system_setting", return_value="0")
@patch("main.resolve_channel_config")
def test_lambda_handler_raises_on_mediapackage_error(mock_resolve, mock_setting, mock_mp, base_event, mock_context):
    """Handler raises ClientError when MediaPackage call fails."""
    mock_resolve.return_value = {
        "channelGroup": "grp", "channelName": "ch",
        "landscapeEndpoint": "land-ep", "verticalEndpoint": "vert-ep",
    }
    mock_mp.create_harvest_job.side_effect = ClientError(
        {"Error": {"Code": "ServiceException", "Message": "Service error"}},
        "CreateHarvestJob",
    )

    with pytest.raises(ClientError):
        lambda_handler(base_event, mock_context)


@patch("main.save_harvest_job_record")
@patch("main.mediapackagev2_client")
@patch("main.read_system_setting", return_value="0")
@patch("main.resolve_channel_config")
def test_lambda_handler_uses_explicit_channel_config(mock_resolve, mock_setting, mock_mp, mock_save, base_event, mock_context):
    """Handler passes channelConfig through to resolve_channel_config."""
    mock_resolve.return_value = {
        "channelGroup": "explicit-grp", "channelName": "explicit-ch",
        "landscapeEndpoint": "explicit-land", "verticalEndpoint": "explicit-vert",
    }
    mock_mp.create_harvest_job.return_value = {}
    base_event["channelConfig"] = {"channelGroup": "explicit-grp", "channelName": "explicit-ch"}

    lambda_handler(base_event, mock_context)

    mock_resolve.assert_called_once_with("channel-1", base_event["channelConfig"])
