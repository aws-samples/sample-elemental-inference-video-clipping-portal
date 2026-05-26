#!/usr/bin/env python3
"""
MediaLive API Client

Wrapper for AWS Elemental MediaLive boto3 client with observability.
"""

import os
from typing import Dict, Any, Optional, List

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit

logger = Logger(service="medialive-api-client", child=True)
tracer = Tracer(service="medialive-api-client")
metrics = Metrics(namespace="MediaLiveAPIClient", service="medialive-api-client")


class MediaLiveAPIError(Exception):
    """Base exception for MediaLive API errors"""
    pass


class InputBusyError(MediaLiveAPIError):
    """
    Raised when DeleteInput is rejected because the input is still attached
    to a channel that is in DELETING state. Callers (the DeleteChannel state
    machine) can retry after waiting for the channel to fully delete.
    """
    pass


class MediaLiveClient:
    """Wrapper for MediaLive boto3 client"""
    
    def __init__(self, endpoint_url: str, region: str):
        """
        Initialize MediaLive client
        
        Args:
            endpoint_url: MediaLive API endpoint URL
            region: AWS region
        """
        self.endpoint_url = endpoint_url
        self.region = region
        
        self.client = boto3.client(
            'medialive',
            region_name=self.region,
            endpoint_url=self.endpoint_url
        )
    
    @tracer.capture_method
    def create_channel(self, name: str, input_attachments: Optional[List[Dict]] = None, 
                      destinations: Optional[List[Dict]] = None, encoder_settings: Optional[Dict] = None, 
                      channel_class: str = 'STANDARD', role_arn: Optional[str] = None, 
                      tags: Optional[Dict[str, str]] = None, **kwargs) -> Dict[str, Any]:
        """
        Create a MediaLive channel
        
        Args:
            name: Channel name
            input_attachments: List of input attachments
            destinations: List of output destinations
            encoder_settings: Encoder configuration
            channel_class: Channel class (STANDARD or SINGLE_PIPELINE)
            role_arn: IAM role ARN for the channel
            tags: Resource tags
            **kwargs: Additional parameters from service definition
            
        Returns:
            Channel creation response
        """
        try:
            logger.info(f"Creating MediaLive channel: {name}")
            
            request_params = {'Name': name}
            
            if input_attachments:
                request_params['InputAttachments'] = input_attachments
            if destinations:
                request_params['Destinations'] = destinations
            if encoder_settings:
                request_params['EncoderSettings'] = encoder_settings
            if channel_class:
                request_params['ChannelClass'] = channel_class
            if role_arn:
                request_params['RoleArn'] = role_arn
            if tags:
                request_params['Tags'] = tags
            
            # Add any additional parameters
            request_params.update(kwargs)
            
            logger.info(f"Request params being sent to boto3: {list(request_params.keys())}")
            
            response = self.client.create_channel(**request_params)
            
            metrics.add_metric(name="ChannelCreated", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully created channel: {response.get('Channel', {}).get('Id')}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to create channel: {error_code} - {error_message}")
            metrics.add_metric(name="ChannelCreateError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to create channel: {error_message}")
    
    @tracer.capture_method
    def update_channel(self, channel_id: str, name: Optional[str] = None, 
                      destinations: Optional[List[Dict]] = None, encoder_settings: Optional[Dict] = None,
                      input_attachments: Optional[List[Dict]] = None, 
                      role_arn: Optional[str] = None) -> Dict[str, Any]:
        """
        Update a MediaLive channel
        
        Args:
            channel_id: Channel ID to update
            name: New channel name
            destinations: New output destinations
            encoder_settings: New encoder configuration
            input_attachments: New input attachments
            role_arn: New IAM role ARN
            
        Returns:
            Channel update response
        """
        try:
            logger.info(f"Updating MediaLive channel: {channel_id}")
            
            request_params = {'ChannelId': channel_id}
            
            if name:
                request_params['Name'] = name
            if destinations:
                request_params['Destinations'] = destinations
            if encoder_settings:
                request_params['EncoderSettings'] = encoder_settings
            if input_attachments:
                request_params['InputAttachments'] = input_attachments
            if role_arn:
                request_params['RoleArn'] = role_arn
            
            response = self.client.update_channel(**request_params)
            
            metrics.add_metric(name="ChannelUpdated", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully updated channel: {channel_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to update channel {channel_id}: {error_code} - {error_message}")
            metrics.add_metric(name="ChannelUpdateError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to update channel: {error_message}")
    
    @tracer.capture_method
    def delete_channel(self, channel_id: str) -> Dict[str, Any]:
        """
        Delete a MediaLive channel
        
        Args:
            channel_id: Channel ID to delete
            
        Returns:
            Channel deletion response. Treats NotFoundException as success
            (idempotent — channel is already gone).
        """
        try:
            logger.info(f"Deleting MediaLive channel: {channel_id}")
            
            response = self.client.delete_channel(ChannelId=channel_id)
            
            metrics.add_metric(name="ChannelDeleted", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully deleted channel: {channel_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            if error_code in ("NotFoundException", "ResourceNotFoundException"):
                logger.info(f"Channel {channel_id} already deleted")
                metrics.add_metric(name="ChannelDeleteNotFound", unit=MetricUnit.Count, value=1)
                return {"alreadyDeleted": True}
            logger.error(f"Failed to delete channel {channel_id}: {error_code} - {error_message}")
            metrics.add_metric(name="ChannelDeleteError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to delete channel: {error_message}")
    
    @tracer.capture_method
    def start_channel(self, channel_id: str) -> Dict[str, Any]:
        """
        Start a MediaLive channel
        
        Args:
            channel_id: Channel ID to start
            
        Returns:
            Channel start response
        """
        try:
            logger.info(f"Starting MediaLive channel: {channel_id}")
            
            response = self.client.start_channel(ChannelId=channel_id)
            
            metrics.add_metric(name="ChannelStarted", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully started channel: {channel_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to start channel {channel_id}: {error_code} - {error_message}")
            metrics.add_metric(name="ChannelStartError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to start channel: {error_message}")
    
    @tracer.capture_method
    def stop_channel(self, channel_id: str) -> Dict[str, Any]:
        """
        Stop a MediaLive channel
        
        Args:
            channel_id: Channel ID to stop
            
        Returns:
            Channel stop response
        """
        try:
            logger.info(f"Stopping MediaLive channel: {channel_id}")
            
            response = self.client.stop_channel(ChannelId=channel_id)
            
            metrics.add_metric(name="ChannelStopped", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully stopped channel: {channel_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to stop channel {channel_id}: {error_code} - {error_message}")
            metrics.add_metric(name="ChannelStopError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to stop channel: {error_message}")
    
    @tracer.capture_method
    def create_input(self, name: Optional[str] = None, type: Optional[str] = None, 
                    destinations: Optional[List[Dict]] = None, sources: Optional[List[Dict]] = None, 
                    tags: Optional[Dict[str, str]] = None, **kwargs) -> Dict[str, Any]:
        """
        Create a MediaLive input
        
        Args:
            name: Input name
            type: Input type (e.g., 'RTMP_PUSH', 'RTP_PUSH', 'UDP_PUSH')
            destinations: Input destinations
            sources: Input sources  
            tags: Resource tags
            **kwargs: Additional parameters from service definition
            
        Returns:
            Input creation response
        """
        try:
            logger.info(f"Creating MediaLive input: {name}")
            
            request_params = {}
            
            if name:
                request_params['Name'] = name
            if type:
                request_params['Type'] = type
            if destinations:
                request_params['Destinations'] = destinations
            if sources:
                request_params['Sources'] = sources
            if tags:
                request_params['Tags'] = tags
            
            # Add any additional parameters
            request_params.update(kwargs)
            
            response = self.client.create_input(**request_params)
            
            metrics.add_metric(name="InputCreated", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully created input: {response.get('Input', {}).get('Id')}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to create input: {error_code} - {error_message}")
            metrics.add_metric(name="InputCreateError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to create input: {error_message}")
    
    @tracer.capture_method
    def update_input(self, input_id: str, name: Optional[str] = None,
                    destinations: Optional[List[Dict]] = None, sources: Optional[List[Dict]] = None) -> Dict[str, Any]:
        """
        Update a MediaLive input
        
        Args:
            input_id: Input ID to update
            name: New input name
            destinations: New input destinations
            sources: New input sources
            
        Returns:
            Input update response
        """
        try:
            logger.info(f"Updating MediaLive input: {input_id}")
            
            request_params = {'InputId': input_id}
            
            if name:
                request_params['Name'] = name
            if destinations:
                request_params['Destinations'] = destinations
            if sources:
                request_params['Sources'] = sources
            
            response = self.client.update_input(**request_params)
            
            metrics.add_metric(name="InputUpdated", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully updated input: {input_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to update input {input_id}: {error_code} - {error_message}")
            metrics.add_metric(name="InputUpdateError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to update input: {error_message}")
    
    @tracer.capture_method
    def delete_input(self, input_id: str) -> Dict[str, Any]:
        """
        Delete a MediaLive input
        
        Args:
            input_id: Input ID to delete
            
        Returns:
            Input deletion response. Treats NotFoundException as success
            (idempotent — input is already gone). Raises a distinct
            ``InputBusyError`` when the input is still attached to a channel
            so callers (the DeleteChannel state machine) can retry.
        """
        try:
            logger.info(f"Deleting MediaLive input: {input_id}")
            
            response = self.client.delete_input(InputId=input_id)
            
            metrics.add_metric(name="InputDeleted", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully deleted input: {input_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            if error_code in ("NotFoundException", "ResourceNotFoundException"):
                logger.info(f"Input {input_id} already deleted")
                metrics.add_metric(name="InputDeleteNotFound", unit=MetricUnit.Count, value=1)
                return {"alreadyDeleted": True}
            # MediaLive returns 400 BadRequestException with the message
            # "Input <id> is busy, it cannot be deleted" while the channel
            # that referenced it is still in DELETING state.
            if "is busy" in error_message:
                logger.warning(f"Input {input_id} is still attached: {error_message}")
                metrics.add_metric(name="InputDeleteBusy", unit=MetricUnit.Count, value=1)
                raise InputBusyError(f"Input is busy: {error_message}")
            logger.error(f"Failed to delete input {input_id}: {error_code} - {error_message}")
            metrics.add_metric(name="InputDeleteError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to delete input: {error_message}")
    
    @tracer.capture_method
    @tracer.capture_method
    def describe_channel(self, channel_id: str) -> Dict[str, Any]:
        """
        Describe a MediaLive channel
        
        Args:
            channel_id: Channel ID to describe
            
        Returns:
            Channel description response with an added ``channelExists`` flag.
            Returns ``{"channelExists": False}`` when the channel no longer exists
            (NotFoundException) so callers — notably the DeleteChannel state
            machine, which polls until the channel is fully deleted — can branch
            on a clean signal instead of catching an error.
        """
        try:
            logger.info(f"Describing MediaLive channel: {channel_id}")
            
            response = self.client.describe_channel(ChannelId=channel_id)
            
            metrics.add_metric(name="ChannelDescribed", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully described channel: {channel_id}")
            
            response["channelExists"] = True
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            if error_code in ("NotFoundException", "ResourceNotFoundException"):
                logger.info(f"Channel {channel_id} not found (already deleted)")
                metrics.add_metric(name="ChannelDescribeNotFound", unit=MetricUnit.Count, value=1)
                return {"channelExists": False}
            logger.error(f"Failed to describe channel {channel_id}: {error_code} - {error_message}")
            metrics.add_metric(name="ChannelDescribeError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to describe channel: {error_message}")
    
    @tracer.capture_method
    def describe_input(self, input_id: str) -> Dict[str, Any]:
        """
        Describe a MediaLive input
        
        Args:
            input_id: Input ID to describe
            
        Returns:
            Input description response
        """
        try:
            logger.info(f"Describing MediaLive input: {input_id}")
            
            response = self.client.describe_input(InputId=input_id)
            
            metrics.add_metric(name="InputDescribed", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully described input: {input_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to describe input {input_id}: {error_code} - {error_message}")
            metrics.add_metric(name="InputDescribeError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to describe input: {error_message}")

    @tracer.capture_method
    def describe_thumbnails(self, channel_id: str, pipeline_id: str = "0",
                           thumbnail_type: str = "CURRENT_ACTIVE") -> Dict[str, Any]:
        """
        Describe thumbnails for a MediaLive channel
        
        Args:
            channel_id: Channel ID
            pipeline_id: Pipeline ID (default "0")
            thumbnail_type: Thumbnail type (default "CURRENT_ACTIVE")
            
        Returns:
            Thumbnails response
        """
        try:
            logger.info(f"Describing thumbnails for channel: {channel_id}")
            
            response = self.client.describe_thumbnails(
                ChannelId=channel_id,
                PipelineId=pipeline_id,
                ThumbnailType=thumbnail_type
            )
            
            metrics.add_metric(name="ThumbnailsDescribed", unit=MetricUnit.Count, value=1)
            logger.info(f"Successfully described thumbnails for channel: {channel_id}")
            
            return response
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            logger.error(f"Failed to describe thumbnails for {channel_id}: {error_code} - {error_message}")
            metrics.add_metric(name="ThumbnailsDescribeError", unit=MetricUnit.Count, value=1)
            raise MediaLiveAPIError(f"Failed to describe thumbnails: {error_message}")
