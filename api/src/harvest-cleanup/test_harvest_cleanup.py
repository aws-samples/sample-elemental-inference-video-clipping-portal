"""Unit tests for the Harvest Cleanup Lambda."""

import os
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock, call

# Set env vars before importing the module
os.environ["CLIPS_TABLE_NAME"] = "test-Clips"
os.environ["SYSTEM_SETTINGS_TABLE"] = "test-SystemSettings"
os.environ["VIDEO_ASSETS_BUCKET"] = "test-video-assets"

import main


@pytest.fixture
def mock_context():
    ctx = MagicMock()
    ctx.function_name = "harvest-cleanup"
    ctx.memory_limit_in_mb = 256
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:harvest-cleanup"
    ctx.aws_request_id = "test-request-id"
    return ctx


def _make_clip(clip_id, days_old, locked=False, source_keys=None, source_key=None, harvested=None):
    """Helper to build a clip record."""
    created = (datetime.now(timezone.utc) - timedelta(days=days_old)).isoformat()
    clip = {"id": clip_id, "createdAt": created}
    if locked:
        clip["locked"] = True
    if source_keys:
        clip["sourceKeys"] = source_keys
    if source_key:
        clip["sourceKey"] = source_key
    if harvested:
        clip["harvestedOrientations"] = set(harvested)
    return clip


# --- Unit tests for helper functions ---

class TestHasHarvestedContent:
    def test_with_harvested_orientations(self):
        clip = {"harvestedOrientations": {"landscape"}}
        assert main.has_harvested_content(clip) is True

    def test_with_source_keys(self):
        clip = {"sourceKeys": {"landscape": "harvested-clips/ch/date/clip/landscape/"}}
        assert main.has_harvested_content(clip) is True

    def test_with_legacy_source_key(self):
        clip = {"sourceKey": "harvested-clips/ch/date/clip/"}
        assert main.has_harvested_content(clip) is True

    def test_empty_clip(self):
        clip = {}
        assert main.has_harvested_content(clip) is False

    def test_empty_collections(self):
        clip = {"harvestedOrientations": set(), "sourceKeys": {}, "sourceKey": ""}
        assert main.has_harvested_content(clip) is False


class TestIsClipExpired:
    def test_expired_clip(self):
        clip = _make_clip("c1", days_old=45)
        assert main.is_clip_expired(clip, 30) is True

    def test_fresh_clip(self):
        clip = _make_clip("c1", days_old=10)
        assert main.is_clip_expired(clip, 30) is False

    def test_exactly_at_boundary(self):
        clip = _make_clip("c1", days_old=30)
        # 30 days old with 30-day retention — should be expired (< cutoff)
        assert main.is_clip_expired(clip, 30) is True

    def test_missing_created_at(self):
        clip = {"id": "c1"}
        assert main.is_clip_expired(clip, 30) is False

    def test_invalid_created_at(self):
        clip = {"id": "c1", "createdAt": "not-a-date"}
        assert main.is_clip_expired(clip, 30) is False


class TestGetS3PrefixesForClip:
    def test_source_keys_only(self):
        clip = {"sourceKeys": {
            "landscape": "harvested-clips/ch/date/clip/landscape/",
            "portrait": "harvested-clips/ch/date/clip/portrait/",
        }}
        prefixes = main.get_s3_prefixes_for_clip(clip)
        assert len(prefixes) == 2
        assert "harvested-clips/ch/date/clip/landscape/" in prefixes
        assert "harvested-clips/ch/date/clip/portrait/" in prefixes

    def test_legacy_source_key_only(self):
        clip = {"sourceKey": "harvested-clips/ch/date/clip/"}
        prefixes = main.get_s3_prefixes_for_clip(clip)
        assert prefixes == ["harvested-clips/ch/date/clip/"]

    def test_skips_non_harvested_prefixes(self):
        clip = {"sourceKeys": {"landscape": "downloads/clip/landscape/"}}
        prefixes = main.get_s3_prefixes_for_clip(clip)
        assert prefixes == []

    def test_deduplicates_legacy_and_source_keys(self):
        prefix = "harvested-clips/ch/date/clip/landscape/"
        clip = {
            "sourceKeys": {"landscape": prefix},
            "sourceKey": prefix,
        }
        prefixes = main.get_s3_prefixes_for_clip(clip)
        assert prefixes == [prefix]

    def test_empty_clip(self):
        assert main.get_s3_prefixes_for_clip({}) == []


# --- Integration tests for lambda_handler ---

