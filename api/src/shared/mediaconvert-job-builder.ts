/**
 * MediaConvert Job Builder
 *
 * Constructs MediaConvert CreateJobRequest objects for MP4 download and video editing.
 * Translates application-level concepts (operations, orientation) to MediaConvert API structures.
 */

import type { CreateJobRequest, InputClipping, VideoSelector } from "@aws-sdk/client-mediaconvert";
import { secondsToSmpte } from "./timecode-converter";
import { operationsToKeepSegments, type VideoEditOperation } from "./segment-calculator";

// --- Types ---

export interface MediaConvertJobConfig {
  inputS3Uri: string;
  orientation: "landscape" | "portrait" | "both";
  outputBucket: string;
  outputKeyPrefix: string;
  roleArn: string;
  userMetadata: {
    jobType: "editing" | "download";
    appJobId: string;
    assetType?: "clip" | "reel";
  };
}

export interface DownloadJobConfig extends MediaConvertJobConfig {
  type: "download";
}

export interface EditingJobConfig extends MediaConvertJobConfig {
  type: "editing";
  operations: VideoEditOperation[];
  outputFormat: "mp4" | "hls";
  quality: "high" | "medium" | "low";
}

// --- Oriented Job Config Types (single orientation, orientation-specific source) ---

export interface OrientedDownloadJobConfig {
  type: "download";
  inputS3Uri: string;
  orientation: "landscape" | "portrait";
  outputBucket: string;
  outputKeyPrefix: string;
  roleArn: string;
  userMetadata: { jobType: "download"; appJobId: string; assetType?: "clip" | "reel" };
}

export interface OrientedEditingJobConfig {
  type: "editing";
  inputS3Uri: string;
  orientation: "landscape" | "portrait";
  outputBucket: string;
  outputKeyPrefix: string;
  roleArn: string;
  operations: VideoEditOperation[];
  outputFormat: "mp4" | "hls";
  quality: "high" | "medium" | "low";
  userMetadata: { jobType: "editing"; appJobId: string; assetType?: "clip" | "reel" };
}

// --- Constants ---

const SENTINEL_END_TIME = 999999;

const LANDSCAPE_WIDTH = 1280;
const LANDSCAPE_HEIGHT = 720;
const LANDSCAPE_BITRATE = 3_000_000;

const PORTRAIT_WIDTH = 720;
const PORTRAIT_HEIGHT = 1280;
const PORTRAIT_BITRATE = 3_500_000;

const HLS_SEGMENT_LENGTH = 6;

const QUALITY_MAP = {
  high: { qualityTuningLevel: "MULTI_PASS_HQ" as const, bitrate: PORTRAIT_BITRATE },
  medium: { qualityTuningLevel: "SINGLE_PASS" as const, bitrate: PORTRAIT_BITRATE },
  low: { qualityTuningLevel: "SINGLE_PASS" as const, bitrate: 1_500_000 },
};

// --- Video Selector ---

/**
 * Build VideoSelector configuration for a given orientation.
 * Maps orientation to the correct resolution and bitrate from the HLS manifest.
 */
export function buildVideoSelector(orientation: "landscape" | "portrait"): VideoSelector {
  if (orientation === "landscape") {
    return {
      ColorSpace: "FOLLOW",
      Rotate: "AUTO",
    };
  }
  // portrait
  return {
    ColorSpace: "FOLLOW",
    Rotate: "AUTO",
  };
}

// --- Helpers ---

function buildOutputSettings(orientation: "landscape" | "portrait") {
  const isLandscape = orientation === "landscape";
  return {
    Width: isLandscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH,
    Height: isLandscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT,
    Bitrate: isLandscape ? LANDSCAPE_BITRATE : PORTRAIT_BITRATE,
  };
}

function buildVideoDescription(orientation: "landscape" | "portrait", quality: "high" | "medium" | "low" = "medium") {
  const { Width, Height, Bitrate } = buildOutputSettings(orientation);
  const q = QUALITY_MAP[quality];
  return {
    CodecSettings: {
      Codec: "H_264" as const,
      H264Settings: {
        RateControlMode: "CBR" as const,
        Bitrate: q.bitrate ?? Bitrate,
        QualityTuningLevel: q.qualityTuningLevel,
        CodecProfile: "HIGH" as const,
        FramerateControl: "INITIALIZE_FROM_SOURCE" as const,
      },
    },
    Width,
    Height,
    ScalingBehavior: "DEFAULT" as const,
    AntiAlias: "ENABLED" as const,
  };
}

