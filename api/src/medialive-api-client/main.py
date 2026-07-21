#!/usr/bin/env python3
"""
MediaLive API Client Lambda Function

This Lambda function provides a wrapper around the MediaLive API to enable
other AWS services to interact with the MediaLive service.

Supported operations:
- create_channel: Create a new MediaLive channel
- update_channel: Update an existing channel
- delete_channel: Delete a channel
- start_channel: Start a channel
- stop_channel: Stop a channel
- create_input: Create a new input
- update_input: Update an existing input
- delete_input: Delete an input
"""

import os
import json
from typing import Dict, Any
from datetime import datetime
import boto3

from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

from medialive_client import MediaLiveClient, MediaLiveAPIError, InputBusyError
from smart_subtitles import apply_smart_subtitles
from models import (
    CreateChannelRequest, UpdateChannelRequest, DeleteChannelRequest,
    StartChannelRequest, StopChannelRequest, CreateInputRequest,
    UpdateInputRequest, DeleteInputRequest, DescribeChannelRequest,
    DescribeInputRequest
)

# Initialize AWS Lambda Powertools
logger = Logger(service="medialive-api-client")
tracer = Tracer(service="medialive-api-client")
metrics = Metrics(namespace="MediaLiveAPIClient", service="medialive-api-client")

