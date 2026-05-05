"""
Unit tests for the refactored Clip Detection Handler (lambda_handler / process_inference_event).

Validates:
- Clip_Record creation with status "detected" (Req 1.1)
- Event metadata stored on Clip_Record (Req 1.2)
- No MediaPackage harvest job creation (Req 1.3)
- AutoHarvest State Machine invocation when enabled (Req 1.4)
- No invocation when disabled (Req 1.5)
- Event association via existing logic (Req 1.6)
- inferenceDetectedAt field written instead of starfishDetectedAt (Req 11.3)
"""

import json
import os
import pytest
from unittest.mock import MagicMock, patch, ANY
from datetime import datetime

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
os.environ.setdefault('SYSTEM_SETTINGS_TABLE', 'test-system-settings')
os.environ.setdefault('AUTOHARVEST_STATE_MACHINE_ARN', 'arn:aws:states:us-east-1:123456789012:stateMachine:AutoHarvestWorkflow')


def _make_inference_event(event_time="2025-01-15T12:00:00Z", channel_id="test-channel"):
    """Build a sample Inference EventBridge event."""
    return {
        "version": "0",
        "id": "abcd1234-5678-9012-3456-abcdef123456",
        "detail-type": "Clip Metadata Generated",
        "source": "aws.elemental-inference",
        "account": "123456789012",
        "time": event_time,
        "region": "us-east-1",
        "detail": {
            "timescale": 90000,
            "startPts": 158395072209000,
            "endPts": 158395072374000,
            "description": "Test highlight",
            "tags": ["goal", "celebration"],
            "channelId": channel_id,
            "callbackMetadata": "Test Event",
        },
    }


class MockContext:
    aws_request_id = "test-request-id"
    function_name = "test-function"
    function_version = "1"
    invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test"
    memory_limit_in_mb = 512
    remaining_time_in_millis = 300000


@pytest.fixture(autouse=True)
def _reset_env(monkeypatch):
    """Ensure env vars are set for every test."""
    monkeypatch.setenv('SYSTEM_SETTINGS_TABLE', 'test-system-settings')
    monkeypatch.setenv('AUTOHARVEST_STATE_MACHINE_ARN',
                       'arn:aws:states:us-east-1:123456789012:stateMachine:AutoHarvestWorkflow')


# ---------------------------------------------------------------------------
# Req 1.1 & 1.2: Clip_Record created with status "detected" and metadata
# ---------------------------------------------------------------------------

@patch('main.sfn_client')
@patch('main.read_system_setting')
@patch('main.dynamodb')
@patch('main.mediapackagev2_client')
def test_clip_record_created_with_detected_status(mock_mp, mock_ddb, mock_settings, mock_sfn):
    """Clip_Record is created with status='detected' on Inference event."""
    from main import HarvestPipelineService

    # Mock DynamoDB tables
    mock_clips_table = MagicMock()
    mock_events_table = MagicMock()
    mock_events_table.query.return_value = {'Items': [{'id': 'evt-1', 'name': 'Test Event', 'mediaLiveChannel': 'ch-1'}]}
    mock_events_table.scan.return_value = {'Items': []}
    mock_harvest_table = MagicMock()
    mock_channels_table = MagicMock()
    mock_channels_table.get_item.return_value = {}

    def table_router(name):
        tables = {
            'test-clips': mock_clips_table,
            'test-events': mock_events_table,
            'test-harvest-jobs': mock_harvest_table,
        }
        return tables.get(name, MagicMock())

    mock_ddb.Table.side_effect = table_router

    # Auto-harvest enabled for landscape only
    mock_settings.side_effect = lambda table, key, default: {
        'autoHarvestLandscape': 'true',
        'autoHarvestPortrait': 'false',
        'harvestBufferSeconds': '0',
    }.get(key, default)

    mock_sfn.start_execution.return_value = {
        'executionArn': 'arn:aws:states:us-east-1:123456789012:execution:AutoHarvestWorkflow:exec-1'
    }

    service = HarvestPipelineService()
    service.process_inference_event(_make_inference_event(), 'corr-123')

    # Verify put_item was called on clips table with status=detected
    mock_clips_table.put_item.assert_called_once()
    clip_item = mock_clips_table.put_item.call_args[1]['Item']
    assert clip_item['status'] == 'detected'
    assert clip_item['isHarvested'] is False
    assert 'startTime' in clip_item
    assert 'endTime' in clip_item
    assert 'eventId' in clip_item


