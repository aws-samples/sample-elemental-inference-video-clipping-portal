"""
Unit tests for the Transcode Task Lambda.

Tests orientation-specific video settings, HLS manifest URI derivation,
MediaConvert job submission, and error handling.
"""

import os
import pytest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError

# Set required environment variables before importing
os.environ.setdefault("MC_ENDPOINT", "https://mediaconvert.us-east-1.amazonaws.com")
os.environ.setdefault("VIDEO_ASSETS_BUCKET", "test-bucket")

from main import lambda_handler, build_job_settings, VIDEO_SETTINGS


@pytest.fixture
def base_event():
    return {
        "s3SourceKey": "harvested-clips/ch/2024-01-01/clip-1/landscape/",
        "orientation": "landscape",
        "outputPrefix": "downloads/clip/clip-1/landscape/",
        "mcRoleArn": "arn:aws:iam::123456789012:role/MediaConvertRole",
        "correlationId": "exec-id-123",
        "downloadJobId": "djob-uuid-1",
    }


@pytest.fixture
def mock_context():
    ctx = MagicMock()
    ctx.function_name = "transcode-task"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:transcode-task"
    ctx.aws_request_id = "test-request-id"
    return ctx


# --- Video Settings ---

def test_landscape_video_dimensions():
    """Landscape uses 1920x1080."""
    assert VIDEO_SETTINGS["landscape"]["width"] == 1920
    assert VIDEO_SETTINGS["landscape"]["height"] == 1080


def test_portrait_video_dimensions():
    """Portrait uses 1080x1920."""
    assert VIDEO_SETTINGS["portrait"]["width"] == 1080
    assert VIDEO_SETTINGS["portrait"]["height"] == 1920


# --- Job Settings Builder ---

def test_build_job_settings_landscape():
    """Landscape job settings have correct dimensions and codec."""
    settings = build_job_settings("s3://bucket/input.m3u8", "landscape", "s3://bucket/output/")
    video = settings["OutputGroups"][0]["Outputs"][0]["VideoDescription"]
    assert video["Width"] == 1920
    assert video["Height"] == 1080
    assert video["CodecSettings"]["H264Settings"]["RateControlMode"] == "QVBR"


def test_build_job_settings_portrait():
    """Portrait job settings have correct dimensions."""
    settings = build_job_settings("s3://bucket/input.m3u8", "portrait", "s3://bucket/output/")
    video = settings["OutputGroups"][0]["Outputs"][0]["VideoDescription"]
    assert video["Width"] == 1080
    assert video["Height"] == 1920


def test_build_job_settings_audio():
    """Audio settings use AAC at 128kbps."""
    settings = build_job_settings("s3://bucket/input.m3u8", "landscape", "s3://bucket/output/")
    audio = settings["OutputGroups"][0]["Outputs"][0]["AudioDescriptions"][0]
    assert audio["CodecSettings"]["Codec"] == "AAC"
    assert audio["CodecSettings"]["AacSettings"]["Bitrate"] == 128000
    assert audio["CodecSettings"]["AacSettings"]["SampleRate"] == 48000


def test_build_job_settings_unknown_orientation_defaults_to_landscape():
    """Unknown orientation falls back to landscape dimensions."""
    settings = build_job_settings("s3://bucket/input.m3u8", "unknown", "s3://bucket/output/")
    video = settings["OutputGroups"][0]["Outputs"][0]["VideoDescription"]
    assert video["Width"] == 1920
    assert video["Height"] == 1080


def test_build_job_settings_mp4_container():
    """Output container is MP4."""
    settings = build_job_settings("s3://bucket/input.m3u8", "landscape", "s3://bucket/output/")
    container = settings["OutputGroups"][0]["Outputs"][0]["ContainerSettings"]["Container"]
    assert container == "MP4"


# --- HLS Manifest URI Derivation ---

