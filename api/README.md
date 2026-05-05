# Test Events for Lambda

## Creating a channel + dependencies

### Prerequisites. 
In this guide we will need to create and/or insert these dependencies manually first before creating the channel.
This is just for illustration only, you don't need to do anything with the following:
```json
{
  "InputId": "<REPLACE_WITH_INPUT_ID>",
  "ChannelGroup": "<REPLACE_WITH_MEDIAPACKAGE_CHANNEL_GROUP>",
  "ChannelName": "<REPLACE_WITH_MEDIAPACKAGE_CHANNEL_NAME>",
  "FeedArn": "<REPLACE_WITH_STARFISH_FEED_ARN>"
}
```

- The InputId refers to the input sources into MediaLive.
- The ChannelGroup and ChannelName refers to the MediaPackageV2 output configuration.
- FeedArn refers to the Elemental Inference feed.

For the following operations, use native boto3 `elementalinference` client directly (no Lambda wrapper needed).

### CreateFeed - Native boto3

Create the Elemental Inference feed using native boto3 client:
Create the input sources, for example for VOD assets stored in S3 just grab the S3 URI from the console.
Here we are using the 11 second test video you provided for your account.

NOTE: Make sure the input file name does not have spaces.

```json
{
  "action": "create_input",
  "params": {
    "Name": "test-input-lambda",
    "Type": "MP4_FILE",
    "Sources": [
      {
        "Url": "s3://test-videos-125667709191/Euro_Norway_Goal_Wide.mp4"
      },
      {
        "Url": "s3://test-videos-125667709191/Euro_Norway_Goal_Wide.mp4"
      }
    ]
  }
}
```

### CreateFeed - starfish-api-client

Create the Starfish feed in us-east-1, which will be automatically forwarded to us-west-2.

NOTE: Only 1 Starfish feed can be associated with 1 MediaLive channel, and that association can only occur once.
Meaning if you want to create a new channel you have to create a new feed as well.
The other caveat is that during the private beta phase each account has a hard quota of 2 active feeds regardless of region (active meaning either in the AVAILABLE or IDLE state).
You can remove an existing feed by simply deleting it using the DeleteFeed operation in the Additional Operations section below.
If you delete a channel, the feed will be automatically disassociated and put into ARCHIVED state.

```json
{
  "action": "create_feed",
  "endpoint": "https://elemental-inference.us-east-1.amazonaws.com",
  "region": "us-east-1",
  "params": {
    "name": "test-feed-clipping-cropping-iad",
    "outputs": [
      {
        "name": "medialive-cropping-0",
        "outputConfig": {
          "cropping": {}
        },
        "status": "ENABLED"
      },
      {
        "name": "clipping-output",
        "outputConfig": {
          "clipping": {
            "callbackMetadata": "test-highlight-metadata"
          }
        },
        "status": "ENABLED"
      }
    ],
    "tags": {
      "Environment": "test",
      "Purpose": "medialive-integration",
      "Region": "us-east-1"
    }
  }
}
```

### GetFeed - starfish-api-client
You can check the created feed to ensure it's in the AVAILABLE state.
Once you associate it with a channel using the next operation, it will automatically change into IDLE state.

```json
{
  "action": "get_feed",
  "region": "us-east-1",
  "endpoint": "https://elemental-inference.us-east-1.amazonaws.com",
  "params": {
    "feed_id": "g5oicv2l3ugnxquwdjl"
  }
}
```

### CreateChannel - medialive-api-client
Then create the channel in us-west-2 (by default). Below we have already added the required parameters for
`ChannelGroup`, `ChannelName`, `FeedArn`, `inputId`.
This operation also inserts a record in the Channels table in DynamoDB, so that the app can retrieve available channels.

NOTE: Technically the IAM RoleArn should be passed into this configuration as a parameter as well, but we are dynamically inserting that for you within the Lambda code as a security consideration.

**IMPORTANT:** This configuration includes audio support. For MediaPackage V2 with CMAF, audio and video must be in separate outputs.

