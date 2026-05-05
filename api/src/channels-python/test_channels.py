"""Unit tests for channels-python Lambda — handle_create_channel (Step Functions integration)."""

import os
import json
from unittest.mock import patch, MagicMock
from datetime import datetime
from urllib.parse import quote

import pytest
from botocore.exceptions import ClientError


@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    monkeypatch.setenv("AWS_REGION", "us-west-2")
    monkeypatch.setenv("CHANNELS_TABLE_NAME", "test-channels-table")
    monkeypatch.setenv("CHANNEL_GROUP_NAME", "test-channel-group")
    monkeypatch.setenv("CHANNEL_CREATION_STATE_MACHINE_ARN", "arn:aws:states:us-west-2:123456789012:stateMachine:CreateChannel")
    monkeypatch.setenv("INFERENCE_STAGE", "prod")
    monkeypatch.setenv("POWERTOOLS_SERVICE_NAME", "channels-api")
    monkeypatch.setenv("POWERTOOLS_METRICS_NAMESPACE", "ChannelsAPI")
    monkeypatch.setenv("POWERTOOLS_TRACE_DISABLED", "true")


@pytest.fixture
def mock_sfn_client():
    with patch("main.sfn_client") as mock_client:
        yield mock_client


@pytest.fixture
def lambda_context():
    ctx = MagicMock()
    ctx.function_name = "channels-api"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-west-2:123456789012:function:channels-api"
    ctx.aws_request_id = "test-request-id"
    return ctx


def _make_event(body: dict) -> dict:
    return {
        "requestContext": {"http": {"method": "POST"}},
        "pathParameters": None,
        "body": json.dumps(body),
    }


VALID_BODY = {
    "channelName": "my-channel",
    "inputType": "RTMP_PUSH",
    "inputName": "my-input",
    "inputUrl": "rtmp://example.com/live",
    "encoderSettings": {"videoDescriptions": []},
}


class TestHandleCreateChannel:
    def test_starts_sfn_execution_and_returns_execution_arn(self, mock_sfn_client, lambda_context):
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:aws:states:us-west-2:123456789012:execution:CreateChannel:create-my-channel-123",
            "startDate": datetime(2024, 1, 1),
        }

        from main import lambda_handler

        result = lambda_handler(_make_event(VALID_BODY), lambda_context)

        assert result["statusCode"] == 202
        body = json.loads(result["body"])
        assert body["status"] == "CREATING"
        assert "executionArn" in body
        mock_sfn_client.start_execution.assert_called_once()

    def test_sfn_input_contains_required_fields(self, mock_sfn_client, lambda_context):
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:exec:123",
            "startDate": datetime(2024, 1, 1),
        }

        from main import lambda_handler

        lambda_handler(_make_event(VALID_BODY), lambda_context)

        call_kwargs = mock_sfn_client.start_execution.call_args
        sfn_input = json.loads(call_kwargs.kwargs.get("input") or call_kwargs[1]["input"])

        assert sfn_input["channelName"] == "my-channel"
        assert sfn_input["channelGroupName"] == "test-channel-group"
        assert sfn_input["inputName"] == "my-input"
        assert sfn_input["inputType"] == "RTMP_PUSH"
        assert sfn_input["encoderSettings"] == {"videoDescriptions": []}
        assert sfn_input["region"] == "us-west-2"

    def test_sfn_input_builds_input_sources_from_input_url(self, mock_sfn_client, lambda_context):
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:exec:123",
            "startDate": datetime(2024, 1, 1),
        }

        from main import lambda_handler

        lambda_handler(_make_event(VALID_BODY), lambda_context)

        call_kwargs = mock_sfn_client.start_execution.call_args
        sfn_input = json.loads(call_kwargs.kwargs.get("input") or call_kwargs[1]["input"])

        assert sfn_input["inputSources"] == [
            {"Url": "rtmp://example.com/live"},
            {"Url": "rtmp://example.com/live"},
        ]

    def test_sfn_input_uses_explicit_input_sources_when_provided(self, mock_sfn_client, lambda_context):
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:exec:123",
            "startDate": datetime(2024, 1, 1),
        }

        body = {
            **VALID_BODY,
            "inputSources": [{"Url": "rtmp://a.com"}, {"Url": "rtmp://b.com"}],
        }

        from main import lambda_handler

        lambda_handler(_make_event(body), lambda_context)

        call_kwargs = mock_sfn_client.start_execution.call_args
        sfn_input = json.loads(call_kwargs.kwargs.get("input") or call_kwargs[1]["input"])

        assert sfn_input["inputSources"] == [{"Url": "rtmp://a.com"}, {"Url": "rtmp://b.com"}]

    def test_sfn_input_converts_s3_url_to_s3ssl(self, mock_sfn_client, lambda_context):
        """S3 URLs should be converted to s3ssl:// for TLS/HTTPS access by MediaLive."""
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:exec:123",
            "startDate": datetime(2024, 1, 1),
        }

        body = {**VALID_BODY, "inputUrl": "s3://my-bucket/video.mp4", "inputType": "MP4_FILE"}

        from main import lambda_handler

        lambda_handler(_make_event(body), lambda_context)

        call_kwargs = mock_sfn_client.start_execution.call_args
        sfn_input = json.loads(call_kwargs.kwargs.get("input") or call_kwargs[1]["input"])

        assert sfn_input["inputSources"] == [
            {"Url": "s3ssl://my-bucket/video.mp4"},
            {"Url": "s3ssl://my-bucket/video.mp4"},
        ]

    def test_returns_400_when_body_is_missing(self, mock_sfn_client, lambda_context):
        from main import lambda_handler

        event = {
            "requestContext": {"http": {"method": "POST"}},
            "pathParameters": None,
        }
        result = lambda_handler(event, lambda_context)

        assert result["statusCode"] == 400
        assert "Missing request body" in json.loads(result["body"])["error"]

    def test_returns_400_when_required_fields_missing(self, mock_sfn_client, lambda_context):
        from main import lambda_handler

        result = lambda_handler(_make_event({"channelName": "ch1"}), lambda_context)

        assert result["statusCode"] == 400
        body = json.loads(result["body"])
        assert "Missing required fields" in body["error"]

    def test_uses_state_machine_arn_from_env(self, mock_sfn_client, lambda_context):
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:exec:123",
            "startDate": datetime(2024, 1, 1),
        }

        from main import lambda_handler

        lambda_handler(_make_event(VALID_BODY), lambda_context)

        call_kwargs = mock_sfn_client.start_execution.call_args
        state_machine_arn = call_kwargs.kwargs.get("stateMachineArn") or call_kwargs[1]["stateMachineArn"]
        assert state_machine_arn == "arn:aws:states:us-west-2:123456789012:stateMachine:CreateChannel"