# Get configuration from environment variables
MEDIALIVE_API_ENDPOINT = os.environ.get('MEDIALIVE_API_ENDPOINT', '')
MEDIALIVE_SERVICE_ROLE_ARN = os.environ.get('MEDIALIVE_SERVICE_ROLE_ARN', '')
AWS_REGION = os.environ.get('AWS_REGION', 'us-west-2')
CHANNELS_TABLE_NAME = os.environ.get('CHANNELS_TABLE_NAME', '')
MANIFEST_URL = os.environ.get('MANIFEST_URL', '')
LANDSCAPE_MANIFEST_URL = os.environ.get('LANDSCAPE_MANIFEST_URL', '')
VERTICAL_MANIFEST_URL = os.environ.get('VERTICAL_MANIFEST_URL', '')

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    AWS Lambda handler for MediaLive API client operations
    
    Args:
        event: Lambda event containing:
            - action: Operation to perform
            - params: Parameters for the operation
        context: Lambda context
        
    Returns:
        Response with statusCode and body containing data or error
    """
    logger.info("Received event", extra={"event": event})
    
    try:
        # Validate event structure
        if 'action' not in event:
            return error_response("Missing 'action' in request", 400)
        
        action = event['action']
        params = event.get('params', {})
        
        # Validate configuration
        if not MEDIALIVE_API_ENDPOINT:
            return error_response("MEDIALIVE_API_ENDPOINT not configured", 500)
        
        # Initialize MediaLive client
        medialive_client = MediaLiveClient(endpoint_url=MEDIALIVE_API_ENDPOINT, region=AWS_REGION)
        
        # Route to appropriate handler
        if action == 'create_channel':
            return handle_create_channel(medialive_client, params)
        elif action == 'update_channel':
            return handle_update_channel(medialive_client, params)
        elif action == 'delete_channel':
            return handle_delete_channel(medialive_client, params)
        elif action == 'start_channel':
            return handle_start_channel(medialive_client, params)
        elif action == 'stop_channel':
            return handle_stop_channel(medialive_client, params)
        elif action == 'describe_channel':
            return handle_describe_channel(medialive_client, params)
        elif action == 'create_input':
            return handle_create_input(medialive_client, params)
        elif action == 'update_input':
            return handle_update_input(medialive_client, params)
        elif action == 'delete_input':
            return handle_delete_input(medialive_client, params)
        elif action == 'describe_input':
            return handle_describe_input(medialive_client, params)
        elif action == 'describe_thumbnails':
            return handle_describe_thumbnails(medialive_client, params)
        else:
            return error_response(f"Unknown action: {action}", 400)
            
    except ValueError as e:
        logger.error(f"Configuration error: {str(e)}")
        return error_response(f"Configuration error: {str(e)}", 500)
    except InputBusyError as e:
        # Input still attached to a channel that is in DELETING state.
        # Surface a distinct errorType so the DeleteChannel state machine
        # can catch on it and retry after waiting.
        logger.warning(f"Input busy: {str(e)}")
        raise
    except MediaLiveAPIError as e:
        logger.error(f"MediaLive API error: {str(e)}")
        return error_response(str(e), 502)
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        metrics.add_metric(name="UnexpectedError", unit=MetricUnit.Count, value=1)
        return error_response(f"Internal error: {str(e)}", 500)


def handle_create_channel(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle create_channel operation"""
    try:
        # Use environment variable for RoleArn if not provided
        if 'RoleArn' not in params or not params['RoleArn']:
            params['RoleArn'] = MEDIALIVE_SERVICE_ROLE_ARN

        # Pop the Smart Subtitles config (not a MediaLive API field) before building
        # the request, then merge the caption selector/description/output into the
        # channel definition. Idempotent no-op when subtitles is absent/disabled.
        subtitles = params.pop('subtitles', None) or params.pop('Subtitles', None)
        input_attachments = params.get('InputAttachments') or params.get('input_attachments')
        encoder_settings = params.get('EncoderSettings') or params.get('encoder_settings')
        input_attachments, encoder_settings = apply_smart_subtitles(
            input_attachments, encoder_settings, subtitles
        )

        # Support both PascalCase (from channels Lambda) and snake_case params
        request = CreateChannelRequest(
            name=params.get('Name') or params.get('name'),
            input_attachments=input_attachments,
            destinations=params.get('Destinations') or params.get('destinations'),
            encoder_settings=encoder_settings,
            channel_class=params.get('ChannelClass') or params.get('channel_class', 'STANDARD'),
            role_arn=params.get('RoleArn') or params.get('role_arn'),
            tags=params.get('Tags') or params.get('tags')
        )
        
        # Collect extra kwargs (PascalCase keys not in the standard set)
        standard_keys = {
            'Name', 'name', 'InputAttachments', 'input_attachments',
            'Destinations', 'destinations', 'EncoderSettings', 'encoder_settings',
            'ChannelClass', 'channel_class', 'RoleArn', 'role_arn', 'Tags', 'tags',
            'subtitles', 'Subtitles'
        }
        extra_kwargs = {k: v for k, v in params.items() if k not in standard_keys}
        
        response = client.create_channel(
            name=request.name,
            input_attachments=request.input_attachments,
            destinations=request.destinations,
            encoder_settings=request.encoder_settings,
            channel_class=request.channel_class,
            role_arn=request.role_arn,
            tags=request.tags,
            **extra_kwargs
        )
        
        # Write channel record to DynamoDB
        if CHANNELS_TABLE_NAME and response.get('Channel', {}).get('Id'):
            try:
                channels_table = dynamodb.Table(CHANNELS_TABLE_NAME)
                timestamp = datetime.utcnow().isoformat() + 'Z'
                channel_data = response['Channel']
                
                channels_table.put_item(
                    Item={
                        'id': channel_data['Id'],
                        'name': channel_data.get('Name', params.get('Name', '')),
                        'region': AWS_REGION,
                        'configuration': params,
                        'manifestUrl': MANIFEST_URL,
                        'landscapeManifestUrl': LANDSCAPE_MANIFEST_URL,
                        'verticalManifestUrl': VERTICAL_MANIFEST_URL,
                        'createdAt': timestamp,
                        'updatedAt': timestamp
                    }
                )
                logger.info(f"Created channel record in DynamoDB: {channel_data['Id']}")
            except Exception as e:
                logger.error(f"Failed to write channel to DynamoDB: {str(e)}")
                # Don't fail the request if DynamoDB write fails
        
        return success_response({'channel': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_update_channel(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle update_channel operation"""
    try:
        if 'channel_id' not in params:
            return error_response("Missing required parameter: channel_id", 400)
        
        request = UpdateChannelRequest(
            channel_id=params['channel_id'],
            name=params.get('name'),
            destinations=params.get('destinations'),
            encoder_settings=params.get('encoder_settings'),
            input_attachments=params.get('input_attachments'),
            role_arn=params.get('role_arn')
        )
        
        response = client.update_channel(
            channel_id=request.channel_id,
            name=request.name,
            destinations=request.destinations,
            encoder_settings=request.encoder_settings,
            input_attachments=request.input_attachments,
            role_arn=request.role_arn
        )
        
        return success_response({'channel': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_delete_channel(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle delete_channel operation"""
    try:
        if 'channel_id' not in params:
            return error_response("Missing required parameter: channel_id", 400)
        
        request = DeleteChannelRequest(channel_id=params['channel_id'])
        
        response = client.delete_channel(channel_id=request.channel_id)
        
        # Delete channel record from DynamoDB
        if CHANNELS_TABLE_NAME:
            try:
                channels_table = dynamodb.Table(CHANNELS_TABLE_NAME)
                channels_table.delete_item(
                    Key={'id': request.channel_id}
                )
                logger.info(f"Deleted channel record from DynamoDB: {request.channel_id}")
            except Exception as e:
                logger.error(f"Failed to delete channel from DynamoDB: {str(e)}")
                # Don't fail the request if DynamoDB delete fails
        
        return success_response({'channel': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_start_channel(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle start_channel operation"""
    try:
        if 'channel_id' not in params:
            return error_response("Missing required parameter: channel_id", 400)
        
        request = StartChannelRequest(channel_id=params['channel_id'])
        
        response = client.start_channel(channel_id=request.channel_id)
        
        return success_response({'channel': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_stop_channel(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle stop_channel operation"""
    try:
        if 'channel_id' not in params:
            return error_response("Missing required parameter: channel_id", 400)
        
        request = StopChannelRequest(channel_id=params['channel_id'])
        
        response = client.stop_channel(channel_id=request.channel_id)
        
        return success_response({'channel': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_create_input(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle create_input operation"""
    try:
        # Support both PascalCase (from channels Lambda) and snake_case params
        request = CreateInputRequest(
            name=params.get('Name') or params.get('name'),
            type=params.get('Type') or params.get('type'),
            destinations=params.get('Destinations') or params.get('destinations'),
            sources=params.get('Sources') or params.get('sources'),
            tags=params.get('Tags') or params.get('tags')
        )
        
        standard_keys = {
            'Name', 'name', 'Type', 'type', 'Destinations', 'destinations',
            'Sources', 'sources', 'Tags', 'tags'
        }
        extra_kwargs = {k: v for k, v in params.items() if k not in standard_keys}
        
        response = client.create_input(
            name=request.name,
            type=request.type,
            destinations=request.destinations,
            sources=request.sources,
            tags=request.tags,
            **extra_kwargs
        )
        
        return success_response({'input': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_update_input(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle update_input operation"""
    try:
        if 'input_id' not in params:
            return error_response("Missing required parameter: input_id", 400)
        
        request = UpdateInputRequest(
            input_id=params['input_id'],
            name=params.get('name'),
            destinations=params.get('destinations'),
            sources=params.get('sources')
        )
        
        response = client.update_input(
            input_id=request.input_id,
            name=request.name,
            destinations=request.destinations,
            sources=request.sources
        )
        
        return success_response({'input': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_delete_input(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle delete_input operation"""
    try:
        if 'input_id' not in params:
            return error_response("Missing required parameter: input_id", 400)
        
        request = DeleteInputRequest(input_id=params['input_id'])
        
        response = client.delete_input(input_id=request.input_id)
        
        return success_response({'input': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_describe_channel(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle describe_channel operation"""
    try:
        if 'channel_id' not in params:
            return error_response("Missing required parameter: channel_id", 400)
        
        request = DescribeChannelRequest(channel_id=params['channel_id'])
        
        response = client.describe_channel(channel_id=request.channel_id)
        
        return success_response({'channel': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_describe_input(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle describe_input operation"""
    try:
        if 'input_id' not in params:
            return error_response("Missing required parameter: input_id", 400)
        
        request = DescribeInputRequest(input_id=params['input_id'])
        
        response = client.describe_input(input_id=request.input_id)
        
        return success_response({'input': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def handle_describe_thumbnails(client: MediaLiveClient, params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle describe_thumbnails operation"""
    try:
        if 'channel_id' not in params:
            return error_response("Missing required parameter: channel_id", 400)
        
        pipeline_id = params.get('pipeline_id', '0')
        thumbnail_type = params.get('thumbnail_type', 'CURRENT_ACTIVE')
        
        response = client.describe_thumbnails(
            channel_id=params['channel_id'],
            pipeline_id=pipeline_id,
            thumbnail_type=thumbnail_type
        )
        
        return success_response({'thumbnails': response})
    except (TypeError, ValueError) as e:
        return error_response(f"Invalid request parameters: {str(e)}", 400)


def success_response(data: Dict[str, Any]) -> Dict[str, Any]:
    """Format successful response"""
    return {
        'statusCode': 200,
        'body': json.dumps(data, default=str)
    }


def error_response(message: str, status_code: int = 500) -> Dict[str, Any]:
    """Format error response"""
    return {
        'statusCode': status_code,
        'body': json.dumps({
            'error': message
        })
    }