```json
{
  "action": "create_channel",
  "params": {
    "Name": "test-eml-starfish-cross-region",
    "ChannelClass": "SINGLE_PIPELINE",
    "InputAttachments": [
      {
        "InputAttachmentName": "test-input-attachment",
        "InputId": "4363418",
        "InputSettings": {
          "AudioSelectors": [
            {
              "Name": "default",
              "SelectorSettings": {
                "AudioTrackSelection": {
                  "Tracks": [
                    {
                      "Track": 1
                    }
                  ]
                }
              }
            }
          ],
          "SourceEndBehavior": "CONTINUE",
          "InputFilter": "AUTO",
          "FilterStrength": 1,
          "DeblockFilter": "DISABLED",
          "DenoiseFilter": "DISABLED",
          "Smpte2038DataPreference": "IGNORE"
        }
      }
    ],
    "InputSpecification": {
      "Codec": "AVC",
      "Resolution": "HD",
      "MaximumBitrate": "MAX_20_MBPS"
    },
    "Destinations": [
      {
        "Id": "mediapackage-v2",
        "MediaPackageSettings": [
          {
            "ChannelGroup": "harvest-channel-group-mainmediapackagev257893362",
            "ChannelName": "harvest-channel-group-mainmediapackagev257893362-channel-v2"
          }
        ]
      }
    ],
    "EncoderSettings": {
      "AudioDescriptions": [
        {
          "AudioSelectorName": "default",
          "Name": "audio_main",
          "CodecSettings": {
            "AacSettings": {
              "Bitrate": 96000,
              "CodingMode": "CODING_MODE_2_0",
              "InputType": "NORMAL",
              "Profile": "LC",
              "RateControlMode": "CBR",
              "RawFormat": "NONE",
              "SampleRate": 48000,
              "Spec": "MPEG4"
            }
          }
        }
      ],
      "TimecodeConfig": {
        "Source": "EMBEDDED"
      },
      "VideoDescriptions": [
        {
          "Name": "video_main",
          "Width": 1080,
          "Height": 1920,
          "ScalingBehavior": "SMART_CROP",
          "Sharpness": 50,
          "RespondToAfd": "NONE",
          "CodecSettings": {
            "H264Settings": {
              "AdaptiveQuantization": "AUTO",
              "AfdSignaling": "NONE",
              "ColorMetadata": "INSERT",
              "EntropyEncoding": "CABAC",
              "FlickerAq": "ENABLED",
              "ForceFieldPictures": "DISABLED",
              "FramerateControl": "SPECIFIED",
              "FramerateDenominator": 1,
              "FramerateNumerator": 30,
              "GopBReference": "DISABLED",
              "GopClosedCadence": 1,
              "GopSize": 30,
              "GopSizeUnits": "FRAMES",
              "Level": "H264_LEVEL_AUTO",
              "LookAheadRateControl": "MEDIUM",
              "NumRefFrames": 1,
              "ParControl": "SPECIFIED",
              "ParDenominator": 1,
              "ParNumerator": 1,
              "Profile": "MAIN",
              "RateControlMode": "CBR",
              "ScanType": "PROGRESSIVE",
              "SceneChangeDetect": "ENABLED",
              "SpatialAq": "ENABLED",
              "SubgopLength": "FIXED",
              "Syntax": "DEFAULT",
              "TemporalAq": "ENABLED",
              "TimecodeInsertion": "DISABLED"
            }
          }
        }
      ],
      "OutputGroups": [
        {
          "Name": "harvest-output-group",
          "OutputGroupSettings": {
            "MediaPackageGroupSettings": {
              "Destination": {
                "DestinationRefId": "mediapackage-v2"
              },
              "MediapackageV2GroupSettings": {
                "CaptionLanguageMappings": [],
                "SegmentLength": 1
              }
            }
          },
          "Outputs": [
            {
              "OutputName": "video-only",
              "AudioDescriptionNames": [],
              "OutputSettings": {
                "MediaPackageOutputSettings": {}
              },
              "VideoDescriptionName": "video_main"
            },
            {
              "OutputName": "audio-only",
              "AudioDescriptionNames": ["audio_main"],
              "OutputSettings": {
                "MediaPackageOutputSettings": {}
              }
            }
          ]
        }
      ]
    },
    "LogLevel": "INFO",
    "InferenceSettings": {
      "FeedArn": "arn:aws:elemental-inference:us-east-1:125667709191:feed/lr56b2sny52q857687v"
    }
  }
}
```

### DescribeChannel - medialive-api-client
Upon successful creation you should be able to use this operation to confirm the channel is ready and associated with the feed. 
At the bottom of its response you can see something like `State: IDLE`. 
Feel free to use this operation as often as you like to monitor it's status, which is helpful when you're stopping or starting a channel (more on that in the next section).

```json
{
  "action": "describe_channel",
  "params": {
    "channel_id": "6310187"
  }
}
```

## Starting and running the channel