SAMPLE_EXECUTION_ARN = "arn:aws:states:us-west-2:123456789012:execution:CreateChannel:create-my-channel-123"


def _make_status_event(execution_arn: str) -> dict:
    return {
        "requestContext": {"http": {"method": "GET"}},
        "pathParameters": {"executionArn": execution_arn},
    }


class TestHandleGetStatus:
    def test_returns_creating_when_execution_is_running(self, mock_sfn_client, lambda_context):
        mock_sfn_client.describe_execution.return_value = {
            "executionArn": SAMPLE_EXECUTION_ARN,
            "status": "RUNNING",
        }

        from main import lambda_handler

        result = lambda_handler(_make_status_event(SAMPLE_EXECUTION_ARN), lambda_context)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["status"] == "CREATING"
        assert body["executionArn"] == SAMPLE_EXECUTION_ARN
        mock_sfn_client.describe_execution.assert_called_once_with(executionArn=SAMPLE_EXECUTION_ARN)

    def test_returns_active_with_output_when_execution_succeeded(self, mock_sfn_client, lambda_context):
        sfn_output = {"channelId": "ch-123", "feedId": "feed-456"}
        mock_sfn_client.describe_execution.return_value = {
            "executionArn": SAMPLE_EXECUTION_ARN,
            "status": "SUCCEEDED",
            "output": json.dumps(sfn_output),
        }

        from main import lambda_handler

        result = lambda_handler(_make_status_event(SAMPLE_EXECUTION_ARN), lambda_context)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["status"] == "ACTIVE"
        assert body["output"] == sfn_output
        assert body["executionArn"] == SAMPLE_EXECUTION_ARN

    def test_returns_failed_when_execution_failed(self, mock_sfn_client, lambda_context):
        mock_sfn_client.describe_execution.return_value = {
            "executionArn": SAMPLE_EXECUTION_ARN,
            "status": "FAILED",
            "error": "States.TaskFailed",
            "cause": "MediaPackage channel creation failed",
        }

        from main import lambda_handler

        result = lambda_handler(_make_status_event(SAMPLE_EXECUTION_ARN), lambda_context)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["status"] == "FAILED"
        assert body["error"]["error"] == "States.TaskFailed"
        assert body["error"]["cause"] == "MediaPackage channel creation failed"

    def test_returns_failed_when_execution_timed_out(self, mock_sfn_client, lambda_context):
        mock_sfn_client.describe_execution.return_value = {
            "executionArn": SAMPLE_EXECUTION_ARN,
            "status": "TIMED_OUT",
        }

        from main import lambda_handler

        result = lambda_handler(_make_status_event(SAMPLE_EXECUTION_ARN), lambda_context)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["status"] == "FAILED"
        assert body["executionArn"] == SAMPLE_EXECUTION_ARN

    def test_returns_failed_when_execution_aborted(self, mock_sfn_client, lambda_context):
        mock_sfn_client.describe_execution.return_value = {
            "executionArn": SAMPLE_EXECUTION_ARN,
            "status": "ABORTED",
        }

        from main import lambda_handler

        result = lambda_handler(_make_status_event(SAMPLE_EXECUTION_ARN), lambda_context)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["status"] == "FAILED"

    def test_url_decodes_execution_arn(self, mock_sfn_client, lambda_context):
        mock_sfn_client.describe_execution.return_value = {
            "executionArn": SAMPLE_EXECUTION_ARN,
            "status": "RUNNING",
        }
        encoded_arn = quote(SAMPLE_EXECUTION_ARN, safe="")

        from main import lambda_handler

        lambda_handler(_make_status_event(encoded_arn), lambda_context)

        mock_sfn_client.describe_execution.assert_called_once_with(executionArn=SAMPLE_EXECUTION_ARN)

    def test_returns_500_on_client_error(self, mock_sfn_client, lambda_context):
        mock_sfn_client.describe_execution.side_effect = ClientError(
            {"Error": {"Code": "ExecutionDoesNotExist", "Message": "Execution not found"}},
            "DescribeExecution",
        )

        from main import lambda_handler

        result = lambda_handler(_make_status_event(SAMPLE_EXECUTION_ARN), lambda_context)

        assert result["statusCode"] == 500
        body = json.loads(result["body"])
        assert "error" in body


