"""
Unit tests for the Download API Lambda.

Tests POST validation, duplicate detection, state machine invocation,
GET presigned URL generation, and error handling.
"""

import json
import os
import pytest
from unittest.mock import MagicMock, patch, ANY

# Set required environment variables before importing the module
os.environ.setdefault("CLIPS_TABLE", "test-clips")
os.environ.setdefault("DOWNLOAD_JOBS_TABLE", "test-download-jobs")
os.environ.setdefault("VIDEO_ASSETS_BUCKET", "test-video-bucket")
os.environ.setdefault("DOWNLOAD_STATE_MACHINE_ARN", "arn:aws:states:us-east-1:123456789012:stateMachine:DownloadWorkflow")
os.environ.setdefault("MC_ROLE_ARN", "arn:aws:iam::123456789012:role/MediaConvertRole")

from main import lambda_handler


# --- Fixtures ---

@pytest.fixture
def mock_context():
    ctx = MagicMock()
    ctx.function_name = "download-api"
    ctx.memory_limit_in_mb = 512
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:download-api"
    ctx.aws_request_id = "test-request-id"
    return ctx


def _post_event(body: dict) -> dict:
    return {
        "requestContext": {"http": {"method": "POST"}},
        "pathParameters": None,
        "body": json.dumps(body),
    }


def _get_event(job_id: str) -> dict:
    return {
        "requestContext": {"http": {"method": "GET"}},
        "pathParameters": {"jobId": job_id},
        "body": None,
    }


# --- POST Validation Tests ---

class TestPostValidation:
    def test_empty_items_returns_400(self, mock_context):
        resp = lambda_handler(_post_event({"items": []}), mock_context)
        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert "At least one item" in body["message"]

    def test_missing_items_returns_400(self, mock_context):
        resp = lambda_handler(_post_event({}), mock_context)
        assert resp["statusCode"] == 400

    def test_too_many_items_returns_400(self, mock_context):
        items = [{"id": f"clip-{i}"} for i in range(25)]
        resp = lambda_handler(_post_event({"items": items}), mock_context)
        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert "Maximum" in body["message"]

    def test_invalid_orientation_returns_400(self, mock_context):
        resp = lambda_handler(
            _post_event({"items": [{"id": "clip-1"}], "orientation": "diagonal"}),
            mock_context,
        )
        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert "orientation" in body["message"]


# --- POST Clip Not Found ---

class TestPostClipNotFound:
    @patch("main.dynamodb")
    def test_clip_not_found_is_skipped(self, mock_dynamo, mock_context):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}  # no Item
        mock_dynamo.Table.return_value = mock_table

        resp = lambda_handler(
            _post_event({"items": [{"id": "nonexistent"}], "orientation": "landscape"}),
            mock_context,
        )
        assert resp["statusCode"] == 202
        body = json.loads(resp["body"])
        assert len(body["processed"]) == 0
        assert len(body["skipped"]) == 1
        assert body["skipped"][0]["reason"] == "Clip not found"


# --- POST Duplicate Detection ---

class TestPostDuplicateDetection:
    @patch("main.dynamodb")
    def test_existing_processing_job_is_skipped(self, mock_dynamo, mock_context):
        mock_table = MagicMock()

        def get_item_side_effect(Key):
            if "id" in Key:
                return {"Item": {"id": "clip-1", "downloadJobId": "existing-job-1", "channelId": "ch-1"}}
            if "jobId" in Key:
                return {"Item": {"jobId": "existing-job-1", "download_status": "processing", "executionArn": "arn:exec"}}
            return {}

        mock_table.get_item.side_effect = get_item_side_effect
        mock_dynamo.Table.return_value = mock_table

        resp = lambda_handler(
            _post_event({"items": [{"id": "clip-1"}], "orientation": "landscape"}),
            mock_context,
        )
        assert resp["statusCode"] == 202
        body = json.loads(resp["body"])
        assert len(body["processed"]) == 0
        assert len(body["skipped"]) == 1
        assert "already in progress" in body["skipped"][0]["reason"]

    @patch("main.sfn_client")
    @patch("main.dynamodb")
    def test_failed_job_allows_reprocessing(self, mock_dynamo, mock_sfn, mock_context):
        mock_table = MagicMock()

        def get_item_side_effect(Key):
            if "id" in Key:
                return {"Item": {
                    "id": "clip-1", "downloadJobId": "old-job",
                    "channelId": "ch-1", "startTime": "2024-01-01T00:00:00Z",
                    "endTime": "2024-01-01T00:05:00Z",
                }}
            if "jobId" in Key:
                return {"Item": {"jobId": "old-job", "download_status": "failed"}}
            return {}

        mock_table.get_item.side_effect = get_item_side_effect
        mock_dynamo.Table.return_value = mock_table
        mock_sfn.start_execution.return_value = {"executionArn": "arn:aws:states:us-east-1:123:execution:test"}

        resp = lambda_handler(
            _post_event({"items": [{"id": "clip-1"}], "orientation": "landscape"}),
            mock_context,
        )
        assert resp["statusCode"] == 202
        body = json.loads(resp["body"])
        assert len(body["processed"]) == 1


