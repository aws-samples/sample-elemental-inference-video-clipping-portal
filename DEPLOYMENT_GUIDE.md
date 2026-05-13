# Deployment Guide

## Prerequisites

- Node.js >= 20.19 (or 22.12+)
- Python >= 3.8
- Docker Desktop (running)
- AWS CLI configured with credentials that have at least PowerUserAccess + IAMFullAccess
- An AWS account with access to MediaLive, MediaPackage V2, MediaConvert, and Elemental Inference

## 1. Install Dependencies

```bash
npm install

cd api && npm install && cd ..
cd deploy && npm install && cd ..
cd web-app && npm install && cd ..
```

## 2. Bootstrap CDK

Required once per account/region combination. The application deploys two stacks:

1. **WAF stack** — always deployed to **us-east-1** (AWS requires CloudFront-associated WAF WebACLs to reside in us-east-1, regardless of where the rest of your infrastructure lives).
2. **App stack** — deployed to your chosen target region.

If your target region is us-east-1, a single bootstrap covers both stacks:

```bash
npm run deploy.bootstrap
```

If your target region is anything else (e.g., ap-southeast-2), you must bootstrap both us-east-1 (for the WAF stack) and your target region (for the app stack):

```bash
cd deploy
npx cdk bootstrap ${AWS_ACCOUNT}/us-east-1 ${AWS_ACCOUNT}/ap-southeast-2 \
  --qualifier sf2025 \
  --cloudformation-execution-policies "arn:aws:iam::aws:policy/PowerUserAccess,arn:aws:iam::aws:policy/IAMFullAccess"
```

## 3. Build

```bash
npm run build
```

Or build individual components:

```bash
npm run build.api      # Lambda functions
npm run build.web      # React frontend
npm run build.deploy   # CDK infrastructure
```

## 4. Deploy

All deploy commands should be run from the **project root** (not from `deploy/`). The root `npm run deploy` script handles passing `--all` so both the WAF and app stacks are deployed together.

By default, the app stack region is determined by your AWS CLI configuration (`AWS_DEFAULT_REGION` or the profile's region). The stack name is derived from your current git branch. Both can be overridden:

```bash
# Deploy using defaults (git branch name, CLI region)
npm run deploy

# Deploy with a custom stack name
STACK_NAME="my-stack" npm run deploy

# Deploy into a specific region
npm run deploy -- -c region=ap-southeast-2

# Both overrides together
STACK_NAME="my-stack" npm run deploy -- -c region=ap-southeast-2
```

> **Note:** The WAF stack always deploys to us-east-1 regardless of the region you specify. The `-c region=` flag only controls where the app stack is created.

After deployment, note the CloudFront URL from the CDK outputs. This is the application URL.

## 5. Create a Cognito User

The application uses Cognito for authentication. Users sign in with a **username** (not email). Create a user after deployment:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <user-pool-id-from-cdk-outputs> \
  --username <username> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
  --temporary-password <temp-password>
```

Sign in at the CloudFront URL using the username and temporary password. You'll be prompted to set a permanent password on first login.

## 6. Local Development

### Frontend Dev Server

```bash
cd web-app
cp .env.example .env.local
```

Edit `.env.local` and set your CloudFront URL:

```
VITE_CLOUDFRONT_URL=https://your-cloudfront-id.cloudfront.net
```

Then start the dev server:

```bash
cd web-app
npm start
```

The app runs at `http://localhost:5173` with API requests proxied to your deployed CloudFront distribution.

### Running Tests

```bash
# Frontend tests
cd web-app && npm test

# CDK tests
cd deploy && npm test

# Python Lambda tests (example)
cd api/src/harvest-pipeline-python && python -m pytest
```

## Stack Architecture

The deployment creates two CloudFormation stacks:

| Stack | Region | Purpose |
|-------|--------|---------|
| `{name}` | Target region | All application resources (Lambda, DynamoDB, S3, API Gateway, MediaPackage, Step Functions, CloudFront, Cognito) |
| `{name}-waf` | us-east-1 | WAFv2 WebACL for CloudFront (must be in us-east-1) |

### Key Resources Created

- S3 bucket for video assets (with lifecycle policies for cost optimization)
- 7 DynamoDB tables (Events, Channels, Clips, Templates, HarvestJobs, DownloadJobs, SystemSettings)
- MediaPackage V2 channel group with landscape and portrait origin endpoints
- API Gateway v2 (HTTP API) proxied through CloudFront
- Cognito User Pool for authentication
- Step Functions state machines for harvest and download workflows
- MediaConvert endpoint for HLS-to-MP4 transcoding
- EventBridge rules for Inference highlight events
- CloudFront distribution with WAF protection

## Stack Naming Conventions

For team environments, name stacks with your initials and a numeric suffix (e.g., `bab01`) so the team knows who owns each stack.

## Destroying a Stack

```bash
npm run destroy
```

Or with a specific stack name:

```bash
STACK_NAME="my-stack" npm run destroy
```

Note: S3 buckets with content and DynamoDB tables are set to `DESTROY` removal policy in development. For production, change these to `RETAIN` in the CDK code.

## Troubleshooting

### Docker Not Found
Install and start Docker Desktop. Verify with `docker --version`.

### No Space Left on Device (Docker)
```bash
docker image prune -a
```

### CDK Bootstrap Required
If deployment fails with bootstrap errors, run `npm run deploy.bootstrap`.

### Node Version Issues
Ensure Node.js 20.19+ or 22.12+:
```bash
node --version
```

### Cross-Platform Notes
The build system uses Python's `subprocess` module. On Windows, `shutil.which()` is used to locate executables since `PATH` isn't always passed to subprocesses.
