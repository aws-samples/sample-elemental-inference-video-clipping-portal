"""Unit tests for create-feed-lambda."""

import os
import json
from unittest.mock import patch, MagicMock

import pytest


# Patch environment before importing the module
@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    monkeypatch.setenv("AWS_REGION", "us-west-2")
    monkeypatch.setenv("INFERENCE_STAGE", "prod")
    monkeypatch.setenv("POWERTOOLS_SERVICE_NAME", "create-feed-lambda")
    monkeypatch.setenv("POWERTOOLS_METRICS_NAMESPACE", "CreateFeedLambda")
    monkeypatch.setenv("POWERTOOLS_TRACE_DISABLED", "true")


@pytest.fixture
def mock_inference_client():
    with patch("main.inference_client") as mock_client:
        yield mock_client


@pytest.fixture
def lambda_context():
    ctx = MagicMock()
    ctx.function_name = "create-feed-lambda"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-west-2:123456789012:function:create-feed-lambda"
    ctx.aws_request_id = "test-request-id"
    return ctx


class TestHandleCreate:
    def test_create_feed_returns_feed_id_and_arn(self, mock_inference_client, lambda_context):
        mock_inference_client.create_feed.return_value = {
            "id": "feed-abc123",
            "arn": "arn:aws:elementalinference:us-west-2:123456789012:feed/feed-abc123",
        }

        from main import lambda_handler

        result = lambda_handler({"channelName": "my-channel"}, lambda_context)

        assert result["feedId"] == "feed-abc123"
        assert result["feedArn"] == "arn:aws:elementalinference:us-west-2:123456789012:feed/feed-abc123"

    def test_create_feed_sets_callback_metadata_to_channel_name(self, mock_inference_client, lambda_context):
        mock_inference_client.create_feed.return_value = {"id": "f1", "arn": "arn:f1"}

        from main import lambda_handler

        lambda_handler({"channelName": "sports-channel"}, lambda_context)

        call_kwargs = mock_inference_client.create_feed.call_args
        outputs = call_kwargs.kwargs.get("outputs") or call_kwargs[1].get("outputs")
        callback_metadata = outputs[0]["outputConfig"]["clipping"]["callbackMetadata"]
        assert callback_metadata == "sports-channel"

    def test_create_feed_uses_channel_name_in_feed_name(self, mock_inference_client, lambda_context):
        mock_inference_client.create_feed.return_value = {"id": "f1", "arn": "arn:f1"}

        from main import lambda_handler

        lambda_handler({"channelName": "test-ch"}, lambda_context)

        call_kwargs = mock_inference_client.create_feed.call_args
        feed_name = call_kwargs.kwargs.get("name") or call_kwargs[1].get("name")
        assert feed_name == "test-ch-feed"

    def test_create_feed_missing_channel_name_raises(self, mock_inference_client, lambda_context):
        from main import lambda_handler

        with pytest.raises(ValueError, match="channelName"):
            lambda_handler({}, lambda_context)

    def test_create_defaults_to_create_action(self, mock_inference_client, lambda_context):
        """When no action is specified, the Lambda should create a feed."""
        mock_inference_client.create_feed.return_value = {"id": "f1", "arn": "arn:f1"}

        from main import lambda_handler

        result = lambda_handler({"channelName": "ch1"}, lambda_context)

        assert "feedId" in result
        mock_inference_client.create_feed.assert_called_once()


class TestHandleDelete:
    def test_delete_feed_calls_delete_with_feed_id(self, mock_inference_client, lambda_context):
        mock_inference_client.delete_feed.return_value = {}

        from main import lambda_handler

        result = lambda_handler({"action": "delete", "feedId": "feed-xyz"}, lambda_context)

        mock_inference_client.delete_feed.assert_called_once_with(id="feed-xyz")
        assert result["deleted"] is True
        assert result["feedId"] == "feed-xyz"

    def test_delete_feed_missing_feed_id_raises(self, mock_inference_client, lambda_context):
        from main import lambda_handler

        with pytest.raises(ValueError, match="feedId"):
            lambda_handler({"action": "delete"}, lambda_context)