# --- POST State Machine Invocation ---

class TestPostStateMachineInvocation:
    @patch("main.sfn_client")
    @patch("main.dynamodb")
    def test_successful_download_starts_state_machine(self, mock_dynamo, mock_sfn, mock_context):
        mock_table = MagicMock()

        def get_item_side_effect(Key):
            if "id" in Key:
                return {"Item": {
                    "id": "clip-1", "channelId": "ch-1",
                    "startTime": "2024-01-01T00:00:00Z",
                    "endTime": "2024-01-01T00:05:00Z",
                }}
            return {}

        mock_table.get_item.side_effect = get_item_side_effect
        mock_dynamo.Table.return_value = mock_table
        mock_sfn.start_execution.return_value = {
            "executionArn": "arn:aws:states:us-east-1:123:execution:DownloadWorkflow:download-uuid"
        }

        resp = lambda_handler(
            _post_event({"items": [{"id": "clip-1"}], "orientation": "landscape"}),
            mock_context,
        )
        assert resp["statusCode"] == 202
        body = json.loads(resp["body"])
        assert len(body["processed"]) == 1
        assert "executionArn" in body["processed"][0]
        assert "jobId" in body["processed"][0]

        # Verify state machine was started with correct input
        mock_sfn.start_execution.assert_called_once()
        call_kwargs = mock_sfn.start_execution.call_args[1]
        assert call_kwargs["stateMachineArn"] == os.environ["DOWNLOAD_STATE_MACHINE_ARN"]
        sfn_input = json.loads(call_kwargs["input"])
        assert sfn_input["clipId"] == "clip-1"
        assert sfn_input["orientations"] == ["landscape"]
        assert sfn_input["bucket"] == "test-video-bucket"

    @patch("main.sfn_client")
    @patch("main.dynamodb")
    def test_both_orientation_sends_two_orientations(self, mock_dynamo, mock_sfn, mock_context):
        mock_table = MagicMock()

        def get_item_side_effect(Key):
            if "id" in Key:
                return {"Item": {
                    "id": "clip-1", "channelId": "ch-1",
                    "startTime": 1704067200, "endTime": 1704067500,
                }}
            return {}

        mock_table.get_item.side_effect = get_item_side_effect
        mock_dynamo.Table.return_value = mock_table
        mock_sfn.start_execution.return_value = {"executionArn": "arn:exec"}

        resp = lambda_handler(
            _post_event({"items": [{"id": "clip-1"}], "orientation": "both"}),
            mock_context,
        )
        body = json.loads(resp["body"])
        assert len(body["processed"]) == 1

        sfn_input = json.loads(mock_sfn.start_execution.call_args[1]["input"])
        assert sfn_input["orientations"] == ["landscape", "portrait"]

    @patch("main.sfn_client")
    @patch("main.dynamodb")
    def test_sfn_failure_marks_job_failed_and_skips(self, mock_dynamo, mock_sfn, mock_context):
        mock_table = MagicMock()

        def get_item_side_effect(Key):
            if "id" in Key:
                return {"Item": {
                    "id": "clip-1", "channelId": "ch-1",
                    "startTime": "2024-01-01T00:00:00Z",
                    "endTime": "2024-01-01T00:05:00Z",
                }}
            return {}

        mock_table.get_item.side_effect = get_item_side_effect
        mock_dynamo.Table.return_value = mock_table
        mock_sfn.start_execution.side_effect = Exception("Throttled")

        resp = lambda_handler(
            _post_event({"items": [{"id": "clip-1"}], "orientation": "landscape"}),
            mock_context,
        )
        assert resp["statusCode"] == 202
        body = json.loads(resp["body"])
        assert len(body["processed"]) == 0
        assert len(body["skipped"]) == 1
        assert "Failed to start" in body["skipped"][0]["reason"]

        # Verify a failed record was written
        mock_table.put_item.assert_called_once()
        put_item = mock_table.put_item.call_args[1]["Item"]
        assert put_item["download_status"] == "failed"


# --- GET Download Status / Presigned URL ---

