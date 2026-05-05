# User Guide

This guide covers how to use the sample application: managing channels, working with events and clips, editing video, and exporting content.

## Table of Contents

- [Concepts](#concepts)
- [Channel Management](#channel-management)
- [Event Management](#event-management)
- [Clip Processing Pipeline](#clip-processing-pipeline)
- [Video Editing](#video-editing)
- [Downloading and Exporting](#downloading-and-exporting)
- [System Settings](#system-settings)
- [Data Model Reference](#data-model-reference)
- [S3 Storage Layout](#s3-storage-layout)

---

## Concepts

The system is built around four core entities:

| Entity | Description |
|--------|-------------|
| Channel | A MediaLive channel ingesting a video source, paired with MediaPackage V2 endpoints for landscape and portrait output |
| Event | A time-bounded session (e.g., a game) associated with a channel. Controls when highlight detection is active |
| Clip | A video segment detected by AI or created manually. Stored as HLS in S3 with metadata in DynamoDB |
| Template | Defines output settings for highlight generation: resolution, format, clip length, key moment types, sport type |

### Clip Lifecycle

```
detected → processing → original → edit_in_progress → modified
                                                     → discarded
                                 → review_in_progress → reviewed → published
```

- `detected` — AI identified a highlight moment
- `processing` — harvest job is running (extracting HLS from the live stream)
- `original` — harvest complete, clip is ready for review
- `edit_in_progress` — operator is editing the clip
- `modified` — edits have been processed, new version created
- `discarded` — operator rejected the clip
- `reviewed` / `published` — editorial workflow states


---

## Channel Management

Channels are managed from the **Channels** page in the web application. Each channel represents a MediaLive channel paired with MediaPackage V2 resources for video harvesting.

### Creating a Channel

1. Navigate to **Channels** and click **Create Channel**
2. Provide:
   - **Channel Name** — a descriptive name
   - **Input Type** — currently supports `MP4_FILE` (S3-hosted video). Future support for RTMP, RTP, UDP
   - **Input URL** — S3 URI of the video source (e.g., `s3://bucket/game.mp4`)
   - **Input Name** — name for the MediaLive input resource
3. Click **Create**

Channel creation is orchestrated by a Step Functions state machine that provisions:
- A MediaLive input (with redundant sources)
- A MediaLive channel with dual-output encoder settings (landscape + portrait)
- MediaPackage V2 channel and origin endpoints
- An Elemental Inference feed for AI highlight detection
- A DynamoDB record linking all resources together

The channel state progresses through: `CREATING` → `IDLE` → `STARTING` → `RUNNING` → `STOPPING` → `STOPPED`.

### Starting and Stopping Channels

Use the **Start** / **Stop** buttons on the Channels page. A running channel is actively ingesting video and can generate highlights. The page auto-refreshes channel state every 30 seconds.

### Deleting a Channel

Deletion is also orchestrated by a Step Functions state machine that tears down all associated MediaLive, MediaPackage, and Inference resources.

---

## Event Management

Events represent time-bounded sessions (e.g., a single game or broadcast window) and are managed from the **Home** page.

### Creating an Event

1. Click **Create Event** on the Home page
2. Configure:
   - **Name** and **Description**
   - **Channel** — select the MediaLive channel
   - **Start/End DateTime** and **Duration**
   - **Sport Type** — determines which AI moments are detected (soccer, football, basketball, baseball)
   - **Auto Generate Highlights** — enable AI-driven clip creation
   - **Generate MP4** — whether to auto-generate MP4 outputs
   - **Template** — optional output settings template
3. Click **Create**

### Event Status

| Status | Meaning |
|--------|---------|
| `scheduled` | Future event, not yet active |
| `live` | Currently active, highlight detection running |
| `ended` | Past the end time |
| `idle` | No active processing |

### Activating Inference

When an event is activated, the system enables the Elemental Inference feed on the associated channel. This starts AI analysis of the live stream. Deactivating stops highlight detection.

The system supports an **auto-activate** setting that automatically enables inference when an event's start time arrives (managed by the `auto-activate-scheduler` Lambda).


---

## Clip Processing Pipeline

This is the core data pipeline that turns a live stream moment into a downloadable video clip.

### Step 1: Highlight Detection (Inference → EventBridge)

AWS Elemental Inference monitors the live stream and emits EventBridge events when it detects key moments. The event payload includes:

- `startPts` / `endPts` — presentation timestamps (in a 90kHz timescale)
- `description` — what was detected (e.g., "goal", "celebration")
- `tags` — categorization labels
- `channelId` — which channel the moment was detected on

The harvest pipeline Lambda converts PTS values to ISO 8601 timestamps and creates a clip record in DynamoDB with status `processing`.

### Step 2: Event Association

The pipeline attempts to associate each detected clip with an active event by:
1. Looking up events linked to the same MediaLive channel
2. Checking if the clip's timestamp falls within the event's time window (configurable, default 30 minutes)
3. Matching via the Inference feed's `callbackMetadata` against event names

### Step 3: Auto-Harvest (Step Functions)

If the `autoHarvest` system setting is enabled, the **Auto-Harvest Workflow** state machine runs:

1. Reads the `autoHarvest` setting from the SystemSettings table
2. If enabled, creates harvest jobs for both landscape and portrait orientations in parallel
3. Each orientation branch:
   - Calls the **harvest-task** Lambda to create a MediaPackage V2 harvest job
   - Polls the job status every 30 seconds via the **harvest-poll** Lambda
   - Validates the output with the **harvest-validate** Lambda (checks S3 for valid HLS segments)
   - Updates the clip's `sourceKeys` map in DynamoDB with the S3 prefix for each orientation
4. Finalizes the clip status to `original` if at least one orientation succeeded

### Step 4: Harvest Job Details

Each harvest job tells MediaPackage V2 to extract a time range from the live stream and write HLS segments to S3:

- **Input**: channel group, origin endpoint (landscape or portrait), start/end time
- **Output**: HLS manifest + `.ts` segments written to `harvested-clips/{channelId}/{date}/{clipId}/`
- **Polling**: the harvest-poll Lambda checks `mediapackagev2.getHarvestJob()` until status is `COMPLETED` or `FAILED`
- **Validation**: the harvest-validate Lambda lists S3 objects at the output prefix and confirms valid HLS content exists

### Step 5: Orientation-Specific Endpoints

Each channel has two MediaPackage V2 origin endpoints:
- **Landscape endpoint** — standard 16:9 output (1920×1080)
- **Portrait/Vertical endpoint** — 9:16 output (1080×1920)

The harvest pipeline uses `ChannelConfig.get_origin_endpoint_for_orientation()` to select the correct endpoint. The clip's `sourceKeys` map stores the S3 prefix for each orientation:

```json
{
  "sourceKeys": {
    "landscape": "harvested-clips/channel-123/2025-04-01/clip-abc/",
    "portrait": "harvested-clips/channel-123/2025-04-01/clip-abc-portrait/"
  },
  "harvestedOrientations": ["landscape", "portrait"]
}
```

### Harvest Buffer

The `harvestBufferSeconds` system setting (0–5 seconds) adds padding before and after the detected moment to ensure the full highlight is captured.

### Harvest Cleanup

The **harvest-cleanup** Lambda runs on a schedule and removes harvest job records older than the configured `harvestRetentionDays` (default: 30). A `harvestCleanupDryRun` setting allows previewing what would be deleted.


---

## Video Editing

The **Clip Editor** page provides a browser-based video editor for refining clips before export.

### Accessing the Editor

From the Home page, select a clip and click **Edit** (or click the clip name). The editor loads the clip's HLS source from S3 via a signed URL and renders it using the Omakase Player.

### Editing Operations

The editor supports four operation types:

| Operation | Description |
|-----------|-------------|
| **Trim** | Set new in/out points. Drag the yellow handles on the trim timeline to define the portion of the clip to keep |
| **Split** | Divide the clip into segments at specific points. Toggle "Split Mode" and click on the segments timeline to add split points |
| **Delete** | Remove a segment. Click a segment to toggle it off (turns red). Disabled segments are excluded from the final output |
| **Merge** | Combine multiple segments (reserved for future use) |

### Editor Interface

The editor has two timelines:

1. **Trim Timeline** (yellow handles) — defines the overall boundaries of the output video
2. **Segments Timeline** (green/red blocks) — shows individual segments after splits. Green segments are included; red segments are excluded

### Processing a Video

After making edits:

1. Click **Process Video**
2. The system creates a `VideoProcessingJob` with your edit operations
3. The job is submitted to MediaConvert, which applies the operations and produces a new HLS output
4. The new clip is stored in S3 with a reference back to the original (`originalAssetId`)
5. Track progress in the **Processing Jobs** tab

Processing parameters include:
- `operations` — the list of trim/split/delete operations with timestamps
- `outputSettings` — format (HLS/MP4), quality (high/medium/low), resolution
- `orientation` — landscape, portrait, or both

### Generated Clips

The **Generated Clips** tab shows all clips derived from the current clip. Each generated clip can be further edited or exported independently. The `originalAssetId` field maintains the lineage chain.

### Clip Locking

Clips can be locked to prevent accidental edits. A locked clip's editor is read-only until unlocked.


---

## Downloading and Exporting

The download system converts HLS clips to MP4 files for distribution.

### Download Workflow (Step Functions)

When a user requests a download, the **Download Workflow** state machine runs:

1. **Resolve Orientations** — checks which orientations are already harvested vs. need harvesting. Reads the clip's `sourceKeys` and `harvestedOrientations` from DynamoDB
2. **Parallel Processing** — for each requested orientation (landscape, portrait, or both):
   - If the orientation hasn't been harvested yet, runs the full harvest pipeline (harvest-task → poll → validate)
   - Submits a **MediaConvert transcode job** to convert HLS to MP4
   - Polls the transcode job until complete
3. **Update Records** — writes the output S3 key and status to the DownloadJobs table

### Transcode Settings

MediaConvert jobs use these settings per orientation:

| Setting | Landscape | Portrait |
|---------|-----------|----------|
| Resolution | 1920×1080 | 1080×1920 |
| Video Codec | H.264 High Profile | H.264 High Profile |
| Rate Control | QVBR (quality level 7) | QVBR (quality level 7) |
| Max Bitrate | 5 Mbps | 5 Mbps |
| Audio | AAC 128kbps, 48kHz stereo | AAC 128kbps, 48kHz stereo |
| Container | MP4 | MP4 |

Output files are written to: `downloads/clip/{clipId}/{orientation}/`

### Requesting a Download

From the web application:

1. Select one or more clips
2. Choose orientation: landscape, portrait, or both
3. Click **Download**
4. The system creates download job records and starts the Step Functions execution
5. Poll for status — when complete, a presigned S3 URL is generated (valid for 1 hour)

The download API supports up to 20 items per request. If a clip already has an in-progress download, it's skipped to avoid duplicate work.

### Direct MP4 Download

If a clip already has an `mp4Key` (from a previous processing job), the system can generate a presigned URL directly without running the full download workflow.


---

## System Settings

Configurable via the Settings page or the `/api/settings/{key}` API endpoint.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autoHarvest` | boolean | `false` | Automatically harvest clips when highlights are detected |
| `harvestBufferSeconds` | integer (0–5) | `0` | Seconds of padding added before/after detected moments |
| `autoActivateInference` | boolean | `false` | Automatically activate Inference when an event's start time arrives |
| `autoActivateConflictResolution` | enum | `prefer_running` | How to resolve conflicts when multiple events share a channel. Options: `prefer_running`, `prefer_latest_start` |
| `harvestRetentionDays` | integer | `30` | Days to retain harvest job records before cleanup |
| `harvestCleanupDryRun` | boolean | `true` | Preview cleanup without deleting (set to `false` to enable actual deletion) |

Settings are stored in the SystemSettings DynamoDB table and seeded with defaults on first deployment (existing values are never overwritten).

---

## Data Model Reference

### DynamoDB Tables

| Table | Partition Key | Notable GSIs | Purpose |
|-------|--------------|--------------|---------|
| Events | `id` | `MediaLiveChannelIndex`, `EventNameIndex` | Event sessions (games, broadcasts) |
| Channels | `id` | `FeedArnIndex` | MediaLive channels + MediaPackage config |
| Clips | `id` | `EventIdIndex` | Video clips with edit state and source keys |
| Templates | `id` | `GameTypeEventIndex` | Output settings for highlight generation |
| HarvestJobs | `job_id` | `StatusIndex`, `ChannelIndex` | MediaPackage V2 harvest job tracking |
| DownloadJobs | `jobId` | — | Download/transcode job tracking |
| SystemSettings | `settingKey` | — | Global configuration key-value pairs |
| VideoJobs | `jobId` | — | Video processing job tracking |

### Key Clip Fields

| Field | Type | Description |
|-------|------|-------------|
| `sourceKey` | string | Current S3 key for the clip's HLS content |
| `sourceKeys` | map | Orientation → S3 prefix map (e.g., `{"landscape": "...", "portrait": "..."}`) |
| `originalSourceKey` | string | S3 key before any edits |
| `originalAssetId` | string | ID of the parent clip (for generated/edited clips) |
| `harvestedOrientations` | string set | Which orientations have been harvested (`["landscape", "portrait"]`) |
| `editOperations` | list | Ordered list of trim/split/delete operations applied |
| `mp4Key` | string | S3 key for the transcoded MP4 file |
| `downloadJobId` | string | Active download job reference |
| `locked` | boolean | Whether the clip is locked for editing |
| `tags` | list | AI-generated tags from Inference (e.g., "goal", "celebration") |
| `customTags` | list | User-added tags |
| `latency` | number | Detection-to-availability latency in seconds |
| `harvestingTime` | number | Time from detection to harvest completion in seconds |


---

## S3 Storage Layout

All video assets are stored in a single S3 bucket with organized prefixes:

```
videoAssetsBucket/
├── harvested-clips/                    # Raw HLS from MediaPackage harvest jobs
│   └── {channelId}/
│       └── {YYYY-MM-DD}/
│           └── {clipId}/
│               ├── main.m3u8          # HLS master manifest
│               └── *.ts               # HLS segments
├── downloads/                          # Transcoded MP4 outputs
│   └── clip/
│       └── {clipId}/
│           └── {orientation}/
│               └── *-{clipId}-{orientation}.mp4
├── events/                             # Raw event video assets
│   └── (transitioned to IA after 30d, Glacier after 90d)
├── processing-jobs/                    # Intermediate processing artifacts
│   └── (auto-deleted after 30d)
└── temp/                               # Temporary files
    └── (auto-deleted after 7d)
```

### Lifecycle Policies

| Prefix | Policy |
|--------|--------|
| `events/` | Transition to Infrequent Access after 30 days, Glacier after 90 days |
| `temp/` | Auto-delete after 7 days |
| `processing-jobs/` | Auto-delete after 30 days |
| Incomplete multipart uploads | Abort after 1 day |

---

## API Endpoints

All API routes are served through API Gateway v2 behind CloudFront at `/api/`.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/events` | List or create events |
| GET/PUT/DELETE | `/api/events/{id}` | Get, update, or delete an event |
| POST | `/api/events/{id}/activate` | Enable Inference for an event |
| POST | `/api/events/{id}/deactivate` | Disable Inference for an event |
| GET/POST | `/api/clips` | List or create clips |
| GET | `/api/clips?eventId={id}` | List clips for a specific event |
| GET/PUT/DELETE | `/api/clips/{id}` | Get, update, or delete a clip |
| GET/POST | `/api/channels` | List or create channels |
| GET/DELETE | `/api/channels/{id}` | Get or delete a channel |
| GET | `/api/channels/{id}/status` | Get MediaLive channel state |
| POST | `/api/channels/{id}/start` | Start a channel |
| POST | `/api/channels/{id}/stop` | Stop a channel |
| POST | `/api/download-clips` | Create download jobs (up to 20 items) |
| GET | `/api/download-clips/{jobId}` | Get download job status + presigned URLs |
| POST | `/api/download-clips/presign` | Get presigned URL for an S3 key |
| GET/PUT | `/api/settings/{settingKey}` | Read or update a system setting |
| GET/POST | `/api/templates` | List or create templates |
| GET/PUT/DELETE | `/api/templates/{id}` | Get, update, or delete a template |
| GET/POST | `/api/jobs` | List or create processing jobs |
| GET | `/api/jobs/{id}` | Get processing job status |

---

## Supported Sports and Key Moments

| Sport | Detected Moments |
|-------|-----------------|
| Soccer | Goals, Saves, Celebrations, Fouls |
| Football | Touchdowns, Field Goals, Interceptions |
| Basketball | Shots, Dunks, Free Throws |
| Baseball | Home Runs, Strikes, Hits |

The sport type is configured per event and determines which Inference model is used for highlight detection.
