#!/usr/bin/env python3
"""
MediaLive API Request Models

Dataclasses representing request structures for MediaLive API operations.
Based on AWS Elemental MediaLive service definitions.
"""

from dataclasses import dataclass
from typing import Optional, Dict, List


@dataclass
class CreateChannelRequest:
    """Request structure for create_channel operation"""
    name: str
    input_attachments: Optional[List[Dict]] = None
    destinations: Optional[List[Dict]] = None
    encoder_settings: Optional[Dict] = None
    channel_class: str = 'STANDARD'
    role_arn: Optional[str] = None
    tags: Optional[Dict[str, str]] = None


@dataclass
class UpdateChannelRequest:
    """Request structure for update_channel operation"""
    channel_id: str
    name: Optional[str] = None
    destinations: Optional[List[Dict]] = None
    encoder_settings: Optional[Dict] = None
    input_attachments: Optional[List[Dict]] = None
    role_arn: Optional[str] = None


@dataclass
class DeleteChannelRequest:
    """Request structure for delete_channel operation"""
    channel_id: str


@dataclass
class StartChannelRequest:
    """Request structure for start_channel operation"""
    channel_id: str


@dataclass
class StopChannelRequest:
    """Request structure for stop_channel operation"""
    channel_id: str


@dataclass
class CreateInputRequest:
    """Request structure for create_input operation"""
    name: Optional[str] = None
    type: Optional[str] = None
    destinations: Optional[List[Dict]] = None
    sources: Optional[List[Dict]] = None
    tags: Optional[Dict[str, str]] = None


@dataclass
class UpdateInputRequest:
    """Request structure for update_input operation"""
    input_id: str
    name: Optional[str] = None
    destinations: Optional[List[Dict]] = None
    sources: Optional[List[Dict]] = None


@dataclass
class DeleteInputRequest:
    """Request structure for delete_input operation"""
    input_id: str


@dataclass
class DescribeChannelRequest:
    """Request structure for describe_channel operation"""
    channel_id: str


@dataclass
class DescribeInputRequest:
    """Request structure for describe_input operation"""
    input_id: str
