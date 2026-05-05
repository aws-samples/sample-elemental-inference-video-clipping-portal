# Sample Elemental Inference Video Clipping Portal

A video clipping portal for live sports content, powered by AWS Elemental Inference, in conjunction with other AWS Media Services for AI-driven smart-cropping and highlight detection.

Operators can manage live video channels, automatically detect highlights from live streams, harvest and edit clips in both landscape and portrait orientations, and export finished MP4s for distribution.

## How It Works

```
Live Video → MediaLive → MediaPackage V2 → Inference AI (highlight detection)
                                                  ↓
                                          EventBridge event
                                                  ↓
                                     Harvest Pipeline (Step Functions)
                                          ↓              ↓
                                    Landscape HLS    Portrait HLS
                                          ↓              ↓
                                     Clip stored in S3 + DynamoDB
                                                  ↓
                                     Web App (edit, trim, split)
                                                  ↓
                                     MediaConvert transcode → MP4 download
```

1. A MediaLive channel ingests a video source and streams it through MediaPackage V2
2. AWS Elemental Inference analyzes the stream and emits EventBridge events when highlights are detected (goals, saves, touchdowns, etc.)
3. The harvest pipeline automatically creates MediaPackage V2 harvest jobs to capture the clip in both landscape (1920×1080) and portrait (1080×1920) orientations
4. Harvested HLS segments are stored in S3 and clip metadata is tracked in DynamoDB
5. Operators use the web application to review, edit (trim, split, delete sections), and process clips
6. The download workflow transcodes HLS to MP4 via MediaConvert and provides presigned download URLs

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Cloudscape Design System |
| Auth | Amazon Cognito via AWS Amplify |
| API | API Gateway v2 (HTTP) → Lambda (Python + TypeScript) |
| Orchestration | Step Functions (ASL JSON) |
| Video | MediaLive, MediaPackage V2, MediaConvert |
| AI | AWS Elemental Inference (highlight detection) |
| Storage | S3 (video assets), DynamoDB (metadata) |
| CDN | CloudFront + WAFv2 |
| Infrastructure | AWS CDK v2 (TypeScript), cdk-nag compliance |

## Project Structure

```
.
├── api/                    # Lambda functions (Python + TypeScript)
│   └── src/
│       ├── channels-python/        # Channel CRUD
│       ├── clips/                  # Clip CRUD (TypeScript)
│       ├── events/                 # Event CRUD (TypeScript)
│       ├── harvest-pipeline-python/# EventBridge → harvest job creation
│       ├── harvest-task/           # Execute harvest job
│       ├── harvest-poll/           # Poll harvest status
│       ├── harvest-validate/       # Validate harvest output
│       ├── harvest-cleanup/        # Clean up old harvest jobs
│       ├── transcode-task/         # Submit MediaConvert job
│       ├── transcode-poll/         # Poll transcode status
│       ├── download-api/           # Download orchestration + presigned URLs
│       ├── video-processor/        # Video processing utilities
│       ├── medialive-api-client/   # MediaLive API wrapper
│       ├── medialive-status/       # Channel status checks
│       ├── create-feed-lambda/     # Inference feed creation
│       ├── auto-activate-scheduler/# Scheduled inference activation
│       ├── mediaconvert-completion-handler/ # MediaConvert callback
│       ├── jobs-api/               # Processing jobs management
│       ├── system-settings/        # System settings API
│       └── templates/              # Template management
├── deploy/                 # CDK infrastructure (TypeScript)
│   └── src/
│       ├── app-stack.ts            # Main application stack
│       ├── cf-waf-stack.ts         # WAF stack (us-east-1)
│       ├── constructs/             # Reusable CDK constructs
│       └── state-machines/         # Step Functions ASL definitions
├── web-app/                # React SPA
│   └── src/
│       ├── pages/                  # Home, Channels, ClipEditor, Settings, Docs
│       ├── components/             # UI components
│       ├── services/               # API + download + video services
│       ├── hooks/                  # useAuth, useClips, useEvents, useJobs
│       └── types/                  # TypeScript type definitions
└── scripts/                # Utility scripts (fetch-config.sh for local dev)
```

## Quick Start

```bash
# Prerequisites: Node.js >= 20.19, Python >= 3.8, Docker, AWS CLI

# Build everything
npm run build

# Bootstrap CDK (first time only)
npm run deploy.bootstrap

# Deploy
npm run deploy

# Create a Cognito user, then open the CloudFront URL from CDK outputs
```

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for detailed setup and deployment instructions.

See [USER_GUIDE.md](./USER_GUIDE.md) for the operator guide covering channel management, clip processing, video editing, and data handling.

## Common Commands

```bash
npm run build              # Build all components
npm run build.api          # Build Lambda functions only
npm run build.web          # Build React app only
npm run build.deploy       # Build CDK only
npm run deploy             # Deploy all stacks
npm run destroy            # Tear down all stacks
STACK_NAME="my-stack" npm run deploy  # Deploy with custom stack name
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for build and deployment conventions.

## License

See [LICENSE](./LICENSE).
