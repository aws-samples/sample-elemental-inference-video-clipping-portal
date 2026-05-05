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

Required once per account/region combination. The application deploys two stacks: the main app stack in your target region and a WAF stack in us-east-1 (required for CloudFront).

If deploying to us-east-1:

```bash
npm run deploy.bootstrap
```

If deploying to any other region (e.g., us-west-2), bootstrap both regions:

```bash
cd deploy
npx cdk bootstrap ${AWS_ACCOUNT}/us-east-1 ${AWS_ACCOUNT}/us-west-2 \
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

By default, the stack name is derived from your current git branch. Override with `STACK_NAME`:

```bash
# Deploy using git branch name
npm run deploy

# Deploy with a custom stack name
STACK_NAME="my-stack" npm run deploy
```

To deploy into a different region:

```bash
npm run deploy -- -c region=eu-west-1
```

After deployment, note the CloudFront URL from the CDK outputs. This is the application URL.

## 5. Create a Cognito User

The application uses Cognito for authentication. Create a user after deployment:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <user-pool-id-from-cdk-outputs> \
  --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
  --temporary-password <temp-password>
```

Sign in at the CloudFront URL. You'll be prompted to set a permanent password on first login.

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
