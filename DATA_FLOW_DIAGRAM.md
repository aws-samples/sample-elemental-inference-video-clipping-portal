# Data Flow Diagram

## Overview

This document describes the data flows through the Sample Elemental Inference Video Clipping Portal, covering ingestion, AI processing, harvesting, editing, and export paths.

---

## High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL INPUTS                                         │
│                                                                                      │
│   ┌──────────────┐         ┌──────────────────┐                                     │
│   │ Video Source │         │  Operator (User) │                                     │
│   │ (S3 MP4 File)│         │  via Browser     │                                     │
│   └──────┬───────┘         └────────┬─────────┘                                     │
└──────────┼──────────────────────────┼───────────────────────────────────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐       ┌─────────────────────┐
│  AWS Elemental   │       │     CloudFront      │
│    MediaLive     │       │   (CDN + WAFv2)     │
│  (Video Ingest)  │       │                     │
└────────┬─────────┘       └──────┬──────────────┘
         │                        │
         │ Dual-output encode     │ Routes to:
         │ (landscape + portrait) │  ├─ /        → S3 (React SPA)
         │                        │  ├─ /api/*   → API Gateway
         ▼                        │  └─ /assets  → S3 (Video Assets)
┌──────────────────┐              │
│  AWS Elemental   │              ▼
│  MediaPackage V2 │       ┌─────────────────────┐
│  (JITP Origin)   │       │   API Gateway v2    │
│                  │       │   (HTTP API)        │
│  ┌────────────┐  │       │   + Cognito Auth    │
│  │ Landscape  │  │       └──────┬──────────────┘
│  │ Endpoint   │  │              │
│  ├────────────┤  │              ▼
│  │ Portrait   │  │       ┌─────────────────────┐
│  │ Endpoint   │  │       │   Lambda Functions  │
│  └────────────┘  │       │   (API Handlers)    │
└────────┬─────────┘       └──────┬──────────────┘
         │                        │
         │                        ▼
         │                 ┌─────────────────────┐
         │                 │     DynamoDB        │
         │                 │  (7 Tables)         │
         │                 └─────────────────────┘
         │
         ▼
┌──────────────────┐
│  AWS Elemental   │
│    Inference     │
│  (AI Analysis)   │
└────────┬─────────┘
         │
         │ Key moment events
         ▼
┌──────────────────┐
│   EventBridge    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐       ┌─────────────────────┐
│ Harvest Pipeline │──────▶│        S3           │
│   (Lambda)       │       │  (Video Assets)     │
└────────┬─────────┘       └─────────────────────┘
         │                          ▲
         ▼                          │
┌──────────────────┐                │
│ Step Functions   │────────────────┘
│ (Harvest/Download│
│  Workflows)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  MediaConvert    │
│  (Transcoding)   │
└──────────────────┘
```

---

## Detailed Data Flows

### Flow 1: Video Ingestion

```
Video Source (S3)
    │
    │ [1] MP4 file read via S3 URI
    ▼
MediaLive Input
    │
    │ [2] Encode to dual outputs:
    │     • Landscape (1920×1080, 16:9)
    │     • Portrait  (1080×1920, 9:16) — using Inference smart-crop coordinates
    ▼
MediaPackage V2 Channel Group
    │
    │ [3] Just-in-time packaging (HLS)
    ▼
MediaPackage V2 Origin Endpoints
    ├── Landscape Origin Endpoint
    └── Portrait Origin Endpoint
```

**Data types:** Raw video (H.264), HLS manifests (.m3u8), HLS segments (.ts)

---

### Flow 2: AI Highlight Detection

```
MediaLive Output
    │
    │ [1] Live stream sent to Inference feed
    ▼
Elemental Inference Feed
    │
    │ [2] AI analysis:
    │     • Smart-cropping coordinates → returned to MediaLive
    │     • Key moment detection (goals, saves, etc.)
    │
    │ [3] Key moment detected
    ▼
EventBridge Event
    │
    │ Payload:
    │   • startPts / endPts (90kHz timescale)
    │   • description (e.g., "goal")
    │   • tags (categorization)
    │   • channelId
    │
    │ [4] Event rule triggers Lambda
    ▼
Harvest Pipeline Lambda
    │
    │ [5] Convert PTS → ISO 8601 timestamps
    │ [6] Look up active event for channel
    │ [7] Create clip record in DynamoDB (status: "processing")
    │
    ├──▶ DynamoDB (Clips table)
    │
    │ [8] If autoHarvest enabled, start workflow
    ▼
Step Functions (Auto-Harvest Workflow)
```

**Data types:** EventBridge JSON events, DynamoDB items, Step Functions execution input

---

### Flow 3: Harvest Pipeline (Clip Extraction)

```
Step Functions (Auto-Harvest Workflow)
    │
    │ [1] Read autoHarvest setting
    ▼
SystemSettings Table (DynamoDB)
    │
    │ [2] If enabled, parallel harvest for each orientation
    ▼
┌────────────────────────────────────────────-─┐
│           PARALLEL BRANCHES                  │
│                                              │
│  ┌─────────────────┐  ┌─────────────────┐    │
│  │   Landscape     │  │    Portrait     │    │
│  └────────┬────────┘  └────────┬────────┘    │
│           │                     │            │
│           ▼                     ▼            │
│  harvest-task Lambda    harvest-task Lambda  │
│     │                      │                 │
│     │ [3] Create MediaPackage V2 harvest job │
│     ▼                      ▼                 │
│  MediaPackage V2      MediaPackage V2        │
│  (extract HLS)        (extract HLS)          │
│     │                      │                 │
│     │ [4] Poll every 30s   │                 │
│     ▼                      ▼                 │
│  harvest-poll Lambda  harvest-poll Lambda    │
│     │                      │                 │
│     │ [5] Validate output  │                 │
│     ▼                      ▼                 │
│  harvest-validate     harvest-validate       │
│     │                      │                 │
│     │ [6] Write HLS to S3  │                 │
│     ▼                      ▼                 │
│  S3: harvested-clips/ S3: harvested-clips/   │
│                                              │
└─────────────────────────────────────────────-┘
    │
    │ [7] Update clip record:
    │     • sourceKeys map (orientation → S3 prefix)
    │     • harvestedOrientations
    │     • status → "original"
    ▼
DynamoDB (Clips table)
```

**Data types:** HLS manifests (.m3u8), HLS segments (.ts), DynamoDB items

**S3 output path:** `harvested-clips/{channelId}/{YYYY-MM-DD}/{clipId}/`

---

### Flow 4: Video Editing

```
Operator (Browser)
    │
    │ [1] Select clip, open editor
    ▼
CloudFront → S3
    │
    │ [2] Fetch HLS source via presigned URL
    ▼
Omakase Player (Browser)
    │
    │ [3] Operator performs edits:
    │     • Trim (in/out points)
    │     • Split (segment division)
    │     • Delete (remove segments)
    │
    │ [4] Click "Process Video"
    ▼
API Gateway → Jobs API Lambda
    │
    │ [5] Create VideoProcessingJob record
    │     Payload:
    │       • operations (trim/split/delete with timestamps)
    │       • outputSettings (format, quality, resolution)
    │       • orientation
    ▼
DynamoDB (VideoJobs table)
    │
    │ [6] Submit MediaConvert job
    ▼
MediaConvert
    │
    │ [7] Process video:
    │     • Apply edit operations
    │     • Produce new HLS output
    │
    │ [8] Write output to S3
    ▼
S3 (processing-jobs/)
    │
    │ [9] EventBridge completion event
    ▼
MediaConvert Completion Handler Lambda
    │
    │ [10] Update VideoJobs table (status: complete)
    │ [11] Update Clips table (new sourceKey, originalAssetId)
    ▼
DynamoDB (VideoJobs + Clips tables)
```

**Data types:** Edit operation JSON, HLS video, MP4 video, DynamoDB items

---

### Flow 5: Download / Export

```
Operator (Browser)
    │
    │ [1] Select clips, choose orientation, click Download
    ▼
API Gateway → Download API Lambda
    │
    │ [2] Create DownloadJob records
    │ [3] Start Step Functions execution
    ▼
Step Functions (Download Workflow)
    │
    │ [4] Resolve orientations:
    │     • Check which are already harvested
    │     • Harvest missing orientations if needed
    │
    │ [5] For each orientation:
    ▼
┌───────────────────────────────────────────-──┐
│           PER-ORIENTATION                    │
│                                              │
│  [6] If not harvested → run harvest pipeline │
│                                              │
│  [7] Submit MediaConvert transcode job       │
│      • Input: HLS from S3                    │
│      • Output: MP4                           │
│      • Settings:                             │
│        - H.264 High Profile                  │
│        - QVBR quality 7                      │
│        - 5 Mbps max bitrate                  │
│        - AAC 128kbps stereo                  │
│                                              │
│  [8] Poll transcode job until complete       │
│                                              │
│  [9] Write MP4 to S3                         │
│      Path: downloads/clip/{clipId}/{orient}/ │
│                                              │
└─────────────────────────────────────────-────┘
    │
    │ [10] Update DownloadJobs table
    ▼
DynamoDB (DownloadJobs table)
    │
    │ [11] Operator polls for completion
    │ [12] Generate presigned S3 URL (1hr expiry)
    ▼
Operator downloads MP4 via presigned URL
```

**Data types:** MP4 video files, presigned URLs, DynamoDB items

---

### Flow 6: Channel Lifecycle (Create / Delete)

```
Operator (Browser)
    │
    │ [1] Create Channel request
    ▼
API Gateway → Channels API Lambda
    │
    │ [2] Start Step Functions execution
    ▼
Step Functions (CreateChannel)
    │
    │ [3] Provision resources (in order):
    │     a. MediaLive Input (redundant sources)
    │     b. MediaLive Channel (dual-output encoder)
    │     c. MediaPackage V2 Channel
    │     d. MediaPackage V2 Origin Endpoints (landscape + portrait)
    │     e. Elemental Inference Feed
    │     f. DynamoDB Channel record
    ▼
DynamoDB (Channels table)

─────────────────────────────────────────────

Operator (Browser)
    │
    │ [4] Delete Channel request
    ▼
Step Functions (DeleteChannel)
    │
    │ [5] Tear down resources (reverse order):
    │     a. Delete Inference Feed
    │     b. Delete MediaPackage Endpoints
    │     c. Delete MediaPackage Channel
    │     d. Delete MediaLive Channel
    │     e. Delete MediaLive Input
    │     f. Remove DynamoDB record
    ▼
Resources cleaned up
```

---

### Flow 7: Auto-Activate Scheduler

```
EventBridge Rule (every 1 minute)
    │
    ▼
Auto-Activate Scheduler Lambda
    │
    │ [1] Read autoActivateInference setting
    ▼
SystemSettings Table
    │
    │ [2] If enabled, scan events table for:
    │     • Events with start time ≤ now AND end time > now
    │     • Events not yet activated
    ▼
Events Table (DynamoDB)
    │
    │ [3] For each qualifying event:
    │     • Look up channel's Inference feed
    │     • Apply conflict resolution strategy
    ▼
Channels Table (DynamoDB)
    │
    │ [4] Invoke create-feed Lambda to enable/disable feed
    ▼
Create Feed Lambda → Elemental Inference API
    │
    │ [5] Update event status
    ▼
Events Table (DynamoDB)
```

---

## Data Storage Summary

| Store | Data Type | Retention |
|-------|-----------|-----------|
| S3 `harvested-clips/` | Raw HLS clips | Managed by harvest-cleanup (configurable days) |
| S3 `downloads/` | Transcoded MP4 files | Indefinite |
| S3 `events/` | Raw event video | 30d → IA, 90d → Glacier |
| S3 `processing-jobs/` | Intermediate artifacts | Auto-deleted after 30 days |
| S3 `temp/` | Temporary files | Auto-deleted after 7 days |
| DynamoDB (all tables) | Metadata & state | Indefinite (PITR enabled) |

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                    AWS ACCOUNT BOUNDARY                         │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              VPC / PRIVATE RESOURCES                      │  │
│  │                                                           │  │
│  │  Lambda Functions, Step Functions, DynamoDB, S3,          │  │
│  │  MediaLive, MediaPackage, MediaConvert, Inference         │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          ▲                                      │
│                          │ IAM-authenticated                    │
│                          │                                      │
│  ┌───────────────────────┴───────────────────────────────────┐  │
│  │              PUBLIC EDGE                                  │  │
│  │                                                           │  │
│  │  CloudFront (WAFv2) → API Gateway (Cognito JWT auth)      │  │
│  │                                                           │  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │ HTTPS (TLS)
                           │
              ┌────────────┴────────────-┐
              │   EXTERNAL / UNTRUSTED   │
              │                          │
              │  Operator Browser        │
              │  (Cognito-authenticated) │
              │                          │
              └─────────────────────────-┘
```

### Authentication & Authorization

- All API requests require a valid Cognito JWT token
- S3 video asset access uses Cognito Identity Pool credentials (authenticated role)
- Presigned URLs for downloads expire after 1 hour
- WAFv2 provides rate limiting and common attack protection at the edge