# ---------------------------------------------------------------------------
# Delete Channel Tests
# ---------------------------------------------------------------------------

SAMPLE_CHANNEL_RECORD = {
    "id": "ch-123",
    "name": "test-channel",
    "channelGroupName": "test-channel-group",
    "mediaPackageChannelName": "test-channel-mp",
    "inputId": "input-456",
    "feedId": "feed-789",
    "originEndpointName": "test-channel-main",
    "landscapeEndpointName": "test-channel-landscape",
    "verticalEndpointName": "test-channel-vertical",
}


def _make_delete_event(channel_id: str) -> dict:
    return {
        "requestContext": {"http": {"method": "DELETE"}},
        "pathParameters": {"id": channel_id},
    }


@pytest.fixture
def mock_dynamodb_table():
    with patch("main.dynamodb") as mock_ddb:
        mock_table = MagicMock()
        mock_ddb.Table.return_value = mock_table
        yield mock_table


class TestHandleDeleteChannel:
    def test_returns_404_when_channel_not_found(
        self, mock_sfn_client, mock_dynamodb_table, lambda_context
    ):
        mock_dynamodb_table.get_item.return_value = {}

        from main import lambda_handler

        result = lambda_handler(_make_delete_event("ch-missing"), lambda_context)

        assert result["statusCode"] == 404
        body = json.loads(result["body"])
        assert "Channel not found" in body["error"]

    def test_starts_sfn_execution_and_returns_202(
        self, mock_sfn_client, mock_dynamodb_table, lambda_context
    ):
        mock_dynamodb_table.get_item.return_value = {"Item": SAMPLE_CHANNEL_RECORD}
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:aws:states:us-west-2:123456789012:execution:DeleteChannel:delete-ch-123",
            "startDate": datetime(2024, 1, 1),
        }

        from main import lambda_handler

        result = lambda_handler(_make_delete_event("ch-123"), lambda_context)

        assert result["statusCode"] == 202
        body = json.loads(result["body"])
        assert body["status"] == "DELETING"
        assert "executionArn" in body
        mock_sfn_client.start_execution.assert_called_once()

    def test_sets_provisioning_status_to_deleting(
        self, mock_sfn_client, mock_dynamodb_table, lambda_context
    ):
        mock_dynamodb_table.get_item.return_value = {"Item": SAMPLE_CHANNEL_RECORD}
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:exec:delete",
            "startDate": datetime(2024, 1, 1),
        }

        from main import lambda_handler

        lambda_handler(_make_delete_event("ch-123"), lambda_context)

        # Verify update_item was called to set DELETING status
        mock_dynamodb_table.update_item.assert_called_once()
        call_kwargs = mock_dynamodb_table.update_item.call_args
        assert ":status" in str(call_kwargs)

    def test_sfn_input_contains_channel_resource_ids(
        self, mock_sfn_client, mock_dynamodb_table, lambda_context
    ):
        mock_dynamodb_table.get_item.return_value = {"Item": SAMPLE_CHANNEL_RECORD}
        mock_sfn_client.start_execution.return_value = {
            "executionArn": "arn:exec:delete",
            "startDate": datetime(2024, 1, 1),
        }

        from main import lambda_handler

        lambda_handler(_make_delete_event("ch-123"), lambda_context)

        call_kwargs = mock_sfn_client.start_execution.call_args
        sfn_input = json.loads(call_kwargs.kwargs.get("input") or call_kwargs[1]["input"])

        assert sfn_input["channelId"] == "ch-123"
        assert sfn_input["channelGroupName"] == "test-channel-group"
        assert sfn_input["mediaPackageChannelName"] == "test-channel-mp"
        assert sfn_input["inputId"] == "input-456"
        assert sfn_input["feedId"] == "feed-789"
        assert sfn_input["originEndpointName"] == "test-channel-main"

    def test_response_includes_delete_in_cors_headers(
        self, mock_sfn_client, mock_dynamodb_table, lambda_context
    ):
        mock_dynamodb_table.get_item.return_value = {}

        from main import lambda_handler

        result = lambda_handler(_make_delete_event("ch-missing"), lambda_context)

        assert "DELETE" in result["headers"]["Access-Control-Allow-Methods"]