function buildAudioDescription() {
  return {
    CodecSettings: {
      Codec: "AAC" as const,
      AacSettings: {
        Bitrate: 128000,
        CodingMode: "CODING_MODE_2_0" as const,
        SampleRate: 48000,
      },
    },
  };
}

function buildUserMetadata(config: MediaConvertJobConfig): Record<string, string> {
  const meta: Record<string, string> = {
    jobType: config.userMetadata.jobType,
    appJobId: config.userMetadata.appJobId,
  };
  if (config.userMetadata.assetType) {
    meta.assetType = config.userMetadata.assetType;
  }
  return meta;
}

function buildOrientedUserMetadata(config: OrientedDownloadJobConfig | OrientedEditingJobConfig): Record<string, string> {
  const meta: Record<string, string> = {
    jobType: config.userMetadata.jobType,
    appJobId: config.userMetadata.appJobId,
    orientation: config.orientation,
  };
  if (config.userMetadata.assetType) {
    meta.assetType = config.userMetadata.assetType;
  }
  return meta;
}


// --- Input Clippings ---

/**
 * Convert keep-segments to MediaConvert InputClippings.
 * Handles the 999999 sentinel end-time by omitting EndTimecode.
 */
export function segmentsToInputClippings(operations: VideoEditOperation[]): InputClipping[] {
  const keepSegments = operationsToKeepSegments(operations);

  return keepSegments.map((seg) => {
    const clipping: InputClipping = {
      StartTimecode: secondsToSmpte(seg.start),
    };
    if (seg.end < SENTINEL_END_TIME) {
      clipping.EndTimecode = secondsToSmpte(seg.end);
    }
    return clipping;
  });
}

// --- Download Job Builder ---

/**
 * Build a MediaConvert CreateJobRequest for MP4 download.
 * Configures FILE_GROUP_SETTINGS output, VideoSelector for orientation.
 * Sets UserMetadata for completion handler correlation.
 */
export function buildDownloadJob(config: DownloadJobConfig): CreateJobRequest {
  const orientations: Array<"landscape" | "portrait"> =
    config.orientation === "both" ? ["landscape", "portrait"] : [config.orientation];

  const outputGroups = orientations.map((orient) => ({
    Name: `Download-${orient}`,
    OutputGroupSettings: {
      Type: "FILE_GROUP_SETTINGS" as const,
      FileGroupSettings: {
        Destination: `s3://${config.outputBucket}/${config.outputKeyPrefix}`,
      },
    },
    Outputs: [
      {
        ContainerSettings: {
          Container: "MP4" as const,
          Mp4Settings: {},
        },
        VideoDescription: buildVideoDescription(orient),
        AudioDescriptions: [buildAudioDescription()],
        NameModifier: config.orientation === "both" ? `-${orient}` : undefined,
      },
    ],
  }));

  return {
    Role: config.roleArn,
    UserMetadata: buildUserMetadata(config),
    Settings: {
      Inputs: [
        {
          FileInput: config.inputS3Uri,
          VideoSelector: buildVideoSelector(orientations[0]),
          AudioSelectors: {
            "Audio Selector 1": {
              DefaultSelection: "DEFAULT" as const,
            },
          },
        },
      ],
      OutputGroups: outputGroups,
    },
  };
}

// --- Editing Job Builder ---

function buildHlsOutputGroup(orient: "landscape" | "portrait", quality: "high" | "medium" | "low", destination: string, nameMod?: string) {
  return {
    Name: `HLS-${orient}`,
    OutputGroupSettings: {
      Type: "HLS_GROUP_SETTINGS" as const,
      HlsGroupSettings: {
        SegmentLength: HLS_SEGMENT_LENGTH,
        MinSegmentLength: 0,
        Destination: destination,
      },
    },
    Outputs: [
      {
        ContainerSettings: {
          Container: "M3U8" as const,
        },
        VideoDescription: buildVideoDescription(orient, quality),
        AudioDescriptions: [buildAudioDescription()],
        OutputSettings: {
          HlsSettings: {},
        },
        NameModifier: nameMod || "_video",
      },
    ],
  };
}

function buildMp4OutputGroup(orient: "landscape" | "portrait", quality: "high" | "medium" | "low", destination: string, nameMod?: string) {
  return {
    Name: `MP4-${orient}`,
    OutputGroupSettings: {
      Type: "FILE_GROUP_SETTINGS" as const,
      FileGroupSettings: {
        Destination: destination,
      },
    },
    Outputs: [
      {
        ContainerSettings: {
          Container: "MP4" as const,
          Mp4Settings: {},
        },
        VideoDescription: buildVideoDescription(orient, quality),
        AudioDescriptions: [buildAudioDescription()],
        NameModifier: nameMod || "_video",
      },
    ],
  };
}