### Basic steps
1. Once a channel has been created the first thing you want to do is create an event from the App UI. When you create a new event you should be able to see the channel name under the dropdown. For convenience, we created the channel `test-eml-starfish-cross-region` for you. 
2. Activate this event for starfish key moment generation. Under the Actions column to the right of the events table you'll see a AI-sparkle icon, which can be toggled to activate one event at a time. For the existing test event we already did it for you so it should be greyed out. 

NOTE: The operational steps below of starting and stopping a channel can now be performed via the AWS console UI. It's highly recommended to use the UI unless you're testing specific MediaLive APIs.

3. Now return to the medialive-client-api lambda and use the StartChannel operation below to start the channel. Once the channel is running (remember you can use DescribeChannel to check if the state is RUNNING), you can track incoming starfish events via this CloudWatch log group: 
`/aws/events/main/starfish-events-cross-region`. As discussed in our calls, these events are processed by our harvesting pipeline (its lambdas also have their own logs).
4. For an 11 second video I recommend not letting the channel run for too long, or starfish will generate clips that are black videos. If you want to test the video on a loop you can set the `SourceEndBehavior` when creating a channel to `LOOP` instead. To stop the channel use the StopChannel operation below and starfish will stop emitting events.

### StartChannel - medialive-api-client

```json
{
  "action": "start_channel",
  "params": {
    "channel_id": "6310187"
  }
}
```

### StopChannel - medialive-api-client

```json
{
  "action": "stop_channel",
  "params": {
    "channel_id": "6310187"
  }
}
```

And that's it! We ran through these steps during testing so you should already see them in your account. Feel free to use the additional operations below if you want to clean up the resources and try yourself with different inputs. Just remember to update the parameters such as IDs and ARNs.

## Additional Operations

### UpdateChannel - medialive-api-client
Update an existing MediaLive channel configuration.

**IMPORTANT:** MediaLive's UpdateChannel API requires the complete `encoder_settings` and `input_attachments` objects. It does not support partial updates - any fields not included will be removed from the channel configuration. This is why the payload is large even for a single field change.

**Example:** Adding audio configuration to channel 6310187 (1080x1920 vertical, GopSize: 30):

```json
{
  "action": "update_channel",
  "params": {
    "channel_id": "6310187",
    "encoder_settings": {
      "AudioDescriptions": [
        {
          "AudioSelectorName": "default",
          "Name": "audio_main",
          "CodecSettings": {
            "AacSettings": {
              "Bitrate": 96000,
              "CodingMode": "CODING_MODE_2_0",
              "InputType": "NORMAL",
              "Profile": "LC",
              "RateControlMode": "CBR",
              "RawFormat": "NONE",
              "SampleRate": 48000,
              "Spec": "MPEG4"
            }
          }
        }
      ],
      "CaptionDescriptions": [],
      "OutputGroups": [
        {
          "Name": "harvest-output-group",
          "OutputGroupSettings": {
            "MediaPackageGroupSettings": {
              "Destination": {
                "DestinationRefId": "mediapackage-v2"
              },
              "MediapackageV2GroupSettings": {
                "CaptionLanguageMappings": [],
                "SegmentLength": 1
              }
            }
          },
          "Outputs": [
            {
              "AudioDescriptionNames": [],
              "CaptionDescriptionNames": [],
              "OutputName": "video-only",
              "OutputSettings": {
                "MediaPackageOutputSettings": {}
              },
              "VideoDescriptionName": "video_main"
            },
            {
              "AudioDescriptionNames": ["audio_main"],
              "CaptionDescriptionNames": [],
              "OutputName": "audio-only",
              "OutputSettings": {
                "MediaPackageOutputSettings": {}
              }
            }
          ]
        }
      ],
      "TimecodeConfig": {
        "Source": "EMBEDDED"
      },
      "VideoDescriptions": [
        {
          "CodecSettings": {
            "H264Settings": {
              "AdaptiveQuantization": "AUTO",
              "AfdSignaling": "NONE",
              "ColorMetadata": "INSERT",
              "EntropyEncoding": "CABAC",
              "FlickerAq": "ENABLED",
              "ForceFieldPictures": "DISABLED",
              "FramerateControl": "SPECIFIED",
              "FramerateDenominator": 1,
              "FramerateNumerator": 30,
              "GopBReference": "DISABLED",
              "GopClosedCadence": 1,
              "GopSize": 30,
              "GopSizeUnits": "FRAMES",
              "Level": "H264_LEVEL_AUTO",
              "LookAheadRateControl": "MEDIUM",
              "NumRefFrames": 1,
              "ParControl": "SPECIFIED",
              "ParDenominator": 1,
              "ParNumerator": 1,
              "Profile": "MAIN",
              "RateControlMode": "CBR",
              "ScanType": "PROGRESSIVE",
              "SceneChangeDetect": "ENABLED",
              "SpatialAq": "ENABLED",
              "SubgopLength": "FIXED",
              "Syntax": "DEFAULT",
              "TemporalAq": "ENABLED",
              "TimecodeInsertion": "DISABLED"
            }
          },
          "Height": 1920,
          "Name": "video_main",
          "RespondToAfd": "NONE",
          "ScalingBehavior": "SMART_CROP",
          "Sharpness": 50,
          "Width": 1080
        }
      ]
    },
    "input_attachments": [
      {
        "InputAttachmentName": "test-input-attachment",
        "InputId": "4363418",
        "InputSettings": {
          "AudioSelectors": [
            {
              "Name": "default",
              "SelectorSettings": {
                "AudioTrackSelection": {
                  "Tracks": [
                    {
                      "Track": 1
                    }
                  ]
                }
              }
            }
          ],
          "CaptionSelectors": [],
          "DeblockFilter": "DISABLED",
          "DenoiseFilter": "DISABLED",
          "FilterStrength": 1,
          "InputFilter": "AUTO",
          "Smpte2038DataPreference": "IGNORE",
          "SourceEndBehavior": "CONTINUE"
        }
      }
    ]
  }
}
```