class TestGetDownloadStatus:
    @patch("main.dynamodb")
    def test_job_not_found_returns_404(self, mock_dynamo, mock_context):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_dynamo.Table.return_value = mock_table

        resp = lambda_handler(_get_event("nonexistent-job"), mock_context)
        assert resp["statusCode"] == 404

    @patch("main.dynamodb")
    def test_in_progress_returns_status(self, mock_dynamo, mock_context):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "jobId": "job-1",
                "download_status": "processing",
                "correlationId": "arn:exec:123",
            }
        }
        mock_dynamo.Table.return_value = mock_table

        resp = lambda_handler(_get_event("job-1"), mock_context)
        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["status"] == "processing"
        assert body["correlationId"] == "arn:exec:123"
        assert "downloadUrl" not in body

    @patch("main.s3_client")
    @patch("main.dynamodb")
    def test_completed_returns_presigned_url(self, mock_dynamo, mock_s3, mock_context):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "jobId": "job-1",
                "download_status": "completed",
                "s3OutputKey": "downloads/clip/clip-1/landscape/clip-1.mp4",
                "correlationId": "arn:exec:123",
            }
        }
        mock_dynamo.Table.return_value = mock_table
        mock_s3.generate_presigned_url.return_value = "https://signed-url.example.com/clip.mp4"

        resp = lambda_handler(_get_event("job-1"), mock_context)
        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["status"] == "completed"
        assert body["downloadUrl"] == "https://signed-url.example.com/clip.mp4"
        assert body["expiresIn"] == 3600

        mock_s3.generate_presigned_url.assert_called_once_with(
            "get_object",
            Params={"Bucket": "test-video-bucket", "Key": "downloads/clip/clip-1/landscape/clip-1.mp4"},
            ExpiresIn=3600,
        )

    @patch("main.dynamodb")
    def test_failed_returns_error_message(self, mock_dynamo, mock_context):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "jobId": "job-1",
                "download_status": "failed",
                "errorMessage": "Harvest timed out",
                "correlationId": "arn:exec:123",
            }
        }
        mock_dynamo.Table.return_value = mock_table

        resp = lambda_handler(_get_event("job-1"), mock_context)
        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["status"] == "failed"
        assert body["errorMessage"] == "Harvest timed out"


# --- Method Not Allowed ---

class TestMethodNotAllowed:
    def test_unsupported_method_returns_405(self, mock_context):
        event = {
            "requestContext": {"http": {"method": "DELETE"}},
            "pathParameters": None,
            "body": None,
        }
        resp = lambda_handler(event, mock_context)
        assert resp["statusCode"] == 405


# --- Presign URL Validation Tests ---

def _presign_event(body: dict) -> dict:
    return {
        "requestContext": {"http": {"method": "POST"}},
        "pathParameters": None,
        "rawPath": "/api/download-clips/presign",
        "body": json.dumps(body),
    }


class TestPresignValidation:
    def test_missing_s3key_returns_400(self, mock_context):
        resp = lambda_handler(_presign_event({}), mock_context)
        assert resp["statusCode"] == 400

    def test_empty_s3key_returns_400(self, mock_context):
        resp = lambda_handler(_presign_event({"s3Key": ""}), mock_context)
        assert resp["statusCode"] == 400

    def test_path_traversal_returns_400(self, mock_context):
        resp = lambda_handler(_presign_event({"s3Key": "harvested-clips/../secrets/key"}), mock_context)
        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert "Invalid" in body["message"]

    def test_disallowed_prefix_returns_403(self, mock_context):
        resp = lambda_handler(_presign_event({"s3Key": "secrets/admin-config.json"}), mock_context)
        assert resp["statusCode"] == 403
        body = json.loads(resp["body"])
        assert "Access denied" in body["message"]

    def test_root_key_returns_403(self, mock_context):
        resp = lambda_handler(_presign_event({"s3Key": "config.json"}), mock_context)
        assert resp["statusCode"] == 403

    @patch("main.s3_client")
    def test_allowed_harvested_clips_prefix(self, mock_s3, mock_context):
        mock_s3.generate_presigned_url.return_value = "https://signed.example.com/clip.ts"
        resp = lambda_handler(
            _presign_event({"s3Key": "harvested-clips/ch-1/2024-01-01/clip-1/landscape/main.m3u8"}),
            mock_context,
        )
        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert "downloadUrl" in body

    @patch("main.s3_client")
    def test_allowed_downloads_prefix(self, mock_s3, mock_context):
        mock_s3.generate_presigned_url.return_value = "https://signed.example.com/clip.mp4"
        resp = lambda_handler(
            _presign_event({"s3Key": "downloads/clip/clip-1/landscape/clip-1.mp4"}),
            mock_context,
        )
        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert "downloadUrl" in body
