"""
Property-based tests for the Harvest Pipeline orientation-aware harvesting feature.

Uses Hypothesis to verify correctness properties across randomized inputs.
Feature: orientation-aware-harvesting
"""

import os
import re
import pytest
from datetime import datetime
from hypothesis import given, settings, strategies as st

# Set required environment variables before importing the module
os.environ.setdefault('VIDEO_ASSETS_BUCKET', 'test-bucket')
os.environ.setdefault('HARVEST_JOBS_TABLE_NAME', 'test-harvest-jobs')
os.environ.setdefault('CLIPS_TABLE', 'test-clips')
os.environ.setdefault('EVENTS_TABLE', 'test-events')
os.environ.setdefault('MEDIAPACKAGE_CHANNEL_GROUP', 'test-channel-group')
os.environ.setdefault('MEDIALIVE_CHANNEL_NAME', 'test-channel')
os.environ.setdefault('MEDIAPACKAGE_ORIGIN_ENDPOINT_ID', 'test-origin-endpoint')
os.environ.setdefault('MEDIAPACKAGE_ORIGIN_ENDPOINT_URL', 'https://test.example.com/endpoint')
os.environ.setdefault('MEDIAPACKAGE_LANDSCAPE_ENDPOINT', 'test-channel-group-landscape')
os.environ.setdefault('MEDIAPACKAGE_VERTICAL_ENDPOINT', 'test-channel-group-vertical')
os.environ.setdefault('AWS_STACK_NAME', 'test-stack')

from main import HarvestPipelineConfig


# --- Strategies ---

# Non-empty alphanumeric strings for IDs (avoiding characters that would break S3 paths)
safe_id_chars = st.text(
    alphabet=st.sampled_from('abcdefghijklmnopqrstuvwxyz0123456789-_'),
    min_size=1,
    max_size=50
)

orientation_strategy = st.sampled_from(["landscape", "portrait"])

date_strategy = st.dates(
    min_value=datetime(2020, 1, 1).date(),
    max_value=datetime(2030, 12, 31).date()
).map(lambda d: datetime(d.year, d.month, d.day))


# --- Property 1: Orientation-to-endpoint mapping ---
# Feature: orientation-aware-harvesting, Property 1: Orientation-to-endpoint mapping
# **Validates: Requirements 1.1, 1.2, 1.4**

@settings(max_examples=100)
@given(orientation=orientation_strategy)
def test_orientation_to_endpoint_mapping(orientation):
    """For any orientation in {"landscape", "portrait"}, get_origin_endpoint_for_orientation()
    returns the landscape endpoint name for "landscape" and the vertical endpoint name for "portrait".
    """
    config = HarvestPipelineConfig()

    result = config.get_origin_endpoint_for_orientation(orientation)

    if orientation == "landscape":
        assert result == config.mediapackage_landscape_endpoint, (
            f"Expected landscape endpoint '{config.mediapackage_landscape_endpoint}', got '{result}'"
        )
    elif orientation == "portrait":
        assert result == config.mediapackage_vertical_endpoint, (
            f"Expected vertical endpoint '{config.mediapackage_vertical_endpoint}', got '{result}'"
        )


@settings(max_examples=100)
@given(
    invalid_orientation=st.text(min_size=1, max_size=20).filter(
        lambda s: s not in ("landscape", "portrait")
    )
)
def test_orientation_to_endpoint_rejects_invalid(invalid_orientation):
    """Invalid orientation values must raise ValueError."""
    config = HarvestPipelineConfig()

    with pytest.raises(ValueError):
        config.get_origin_endpoint_for_orientation(invalid_orientation)


# --- Property 2: S3 prefix includes orientation ---
# Feature: orientation-aware-harvesting, Property 2: S3 prefix includes orientation
# **Validates: Requirements 1.5**

@settings(max_examples=100)
@given(
    channel_id=safe_id_chars,
    clip_id=safe_id_chars,
    date=date_strategy,
    orientation=orientation_strategy
)
def test_s3_prefix_includes_orientation(channel_id, clip_id, date, orientation):
    """For any channel_id, clip_id, date, and orientation in {"landscape", "portrait"},
    get_harvest_s3_prefix() returns a string matching
    harvested-clips/{channel_id}/{date}/{clip_id}/{orientation}/.
    """
    config = HarvestPipelineConfig()

    result = config.get_harvest_s3_prefix(channel_id, clip_id, date=date, orientation=orientation)

    date_str = date.strftime('%Y-%m-%d')
    expected = f"harvested-clips/{channel_id}/{date_str}/{clip_id}/{orientation}/"

    assert result == expected, f"Expected '{expected}', got '{result}'"
    # Verify the path ends with the orientation segment
    assert result.endswith(f"/{orientation}/")
    # Verify all components are present in order
    assert result.startswith("harvested-clips/")
    assert f"/{channel_id}/" in result
    assert f"/{clip_id}/" in result


# --- Property 10: Orientation extraction from S3 path ---
# Feature: orientation-aware-harvesting, Property 10: Orientation extraction from S3 path
# **Validates: Requirements 7.1**

@settings(max_examples=100)
@given(
    channel_id=safe_id_chars,
    clip_id=safe_id_chars,
    date=date_strategy,
    orientation=orientation_strategy
)
def test_orientation_extraction_from_s3_path(channel_id, clip_id, date, orientation):
    """For any S3 path containing an orientation segment (/landscape/ or /portrait/),
    extract_orientation_from_s3_path() returns the correct orientation string.
    """
    config = HarvestPipelineConfig()

    # Build a realistic S3 path using the same function that produces them
    s3_path = config.get_harvest_s3_prefix(channel_id, clip_id, date=date, orientation=orientation)

    extracted = HarvestPipelineConfig.extract_orientation_from_s3_path(s3_path)

    assert extracted == orientation, (
        f"Expected orientation '{orientation}' from path '{s3_path}', got '{extracted}'"
    )


@settings(max_examples=100)
@given(
    path_segment=st.text(min_size=1, max_size=100).filter(
        lambda s: "/landscape/" not in s and "/portrait/" not in s
    )
)
def test_orientation_extraction_returns_none_for_no_orientation(path_segment):
    """Paths without /landscape/ or /portrait/ should return None."""
    result = HarvestPipelineConfig.extract_orientation_from_s3_path(path_segment)
    assert result is None, f"Expected None for path '{path_segment}', got '{result}'"
