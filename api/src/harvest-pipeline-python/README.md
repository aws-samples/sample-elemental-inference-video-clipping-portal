# Video Harvesting Pipeline - Python Implementation

This is a Python implementation of the video harvesting pipeline that automatically captures live video clips from AWS MediaLive channels through MediaPackage V2 integration.

## Overview

The pipeline processes EventBridge notifications from Starfish (highlight metadata generation service), creates harvest jobs in MediaPackage V2, and stores the resulting clips in S3 while automatically integrating them with the existing clips management system.

## Architecture

- **EventBridge Handler**: Processes Starfish highlight metadata events
- **MediaPackage V2 Service**: Creates and manages harvest jobs
- **DynamoDB Integration**: Stores harvest job status and creates clip records
- **S3 Storage**: Organized storage for harvested video clips
- **API Gateway**: REST endpoints for harvest job management
- **Monitoring**: CloudWatch metrics, alarms, and dashboards

## Key Features

- ✅ **Event-driven processing** with EventBridge integration
- ✅ **Resilience patterns** with circuit breaker and retry logic
- ✅ **AWS Lambda Powertools** for observability (logging, metrics, tracing)
- ✅ **Comprehensive error handling** with custom exception classes
- ✅ **Dead letter queue** for failed events
- ✅ **CloudWatch monitoring** with alarms and dashboards
- ✅ **REST API** for harvest job management
- ✅ **Automatic clips integration** with existing system

## Files

- `main.py` - Main Lambda function with all functionality
- `requirements.txt` - Python dependencies
- `README.md` - This documentation

## Environment Variables

### Required
- `VIDEO_ASSETS_BUCKET` - S3 bucket for video assets
- `HARVEST_JOBS_TABLE_NAME` - DynamoDB table for harvest jobs
- `CLIPS_TABLE` - DynamoDB table for clips
- `EVENTS_TABLE` - DynamoDB table for events
- `MEDIAPACKAGE_CHANNEL_GROUP` - MediaPackage V2 channel group
- `MEDIALIVE_CHANNEL_NAME` - MediaLive channel name
- `MEDIAPACKAGE_ORIGIN_ENDPOINT_ID` - Origin endpoint ID
- `AWS_STACK_NAME` - Stack name for resource naming

### Optional
- `EVENT_ASSOCIATION_TIME_WINDOW_MINUTES` - Time window for event association (default: 30)
- `MAX_RETRIES` - Maximum retry attempts (default: 3)
- `BASE_DELAY` - Base delay for exponential backoff (default: 1.0)
- `MAX_DELAY` - Maximum delay for exponential backoff (default: 10.0)
- `BACKOFF_MULTIPLIER` - Backoff multiplier (default: 2.0)

## Event Processing

The pipeline processes EventBridge events with the following structure:

```json
{
  "version": "0",
  "id": "event-id",
  "detail-type": "Highlight Metadata Generated",
  "source": "aws.starfish-test",
  "time": "2025-09-26T20:00:00Z",
  "detail": {
    "timescale": 90000,
    "startPts": 158395072209000,
    "endPts": 158395072374000,
    "description": "Test highlight",
    "tags": ["celebration", "goal"],
    "channelId": "test-channel"
  }
}
```

## API Endpoints

### GET /api/harvest-jobs
List harvest jobs with pagination support.

**Query Parameters:**
- `limit` - Number of jobs to return (max 100, default 20)
- `lastEvaluatedKey` - Pagination token
- `status` - Filter by job status

### GET /api/harvest-jobs/{jobId}
Get details for a specific harvest job.

### GET /api/harvest-jobs/{jobId}/clip-url
Get a presigned S3 URL for the harvested clip (only for completed jobs).

## Deployment

The Python harvest pipeline is deployed automatically as part of the main CDK stack:

```bash
cd deploy
npm run deploy
```

This creates:
1. **Lambda Layer** with Python dependencies
2. **EventBridge Processor Lambda** for processing Starfish events
3. **API Lambda** for REST endpoints
4. **EventBridge Rule** for Starfish events
5. **Dead Letter Queue** for failed events
6. **SNS Topic** for alerts
7. **CloudWatch Alarms** and Dashboard
8. **API Gateway Routes** for harvest management

## Monitoring

### CloudWatch Metrics
- Function invocations and errors
- Function duration
- Custom business metrics
- Dead letter queue messages

### CloudWatch Alarms
- Function errors
- High duration warnings
- Dead letter queue messages

### CloudWatch Dashboard
- Function performance metrics
- Dead letter queue status
- Custom business metrics

## Error Handling

### Exception Types
- `InvalidEventDataError` - Invalid EventBridge event data
- `HarvestJobCreationError` - MediaPackage V2 harvest job creation failures
- `MediaPackageServiceError` - General MediaPackage service errors
- `CircuitBreakerError` - Circuit breaker open state

### Resilience Patterns
- **Circuit Breaker** - Prevents cascading failures
- **Exponential Backoff** - Smart retry with jitter
- **Dead Letter Queue** - Failed event handling
- **Structured Logging** - Comprehensive observability

## Local Testing

The main.py file includes a sample event for local testing:

```python
python main.py
```

This will process a sample Starfish event locally (requires AWS credentials and environment variables).

## Integration with Existing System

Harvested clips are automatically integrated with the existing clips management system:

1. **Immediate Clip Creation** - Clips appear with "processing" status
2. **Event Association** - Links clips to existing events when possible
3. **S3 Organization** - Uses consistent S3 prefix structure
4. **Metadata Preservation** - Maintains Starfish metadata for traceability
5. **Status Updates** - Updates clip status as harvest progresses

## S3 Organization

Harvested clips are stored with the following structure:

```
videoAssetsBucket/
├── harvested-clips/
│   ├── {channelId}/
│   │   ├── {YYYY-MM-DD}/
│   │   │   ├── {clipId}/
│   │   │   │   ├── manifest.m3u8
│   │   │   │   ├── segment_001.ts
│   │   │   │   └── ...
```

## Dependencies

Key Python dependencies:
- `boto3` - AWS SDK
- `aws-lambda-powertools` - Observability and best practices
- `dataclasses-json` - Data serialization
- `tenacity` - Retry utilities

See `requirements.txt` for the complete list.