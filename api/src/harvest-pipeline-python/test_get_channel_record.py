"""
Unit tests for DynamoDBService.get_channel_record method.

Validates AC5.1: harvest pipeline looks up channel record from Channels table.
"""

import os
import pytest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError

# Set required environment variables before importing the module
os.environ.setdefault('VIDEO_ASSETS_BUCKET', 'test-bucket')
os.environ.setdefault('HARVEST_JOBS_TABLE_NAME', 'test-harvest-jobs')
os.environ.setdefault('CLIPS_TABLE', 'test-clips')
os.environ.setdefault('EVENTS_TABLE', 'test-events')
os.environ.setdefault('MEDIAPACKAGE_CHANNEL_GROUP', 'test-channel-group')
os.environ.setdefault('MEDIALIVE_CHANNEL_NAME', 'test-channel')
os.environ.setdefault('MEDIAPACKAGE_ORIGIN_ENDPOINT_ID', 'test-origin-endpoint')
os.environ.setdefault('MEDIAPACKAGE_ORIGIN_ENDPOINT_URL', 'https://test.example.com/endpoint')
os.environ.setdefault('MEDIAPACKAGE_LANDSCAPE_ENDPOINT', 'test-landscape')
os.environ.setdefault('MEDIAPACKAGE_VERTICAL_ENDPOINT', 'test-vertical')
os.environ.setdefault('AWS_STACK_NAME', 'test-stack')

from main import DynamoDBService, HarvestPipelineConfig


@pytest.fixture
def config_with_channels_table(monkeypatch):
    """Config with CHANNELS_TABLE_NAME set."""
    monkeypatch.setenv('CHANNELS_TABLE_NAME', 'test-channels')
    return HarvestPipelineConfig()


@pytest.fixture
def config_without_channels_table(monkeypatch):
    """Config without CHANNELS_TABLE_NAME."""
    monkeypatch.setenv('CHANNELS_TABLE_NAME', '')
    return HarvestPipelineConfig()


@patch('main.dynamodb')
def test_returns_channel_record_when_found(mock_dynamodb, config_with_channels_table):
    """get_channel_record returns the Item when the channel exists."""
    mock_table = MagicMock()
    mock_table.get_item.return_value = {
        'Item': {
            'id': 'channel-123',
            'mediaPackageChannelName': 'mp-channel-123',
            'channelGroupName': 'my-group',
            'feedId': 'feed-abc',
        }
    }
    mock_dynamodb.Table.return_value = mock_table

    service = DynamoDBService(config_with_channels_table)
    result = service.get_channel_record('channel-123')

    assert result is not None
    assert result['id'] == 'channel-123'
    assert result['mediaPackageChannelName'] == 'mp-channel-123'


@patch('main.dynamodb')
def test_returns_none_when_channel_not_found(mock_dynamodb, config_with_channels_table):
    """get_channel_record returns None when no Item is in the response."""
    mock_table = MagicMock()
    mock_table.get_item.return_value = {}
    mock_dynamodb.Table.return_value = mock_table

    service = DynamoDBService(config_with_channels_table)
    result = service.get_channel_record('nonexistent-channel')

    assert result is None


@patch('main.dynamodb')
def test_returns_none_on_dynamodb_error(mock_dynamodb, config_with_channels_table):
    """get_channel_record returns None (doesn't crash) on DynamoDB errors."""
    mock_table = MagicMock()
    mock_table.get_item.side_effect = ClientError(
        {'Error': {'Code': 'InternalServerError', 'Message': 'Service unavailable'}},
        'GetItem'
    )
    mock_dynamodb.Table.return_value = mock_table

    service = DynamoDBService(config_with_channels_table)
    result = service.get_channel_record('channel-123')

    assert result is None


@patch('main.dynamodb')
def test_returns_none_when_channel_id_is_empty(mock_dynamodb, config_with_channels_table):
    """get_channel_record returns None for empty channel_id without calling DynamoDB."""
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    service = DynamoDBService(config_with_channels_table)
    result = service.get_channel_record('')

    assert result is None
    mock_table.get_item.assert_not_called()


@patch('main.dynamodb')
def test_returns_none_when_channels_table_not_configured(mock_dynamodb, config_without_channels_table):
    """get_channel_record returns None when CHANNELS_TABLE_NAME is not set."""
    mock_table = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    service = DynamoDBService(config_without_channels_table)
    result = service.get_channel_record('channel-123')

    assert result is None