/**
 * Build a MediaConvert CreateJobRequest for video editing.
 * Converts operations to InputClippings via Timecode Converter.
 * Configures HLS_GROUP_SETTINGS or FILE_GROUP_SETTINGS based on format.
 * Sets UserMetadata for completion handler correlation.
 */
export function buildEditingJob(config: EditingJobConfig): CreateJobRequest {
  const inputClippings = segmentsToInputClippings(config.operations);

  const orientations: Array<"landscape" | "portrait"> =
    config.orientation === "both" ? ["landscape", "portrait"] : [config.orientation];

  const destination = `s3://${config.outputBucket}/${config.outputKeyPrefix}`;

  const outputGroups = orientations.map((orient) => {
    const nameMod = config.orientation === "both" ? `-${orient}` : undefined;
    return config.outputFormat === "hls"
      ? buildHlsOutputGroup(orient, config.quality, destination, nameMod)
      : buildMp4OutputGroup(orient, config.quality, destination, nameMod);
  });

  return {
    Role: config.roleArn,
    UserMetadata: buildUserMetadata(config),
    Settings: {
      Inputs: [
        {
          FileInput: config.inputS3Uri,
          InputClippings: inputClippings.length > 0 ? inputClippings : undefined,
          TimecodeSource: "ZEROBASED" as const,
          VideoSelector: buildVideoSelector(orientations[0]),
          AudioSelectors: {
            "Audio Selector 1": {
              DefaultSelection: "DEFAULT" as const,
            },
          },
        },
      ],
      OutputGroups: outputGroups,
    },
  };
}

// --- Oriented Download Job Builder ---

/**
 * Build a MediaConvert CreateJobRequest for a single-orientation MP4 download.
 * Unlike `buildDownloadJob`, this accepts an orientation-specific input S3 URI
 * and produces a single output group for the specified orientation.
 * When orientation=both, the caller creates two separate jobs.
 */
export function buildOrientedDownloadJob(config: OrientedDownloadJobConfig): CreateJobRequest {
  const outputGroup = {
    Name: `Download-${config.orientation}`,
    OutputGroupSettings: {
      Type: "FILE_GROUP_SETTINGS" as const,
      FileGroupSettings: {
        Destination: `s3://${config.outputBucket}/${config.outputKeyPrefix}`,
      },
    },
    Outputs: [
      {
        ContainerSettings: {
          Container: "MP4" as const,
          Mp4Settings: {},
        },
        VideoDescription: buildVideoDescription(config.orientation),
        AudioDescriptions: [buildAudioDescription()],
      },
    ],
  };

  return {
    Role: config.roleArn,
    UserMetadata: buildOrientedUserMetadata(config),
    Settings: {
      Inputs: [
        {
          FileInput: config.inputS3Uri,
          VideoSelector: buildVideoSelector(config.orientation),
          AudioSelectors: {
            "Audio Selector 1": {
              DefaultSelection: "DEFAULT" as const,
            },
          },
        },
      ],
      OutputGroups: [outputGroup],
    },
  };
}

// --- Oriented Editing Job Builder ---

/**
 * Build a MediaConvert CreateJobRequest for a single-orientation video edit.
 * Unlike `buildEditingJob`, this accepts an orientation-specific input S3 URI
 * and always produces two output groups (HLS + MP4) for the specified orientation.
 * When orientation=both, the caller creates two separate jobs.
 */
export function buildOrientedEditingJob(config: OrientedEditingJobConfig): CreateJobRequest {
  const inputClippings = segmentsToInputClippings(config.operations);
  const hlsDestination = `s3://${config.outputBucket}/${config.outputKeyPrefix}hls/`;
  const mp4Destination = `s3://${config.outputBucket}/${config.outputKeyPrefix}mp4/`;
  const hlsOutputGroup = buildHlsOutputGroup(config.orientation, config.quality, hlsDestination);
  const mp4OutputGroup = buildMp4OutputGroup(config.orientation, config.quality, mp4Destination);

  return {
    Role: config.roleArn,
    UserMetadata: buildOrientedUserMetadata(config),
    Settings: {
      Inputs: [
        {
          FileInput: config.inputS3Uri,
          InputClippings: inputClippings.length > 0 ? inputClippings : undefined,
          TimecodeSource: "ZEROBASED" as const,
          VideoSelector: buildVideoSelector(config.orientation),
          AudioSelectors: {
            "Audio Selector 1": {
              DefaultSelection: "DEFAULT" as const,
            },
          },
        },
      ],
      OutputGroups: [hlsOutputGroup, mp4OutputGroup],
    },
  };
}