@patch("main.mc_client")
def test_handler_appends_main_m3u8_to_prefix(mock_mc, base_event, mock_context):
    """Source key ending with / gets /main.m3u8 appended."""
    mock_mc.create_job.return_value = {"Job": {"Id": "job-123"}}

    lambda_handler(base_event, mock_context)

    call_kwargs = mock_mc.create_job.call_args[1]
    file_input = call_kwargs["Settings"]["Inputs"][0]["FileInput"]
    assert file_input.endswith("/main.m3u8")
    assert "landscape/main.m3u8" in file_input


@patch("main.mc_client")
def test_handler_appends_main_m3u8_to_non_m3u8_key(mock_mc, mock_context):
    """Source key not ending in .m3u8 gets /main.m3u8 appended."""
    event = {
        "s3SourceKey": "harvested-clips/ch/2024-01-01/clip-1/landscape",
        "orientation": "landscape",
        "outputPrefix": "downloads/clip/clip-1/landscape/",
        "mcRoleArn": "arn:aws:iam::123456789012:role/MediaConvertRole",
        "correlationId": "exec-id",
        "downloadJobId": "djob-1",
    }
    mock_mc.create_job.return_value = {"Job": {"Id": "job-123"}}

    lambda_handler(event, mock_context)

    file_input = mock_mc.create_job.call_args[1]["Settings"]["Inputs"][0]["FileInput"]
    assert file_input.endswith("/main.m3u8")


@patch("main.mc_client")
def test_handler_preserves_explicit_m3u8_key(mock_mc, mock_context):
    """Source key already ending in .m3u8 is used as-is."""
    event = {
        "s3SourceKey": "harvested-clips/ch/clip-1/landscape/main.m3u8",
        "orientation": "landscape",
        "outputPrefix": "downloads/clip/clip-1/landscape/",
        "mcRoleArn": "arn:aws:iam::123456789012:role/MediaConvertRole",
        "correlationId": "exec-id",
        "downloadJobId": "djob-1",
    }
    mock_mc.create_job.return_value = {"Job": {"Id": "job-123"}}

    lambda_handler(event, mock_context)

    file_input = mock_mc.create_job.call_args[1]["Settings"]["Inputs"][0]["FileInput"]
    assert file_input == "s3://test-bucket/harvested-clips/ch/clip-1/landscape/main.m3u8"


# --- MediaConvert Job Submission ---

@patch("main.mc_client")
def test_handler_returns_job_id_and_prefix(mock_mc, base_event, mock_context):
    """Handler returns mediaConvertJobId and outputPrefix."""
    mock_mc.create_job.return_value = {"Job": {"Id": "mc-job-456"}}

    result = lambda_handler(base_event, mock_context)

    assert result["mediaConvertJobId"] == "mc-job-456"
    assert result["outputPrefix"] == "downloads/clip/clip-1/landscape/"


@patch("main.mc_client")
def test_handler_includes_correlation_in_metadata(mock_mc, base_event, mock_context):
    """UserMetadata includes correlationId and downloadJobId."""
    mock_mc.create_job.return_value = {"Job": {"Id": "mc-job-456"}}

    lambda_handler(base_event, mock_context)

    call_kwargs = mock_mc.create_job.call_args[1]
    metadata = call_kwargs["UserMetadata"]
    assert metadata["correlationId"] == "exec-id-123"
    assert metadata["downloadJobId"] == "djob-uuid-1"
    assert metadata["orientation"] == "landscape"


@patch("main.mc_client")
def test_handler_passes_role_arn(mock_mc, base_event, mock_context):
    """Handler passes the mcRoleArn to MediaConvert."""
    mock_mc.create_job.return_value = {"Job": {"Id": "mc-job-456"}}

    lambda_handler(base_event, mock_context)

    call_kwargs = mock_mc.create_job.call_args[1]
    assert call_kwargs["Role"] == "arn:aws:iam::123456789012:role/MediaConvertRole"


# --- Error Handling ---

@patch("main.mc_client")
def test_handler_raises_on_mediaconvert_error(mock_mc, base_event, mock_context):
    """Handler raises ClientError when MediaConvert call fails."""
    mock_mc.create_job.side_effect = ClientError(
        {"Error": {"Code": "InternalServerError", "Message": "Service error"}},
        "CreateJob",
    )

    with pytest.raises(ClientError):
        lambda_handler(base_event, mock_context)
