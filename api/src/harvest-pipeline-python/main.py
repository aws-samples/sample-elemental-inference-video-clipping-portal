#!/usr/bin/env python3
"""
Video Harvesting Pipeline - Python Implementation

This module implements a comprehensive video harvesting pipeline using AWS MediaPackage V2 
for live video content harvesting. The pipeline is automatically triggered by EventBridge 
events from Inference highlight metadata generation.

Key Features:
- EventBridge event processing for Inference highlight metadata
- MediaPackage V2 harvest job creation and management
- S3 integration for video asset storage
- DynamoDB integration for clips management
- Comprehensive error handling and logging
- Circuit breaker pattern for resilience
- Retry logic with exponential backoff
"""

import json
import os
import uuid
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from enum import Enum

import boto3
import urllib3
from botocore.exceptions import ClientError, BotoCoreError
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

# Initialize AWS Lambda Powertools
logger = Logger(service="harvest-pipeline")
tracer = Tracer(service="harvest-pipeline")
metrics = Metrics(namespace="HarvestPipeline", service="harvest-pipeline")

# Initialize AWS clients
mediapackagev2_client = boto3.client('mediapackagev2')
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
sfn_client = boto3.client('stepfunctions')


class HarvestJobStatus(Enum):
    """Harvest job status enumeration"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class MediaPackageJobState(Enum):
    """MediaPackage V2 job state enumeration"""
    QUEUED = "QUEUED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


@dataclass
class HarvestJobRequest:
    """Harvest job request data structure"""
    clip_id: str
    channel_id: str
    start_time: str  # ISO 8601 format
    end_time: str    # ISO 8601 format
    origin_endpoint_id: str
    metadata: Dict[str, Any]
    correlation_id: str
    orientation: str = "landscape"  # "landscape" or "portrait"


@dataclass
class HarvestJob:
    """Harvest job data structure"""
    job_id: str
    clip_id: str
    channel_id: str
    status: str
    s3_location: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    error_details: Optional[str] = None
    harvest_job_arn: Optional[str] = None
    mediapackage_job_id: Optional[str] = None
    orientation: Optional[str] = None


@dataclass
class InferenceEvent:
    """Inference EventBridge event structure"""
    version: str
    id: str
    detail_type: str
    source: str
    account: str
    time: str
    region: str
    detail: Dict[str, Any]


class HarvestPipelineError(Exception):
    """Base exception for harvest pipeline errors"""
    def __init__(self, message: str, correlation_id: str, context: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.correlation_id = correlation_id
        self.context = context or {}


class InvalidEventDataError(HarvestPipelineError):
    """Exception for invalid event data"""
    pass


class HarvestJobCreationError(HarvestPipelineError):
    """Exception for harvest job creation failures"""
    pass


class MediaPackageServiceError(HarvestPipelineError):
    """Exception for MediaPackage service errors"""
    pass


class CircuitBreakerError(HarvestPipelineError):
    """Exception for circuit breaker open state"""
    pass


@dataclass
class ChannelConfig:
    """Per-channel MediaPackage resource configuration.

    Holds the resolved resource identifiers for a specific channel,
    populated either from the Channels DynamoDB record or from
    static environment variable defaults.
    """
    channel_group: str
    channel_name: str
    origin_endpoint: str
    landscape_endpoint: str
    vertical_endpoint: str
    manifest_url: str
    landscape_manifest_url: str
    vertical_manifest_url: str

    def get_origin_endpoint_for_orientation(self, orientation: str) -> str:
        """Return the origin endpoint name for the given orientation.

        Args:
            orientation: "landscape" or "portrait"

        Returns:
            vertical_endpoint for "portrait", landscape_endpoint otherwise.
        """
        if orientation == "portrait":
            return self.vertical_endpoint
        return self.landscape_endpoint

    def get_manifest_url_for_orientation(self, orientation: str) -> str:
        """Return the manifest URL for the given orientation.

        Args:
            orientation: "landscape" or "portrait"

        Returns:
            vertical_manifest_url for "portrait", landscape_manifest_url otherwise.
        """
        if orientation == "portrait":
            return self.vertical_manifest_url
        return self.landscape_manifest_url


class HarvestPipelineConfig:
    """Configuration management for harvest pipeline"""

    def __init__(self):
        self.video_assets_bucket = self._get_required_env('VIDEO_ASSETS_BUCKET')
        self.harvest_jobs_table = self._get_required_env('HARVEST_JOBS_TABLE_NAME', 'harvest-jobs')
        self.clips_table = self._get_required_env('CLIPS_TABLE', 'clips')
        self.events_table = self._get_required_env('EVENTS_TABLE', 'events')
        self.mediapackage_channel_group = self._get_required_env('MEDIAPACKAGE_CHANNEL_GROUP')
        self.mediapackage_channel_name = os.environ.get('MEDIALIVE_CHANNEL_NAME', '')
        self.mediapackage_origin_endpoint = os.environ.get('MEDIAPACKAGE_ORIGIN_ENDPOINT_ID', '')
        self.mediapackage_origin_endpoint_url = os.environ.get('MEDIAPACKAGE_ORIGIN_ENDPOINT_URL', '')
        self.mediapackage_landscape_endpoint = os.environ.get('MEDIAPACKAGE_LANDSCAPE_ENDPOINT', '')
        self.mediapackage_vertical_endpoint = os.environ.get('MEDIAPACKAGE_VERTICAL_ENDPOINT', '')
        self.stack_name = self._get_required_env('AWS_STACK_NAME')

        # Channels table (optional – used for dynamic per-channel resolution)
        self.channels_table_name = os.environ.get('CHANNELS_TABLE_NAME', '')

        # Event association settings
        self.event_association_time_window = int(os.environ.get('EVENT_ASSOCIATION_TIME_WINDOW_MINUTES', '30'))
        self.create_default_event = os.environ.get('EVENT_ASSOCIATION_CREATE_DEFAULT', 'false').lower() == 'true'

        # Content availability polling settings
        self.content_poll_max_attempts = int(os.environ.get('CONTENT_POLL_MAX_ATTEMPTS', '3'))
        self.content_poll_delay = float(os.environ.get('CONTENT_POLL_DELAY', '3.0'))

        # Resilience settings
        self.max_retries = int(os.environ.get('MAX_RETRIES', '3'))
        self.base_delay = float(os.environ.get('BASE_DELAY', '1.0'))
        self.max_delay = float(os.environ.get('MAX_DELAY', '10.0'))
        self.backoff_multiplier = float(os.environ.get('BACKOFF_MULTIPLIER', '2.0'))

    def _get_required_env(self, key: str, default: Optional[str] = None) -> str:
        """Get required environment variable"""
        value = os.environ.get(key, default)
        if not value:
            raise ValueError(f"Required environment variable {key} is not set")
        return value

    def resolve_for_channel(self, channel_record: Dict[str, Any]) -> ChannelConfig:
        """Resolve per-channel config from a DynamoDB channel record, falling back to env var defaults.

        Args:
            channel_record: Dict from the Channels DynamoDB table. May be empty for
                legacy channels that lack per-channel resource fields.

        Returns:
            A ChannelConfig with fields populated from the record or env var defaults.
        """
        return ChannelConfig(
            channel_group=channel_record.get('channelGroupName', self.mediapackage_channel_group),
            channel_name=channel_record.get('mediaPackageChannelName', self.mediapackage_channel_name),
            origin_endpoint=channel_record.get('originEndpointName', self.mediapackage_origin_endpoint),
            landscape_endpoint=channel_record.get('landscapeEndpointName', self.mediapackage_landscape_endpoint),
            vertical_endpoint=channel_record.get('verticalEndpointName', self.mediapackage_vertical_endpoint),
            manifest_url=channel_record.get('manifestUrl', self.mediapackage_origin_endpoint_url),
            landscape_manifest_url=channel_record.get('landscapeManifestUrl', self.mediapackage_origin_endpoint_url),
            vertical_manifest_url=channel_record.get('verticalManifestUrl', self.mediapackage_origin_endpoint_url),
        )

    def get_origin_endpoint_for_orientation(self, orientation: str) -> str:
        """Map orientation to the correct MediaPackage origin endpoint name.

        Args:
            orientation: "landscape" or "portrait"

        Returns:
            The endpoint name for the given orientation.

        Raises:
            ValueError: If orientation is not "landscape" or "portrait".
        """
        if orientation == "landscape":
            return self.mediapackage_landscape_endpoint
        elif orientation == "portrait":
            return self.mediapackage_vertical_endpoint
        else:
            raise ValueError(f"Invalid orientation: {orientation}. Must be 'landscape' or 'portrait'.")

    def get_harvest_s3_prefix(self, channel_id: str, clip_id: str, date: Optional[datetime] = None, orientation: Optional[str] = None) -> str:
        """Get S3 prefix for harvest job outputs.

        Args:
            channel_id: The channel identifier.
            clip_id: The clip identifier.
            date: Optional date for the prefix. Defaults to current UTC time.
            orientation: Optional orientation ("landscape" or "portrait") to append to the path.

        Returns:
            S3 prefix string for the harvest job output.
        """
        harvest_date = date or datetime.utcnow()
        date_str = harvest_date.strftime('%Y-%m-%d')
        if orientation:
            return f"harvested-clips/{channel_id}/{date_str}/{clip_id}/{orientation}/"
        return f"harvested-clips/{channel_id}/{date_str}/{clip_id}/"
    @staticmethod
    def extract_orientation_from_s3_path(s3_path: str) -> Optional[str]:
        """Extract orientation from an S3 path containing /landscape/ or /portrait/.

        Args:
            s3_path: An S3 key/prefix that may contain an orientation segment.

        Returns:
            "landscape" or "portrait" if found, None otherwise.
        """
        if "/landscape/" in s3_path:
            return "landscape"
        elif "/portrait/" in s3_path:
            return "portrait"
        return None

    @staticmethod
    def apply_harvest_buffer(start_time_iso: str, end_time_iso: str, buffer_seconds: int) -> tuple:
        """Apply symmetric buffer to harvest window. Buffer is applied AFTER minimum duration enforcement.

        Args:
            start_time_iso: Start time in ISO 8601 format (e.g., '2024-01-01T00:00:00.000Z').
            end_time_iso: End time in ISO 8601 format.
            buffer_seconds: Number of seconds to subtract from start and add to end.

        Returns:
            Tuple of (adjusted_start, adjusted_end) as ISO timestamp strings.
        """
        if buffer_seconds <= 0:
            return start_time_iso, end_time_iso
        start_dt = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(end_time_iso.replace('Z', '+00:00'))
        start_dt -= timedelta(seconds=buffer_seconds)
        end_dt += timedelta(seconds=buffer_seconds)
        return start_dt.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z', end_dt.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def read_system_setting(table_name: str, setting_key: str, default_value: str) -> str:
    """Read a setting from the System_Settings_Table with error handling and default fallback.

    Args:
        table_name: Name of the System_Settings_Table DynamoDB table.
        setting_key: The setting key to look up (e.g., 'autoHarvestOrientation').
        default_value: Value to return if the setting is missing or an error occurs.

    Returns:
        The setting value if found, otherwise default_value.
    """
    try:
        table = dynamodb.Table(table_name)
        response = table.get_item(Key={'settingKey': setting_key})
        item = response.get('Item')
        if item and 'settingValue' in item:
            return item['settingValue']
        logger.warning("Setting not found in System_Settings_Table, using default",
                       extra={"setting_key": setting_key, "default_value": default_value})
        return default_value
    except Exception as e:
        logger.warning("Failed to read system setting, using default",
                       extra={"setting_key": setting_key, "default_value": default_value, "error": str(e)})
        return default_value


class CircuitBreaker:
    """Simple circuit breaker implementation"""
    
    def __init__(self, failure_threshold: int = 5, recovery_timeout: int = 30):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = None
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
    
    def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection"""
        if self.state == "OPEN":
            if self._should_attempt_reset():
                self.state = "HALF_OPEN"
            else:
                raise CircuitBreakerError("Circuit breaker is OPEN", "", {"state": self.state})
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise e
    
    def _should_attempt_reset(self) -> bool:
        """Check if circuit breaker should attempt reset"""
        if self.last_failure_time is None:
            return True
        return (datetime.utcnow() - self.last_failure_time).seconds >= self.recovery_timeout
    
    def _on_success(self):
        """Handle successful call"""
        self.failure_count = 0
        self.state = "CLOSED"
    
    def _on_failure(self):
        """Handle failed call"""
        self.failure_count += 1
        self.last_failure_time = datetime.utcnow()
        if self.failure_count >= self.failure_threshold:
            self.state = "OPEN"