**Note:** The channel must be in `IDLE` state (not running) to update encoder settings. Use `StopChannel` first if needed.

### DeleteChannel - medialive-api-client
Delete a MediaLive channel. This also removes the channel record from the Channels DynamoDB table, and removes the Starfish feed association.

```json
{
  "action": "delete_channel",
  "params": {
    "channel_id": "6310187"
  }
}
```

### UpdateInput - medialive-api-client
Update an existing MediaLive input source. Here we are changing it to the longer 25 mins video.

```json
{
  "action": "update_input",
  "params": {
    "input_id": "4363418",
    "name": "test-input-lambda",
    "sources": [
      {
        "Url": "s3://test-videos-125667709191/soccer_ksa_mli_25mins.mp4"
      },
      {
        "Url": "s3://test-videos-125667709191/soccer_ksa_mli_25mins.mp4"
      }
    ]
  }
}
```

### DeleteInput - medialive-api-client
Delete a MediaLive input source.

```json
{
  "action": "delete_input",
  "params": {
    "input_id": "4363418"
  }
}
```

### DescribeInput - medialive-api-client
Get details about a specific MediaLive input.

```json
{
  "action": "describe_input",
  "params": {
    "input_id": "4363418"
  }
}
```

### ListFeeds - starfish-api-client
List all Starfish feeds in the us-east-1 region.

```json
{
  "action": "list_feeds",
  "endpoint": "https://elemental-inference.us-east-1.amazonaws.com",
  "region": "us-east-1",
  "params": {
    "max_results": 10
  }
}
```

### DeleteFeed - starfish-api-client
Deletes a Starfish feed.

```json
{
  "action": "delete_feed",
  "endpoint": "https://elemental-inference.us-east-1.amazonaws.com",
  "region": "us-east-1",
  "params": {
    "feed_id": "lr56b2sny52q857687v"
  }
}
```

### AssociateFeed - starfish-api-client (DON'T USE)
Manually associate a Starfish feed with a MediaLive channel. Note: This is typically done automatically during channel creation via the StarfishSettings parameter.

```json
{
  "action": "associate_feed",
  "endpoint": "https://elemental-inference.us-east-1.amazonaws.com",
  "region": "us-east-1",
  "params": {
    "feed_id": "lr56b2sny52q857687v",
    "associated_resource_name": "arn:aws:medialive:us-west-2:125667709191:channel:6310187",
    "outputs": [
      {
        "name": "clipping-output",
        "outputConfig": {
          "clipping": {
            "callbackMetadata": "test-metadata"
          }
        },
        "status": "ENABLED"
      }
    ],
    "dry_run": false
  }
}
```

### DisassociateFeed - starfish-api-client (DON'T USE)
Manually disassociate a Starfish feed from a MediaLive channel. Note: this is typically done automatically during channel deletion.

```json
{
  "action": "disassociate_feed",
  "endpoint": "https://elemental-inference.us-east-1.amazonaws.com",
  "region": "us-east-1",
  "params": {
    "feed_id": "g5oicv2l3ugnxquwdjl",
    "associated_resource_name": "arn:aws:medialive:us-west-2:123456789012:channel:1234567",
    "dry_run": false
  }
}
```