# ---------------------------------------------------------------------------
# Req 1.3: No MediaPackage harvest job creation
# ---------------------------------------------------------------------------

@patch('main.sfn_client')
@patch('main.read_system_setting')
@patch('main.dynamodb')
@patch('main.mediapackagev2_client')
def test_no_mediapackage_harvest_job_created(mock_mp, mock_ddb, mock_settings, mock_sfn):
    """The handler SHALL NOT create a MediaPackage harvest job directly."""
    from main import HarvestPipelineService

    mock_clips_table = MagicMock()
    mock_events_table = MagicMock()
    mock_events_table.query.return_value = {'Items': [{'id': 'evt-1', 'name': 'Test Event', 'mediaLiveChannel': 'ch-1'}]}
    mock_events_table.scan.return_value = {'Items': []}
    mock_harvest_table = MagicMock()
    mock_channels_table = MagicMock()
    mock_channels_table.get_item.return_value = {}

    def table_router(name):
        return {'test-clips': mock_clips_table, 'test-events': mock_events_table,
                'test-harvest-jobs': mock_harvest_table}.get(name, MagicMock())

    mock_ddb.Table.side_effect = table_router
    mock_settings.side_effect = lambda t, k, d: {'autoHarvest': 'true', 'harvestBufferSeconds': '0'}.get(k, d)
    mock_sfn.start_execution.return_value = {'executionArn': 'arn:exec:1'}

    service = HarvestPipelineService()
    service.process_inference_event(_make_inference_event(), 'corr-123')

    # MediaPackage create_harvest_job must NOT be called
    mock_mp.create_harvest_job.assert_not_called()


# ---------------------------------------------------------------------------
# Req 1.4: AutoHarvest State Machine invocation when enabled
# ---------------------------------------------------------------------------

@patch('main.sfn_client')
@patch('main.read_system_setting')
@patch('main.dynamodb')
@patch('main.mediapackagev2_client')
def test_autoharvest_sm_started_when_enabled(mock_mp, mock_ddb, mock_settings, mock_sfn):
    """When auto-harvest is enabled, start_execution is called on the AutoHarvest SM."""
    from main import HarvestPipelineService

    mock_clips_table = MagicMock()
    mock_events_table = MagicMock()
    mock_events_table.query.return_value = {'Items': [{'id': 'evt-1', 'name': 'Test Event', 'mediaLiveChannel': 'ch-1'}]}
    mock_events_table.scan.return_value = {'Items': []}

    def table_router(name):
        return {'test-clips': mock_clips_table, 'test-events': mock_events_table,
                'test-harvest-jobs': MagicMock()}.get(name, MagicMock())

    mock_ddb.Table.side_effect = table_router
    mock_settings.side_effect = lambda t, k, d: {'autoHarvest': 'true', 'harvestBufferSeconds': '5'}.get(k, d)
    mock_sfn.start_execution.return_value = {'executionArn': 'arn:exec:1'}

    service = HarvestPipelineService()
    service.process_inference_event(_make_inference_event(), 'corr-123')

    mock_sfn.start_execution.assert_called_once()
    call_kwargs = mock_sfn.start_execution.call_args[1]
    assert call_kwargs['stateMachineArn'] == 'arn:aws:states:us-east-1:123456789012:stateMachine:AutoHarvestWorkflow'

    sfn_input = json.loads(call_kwargs['input'])
    assert 'clipId' in sfn_input
    assert 'channelId' in sfn_input
    assert 'startTime' in sfn_input
    assert 'endTime' in sfn_input
    assert 'channelConfig' in sfn_input
    assert sfn_input['bucket'] == 'test-bucket'


# ---------------------------------------------------------------------------
# Req 1.5: No invocation when auto-harvest disabled
# ---------------------------------------------------------------------------