class RetryPolicy:
    """Exponential backoff retry policy"""
    
    def __init__(self, max_retries: int = 3, base_delay: float = 1.0, 
                 max_delay: float = 10.0, backoff_multiplier: float = 2.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.backoff_multiplier = backoff_multiplier
    
    def execute(self, func, *args, **kwargs):
        """Execute function with retry logic"""
        import time
        import random
        
        last_exception = None
        
        for attempt in range(self.max_retries + 1):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_exception = e
                
                if attempt == self.max_retries:
                    break
                
                if not self._is_retryable_error(e):
                    break
                
                # Calculate delay with jitter
                delay = min(self.base_delay * (self.backoff_multiplier ** attempt), self.max_delay)
                jitter = random.uniform(0, 0.1) * delay
                time.sleep(delay + jitter)
                
                logger.warning(f"Retry attempt {attempt + 1}/{self.max_retries}", 
                             extra={"attempt": attempt + 1, "error": str(e)})
        
        raise last_exception
    
    def _is_retryable_error(self, error: Exception) -> bool:
        """Check if error is retryable"""
        if isinstance(error, ClientError):
            error_code = error.response.get('Error', {}).get('Code', '')
            # Retry on throttling and server errors
            return error_code in ['ThrottlingException', 'ServiceUnavailable'] or \
                   error.response.get('Error', {}).get('HTTPStatusCode', 0) >= 500
        return isinstance(error, BotoCoreError)


class MediaPackageV2Service:
    """MediaPackage V2 service with resilience patterns"""
    
    def __init__(self, config: HarvestPipelineConfig):
        self.config = config
        self.circuit_breaker = CircuitBreaker()
        self.retry_policy = RetryPolicy(
            max_retries=config.max_retries,
            base_delay=config.base_delay,
            max_delay=config.max_delay,
            backoff_multiplier=config.backoff_multiplier
        )
        self.http = urllib3.PoolManager()
    
    @tracer.capture_method
    def wait_for_content_availability(self, start_time: str, end_time: str, correlation_id: str, manifest_url: Optional[str] = None) -> bool:
        """Poll MediaPackage origin endpoint until content is available"""
        base_url = manifest_url or self.config.mediapackage_origin_endpoint_url
        poll_url = f"{base_url}?start={start_time}&end={end_time}"
        
        max_attempts = self.config.content_poll_max_attempts
        delay = self.config.content_poll_delay
        
        logger.info("Polling for content availability", extra={
            "manifest_url": poll_url,
            "max_attempts": max_attempts,
            "correlation_id": correlation_id
        })
        
        for attempt in range(max_attempts):
            try:
                response = self.http.request('HEAD', poll_url, timeout=5.0)
                
                if response.status == 200:
                    logger.info("Content available", extra={
                        "attempt": attempt + 1,
                        "correlation_id": correlation_id
                    })
                    metrics.add_metric(name="ContentAvailability.Success", unit=MetricUnit.Count, value=1)
                    metrics.add_metric(name="ContentAvailability.Attempts", unit=MetricUnit.Count, value=attempt + 1)
                    return True
                    
                logger.debug(f"Content not ready, status: {response.status}", extra={
                    "attempt": attempt + 1,
                    "status": response.status,
                    "correlation_id": correlation_id
                })
                
            except Exception as e:
                logger.debug(f"Poll attempt failed: {str(e)}", extra={
                    "attempt": attempt + 1,
                    "error": str(e),
                    "correlation_id": correlation_id
                })
            
            if attempt < max_attempts - 1:
                time.sleep(delay)
        
        logger.warning("Content not available after max attempts", extra={
            "max_attempts": max_attempts,
            "correlation_id": correlation_id
        })
        metrics.add_metric(name="ContentAvailability.Timeout", unit=MetricUnit.Count, value=1)
        return False
    
    @tracer.capture_method
    def create_harvest_job(self, request: HarvestJobRequest, channel_config: Optional[ChannelConfig] = None) -> Dict[str, Any]:
        """Create MediaPackage V2 harvest job"""
        logger.info("Creating MediaPackage V2 harvest job", 
                   extra={"clip_id": request.clip_id, "channel_id": request.channel_id, "orientation": request.orientation})

        def _create_job():
            harvest_job_name = f"harvest-{request.clip_id}-{request.orientation}-{int(datetime.utcnow().timestamp())}"
            s3_prefix = self.config.get_harvest_s3_prefix(
                request.channel_id, request.clip_id, orientation=request.orientation
            )

            # Use channel_config for per-channel resolution when available, else fall back to static config
            if channel_config:
                channel_group = channel_config.channel_group
                channel_name = channel_config.channel_name
                origin_endpoint = channel_config.get_origin_endpoint_for_orientation(request.orientation)
            else:
                channel_group = self.config.mediapackage_channel_group
                channel_name = self.config.mediapackage_channel_name
                origin_endpoint = self.config.get_origin_endpoint_for_orientation(request.orientation)

            logger.info("MediaPackage V2 harvest job parameters", extra={
                "harvest_job_name": harvest_job_name,
                "channel_group": channel_group,
                "channel_name": channel_name,
                "origin_endpoint": origin_endpoint,
                "orientation": request.orientation,
                "start_time": request.start_time,
                "end_time": request.end_time,
                "s3_bucket": self.config.video_assets_bucket,
                "s3_prefix": s3_prefix
            })

            response = mediapackagev2_client.create_harvest_job(
                ChannelGroupName=channel_group,
                ChannelName=channel_name,
                OriginEndpointName=origin_endpoint,
                HarvestJobName=harvest_job_name,
                HarvestedManifests={
                    'HlsManifests': [{
                        'ManifestName': 'main'
                    }]
                },
                ScheduleConfiguration={
                    'StartTime': datetime.fromisoformat(request.start_time.replace('Z', '+00:00')),
                    'EndTime': datetime.fromisoformat(request.end_time.replace('Z', '+00:00'))
                },
                Destination={
                    'S3Destination': {
                        'BucketName': self.config.video_assets_bucket,
                        'DestinationPath': s3_prefix
                    }
                },
                Description=request.metadata.get('description', f'Harvested clip for {request.clip_id}'),
                Tags={
                    'ClipId': request.clip_id,
                    'ChannelId': request.channel_id,
                    'Orientation': request.orientation,
                    'CreatedBy': 'video-harvesting-pipeline',
                    'CorrelationId': request.correlation_id or 'unknown'
                }
            )

            logger.info("MediaPackage V2 harvest job created successfully", extra={
                "harvest_job_arn": response.get('Arn'),
                "harvest_job_name": response.get('HarvestJobName'),
                "status": response.get('Status'),
                "response": response
            })

            metrics.add_metric(name="MediaPackageV2.CreateHarvestJob.Success", unit=MetricUnit.Count, value=1)
            return response

        try:
            return self.circuit_breaker.call(self.retry_policy.execute, _create_job)
        except Exception as e:
            metrics.add_metric(name="MediaPackageV2.CreateHarvestJob.Error", unit=MetricUnit.Count, value=1)
            logger.error("Failed to create harvest job", extra={"error": str(e), "clip_id": request.clip_id})
            raise MediaPackageServiceError(f"Failed to create harvest job: {str(e)}", request.correlation_id)
    
    @tracer.capture_method
    def get_harvest_job_status(self, harvest_job_name: str, correlation_id: str) -> Dict[str, Any]:
        """Get harvest job status"""
        def _get_status():
            return mediapackagev2_client.get_harvest_job(
                ChannelGroupName=self.config.mediapackage_channel_group,
                ChannelName=self.config.mediapackage_channel_name,
                OriginEndpointName=self.config.mediapackage_origin_endpoint,
                HarvestJobName=harvest_job_name
            )
        
        try:
            return self.circuit_breaker.call(self.retry_policy.execute, _get_status)
        except Exception as e:
            logger.error("Failed to get harvest job status", 
                        extra={"error": str(e), "harvest_job_name": harvest_job_name})
            raise MediaPackageServiceError(f"Failed to get harvest job status: {str(e)}", correlation_id)


class DynamoDBService:
    """DynamoDB service for harvest jobs and clips management"""
    
    def __init__(self, config: HarvestPipelineConfig):
        self.config = config
        self.harvest_jobs_table = dynamodb.Table(config.harvest_jobs_table)
        self.clips_table = dynamodb.Table(config.clips_table)
        self.events_table = dynamodb.Table(config.events_table)
        self.channels_table = dynamodb.Table(config.channels_table_name) if config.channels_table_name else None

    @tracer.capture_method
    def get_channel_record(self, channel_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve the enriched channel record from the Channels table.

        Args:
            channel_id: The channel ID (partition key) to look up.

        Returns:
            The channel item dict if found, None otherwise.
        """
        if not channel_id:
            logger.info("No channel_id provided, skipping channel record lookup")
            return None

        if not self.channels_table:
            logger.info("CHANNELS_TABLE_NAME not configured, skipping channel record lookup")
            return None

        try:
            response = self.channels_table.get_item(Key={'id': channel_id})
            item = response.get('Item')
            if item:
                logger.info("Channel record found", extra={
                    "channel_id": channel_id,
                    "has_mediaPackageChannelName": 'mediaPackageChannelName' in item,
                    "has_feedId": 'feedId' in item,
                })
            else:
                logger.info("No channel record found for channel_id", extra={"channel_id": channel_id})
            return item
        except Exception as e:
            logger.error("Failed to get channel record", extra={
                "error": str(e),
                "channel_id": channel_id,
                "error_type": type(e).__name__,
            })
            return None

    def get_channel_by_feed_arn(self, feed_arn: str) -> Optional[Dict[str, Any]]:
        """Look up a channel record by its Inference feed ARN using the FeedArnIndex GSI.

        Args:
            feed_arn: The Inference feed ARN from the EventBridge event resources.

        Returns:
            The channel item dict if found, None otherwise.
        """
        if not feed_arn:
            logger.info("No feed_arn provided, skipping feed ARN lookup")
            return None

        if not self.channels_table:
            logger.info("CHANNELS_TABLE_NAME not configured, skipping feed ARN lookup")
            return None

        try:
            response = self.channels_table.query(
                IndexName='FeedArnIndex',
                KeyConditionExpression='feedArn = :arn',
                ExpressionAttributeValues={':arn': feed_arn},
                Limit=1,
            )
            items = response.get('Items', [])
            if items:
                channel = items[0]
                logger.info("Channel found by feed ARN", extra={
                    "feed_arn": feed_arn,
                    "channel_id": channel.get('id'),
                    "channel_name": channel.get('name'),
                })
                return channel
            logger.info("No channel found for feed ARN", extra={"feed_arn": feed_arn})
            return None
        except Exception as e:
            logger.error("Failed to look up channel by feed ARN", extra={
                "error": str(e),
                "feed_arn": feed_arn,
                "error_type": type(e).__name__,
            })
            return None

    def find_active_event_for_channel(self, channel_id: str, correlation_id: str) -> Optional[Dict[str, Any]]:
        """Find the active event for a specific channel using the MediaLiveChannelIndex GSI.

        Args:
            channel_id: The MediaLive channel ID.
            correlation_id: For logging.

        Returns:
            The active event dict if found, None otherwise.
        """
        try:
            response = self.events_table.query(
                IndexName='MediaLiveChannelIndex',
                KeyConditionExpression='mediaLiveChannel = :cid',
                ExpressionAttributeValues={':cid': channel_id},
            )
            events = response.get('Items', [])
            logger.info("Events found for channel", extra={
                "channel_id": channel_id,
                "event_count": len(events),
                "correlation_id": correlation_id,
            })

            # Prefer the event marked as active for Inference
            for event in events:
                is_active = event.get('isActiveForStarfish', False)
                if isinstance(is_active, str):
                    is_active = is_active.lower() == 'true'
                if is_active:
                    logger.info("Found active event for channel", extra={
                        "event_id": event.get('id'),
                        "event_name": event.get('name'),
                        "channel_id": channel_id,
                        "correlation_id": correlation_id,
                    })
                    return event

            # No active event — return the most recently started live event
            from datetime import datetime as dt, timezone
            now = dt.now(timezone.utc)
            live_events = []
            for event in events:
                start_str = event.get('startDateTime', '')
                end_str = event.get('endDateTime', '')
                if not start_str or not end_str:
                    continue
                try:
                    start_dt = dt.fromisoformat(start_str.replace('Z', '+00:00'))
                    end_dt = dt.fromisoformat(end_str.replace('Z', '+00:00'))
                    if start_dt <= now <= end_dt:
                        live_events.append(event)
                except (ValueError, TypeError):
                    continue

            if live_events:
                best = max(live_events, key=lambda e: e.get('startDateTime', ''))
                logger.info("Found live event for channel (no isActiveForStarfish flag)", extra={
                    "event_id": best.get('id'),
                    "event_name": best.get('name'),
                    "channel_id": channel_id,
                    "correlation_id": correlation_id,
                })
                return best

            logger.info("No active or live event found for channel", extra={
                "channel_id": channel_id,
                "correlation_id": correlation_id,
            })
            return None
        except Exception as e:
            logger.error("Failed to find active event for channel", extra={
                "error": str(e),
                "channel_id": channel_id,
                "correlation_id": correlation_id,
            })
            return None
    
    @tracer.capture_method
    def save_harvest_job(self, harvest_job: HarvestJob) -> None:
        """Save harvest job to DynamoDB"""
        try:
            item = asdict(harvest_job)
            # Remove None values
            item = {k: v for k, v in item.items() if v is not None}
            
            logger.info("Saving harvest job to DynamoDB", extra={
                "table_name": self.config.harvest_jobs_table,
                "job_id": harvest_job.job_id,
                "item": item
            })
            
            self.harvest_jobs_table.put_item(Item=item)
            logger.info("Harvest job saved to DynamoDB successfully", extra={"job_id": harvest_job.job_id})
        except Exception as e:
            logger.error("Failed to save harvest job", extra={"error": str(e), "job_id": harvest_job.job_id, "error_type": type(e).__name__})
            raise
    
    @tracer.capture_method
    def create_clip_record(self, harvest_job: HarvestJob, request: HarvestJobRequest) -> None:
        """Create clip record in clips table"""
        try:
            logger.info("Creating clip record", extra={
                "table_name": self.config.clips_table,
                "clip_id": harvest_job.clip_id
            })
            
            # Calculate duration from start/end times
            start_dt = datetime.fromisoformat(request.start_time.replace('Z', '+00:00'))
            end_dt = datetime.fromisoformat(request.end_time.replace('Z', '+00:00'))
            duration = int((end_dt - start_dt).total_seconds())
            
            logger.info("Clip duration calculated", extra={
                "duration_seconds": duration,
                "start_time": request.start_time,
                "end_time": request.end_time
            })
            
            clip_item = {
                'id': harvest_job.clip_id,
                'name': request.metadata.get('tags', ['Harvested Clip'])[0] if request.metadata.get('tags') else f'Harvested Clip {harvest_job.clip_id}',
                'description': request.metadata.get('description', 'Auto-generated highlight from Inference'),
                'eventId': request.metadata.get('eventId', 'unknown'),
                'eventName': request.metadata.get('eventName', 'Unknown Event'),
                'startTime': int(start_dt.timestamp()),
                'endTime': int(end_dt.timestamp()),
                'duration': duration,
                'status': 'processing',
                'resolution': '1920x1080',  # Default resolution
                'format': 'mp4',
                'mediaPackage': self.config.mediapackage_channel_group,
                'mediaLiveChannel': request.metadata.get('mediaLiveChannel', 'unknown'),
                'age': 0,
                'createdAt': datetime.utcnow().isoformat() + 'Z',
                'updatedAt': datetime.utcnow().isoformat() + 'Z',
                'inferenceDetectedAt': request.metadata.get('inferenceDetectedAt'),
                'tags': request.metadata.get('tags', ['inference', 'highlight', 'auto-generated']),
                'isHarvested': True,
                'harvestJobId': harvest_job.job_id,
                'harvestMetadata': {
                    'harvestJobArn': harvest_job.harvest_job_arn,
                    'originEndpointId': request.origin_endpoint_id,
                    'harvestTimestamp': datetime.utcnow().isoformat() + 'Z',
                    'correlationId': request.correlation_id
                }
            }
            
            # Add S3 location if available
            if harvest_job.s3_location:
                clip_item['sourceKey'] = harvest_job.s3_location
            
            logger.info("Saving clip record to DynamoDB", extra={
                "clip_id": harvest_job.clip_id,
                "clip_item_keys": list(clip_item.keys())
            })
            
            self.clips_table.put_item(Item=clip_item)
            logger.info("Clip record created successfully", extra={"clip_id": harvest_job.clip_id})
            
        except Exception as e:
            logger.error("Failed to create clip record", 
                        extra={"error": str(e), "clip_id": harvest_job.clip_id, "error_type": type(e).__name__})
            # Don't raise - clip creation failure shouldn't fail the harvest job

    @tracer.capture_method
    def create_clip_record_detected(self, request: HarvestJobRequest) -> None:
        """Create a clip record for a detected key moment, independent of harvesting.

        The clip starts with status ``detected`` and no harvest-specific fields.
        Harvest metadata is linked later via ``link_harvest_to_clip`` if/when
        auto-harvesting runs.
        """
        try:
            start_dt = datetime.fromisoformat(request.start_time.replace('Z', '+00:00'))
            end_dt = datetime.fromisoformat(request.end_time.replace('Z', '+00:00'))
            duration = int((end_dt - start_dt).total_seconds())

            clip_item = {
                'id': request.clip_id,
                'name': request.metadata.get('tags', ['Detected Clip'])[0] if request.metadata.get('tags') else f'Detected Clip {request.clip_id}',
                'description': request.metadata.get('description', 'Auto-generated highlight from Inference'),
                'eventId': request.metadata.get('eventId', 'unknown'),
                'eventName': request.metadata.get('eventName', 'Unknown Event'),
                'startTime': int(start_dt.timestamp()),
                'endTime': int(end_dt.timestamp()),
                'duration': duration,
                'status': 'detected',
                'resolution': '1920x1080',
                'format': 'mp4',
                'mediaPackage': self.config.mediapackage_channel_group,
                'mediaLiveChannel': request.metadata.get('mediaLiveChannel', 'unknown'),
                'age': 0,
                'createdAt': datetime.utcnow().isoformat() + 'Z',
                'updatedAt': datetime.utcnow().isoformat() + 'Z',
                'inferenceDetectedAt': request.metadata.get('inferenceDetectedAt'),
                'tags': request.metadata.get('tags', ['inference', 'highlight', 'auto-generated']),
                'isHarvested': False,
            }

            self.clips_table.put_item(Item=clip_item)
            logger.info("Detected clip record created", extra={"clip_id": request.clip_id})
        except Exception as e:
            logger.error("Failed to create detected clip record",
                         extra={"error": str(e), "clip_id": request.clip_id})

    @tracer.capture_method
    def link_harvest_to_clip(self, clip_id: str, harvest_job: HarvestJob, request: HarvestJobRequest) -> None:
        """Link a harvest job to an existing clip record, transitioning it to ``processing``."""
        try:
            update_expr = 'SET #status = :status, isHarvested = :harvested, harvestJobId = :hjid, harvestMetadata = :hmeta, updatedAt = :now'
            expr_names = {'#status': 'status'}
            expr_values = {
                ':status': 'processing',
                ':harvested': True,
                ':hjid': harvest_job.job_id,
                ':hmeta': {
                    'harvestJobArn': harvest_job.harvest_job_arn,
                    'originEndpointId': request.origin_endpoint_id,
                    'harvestTimestamp': datetime.utcnow().isoformat() + 'Z',
                    'correlationId': request.correlation_id,
                },
                ':now': datetime.utcnow().isoformat() + 'Z',
            }

            if harvest_job.s3_location:
                update_expr += ', sourceKey = :sk'
                expr_values[':sk'] = harvest_job.s3_location

            self.clips_table.update_item(
                Key={'id': clip_id},
                UpdateExpression=update_expr,
                ExpressionAttributeNames=expr_names,
                ExpressionAttributeValues=expr_values,
            )
            logger.info("Harvest linked to clip", extra={"clip_id": clip_id, "harvest_job_id": harvest_job.job_id})
        except Exception as e:
            logger.error("Failed to link harvest to clip",
                         extra={"error": str(e), "clip_id": clip_id})

    @tracer.capture_method
    def find_associated_event(self, callback_metadata: Optional[str], correlation_id: str,
                              feed_arn: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Find the event associated with an Inference event.

        Resolution order:
        1. Feed ARN → Channel (via FeedArnIndex GSI) → active event for that channel
           (via MediaLiveChannelIndex GSI). This is the most reliable method because
           the feed ARN is always present on every Inference EventBridge event and
           uniquely identifies the channel.
        2. callbackMetadata → event name (via EventNameIndex GSI). This works when the
           auto-activate scheduler has updated the feed's callbackMetadata to the
           current event name.
        3. No match found → return None. We no longer use a channel-blind
           isActiveForStarfish scan, which could return events from the wrong channel.
        """
        try:
            # Method 1: Feed ARN → Channel → Active event (preferred)
            if feed_arn:
                logger.info("Resolving event via feed ARN → channel → active event", extra={
                    "feed_arn": feed_arn, "correlation_id": correlation_id,
                })
                channel_record = self.get_channel_by_feed_arn(feed_arn)
                if channel_record:
                    channel_id = channel_record.get('id')
                    event = self.find_active_event_for_channel(channel_id, correlation_id)
                    if event:
                        logger.info("Found event via feed ARN chain", extra={
                            "event_id": event.get('id'),
                            "event_name": event.get('name'),
                            "channel_id": channel_id,
                            "feed_arn": feed_arn,
                            "method": "feed_arn_chain",
                            "correlation_id": correlation_id,
                        })
                        return event
                    logger.info("Channel found by feed ARN but no active event", extra={
                        "channel_id": channel_id, "feed_arn": feed_arn,
                        "correlation_id": correlation_id,
                    })
                else:
                    logger.info("No channel found for feed ARN, falling back to callbackMetadata", extra={
                        "feed_arn": feed_arn, "correlation_id": correlation_id,
                    })

            # Method 2: callbackMetadata → event name query
            if callback_metadata:
                logger.info("Querying event by name using EventNameIndex GSI", extra={
                    "callback_metadata": callback_metadata, "correlation_id": correlation_id,
                })
                response = self.events_table.query(
                    IndexName='EventNameIndex',
                    KeyConditionExpression='#name = :name_val',
                    ExpressionAttributeNames={'#name': 'name'},
                    ExpressionAttributeValues={':name_val': callback_metadata},
                    Limit=1,
                )
                matching_events = response.get('Items', [])
                logger.info("Event name query results", extra={
                    "matching_count": len(matching_events),
                    "callback_metadata": callback_metadata,
                    "correlation_id": correlation_id,
                })
                if matching_events:
                    event = matching_events[0]
                    logger.info("Found event via callbackMetadata", extra={
                        "event_id": event.get('id'),
                        "event_name": event.get('name'),
                        "mediaLiveChannel": event.get('mediaLiveChannel'),
                        "method": "callbackMetadata_query",
                        "correlation_id": correlation_id,
                    })
                    return event

            logger.info("No event found using any method", extra={
                "feed_arn": feed_arn,
                "callback_metadata": callback_metadata,
                "correlation_id": correlation_id,
            })
            return None

        except Exception as e:
            logger.error("Failed to find event", extra={
                "error": str(e),
                "feed_arn": feed_arn,
                "callback_metadata": callback_metadata,
                "correlation_id": correlation_id,
            })
            return None


class HarvestPipelineService:
    """Main harvest pipeline service"""
    
    def __init__(self):
        self.config = HarvestPipelineConfig()
        self.mediapackage_service = MediaPackageV2Service(self.config)
        self.dynamodb_service = DynamoDBService(self.config)
    
    @tracer.capture_method
    def process_inference_event(self, event_data: Dict[str, Any], correlation_id: str) -> None:
        """Process Inference EventBridge event"""
        logger.info("Processing Inference event", extra={"event_id": event_data.get('id'), "correlation_id": correlation_id, "full_event": event_data})
        
        # Validate event structure
        logger.info("Step 1: Validating event structure", extra={"correlation_id": correlation_id})
        inference_event = self._validate_event_structure(event_data, correlation_id)
        logger.info("Event structure validated", extra={"source": inference_event.source, "detail_type": inference_event.detail_type, "correlation_id": correlation_id})
        
        # Check if event is harvestable
        logger.info("Step 2: Checking if event is harvestable", extra={"correlation_id": correlation_id})
        if not self._is_harvestable_event(inference_event, correlation_id):
            logger.info("Event is not harvestable, skipping", extra={"correlation_id": correlation_id})
            metrics.add_metric(name="EventBridgeHarvestProcessor.SkippedNonHarvestable", unit=MetricUnit.Count, value=1)
            return
        logger.info("Event is harvestable", extra={"startPts": inference_event.detail.get('startPts'), "endPts": inference_event.detail.get('endPts'), "timescale": inference_event.detail.get('timescale'), "correlation_id": correlation_id})
        
        # Find associated event using feed ARN → channel → event chain
        logger.info("Step 3: Finding associated event", extra={"correlation_id": correlation_id})

        # Extract feed ARN from EventBridge resources array
        resources = event_data.get('resources', [])
        feed_arn = resources[0] if resources else None
        callback_metadata = inference_event.detail.get('callbackMetadata')
        logger.info("Extracted event identifiers", extra={
            "feed_arn": feed_arn,
            "callback_metadata": callback_metadata,
            "correlation_id": correlation_id,
        })

        # Primary: feed ARN → channel → active event. Fallback: callbackMetadata → event name.
        associated_event = self.dynamodb_service.find_associated_event(
            callback_metadata,
            correlation_id,
            feed_arn=feed_arn,
        )

        # Resolve channel: prefer feed ARN lookup (gives us the channel record directly),
        # fall back to associated event's mediaLiveChannel
        channel_record = None
        channel_id = None
        if feed_arn:
            channel_record = self.dynamodb_service.get_channel_by_feed_arn(feed_arn)
            if channel_record:
                channel_id = channel_record.get('id')
        if not channel_id and associated_event:
            channel_id = associated_event.get('mediaLiveChannel')
            if channel_id:
                channel_record = self.dynamodb_service.get_channel_record(channel_id)

        logger.info("Event and channel resolution complete", extra={
            "found_event": associated_event is not None,
            "event_id": associated_event.get('id') if associated_event else None,
            "event_name": associated_event.get('name') if associated_event else None,
            "channel_id": channel_id,
            "has_channel_record": channel_record is not None,
            "correlation_id": correlation_id,
        })

        # Resolve per-channel MediaPackage configuration
        channel_config = self.config.resolve_for_channel(channel_record or {})
        logger.info("Channel config resolved", extra={
            "channel_id": channel_id,
            "channel_group": channel_config.channel_group,
            "channel_name": channel_config.channel_name,
            "correlation_id": correlation_id,
        })

        # Read system settings for harvest buffer
        logger.info("Step 4: Reading system settings", extra={"correlation_id": correlation_id})
        settings_table = os.environ.get('SYSTEM_SETTINGS_TABLE', '')
        auto_harvest = read_system_setting(settings_table, 'autoHarvest', 'false') if settings_table else 'false'
        harvest_buffer_seconds = int(read_system_setting(settings_table, 'harvestBufferSeconds', '0')) if settings_table else 0
        auto_harvest_enabled = auto_harvest == 'true'
        logger.info("System settings loaded", extra={
            "autoHarvest": auto_harvest,
            "harvest_buffer_seconds": harvest_buffer_seconds,
            "auto_harvest_enabled": auto_harvest_enabled,
            "correlation_id": correlation_id
        })

        # Always create a clip record for every detected key moment, regardless of harvest settings.
        # This decouples clip detection from harvesting — clips exist as "detected" even when
        # auto-harvesting is disabled, and can be harvested on-demand later.
        logger.info("Step 5: Creating clip record for detected key moment", extra={"correlation_id": correlation_id})
        clip_request = self._extract_harvest_request(inference_event, associated_event, correlation_id, channel_config, orientation='landscape')
        clip_id = clip_request.clip_id

        # Apply harvest buffer to get accurate start/end times for the clip record
        clip_request.start_time, clip_request.end_time = HarvestPipelineConfig.apply_harvest_buffer(
            clip_request.start_time, clip_request.end_time, harvest_buffer_seconds
        )

        self.dynamodb_service.create_clip_record_detected(clip_request)
        logger.info("Clip record created with status=detected", extra={"clip_id": clip_id, "correlation_id": correlation_id})

        if not auto_harvest_enabled:
            logger.info("Auto-harvesting is disabled for all orientations, clip created without harvest", extra={"clip_id": clip_id, "correlation_id": correlation_id})
            metrics.add_metric(name="EventBridgeHarvestProcessor.ClipCreatedNoHarvest", unit=MetricUnit.Count, value=1)
            return

        # Start AutoHarvest State Machine execution — harvesting is now handled by Step Functions
        autoharvest_sm_arn = os.environ.get('AUTOHARVEST_STATE_MACHINE_ARN', '')
        if not autoharvest_sm_arn:
            logger.error("AUTOHARVEST_STATE_MACHINE_ARN not configured, cannot start auto-harvest", extra={"clip_id": clip_id, "correlation_id": correlation_id})
            metrics.add_metric(name="EventBridgeHarvestProcessor.AutoHarvestMisconfigured", unit=MetricUnit.Count, value=1)
            return

        logger.info("Step 6: Starting AutoHarvest State Machine execution", extra={"clip_id": clip_id, "correlation_id": correlation_id})
        sfn_input = {
            "clipId": clip_id,
            "channelId": channel_id or clip_request.channel_id,
            "startTime": clip_request.start_time,
            "endTime": clip_request.end_time,
            "channelConfig": {
                "channelGroup": channel_config.channel_group,
                "channelName": channel_config.channel_name,
                "landscapeEndpoint": channel_config.landscape_endpoint,
                "verticalEndpoint": channel_config.vertical_endpoint,
            },
            "bucket": self.config.video_assets_bucket,
        }

        try:
            sfn_response = sfn_client.start_execution(
                stateMachineArn=autoharvest_sm_arn,
                input=json.dumps(sfn_input),
            )
            execution_arn = sfn_response['executionArn']
            logger.info("AutoHarvest State Machine execution started", extra={
                "clip_id": clip_id,
                "execution_arn": execution_arn,
                "correlation_id": correlation_id,
            })
            metrics.add_metric(name="EventBridgeHarvestProcessor.AutoHarvestStarted", unit=MetricUnit.Count, value=1)
        except Exception as e:
            logger.error("Failed to start AutoHarvest State Machine execution", extra={
                "error": str(e),
                "clip_id": clip_id,
                "state_machine_arn": autoharvest_sm_arn,
                "correlation_id": correlation_id,
            })
            metrics.add_metric(name="EventBridgeHarvestProcessor.AutoHarvestStartError", unit=MetricUnit.Count, value=1)
            raise

        metrics.add_metric(name="EventBridgeHarvestProcessor.Success", unit=MetricUnit.Count, value=1)
        logger.info("Clip detection and auto-harvest trigger complete",
                   extra={"clip_id": clip_id, "correlation_id": correlation_id})
    
    def _validate_event_structure(self, event_data: Dict[str, Any], correlation_id: str) -> InferenceEvent:
        """Validate EventBridge event structure"""
        if event_data.get('source') != 'aws.elemental-inference':
            raise InvalidEventDataError(
                f"Invalid event source: {event_data.get('source')}. Expected: aws.elemental-inference",
                correlation_id
            )
        
        if event_data.get('detail-type') != 'Clip Metadata Generated':
            raise InvalidEventDataError(
                f"Invalid detail type: {event_data.get('detail-type')}. Expected: Clip Metadata Generated",
                correlation_id
            )
        
        if not event_data.get('detail'):
            raise InvalidEventDataError("Event detail is missing", correlation_id)
        
        # Convert hyphenated keys to underscores for dataclass
        normalized_event = {
            'version': event_data.get('version'),
            'id': event_data.get('id'),
            'detail_type': event_data.get('detail-type'),
            'source': event_data.get('source'),
            'account': event_data.get('account'),
            'time': event_data.get('time'),
            'region': event_data.get('region'),
            'detail': event_data.get('detail')
        }
        
        return InferenceEvent(**normalized_event)
    
    def _is_harvestable_event(self, event: InferenceEvent, correlation_id: str) -> bool:
        """Check if event contains harvestable data"""
        detail = event.detail
        
        # Check required Inference fields
        required_fields = ['timescale', 'startPts', 'endPts']
        if not all(field in detail for field in required_fields):
            logger.debug("Event missing required Inference fields", extra={"correlation_id": correlation_id})
            return False
        
        # Validate PTS values
        if detail['startPts'] >= detail['endPts']:
            logger.debug("Invalid PTS range", extra={"correlation_id": correlation_id})
            return False
        
        # Validate timescale
        if detail['timescale'] <= 0:
            logger.debug("Invalid timescale", extra={"correlation_id": correlation_id})
            return False
        
        return True
    
    def _extract_harvest_request(self, event: InferenceEvent, associated_event: Optional[Dict[str, Any]], 
                                correlation_id: str, channel_config: Optional[ChannelConfig] = None, orientation: str = "landscape") -> HarvestJobRequest:
        """Extract harvest job request from Inference event"""
        detail = event.detail

        # Generate clip ID: full event ID + short UUID for uniqueness
        event_id = associated_event.get('id', 'unknown') if associated_event else 'unknown'
        short_uid = uuid.uuid4().hex[:8]
        clip_id = f"clip-{event_id}-{short_uid}"

        # Convert PTS to ISO time
        start_time, end_time = self._convert_pts_to_iso_time(event)

        # Build metadata
        metadata = {
            'title': detail.get('description', f"Highlight from {associated_event.get('name', 'Unknown Event') if associated_event else 'Unknown Event'}"),
            'description': detail.get('description', 'Auto-generated highlight from Inference'),
            'tags': detail.get('tags', ['inference', 'highlight', 'auto-generated']),
            'eventId': associated_event.get('id') if associated_event else 'unknown',
            'eventName': associated_event.get('name') if associated_event else 'Unknown Event',
            'mediaLiveChannel': associated_event.get('mediaLiveChannel') if associated_event else 'unknown',
            'inferenceDetectedAt': event.time,  # Inference event detection time
        }

        # Resolve channel ID: prefer associated event's mediaLiveChannel, fall back to Inference event detail
        channel_id = (associated_event.get('mediaLiveChannel') if associated_event else None) or detail.get('channelId', 'default-channel')

        return HarvestJobRequest(
            clip_id=clip_id,
            channel_id=channel_id,
            start_time=start_time,
            end_time=end_time,
            origin_endpoint_id=channel_config.get_origin_endpoint_for_orientation(orientation) if channel_config else self.config.get_origin_endpoint_for_orientation(orientation),
            metadata=metadata,
            correlation_id=correlation_id,
            orientation=orientation
        )
    
    def _convert_pts_to_iso_time(self, event: InferenceEvent) -> tuple[str, str]:
        """Convert epoch-aligned PTS timestamps to ISO 8601 format"""
        detail = event.detail
        
        logger.info("Converting PTS to ISO time", extra={
            "startPts": detail['startPts'],
            "endPts": detail['endPts'],
            "timescale": detail['timescale'],
            "event_time": event.time
        })
        
        # PTS values are epoch-aligned - divide by timescale to get Unix epoch seconds
        start_timestamp = detail['startPts'] / detail['timescale']
        end_timestamp = detail['endPts'] / detail['timescale']
        
        duration_seconds = end_timestamp - start_timestamp
        
        # Ensure minimum 5-second duration for all clips
        min_duration = 5
        if duration_seconds < min_duration:
            logger.info(f"Extending clip from {duration_seconds}s to {min_duration}s", extra={
                "original_duration": duration_seconds,
                "min_duration": min_duration
            })
            # Extend backwards from end time to maintain the actual highlight end
            start_timestamp = end_timestamp - min_duration
            duration_seconds = min_duration
        
        # Convert Unix timestamps to datetime objects
        start_time = datetime.utcfromtimestamp(start_timestamp)
        end_time = datetime.utcfromtimestamp(end_timestamp)
        
        # Format as ISO 8601
        start_time_iso = start_time.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
        end_time_iso = end_time.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
        
        logger.info("ISO timestamps calculated from epoch-aligned PTS", extra={
            "start_time": start_time_iso,
            "end_time": end_time_iso,
            "duration_seconds": duration_seconds,
            "NOTE": "All clips extended to minimum 5s duration for harvest reliability"
        })
        
        return start_time_iso, end_time_iso
    
    def _create_harvest_job(self, request: HarvestJobRequest, channel_config: Optional[ChannelConfig] = None) -> HarvestJob:
        """Create harvest job using orientation-aware endpoint and S3 prefix"""
        job_id = str(uuid.uuid4())

        try:
            # Wait for content to be available in MediaPackage
            logger.info("Checking content availability before creating harvest job", 
                       extra={"clip_id": request.clip_id, "correlation_id": request.correlation_id})

            content_available = self.mediapackage_service.wait_for_content_availability(
                request.start_time,
                request.end_time,
                request.correlation_id,
                manifest_url=channel_config.manifest_url if channel_config else None
            )

            if not content_available:
                raise HarvestJobCreationError(
                    f"Content not available after polling: {request.start_time} to {request.end_time}",
                    request.correlation_id
                )

            # Create MediaPackage V2 harvest job
            response = self.mediapackage_service.create_harvest_job(request, channel_config=channel_config)

            # Use orientation-aware S3 prefix
            s3_prefix = self.config.get_harvest_s3_prefix(
                request.channel_id, request.clip_id, orientation=request.orientation
            )

            # Create harvest job record
            harvest_job = HarvestJob(
                job_id=job_id,
                clip_id=request.clip_id,
                channel_id=request.channel_id,
                status=HarvestJobStatus.PENDING.value,
                created_at=datetime.utcnow().isoformat() + 'Z',
                updated_at=datetime.utcnow().isoformat() + 'Z',
                harvest_job_arn=response.get('Arn'),
                mediapackage_job_id=response.get('HarvestJobName'),
                s3_location=s3_prefix,
                orientation=request.orientation
            )

            return harvest_job

        except Exception as e:
            logger.error("Failed to create harvest job", extra={"error": str(e), "clip_id": request.clip_id})
            raise HarvestJobCreationError(f"Failed to create harvest job: {str(e)}", request.correlation_id)


# API Gateway handler for harvest jobs API
@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def api_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    AWS Lambda handler for API Gateway requests
    
    Args:
        event: API Gateway event data
        context: Lambda context
        
    Returns:
        API Gateway response
    """
    correlation_id = logger.get_correlation_id() or str(uuid.uuid4())
    
    try:
        # Parse the request
        http_method = event.get('httpMethod', event.get('requestContext', {}).get('http', {}).get('method', 'GET'))
        path = event.get('path', event.get('rawPath', ''))
        path_parameters = event.get('pathParameters') or {}
        query_parameters = event.get('queryStringParameters') or {}
        
        logger.info("Processing API request", 
                   extra={"method": http_method, "path": path, "correlation_id": correlation_id})
        
        # Initialize services
        config = HarvestPipelineConfig()
        dynamodb_service = DynamoDBService(config)
        
        # Route the request
        if path == '/api/harvest-jobs/trigger' and http_method == 'POST':
            body = json.loads(event.get('body', '{}')) if event.get('body') else {}
            return _handle_trigger_harvest(config, dynamodb_service, body, correlation_id)
        elif path == '/api/harvest-jobs' and http_method == 'GET':
            return _handle_list_harvest_jobs(dynamodb_service, query_parameters, correlation_id)
        elif path.startswith('/api/harvest-jobs/') and path.endswith('/clip-url') and http_method == 'GET':
            job_id = path_parameters.get('jobId')
            return _handle_get_clip_url(dynamodb_service, job_id, correlation_id)
        elif path.startswith('/api/harvest-jobs/') and http_method == 'GET':
            job_id = path_parameters.get('jobId')
            return _handle_get_harvest_job(dynamodb_service, job_id, correlation_id)
        else:
            return {
                'statusCode': 404,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': 'NOT_FOUND',
                    'message': 'Endpoint not found',
                    'correlationId': correlation_id
                })
            }
            
    except Exception as e:
        logger.error("API request failed", extra={"error": str(e), "correlation_id": correlation_id})
        metrics.add_metric(name="HarvestAPI.Error", unit=MetricUnit.Count, value=1)
        
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'INTERNAL_SERVER_ERROR',
                'message': 'An unexpected error occurred',
                'correlationId': correlation_id
            })
        }


def _handle_list_harvest_jobs(dynamodb_service: DynamoDBService, query_params: Dict[str, Any], 
                             correlation_id: str) -> Dict[str, Any]:
    """Handle GET /api/harvest-jobs"""
    try:
        # Get pagination parameters
        limit = int(query_params.get('limit', '20'))
        last_evaluated_key = query_params.get('lastEvaluatedKey')
        status_filter = query_params.get('status')
        
        # Query harvest jobs table
        scan_kwargs = {
            'Limit': min(limit, 100)  # Cap at 100
        }
        
        if last_evaluated_key:
            scan_kwargs['ExclusiveStartKey'] = {'job_id': last_evaluated_key}
        
        if status_filter:
            scan_kwargs['FilterExpression'] = '#status = :status'
            scan_kwargs['ExpressionAttributeNames'] = {'#status': 'status'}
            scan_kwargs['ExpressionAttributeValues'] = {':status': status_filter}
        
        response = dynamodb_service.harvest_jobs_table.scan(**scan_kwargs)
        
        items = response.get('Items', [])
        last_evaluated_key = response.get('LastEvaluatedKey', {}).get('job_id')
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'jobs': items,
                'lastEvaluatedKey': last_evaluated_key,
                'correlationId': correlation_id
            }, default=str)
        }
        
    except Exception as e:
        logger.error("Failed to list harvest jobs", extra={"error": str(e), "correlation_id": correlation_id})
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'INTERNAL_SERVER_ERROR',
                'message': 'Failed to list harvest jobs',
                'correlationId': correlation_id
            })
        }
def _handle_trigger_harvest(config: HarvestPipelineConfig, dynamodb_service: DynamoDBService,
                            body: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
    """Handle POST /api/harvest-jobs/trigger

    Accepts { clipId, orientation, channelId, startTime, endTime } and triggers
    an on-demand harvest for the specified orientation.
    """
    # Validate required fields
    required_fields = ['clipId', 'orientation', 'channelId', 'startTime', 'endTime']
    missing = [f for f in required_fields if not body.get(f)]
    if missing:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'BAD_REQUEST',
                'message': f'Missing required fields: {", ".join(missing)}',
                'correlationId': correlation_id
            })
        }

    orientation = body['orientation']
    if orientation not in ('landscape', 'portrait'):
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'BAD_REQUEST',
                'message': f"Invalid orientation: {orientation}. Must be 'landscape' or 'portrait'.",
                'correlationId': correlation_id
            })
        }

    try:
        mediapackage_service = MediaPackageV2Service(config)

        # Normalize timestamps: accept both epoch ints/floats and ISO strings
        raw_start = body['startTime']
        raw_end = body['endTime']
        if isinstance(raw_start, (int, float)):
            raw_start = datetime.utcfromtimestamp(raw_start).isoformat() + 'Z'
        if isinstance(raw_end, (int, float)):
            raw_end = datetime.utcfromtimestamp(raw_end).isoformat() + 'Z'

        request = HarvestJobRequest(
            clip_id=body['clipId'],
            channel_id=body['channelId'],
            start_time=raw_start,
            end_time=raw_end,
            origin_endpoint_id=config.get_origin_endpoint_for_orientation(orientation),
            metadata={'description': f'On-demand harvest for {body["clipId"]}'},
            correlation_id=correlation_id,
            orientation=orientation
        )

        # Apply harvest buffer from system settings
        settings_table = os.environ.get('SYSTEM_SETTINGS_TABLE', '')
        harvest_buffer_seconds = int(read_system_setting(settings_table, 'harvestBufferSeconds', '0')) if settings_table else 0
        request.start_time, request.end_time = HarvestPipelineConfig.apply_harvest_buffer(
            request.start_time, request.end_time, harvest_buffer_seconds
        )
        logger.info("Harvest buffer applied to on-demand harvest", extra={
            "clip_id": request.clip_id, "buffer_seconds": harvest_buffer_seconds,
            "start_time": request.start_time, "end_time": request.end_time,
            "correlation_id": correlation_id
        })

        # Wait for content availability then create the harvest job
        content_available = mediapackage_service.wait_for_content_availability(
            request.start_time, request.end_time, correlation_id
        )
        if not content_available:
            logger.warning("Content not yet available for on-demand harvest",
                          extra={"clip_id": request.clip_id, "correlation_id": correlation_id})

        response = mediapackage_service.create_harvest_job(request)

        s3_prefix = config.get_harvest_s3_prefix(
            request.channel_id, request.clip_id, orientation=orientation
        )

        job_id = str(uuid.uuid4())
        harvest_job = HarvestJob(
            job_id=job_id,
            clip_id=request.clip_id,
            channel_id=request.channel_id,
            status=HarvestJobStatus.PENDING.value,
            created_at=datetime.utcnow().isoformat() + 'Z',
            updated_at=datetime.utcnow().isoformat() + 'Z',
            harvest_job_arn=response.get('Arn'),
            mediapackage_job_id=response.get('HarvestJobName'),
            s3_location=s3_prefix,
            orientation=orientation
        )

        dynamodb_service.save_harvest_job(harvest_job)

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'jobId': job_id,
                'status': 'pending',
                'orientation': orientation,
                'correlationId': correlation_id
            })
        }

    except Exception as e:
        logger.error("Failed to trigger harvest", extra={"error": str(e), "correlation_id": correlation_id})
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'INTERNAL_SERVER_ERROR',
                'message': 'Failed to trigger harvest job',
                'correlationId': correlation_id
            })
        }




def _handle_get_harvest_job(dynamodb_service: DynamoDBService, job_id: str, 
                           correlation_id: str) -> Dict[str, Any]:
    """Handle GET /api/harvest-jobs/{jobId}"""
    if not job_id:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'BAD_REQUEST',
                'message': 'Job ID is required',
                'correlationId': correlation_id
            })
        }
    
    try:
        response = dynamodb_service.harvest_jobs_table.get_item(Key={'job_id': job_id})
        item = response.get('Item')
        
        if not item:
            return {
                'statusCode': 404,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': 'NOT_FOUND',
                    'message': f'Harvest job {job_id} not found',
                    'correlationId': correlation_id
                })
            }
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'job': item,
                'correlationId': correlation_id
            }, default=str)
        }
        
    except Exception as e:
        logger.error("Failed to get harvest job", 
                    extra={"error": str(e), "job_id": job_id, "correlation_id": correlation_id})
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'INTERNAL_SERVER_ERROR',
                'message': 'Failed to get harvest job',
                'correlationId': correlation_id
            })
        }


def _handle_get_clip_url(dynamodb_service: DynamoDBService, job_id: str, 
                        correlation_id: str) -> Dict[str, Any]:
    """Handle GET /api/harvest-jobs/{jobId}/clip-url"""
    if not job_id:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'BAD_REQUEST',
                'message': 'Job ID is required',
                'correlationId': correlation_id
            })
        }
    
    try:
        # Get harvest job
        response = dynamodb_service.harvest_jobs_table.get_item(Key={'job_id': job_id})
        item = response.get('Item')
        
        if not item:
            return {
                'statusCode': 404,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': 'NOT_FOUND',
                    'message': f'Harvest job {job_id} not found',
                    'correlationId': correlation_id
                })
            }
        
        # Check if job is completed and has S3 location
        if item.get('status') != HarvestJobStatus.COMPLETED.value:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': 'BAD_REQUEST',
                    'message': f'Harvest job {job_id} is not completed',
                    'status': item.get('status'),
                    'correlationId': correlation_id
                })
            }
        
        s3_location = item.get('s3_location')
        if not s3_location:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': 'BAD_REQUEST',
                    'message': f'No S3 location available for harvest job {job_id}',
                    'correlationId': correlation_id
                })
            }
        
        # Generate presigned URL
        bucket_name = dynamodb_service.config.video_assets_bucket
        # Assume the manifest file is at the S3 location + manifest name
        manifest_key = f"{s3_location}manifest.m3u8"
        
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': manifest_key},
            ExpiresIn=3600  # 1 hour
        )
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'clipUrl': presigned_url,
                's3Location': s3_location,
                'expiresIn': 3600,
                'correlationId': correlation_id
            })
        }
        
    except Exception as e:
        logger.error("Failed to get clip URL", 
                    extra={"error": str(e), "job_id": job_id, "correlation_id": correlation_id})
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'INTERNAL_SERVER_ERROR',
                'message': 'Failed to get clip URL',
                'correlationId': correlation_id
            })
        }


# EventBridge Lambda handler
@logger.inject_lambda_context(correlation_id_path=correlation_paths.EVENT_BRIDGE)
@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> None:
    """
    AWS Lambda handler for EventBridge harvest processor
    
    Args:
        event: EventBridge event data
        context: Lambda context
    """
    correlation_id = logger.get_correlation_id()
    
    logger.info("Lambda invoked", extra={
        "correlation_id": correlation_id,
        "function_name": context.function_name,
        "request_id": context.aws_request_id,
        "event_source": event.get('source'),
        "event_detail_type": event.get('detail-type')
    })
    
    try:
        # Initialize harvest pipeline service
        logger.info("Initializing harvest pipeline service", extra={"correlation_id": correlation_id})
        pipeline_service = HarvestPipelineService()
        logger.info("Harvest pipeline service initialized", extra={"correlation_id": correlation_id})
        
        # Process the event
        pipeline_service.process_inference_event(event, correlation_id)
        
        logger.info("Event processed successfully - Lambda execution complete", extra={"correlation_id": correlation_id})
        
    except InvalidEventDataError as e:
        logger.error("Invalid event data", extra={"error": str(e), "correlation_id": correlation_id, "error_type": "InvalidEventDataError"})
        metrics.add_metric(name="EventBridgeHarvestProcessor.InvalidEventError", unit=MetricUnit.Count, value=1)
        # Don't retry invalid events
        raise e
        
    except (HarvestJobCreationError, MediaPackageServiceError) as e:
        logger.error("Harvest job creation failed", extra={"error": str(e), "correlation_id": correlation_id, "error_type": type(e).__name__})
        metrics.add_metric(name="EventBridgeHarvestProcessor.HarvestJobCreationError", unit=MetricUnit.Count, value=1)
        # Retry these errors
        raise e
        
    except Exception as e:
        logger.error("Unexpected error", extra={"error": str(e), "correlation_id": correlation_id, "error_type": type(e).__name__, "traceback": True})
        metrics.add_metric(name="EventBridgeHarvestProcessor.UnexpectedError", unit=MetricUnit.Count, value=1)
        raise e


if __name__ == "__main__":
    # For local testing
    sample_event = {
        "version": "0",
        "id": "e80422f3-c38e-802c-e495-e3fb8b5c6c6d",
        "detail-type": "Clip Metadata Generated",
        "source": "aws.elemental-inference",
        "account": "123456789012",
        "time": "2025-09-26T20:00:00Z",
        "region": "us-west-2",
        "resources": ["myResource1"],
        "detail": {
            "timescale": 90000,
            "startPts": 158395072209000,
            "endPts": 158395072374000,
            "description": "Test highlight from Inference",
            "tags": ["celebration", "goal"],
            "channelId": "test-channel"
        }
    }
    
    class MockContext:
        aws_request_id = "test-request-id"
        function_name = "test-function"
        function_version = "1"
        invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test"
        memory_limit_in_mb = 512
        remaining_time_in_millis = 30000
    
    lambda_handler(sample_event, MockContext())