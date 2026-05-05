"""
Unit tests for the Harvest Validate Lambda.

Tests all four actions: default validation, resolve_orientations,
build_orientation_list, and finalize_auto_harvest.
"""

import os
import pytest
from unittest.mock import MagicMock, patch, call

# Set required environment variables before importing
os.environ.setdefault("CLIPS_TABLE", "test-clips")
os.environ.setdefault("DOWNLOAD_JOBS_TABLE", "test-download-jobs")

from main import (
    lambda_handler,
    validate_harvest,
    resolve_orientations,
    build_orientation_list,
    finalize_auto_harvest,
)


@pytest.fixture
def mock_context():
    ctx = MagicMock()
    ctx.function_name = "harvest-validate"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:harvest-validate"
    ctx.aws_request_id = "test-request-id"
    return ctx


# --- Action Routing ---

@patch("main.dynamodb")
def test_lambda_handler_routes_to_resolve_orientations(mock_dynamodb, mock_context):
    """action=resolve_orientations routes to the correct handler."""
    mock_table = MagicMock()
    mock_table.get_item.return_value = {"Item": {"id": "c1", "sourceKeys": {}}}
    mock_dynamodb.Table.return_value = mock_table

    result = lambda_handler({"action": "resolve_orientations", "clipId": "c1", "requestedOrientations": ["landscape"]}, mock_context)
    assert "orientations" in result
    assert result["orientations"][0]["orientation"] == "landscape"


def test_lambda_handler_routes_to_build_orientation_list(mock_context):
    """action=build_orientation_list routes to the correct handler."""
    result = lambda_handler({"action": "build_orientation_list", "autoHarvest": "true"}, mock_context)
    assert "orientations" in result


@patch("main.dynamodb")
def test_lambda_handler_routes_to_finalize_auto_harvest(mock_dynamodb, mock_context):
    """action=finalize_auto_harvest routes to the correct handler."""
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    result = lambda_handler({"action": "finalize_auto_harvest", "clipId": "c1", "harvestResults": []}, mock_context)
    assert result["clipId"] == "c1"
    assert result["archived"] is False


@patch("main.validate_harvest", return_value={"valid": True, "fileCount": 1, "totalSizeBytes": 100, "reason": None})
def test_lambda_handler_defaults_to_validation(mock_validate, mock_context):
    """No action field routes to default S3 validation."""
    result = lambda_handler({"s3Prefix": "prefix/", "bucket": "bucket", "correlationId": "cid"}, mock_context)
    mock_validate.assert_called_once()


# --- Default Validation Action ---

@patch("main.s3_client")
def test_validate_harvest_valid_content(mock_s3):
    """Returns valid=True when .ts segment files exist."""
    paginator = MagicMock()
    paginator.paginate.return_value = [
        {"Contents": [
            {"Key": "prefix/main.m3u8", "Size": 500},
            {"Key": "prefix/segment001.ts", "Size": 1048576},
            {"Key": "prefix/segment002.ts", "Size": 1048576},
        ]}
    ]
    mock_s3.get_paginator.return_value = paginator

    result = validate_harvest({"s3Prefix": "prefix/", "bucket": "bucket", "correlationId": "cid"})

    assert result["valid"] is True
    assert result["fileCount"] == 2
    assert result["totalSizeBytes"] == 2097152


@patch("main.s3_client")
def test_validate_harvest_valid_cmaf_content(mock_s3):
    """Returns valid=True when CMAF .m4s segment files exist."""
    paginator = MagicMock()
    paginator.paginate.return_value = [
        {"Contents": [
            {"Key": "prefix/main.m3u8", "Size": 500},
            {"Key": "prefix/init.mp4", "Size": 1000},
            {"Key": "prefix/segment001.m4s", "Size": 1048576},
            {"Key": "prefix/segment002.m4s", "Size": 1048576},
        ]}
    ]
    mock_s3.get_paginator.return_value = paginator

    result = validate_harvest({"s3Prefix": "prefix/", "bucket": "bucket", "correlationId": "cid"})

    assert result["valid"] is True
    assert result["fileCount"] == 3  # init.mp4 + 2x .m4s
    assert result["totalSizeBytes"] == 2098152


@patch("main.s3_client")
def test_validate_harvest_empty_content(mock_s3):
    """Returns valid=False and cleans up when no .ts, .m4s, or .mp4 segment files exist."""
    paginator = MagicMock()
    paginator.paginate.return_value = [
        {"Contents": [
            {"Key": "prefix/main.m3u8", "Size": 200},
        ]}
    ]
    mock_s3.get_paginator.return_value = paginator

    result = validate_harvest({"s3Prefix": "prefix/", "bucket": "bucket", "correlationId": "cid"})

    assert result["valid"] is False
    assert result["fileCount"] == 0
    assert result["reason"] == "No video segment files found"
    # Placeholder should be cleaned up
    mock_s3.delete_object.assert_called_once_with(Bucket="bucket", Key="prefix/main.m3u8")


@patch("main.s3_client")
def test_validate_harvest_no_objects(mock_s3):
    """Returns valid=False when prefix has no objects at all."""
    paginator = MagicMock()
    paginator.paginate.return_value = [{"Contents": []}]
    mock_s3.get_paginator.return_value = paginator

    result = validate_harvest({"s3Prefix": "prefix/", "bucket": "bucket", "correlationId": "cid"})

    assert result["valid"] is False
    assert result["fileCount"] == 0


