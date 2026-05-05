/**
 * Channel Management Type Definitions
 * 
 * This file contains TypeScript interfaces and types for the channel management feature.
 * These types define the structure of channel records, form states, API requests/responses,
 * and encoder settings matching the MediaLive API format.
 * 
 * Validates Requirements: 2.1-2.6, 9.1-9.3, 16.2-16.5
 */

import { STANDARD_ENCODER_SETTINGS } from '../config/encoderSettings';

// ============================================================================
// Channel Records and Status
// ============================================================================

/**
 * Channel record structure as stored in DynamoDB
 * Matches the schema defined in Requirements 16.2-16.5
 */
export interface ChannelRecord {
  id: string;                    // Partition key - MediaLive Channel ID
  name: string;                  // User-provided channel name
  region: string;                // AWS region
  configuration: string;         // JSON string of complete channel config
  manifestUrl?: string;          // Main HLS manifest URL
  landscapeManifestUrl?: string; // Landscape variant manifest URL
  verticalManifestUrl?: string;  // Vertical variant manifest URL
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
  provisioningStatus?: string;   // CREATING | ACTIVE | FAILED | DELETING
  provisioningError?: string;    // Error message if provisioningStatus is FAILED
}

/**
 * Channel state as returned by MediaLive API
 * Represents the operational status of a MediaLive channel
 */
export type ChannelState = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED';

/**
 * Channel with current operational status
 * Used for display in the Channels Page
 * Validates Requirements: 9.1-9.3
 */
export interface ChannelWithStatus extends ChannelRecord {
  state: ChannelState;           // Current operational state from MediaLive
  thumbnailUrl?: string;         // Thumbnail URL for running channels
}

// ============================================================================
// Form State and Validation
// ============================================================================

/**
 * Input type options for MediaLive inputs
 * Initially supports MP4_FILE only (Requirement 2.10)
 * Designed to accommodate future input types (Requirement 2.11)
 */
export type InputType = 'MP4_FILE' | 'RTMP_PUSH' | 'RTMP_PULL' | 'RTP_PUSH' | 'UDP_PUSH';

/**
 * Form state for Create Channel Modal
 * Validates Requirements: 2.1-2.6
 */
export interface ChannelFormState {
  channelName: string;           // Required - Channel name (Requirement 2.1)
  inputType: {                   // Required - Input type selector (Requirement 2.2)
    label: string;
    value: InputType;
  };
  inputUrl: string;              // Required - S3 URL for input source (Requirement 2.3)
  inputName: string;             // Required - Name for the MediaLive input (Requirement 2.4)
}

/**
 * Validation errors for form fields
 */
