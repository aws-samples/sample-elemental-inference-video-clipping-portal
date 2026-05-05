/**
 * Standard encoder settings template for MediaLive channels
 * 
 * This configuration defines:
 * - 4 video outputs: smart_crop (720x1280), 720p (1280x720), 480p_high (854x480), 480p_low (854x480)
 * - 1 audio output: 96 Kbps AAC
 * - 30 fps frame rate for all video outputs
 * - H.264 codec with MAIN profile for all video outputs
 * - 1-second segment length for MediaPackage output
 * 
 * Validates Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */

export const STANDARD_ENCODER_SETTINGS = {
  AudioDescriptions: [
    {
      AudioSelectorName: 'default',
      Name: 'audio_main',
      CodecSettings: {
        AacSettings: {
          Bitrate: 96000,
          CodingMode: 'CODING_MODE_2_0',
          InputType: 'NORMAL',
          Profile: 'LC',
          RateControlMode: 'CBR',
          RawFormat: 'NONE',
          SampleRate: 48000,
          Spec: 'MPEG4'
        }
      }
    }
  ],
  TimecodeConfig: { Source: 'SYSTEMCLOCK' },
  VideoDescriptions: [
    {
      Name: 'video_smart_crop',
      Width: 720,
      Height: 1280,
      ScalingBehavior: 'SMART_CROP',
      Sharpness: 50,
      RespondToAfd: 'NONE',
      CodecSettings: {
        H264Settings: {
          AdaptiveQuantization: 'AUTO',
          AfdSignaling: 'NONE',
          Bitrate: 3500000,
          ColorMetadata: 'INSERT',
          EntropyEncoding: 'CABAC',
          FlickerAq: 'ENABLED',
          ForceFieldPictures: 'DISABLED',
          FramerateControl: 'SPECIFIED',
          FramerateDenominator: 1,
          FramerateNumerator: 30,
          GopBReference: 'DISABLED',
          GopClosedCadence: 1,
          GopSize: 30,
          GopSizeUnits: 'FRAMES',
          Level: 'H264_LEVEL_AUTO',
          LookAheadRateControl: 'MEDIUM',
          NumRefFrames: 1,
          ParControl: 'SPECIFIED',
          ParDenominator: 1,
          ParNumerator: 1,
          Profile: 'MAIN',
          RateControlMode: 'CBR',
          ScanType: 'PROGRESSIVE',
          SceneChangeDetect: 'ENABLED',
          SpatialAq: 'ENABLED',
          SubgopLength: 'FIXED',
          Syntax: 'DEFAULT',
          TemporalAq: 'ENABLED',
          TimecodeInsertion: 'PIC_TIMING_SEI'
        }
      }
    },
    {
      Name: 'video_720p',
      Width: 1280,
      Height: 720,
      ScalingBehavior: 'DEFAULT',
      Sharpness: 50,
      RespondToAfd: 'NONE',
      CodecSettings: {
        H264Settings: {
          AdaptiveQuantization: 'AUTO',
          AfdSignaling: 'NONE',
          Bitrate: 3000000,
          ColorMetadata: 'INSERT',
          EntropyEncoding: 'CABAC',
          FlickerAq: 'ENABLED',
          ForceFieldPictures: 'DISABLED',
          FramerateControl: 'SPECIFIED',
          FramerateDenominator: 1,
          FramerateNumerator: 30,
          GopBReference: 'DISABLED',
          GopClosedCadence: 1,
          GopSize: 30,
          GopSizeUnits: 'FRAMES',
          Level: 'H264_LEVEL_AUTO',
          LookAheadRateControl: 'MEDIUM',
          NumRefFrames: 1,
          ParControl: 'SPECIFIED',
          ParDenominator: 1,
          ParNumerator: 1,
          Profile: 'MAIN',
          RateControlMode: 'CBR',
          ScanType: 'PROGRESSIVE',
          SceneChangeDetect: 'ENABLED',
          SpatialAq: 'ENABLED',
          SubgopLength: 'FIXED',
          Syntax: 'DEFAULT',
          TemporalAq: 'ENABLED',
          TimecodeInsertion: 'PIC_TIMING_SEI'
        }
      }
    },
    {
      Name: 'video_480p_high',
      Width: 854,
      Height: 480,
      ScalingBehavior: 'DEFAULT',
      Sharpness: 50,
      RespondToAfd: 'NONE',
      CodecSettings: {
        H264Settings: {
          AdaptiveQuantization: 'AUTO',
          AfdSignaling: 'NONE',
          Bitrate: 1000000,
          ColorMetadata: 'INSERT',
          EntropyEncoding: 'CABAC',
          FlickerAq: 'ENABLED',
          ForceFieldPictures: 'DISABLED',
          FramerateControl: 'SPECIFIED',
          FramerateDenominator: 1,
          FramerateNumerator: 30,
          GopBReference: 'DISABLED',
          GopClosedCadence: 1,
          GopSize: 30,
          GopSizeUnits: 'FRAMES',
          Level: 'H264_LEVEL_AUTO',
          LookAheadRateControl: 'MEDIUM',
          NumRefFrames: 1,
          ParControl: 'SPECIFIED',
          ParDenominator: 1,
          ParNumerator: 1,
          Profile: 'MAIN',
          RateControlMode: 'CBR',
          ScanType: 'PROGRESSIVE',
          SceneChangeDetect: 'ENABLED',
          SpatialAq: 'ENABLED',
          SubgopLength: 'FIXED',
          Syntax: 'DEFAULT',
          TemporalAq: 'ENABLED',
          TimecodeInsertion: 'PIC_TIMING_SEI'
        }
      }
    },
    {
      Name: 'video_480p_low',
      Width: 854,
      Height: 480,
      ScalingBehavior: 'DEFAULT',
      Sharpness: 50,
      RespondToAfd: 'NONE',
      CodecSettings: {
        H264Settings: {
          AdaptiveQuantization: 'AUTO',
          AfdSignaling: 'NONE',
          Bitrate: 600000,
          ColorMetadata: 'INSERT',
          EntropyEncoding: 'CABAC',
          FlickerAq: 'ENABLED',
          ForceFieldPictures: 'DISABLED',
          FramerateControl: 'SPECIFIED',
          FramerateDenominator: 1,
          FramerateNumerator: 30,
          GopBReference: 'DISABLED',
          GopClosedCadence: 1,
          GopSize: 30,
          GopSizeUnits: 'FRAMES',
          Level: 'H264_LEVEL_AUTO',
          LookAheadRateControl: 'MEDIUM',
          NumRefFrames: 1,
          ParControl: 'SPECIFIED',
          ParDenominator: 1,
          ParNumerator: 1,
          Profile: 'MAIN',
          RateControlMode: 'CBR',
          ScanType: 'PROGRESSIVE',
          SceneChangeDetect: 'ENABLED',
          SpatialAq: 'ENABLED',
          SubgopLength: 'FIXED',
          Syntax: 'DEFAULT',
          TemporalAq: 'ENABLED',
          TimecodeInsertion: 'PIC_TIMING_SEI'
        }
      }
    }
  ],
  OutputGroups: [
    {
      Name: 'harvest-output-group',
      OutputGroupSettings: {
        MediaPackageGroupSettings: {
          Destination: { DestinationRefId: 'mediapackage-v2' },
          MediapackageV2GroupSettings: {
            SegmentLength: 1
          }
        }
      },
      Outputs: [
        {
          OutputName: 'video-smart-crop',
          VideoDescriptionName: 'video_smart_crop',
          AudioDescriptionNames: [],
          OutputSettings: {
            MediaPackageOutputSettings: {}
          }
        },
        {
          OutputName: 'video-720p',
          VideoDescriptionName: 'video_720p',
          AudioDescriptionNames: [],
          OutputSettings: {
            MediaPackageOutputSettings: {}
          }
        },
        {
          OutputName: 'video-480p-high',
          VideoDescriptionName: 'video_480p_high',
          AudioDescriptionNames: [],
          OutputSettings: {
            MediaPackageOutputSettings: {}
          }
        },
        {
          OutputName: 'video-480p-low',
          VideoDescriptionName: 'video_480p_low',
          AudioDescriptionNames: [],
          OutputSettings: {
            MediaPackageOutputSettings: {}
          }
        },
        {
          OutputName: 'audio-only',
          AudioDescriptionNames: ['audio_main'],
          OutputSettings: {
            MediaPackageOutputSettings: {}
          }
        }
      ]
    }
  ]
} as const;