class TestLambdaHandler:
    """Tests for the full lambda_handler flow."""

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_purges_expired_clips_with_harvested_content(self, mock_dynamo, mock_s3, mock_context):
        """Expired clip with harvested content should be purged."""
        clip = _make_clip("clip-1", days_old=45,
                          source_keys={"landscape": "harvested-clips/ch/d/clip-1/landscape/"})

        settings_table = MagicMock()
        settings_table.get_item.side_effect = [
            {"Item": {"settingKey": "harvestRetentionDays", "settingValue": "30"}},
            {"Item": {"settingKey": "harvestCleanupDryRun", "settingValue": "false"}},
        ]

        clips_table = MagicMock()
        clips_table.scan.return_value = {"Items": [clip]}
        clips_table.delete_item = MagicMock()

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Contents": [{"Key": "harvested-clips/ch/d/clip-1/landscape/main.m3u8"}]}]
        mock_s3.get_paginator.return_value = paginator
        mock_s3.delete_objects.return_value = {"Errors": []}

        result = main.lambda_handler({}, mock_context)

        assert result["clipsPurged"] == 1
        assert result["errors"] == 0
        assert result["dryRun"] is False
        clips_table.delete_item.assert_called_once_with(Key={"id": "clip-1"})
        mock_s3.delete_objects.assert_called_once()

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_skips_locked_clips(self, mock_dynamo, mock_s3, mock_context):
        """Locked clips should be skipped regardless of age."""
        clip = _make_clip("clip-locked", days_old=100, locked=True,
                          source_keys={"landscape": "harvested-clips/ch/d/clip-locked/landscape/"})

        settings_table = MagicMock()
        settings_table.get_item.side_effect = [
            {"Item": {"settingKey": "harvestRetentionDays", "settingValue": "30"}},
            {"Item": {"settingKey": "harvestCleanupDryRun", "settingValue": "false"}},
        ]

        clips_table = MagicMock()
        clips_table.scan.return_value = {"Items": [clip]}

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        result = main.lambda_handler({}, mock_context)

        assert result["clipsPurged"] == 0
        clips_table.delete_item.assert_not_called()
        mock_s3.delete_objects.assert_not_called()

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_dry_run_mode_does_not_delete(self, mock_dynamo, mock_s3, mock_context):
        """Dry run mode should log but not delete anything."""
        clip = _make_clip("clip-dry", days_old=60,
                          source_keys={"landscape": "harvested-clips/ch/d/clip-dry/landscape/"})

        settings_table = MagicMock()
        settings_table.get_item.side_effect = [
            {"Item": {"settingKey": "harvestRetentionDays", "settingValue": "30"}},
            {"Item": {"settingKey": "harvestCleanupDryRun", "settingValue": "true"}},
        ]

        clips_table = MagicMock()
        clips_table.scan.return_value = {"Items": [clip]}

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Contents": [{"Key": "harvested-clips/ch/d/clip-dry/landscape/seg.ts"}]}]
        mock_s3.get_paginator.return_value = paginator

        result = main.lambda_handler({}, mock_context)

        assert result["dryRun"] is True
        assert result["clipsPurged"] == 1
        clips_table.delete_item.assert_not_called()
        mock_s3.delete_objects.assert_not_called()

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_skips_fresh_clips(self, mock_dynamo, mock_s3, mock_context):
        """Clips within the retention period should not be purged."""
        clip = _make_clip("clip-fresh", days_old=5,
                          source_keys={"landscape": "harvested-clips/ch/d/clip-fresh/landscape/"})

        settings_table = MagicMock()
        settings_table.get_item.side_effect = [
            {"Item": {"settingKey": "harvestRetentionDays", "settingValue": "30"}},
            {"Item": {"settingKey": "harvestCleanupDryRun", "settingValue": "false"}},
        ]

        clips_table = MagicMock()
        clips_table.scan.return_value = {"Items": [clip]}

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        result = main.lambda_handler({}, mock_context)

        assert result["clipsPurged"] == 0

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_continues_on_single_clip_failure(self, mock_dynamo, mock_s3, mock_context):
        """If one clip fails, processing should continue with the next."""
        clip_ok = _make_clip("clip-ok", days_old=60,
                             source_keys={"landscape": "harvested-clips/ch/d/clip-ok/landscape/"})
        clip_bad = _make_clip("clip-bad", days_old=60,
                              source_keys={"landscape": "harvested-clips/ch/d/clip-bad/landscape/"})

        settings_table = MagicMock()
        settings_table.get_item.side_effect = [
            {"Item": {"settingKey": "harvestRetentionDays", "settingValue": "30"}},
            {"Item": {"settingKey": "harvestCleanupDryRun", "settingValue": "false"}},
        ]

        clips_table = MagicMock()
        clips_table.scan.return_value = {"Items": [clip_bad, clip_ok]}
        clips_table.delete_item = MagicMock()

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        # First clip's S3 delete raises, second succeeds
        paginator = MagicMock()
        call_count = {"n": 0}
        def paginate_side_effect(**kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise Exception("S3 error")
            return [{"Contents": [{"Key": "harvested-clips/ch/d/clip-ok/landscape/seg.ts"}]}]

        paginator.paginate.side_effect = paginate_side_effect
        mock_s3.get_paginator.return_value = paginator
        mock_s3.delete_objects.return_value = {"Errors": []}

        result = main.lambda_handler({}, mock_context)

        assert result["errors"] == 1
        assert result["clipsPurged"] == 1
        assert result["clipsProcessed"] == 2

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_only_deletes_harvested_clips_prefix(self, mock_dynamo, mock_s3, mock_context):
        """S3 deletion should only target harvested-clips/ prefixes, not downloads/."""
        clip = _make_clip("clip-mixed", days_old=60, source_keys={
            "landscape": "harvested-clips/ch/d/clip-mixed/landscape/",
        })
        # Simulate a sourceKey under downloads/ — should be ignored
        clip["sourceKey"] = "downloads/clip/clip-mixed/landscape.mp4"

        settings_table = MagicMock()
        settings_table.get_item.side_effect = [
            {"Item": {"settingKey": "harvestRetentionDays", "settingValue": "30"}},
            {"Item": {"settingKey": "harvestCleanupDryRun", "settingValue": "false"}},
        ]

        clips_table = MagicMock()
        clips_table.scan.return_value = {"Items": [clip]}
        clips_table.delete_item = MagicMock()

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Contents": [{"Key": "harvested-clips/ch/d/clip-mixed/landscape/seg.ts"}]}]
        mock_s3.get_paginator.return_value = paginator
        mock_s3.delete_objects.return_value = {"Errors": []}

        result = main.lambda_handler({}, mock_context)

        # Only one S3 prefix should be processed (the harvested-clips/ one)
        assert mock_s3.get_paginator.call_count == 1
        paginator.paginate.assert_called_once_with(
            Bucket="test-video-assets",
            Prefix="harvested-clips/ch/d/clip-mixed/landscape/",
        )

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_default_settings_when_missing(self, mock_dynamo, mock_s3, mock_context):
        """When settings are missing, defaults should be used (30 days, dry run true)."""
        clip = _make_clip("clip-default", days_old=60,
                          source_keys={"landscape": "harvested-clips/ch/d/clip-default/landscape/"})

        settings_table = MagicMock()
        # Return empty items to trigger defaults
        settings_table.get_item.return_value = {}

        clips_table = MagicMock()
        clips_table.scan.return_value = {"Items": [clip]}

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Contents": [{"Key": "harvested-clips/ch/d/clip-default/landscape/seg.ts"}]}]
        mock_s3.get_paginator.return_value = paginator

        result = main.lambda_handler({}, mock_context)

        # Should default to dry run
        assert result["dryRun"] is True
        clips_table.delete_item.assert_not_called()
        mock_s3.delete_objects.assert_not_called()

    @patch.object(main, "s3_client")
    @patch.object(main, "dynamodb")
    def test_pagination_processes_all_pages(self, mock_dynamo, mock_s3, mock_context):
        """Scanner should follow pagination tokens to process all clips."""
        clip1 = _make_clip("clip-p1", days_old=60,
                           source_keys={"landscape": "harvested-clips/ch/d/clip-p1/landscape/"})
        clip2 = _make_clip("clip-p2", days_old=60,
                           source_keys={"landscape": "harvested-clips/ch/d/clip-p2/landscape/"})

        settings_table = MagicMock()
        settings_table.get_item.side_effect = [
            {"Item": {"settingKey": "harvestRetentionDays", "settingValue": "30"}},
            {"Item": {"settingKey": "harvestCleanupDryRun", "settingValue": "false"}},
        ]

        clips_table = MagicMock()
        clips_table.scan.side_effect = [
            {"Items": [clip1], "LastEvaluatedKey": {"id": {"S": "clip-p1"}}},
            {"Items": [clip2]},
        ]
        clips_table.delete_item = MagicMock()

        mock_dynamo.Table.side_effect = lambda name: {
            "test-SystemSettings": settings_table,
            "test-Clips": clips_table,
        }[name]

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Contents": [{"Key": "some-key"}]}]
        mock_s3.get_paginator.return_value = paginator
        mock_s3.delete_objects.return_value = {"Errors": []}

        result = main.lambda_handler({}, mock_context)

        assert result["clipsPurged"] == 2
        assert clips_table.scan.call_count == 2