export interface ChannelFormValidationErrors {
  channelName?: string;
  inputUrl?: string;
  inputName?: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to create a MediaLive input
 * Validates Requirements: 3.1-3.3
 */
export interface CreateInputRequest {
  action: 'create_input';
  params: {
    Name: string;                // Input name with "-input" suffix
    Type: InputType;             // Input type (MP4_FILE initially)
    Sources: Array<{             // Two redundant sources pointing to same URL
      Url: string;
    }>;
  };
}

/**
 * Response from MediaLive input creation
 */
export interface CreateInputResponse {
  Input: {
    Id: string;
    Arn: string;
    Name: string;
    Type: InputType;
    Sources: Array<{
      Url: string;
    }>;
  };
}

/**
 * Request to create a MediaLive channel
 * Validates Requirements: 5.1-5.11
 */
export interface CreateChannelRequest {
  action: 'create_channel';
  params: {
    Name: string;
    ChannelClass: 'SINGLE_PIPELINE';
    InputAttachments: Array<{
      InputAttachmentName: string;
      InputId: string;
      InputSettings: Record<string, unknown>;
    }>;
    InputSpecification: {
      Codec: 'AVC';
      Resolution: 'HD';
      MaximumBitrate: 'MAX_20_MBPS';
    };
    Destinations: Array<{
      Id: string;
      MediaPackageSettings: Array<{
        ChannelId: string;
      }>;
    }>;
    EncoderSettings: typeof STANDARD_ENCODER_SETTINGS;
    LogLevel: 'INFO' | 'DEBUG' | 'WARNING' | 'ERROR';
    InferenceSettings: {
      FeedArn: string;
    };
  };
}

/**
 * Response from MediaLive channel creation
 */
export interface CreateChannelResponse {
  Channel: {
    Id: string;
    Arn: string;
    Name: string;
    State: ChannelState;
    Destinations: Array<{
      Id: string;
      Settings: Array<{
        Url: string;
      }>;
    }>;
  };
}

/**
 * Channel status response from MediaLive API
 * Validates Requirements: 9.2-9.3, 10.1-10.6
 */
export interface ChannelStatusResponse {
  channelId: string;
  state: ChannelState;
  arn: string;
  name: string;
}

// ============================================================================
// Encoder Settings Types (MediaLive API Format)
// ============================================================================

/**
 * H.264 codec settings for video encoding
 * Validates Requirements: 5.5, 5.6
 */
export interface H264Settings {
  AdaptiveQuantization: string;
  AfdSignaling: string;
  Bitrate: number;
  ColorMetadata: string;
  EntropyEncoding: string;
  FlickerAq: string;
  ForceFieldPictures: string;
  FramerateControl: string;
  FramerateDenominator: number;  // 1 for 30 fps
  FramerateNumerator: number;    // 30 for 30 fps
  GopBReference: string;
  GopClosedCadence: number;
  GopSize: number;
  GopSizeUnits: string;
  Level: string;
  LookAheadRateControl: string;
  NumRefFrames: number;
  ParControl: string;
  ParDenominator: number;
  ParNumerator: number;
  Profile: 'MAIN' | 'HIGH' | 'BASELINE';
  RateControlMode: string;
  ScanType: string;
  SceneChangeDetect: string;
  SpatialAq: string;
  SubgopLength: string;
  Syntax: string;
  TemporalAq: string;
  TimecodeInsertion: string;
}

/**
 * AAC audio codec settings
 * Validates Requirement: 5.4
 */
export interface AacSettings {
  Bitrate: number;               // 96000 for 96 Kbps
  CodingMode: string;
  InputType: string;
  Profile: string;
  RateControlMode: string;
  RawFormat: string;
  SampleRate: number;
  Spec: string;
}

/**
 * Video description for encoder settings
 * Validates Requirements: 5.3, 5.5, 5.6
 */
export interface VideoDescription {
  Name: string;
  Width: number;
  Height: number;
  ScalingBehavior: string;
  Sharpness: number;
  RespondToAfd: string;
  CodecSettings: {
    H264Settings: H264Settings;
  };
}

/**
 * Audio description for encoder settings
 * Validates Requirement: 5.4
 */
export interface AudioDescription {
  AudioSelectorName: string;
  Name: string;
  CodecSettings: {
    AacSettings: AacSettings;
  };
}

/**
 * Output configuration for MediaPackage
 * Validates Requirement: 5.7
 */
export interface Output {
  OutputName: string;
  VideoDescriptionName: string;
  AudioDescriptionNames: string[];
  OutputSettings: {
    MediaPackageOutputSettings: Record<string, unknown>;
  };
}

/**
 * Output group configuration
 * Validates Requirements: 5.7, 5.8
 */
export interface OutputGroup {
  Name: string;
  OutputGroupSettings: {
    MediaPackageGroupSettings: {
      Destination: {
        DestinationRefId: string;
      };
      MediapackageV2GroupSettings: {
        SegmentLength: number;     // 1 second
      };
    };
  };
  Outputs: Output[];
}

/**
 * Complete encoder settings structure
 * Validates Requirements: 5.3-5.8
 */
export interface EncoderSettings {
  AudioDescriptions: AudioDescription[];
  TimecodeConfig: {
    Source: string;
  };
  VideoDescriptions: VideoDescription[];
  OutputGroups: OutputGroup[];
}

// ============================================================================
// Service Integration Types
// ============================================================================

/**
 * MediaPackage V2 channel creation parameters
 * Validates Requirements: 4.2, 4.3
 */
export interface MediaPackageChannelParams {
  ChannelGroupName: string;
  ChannelName: string;
  Description?: string;
}

/**
 * Elemental Inference feed creation parameters
 * Validates Requirements: 15.1-15.4
 */
export interface ElementalInferenceFeedParams {
  name: string;
  outputs: Array<{
    name: string;
    outputConfig: {
      clipping: {
        callbackMetadata: string;
      };
    };
    status: 'ENABLED' | 'DISABLED';
  }>;
}

/**
 * CloudFormation stack outputs
 * Validates Requirements: 13.1, 13.2
 */
export interface CloudFormationOutputs {
  MediaPackageV2ChannelGroupName?: string;
  [key: string]: string | undefined;
}

// ============================================================================
// Error Handling Types
// ============================================================================

/**
 * Channel creation error with cleanup context
 */
export interface ChannelCreationError extends Error {
  failurePoint: 'input' | 'mediapackage' | 'feed' | 'channel' | 'validation' | 'configuration';
  resourcesCreated?: {
    inputId?: string;
    mediaPackageChannelName?: string;
    feedId?: string;
  };
}

/**
 * Resource cleanup result
 */
export interface CleanupResult {
  success: boolean;
  errors: string[];
}