@patch('main.sfn_client')
@patch('main.read_system_setting')
@patch('main.dynamodb')
@patch('main.mediapackagev2_client')
def test_no_sm_invocation_when_autoharvest_disabled(mock_mp, mock_ddb, mock_settings, mock_sfn):
    """When both landscape and portrait auto-harvest are disabled, no SM execution starts."""
    from main import HarvestPipelineService

    mock_clips_table = MagicMock()
    mock_events_table = MagicMock()
    mock_events_table.query.return_value = {'Items': [{'id': 'evt-1', 'name': 'Test Event', 'mediaLiveChannel': 'ch-1'}]}
    mock_events_table.scan.return_value = {'Items': []}

    def table_router(name):
        return {'test-clips': mock_clips_table, 'test-events': mock_events_table,
                'test-harvest-jobs': MagicMock()}.get(name, MagicMock())

    mock_ddb.Table.side_effect = table_router
    # Both orientations disabled
    mock_settings.side_effect = lambda t, k, d: {'autoHarvest': 'false', 'harvestBufferSeconds': '0'}.get(k, d)

    service = HarvestPipelineService()
    service.process_inference_event(_make_inference_event(), 'corr-123')

    # Step Functions should NOT be called
    mock_sfn.start_execution.assert_not_called()
    # But clip record should still be created
    mock_clips_table.put_item.assert_called_once()
    clip_item = mock_clips_table.put_item.call_args[1]['Item']
    assert clip_item['status'] == 'detected'


# ---------------------------------------------------------------------------
# Req 1.6: Event association
# ---------------------------------------------------------------------------

@patch('main.sfn_client')
@patch('main.read_system_setting')
@patch('main.dynamodb')
@patch('main.mediapackagev2_client')
def test_event_association_via_callback_metadata(mock_mp, mock_ddb, mock_settings, mock_sfn):
    """Clip_Record is associated with an active event via callbackMetadata query."""
    from main import HarvestPipelineService

    mock_clips_table = MagicMock()
    mock_events_table = MagicMock()
    mock_events_table.query.return_value = {
        'Items': [{'id': 'evt-42', 'name': 'Test Event', 'mediaLiveChannel': 'ch-1'}]
    }
    mock_events_table.scan.return_value = {'Items': []}

    def table_router(name):
        return {'test-clips': mock_clips_table, 'test-events': mock_events_table,
                'test-harvest-jobs': MagicMock()}.get(name, MagicMock())

    mock_ddb.Table.side_effect = table_router
    mock_settings.side_effect = lambda t, k, d: {'autoHarvest': 'true', 'harvestBufferSeconds': '0'}.get(k, d)
    mock_sfn.start_execution.return_value = {'executionArn': 'arn:exec:1'}

    service = HarvestPipelineService()
    service.process_inference_event(_make_inference_event(), 'corr-123')

    clip_item = mock_clips_table.put_item.call_args[1]['Item']
    assert clip_item['eventId'] == 'evt-42'
    assert clip_item['eventName'] == 'Test Event'


# ---------------------------------------------------------------------------
# Req 11.3: inferenceDetectedAt field
# ---------------------------------------------------------------------------

@patch('main.sfn_client')
@patch('main.read_system_setting')
@patch('main.dynamodb')
@patch('main.mediapackagev2_client')
def test_inference_detected_at_field(mock_mp, mock_ddb, mock_settings, mock_sfn):
    """Clip_Record uses inferenceDetectedAt instead of starfishDetectedAt."""
    from main import HarvestPipelineService

    mock_clips_table = MagicMock()
    mock_events_table = MagicMock()
    mock_events_table.query.return_value = {'Items': [{'id': 'evt-1', 'name': 'Test Event', 'mediaLiveChannel': 'ch-1'}]}
    mock_events_table.scan.return_value = {'Items': []}

    def table_router(name):
        return {'test-clips': mock_clips_table, 'test-events': mock_events_table,
                'test-harvest-jobs': MagicMock()}.get(name, MagicMock())

    mock_ddb.Table.side_effect = table_router
    mock_settings.side_effect = lambda t, k, d: {'autoHarvest': 'true', 'harvestBufferSeconds': '0'}.get(k, d)
    mock_sfn.start_execution.return_value = {'executionArn': 'arn:exec:1'}

    service = HarvestPipelineService()
    service.process_inference_event(_make_inference_event(event_time="2025-01-15T12:00:00Z"), 'corr-123')

    clip_item = mock_clips_table.put_item.call_args[1]['Item']
    assert 'inferenceDetectedAt' in clip_item
    assert clip_item['inferenceDetectedAt'] == '2025-01-15T12:00:00Z'
    assert 'starfishDetectedAt' not in clip_item