@patch("main.s3_client")
def test_validate_harvest_empty_page(mock_s3):
    """Returns valid=False when paginator returns pages with no Contents key."""
    paginator = MagicMock()
    paginator.paginate.return_value = [{}]
    mock_s3.get_paginator.return_value = paginator

    result = validate_harvest({"s3Prefix": "prefix/", "bucket": "bucket", "correlationId": "cid"})

    assert result["valid"] is False


# --- Resolve Orientations Action ---

@patch("main.dynamodb")
def test_resolve_orientations_both_need_harvest(mock_dynamodb):
    """Both orientations need harvest when harvestedOrientations is empty."""
    mock_table = MagicMock()
    mock_table.get_item.return_value = {"Item": {"id": "clip-1", "sourceKeys": {}}}
    mock_dynamodb.Table.return_value = mock_table

    result = resolve_orientations({
        "clipId": "clip-1",
        "requestedOrientations": ["landscape", "portrait"],
    })

    orientations = result["orientations"]
    assert len(orientations) == 2
    assert all(o["needsHarvest"] is True for o in orientations)
    assert all(o["downloadJobId"] for o in orientations)  # UUIDs generated


@patch("main.dynamodb")
def test_resolve_orientations_landscape_already_harvested(mock_dynamodb):
    """Landscape skips harvest when already in harvestedOrientations."""
    mock_table = MagicMock()
    mock_table.get_item.return_value = {"Item": {
        "id": "clip-1",
        "harvestedOrientations": {"landscape"},
        "sourceKeys": {"landscape": "harvested-clips/ch/2024-01-01/clip-1/landscape/"},
    }}
    mock_dynamodb.Table.return_value = mock_table

    result = resolve_orientations({
        "clipId": "clip-1",
        "requestedOrientations": ["landscape", "portrait"],
    })

    orientations = {o["orientation"]: o for o in result["orientations"]}
    assert orientations["landscape"]["needsHarvest"] is False
    assert orientations["landscape"]["s3Prefix"] == "harvested-clips/ch/2024-01-01/clip-1/landscape/"
    assert orientations["portrait"]["needsHarvest"] is True


@patch("main.dynamodb")
def test_resolve_orientations_clip_not_found(mock_dynamodb):
    """Raises ValueError when clip doesn't exist."""
    mock_table = MagicMock()
    mock_table.get_item.return_value = {}
    mock_dynamodb.Table.return_value = mock_table

    with pytest.raises(ValueError, match="Clip not found"):
        resolve_orientations({"clipId": "nonexistent", "requestedOrientations": ["landscape"]})


# --- Build Orientation List Action ---

def test_build_orientation_list_both_enabled():
    result = build_orientation_list({"autoHarvest": "true"})
    assert result["orientations"] == ["landscape", "portrait"]


def test_build_orientation_list_disabled():
    result = build_orientation_list({"autoHarvest": "false"})
    assert result["orientations"] == []


def test_build_orientation_list_defaults():
    """Defaults: autoHarvest=false."""
    result = build_orientation_list({})
    assert result["orientations"] == []


def test_build_orientation_list_case_insensitive():
    """Boolean string comparison is case-insensitive."""
    result = build_orientation_list({"autoHarvest": "True"})
    assert result["orientations"] == ["landscape", "portrait"]


# --- Finalize Auto-Harvest Action ---

@patch("main.dynamodb")
def test_finalize_all_success(mock_dynamodb):
    """All branches succeeded — status set to archived, no harvestFailures."""
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    result = finalize_auto_harvest({
        "clipId": "clip-1",
        "harvestResults": [
            {"orientation": "landscape", "status": "success"},
            {"orientation": "portrait", "status": "success"},
        ],
    })

    assert result["archived"] is True
    mock_table.update_item.assert_called_once()
    call_kwargs = mock_table.update_item.call_args[1]
    assert ":archived" in call_kwargs["ExpressionAttributeValues"]
    assert call_kwargs["ExpressionAttributeValues"][":archived"] == "archived"
    # No harvestFailures in the update
    assert ":failures" not in call_kwargs["ExpressionAttributeValues"]


@patch("main.dynamodb")
def test_finalize_partial_success(mock_dynamodb):
    """One success, one failure — status archived with harvestFailures map."""
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    result = finalize_auto_harvest({
        "clipId": "clip-1",
        "harvestResults": [
            {"orientation": "landscape", "status": "success"},
            {"orientation": "portrait", "status": "failed"},
        ],
    })

    assert result["archived"] is True
    call_kwargs = mock_table.update_item.call_args[1]
    assert ":failures" in call_kwargs["ExpressionAttributeValues"]
    assert "portrait" in call_kwargs["ExpressionAttributeValues"][":failures"]


@patch("main.dynamodb")
def test_finalize_all_failed(mock_dynamodb):
    """All branches failed — status stays detected, harvestFailures recorded."""
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    result = finalize_auto_harvest({
        "clipId": "clip-1",
        "harvestResults": [
            {"orientation": "landscape", "status": "failed"},
            {"orientation": "portrait", "status": "failed"},
        ],
    })

    assert result["archived"] is False
    call_kwargs = mock_table.update_item.call_args[1]
    # Should only set harvestFailures, not status
    assert "SET harvestFailures" in call_kwargs["UpdateExpression"]
    assert "#status" not in call_kwargs.get("ExpressionAttributeNames", {})


@patch("main.dynamodb")
def test_finalize_empty_results(mock_dynamodb):
    """Empty harvest results — no update, not archived."""
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    result = finalize_auto_harvest({
        "clipId": "clip-1",
        "harvestResults": [],
    })

    assert result["archived"] is False
    mock_table.update_item.assert_not_called()
