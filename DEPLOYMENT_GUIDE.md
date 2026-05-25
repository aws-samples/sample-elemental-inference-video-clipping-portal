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

By default, the app stack region is determined by your AWS CLI configuration (`AWS_DEFAULT_REGION` or the profile's region). The stack name defaults to `sample-clipping-portal` (defined in `deploy/src/app.ts`) and can be overridden via the `STACK_NAME` env var. Both can be overridden:

```bash
# Deploy using defaults (stack name "sample-clipping-portal", CLI region)
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

The web app needs two things to run locally against your deployed AWS resources:

1. **`web-app/.env.local`** — sets `VITE_CLOUDFRONT_URL`, used by Vite to proxy `/api` requests to your deployed CloudFront distribution.
2. **`web-app/public/config.json`** — the Amplify config (Cognito IDs, S3 bucket, API endpoint). The app fetches this from `/config.json` at startup. It is gitignored because it is deployment-specific.

#### Step 1: Create `.env.local`

From the project root:

```bash
cp web-app/.env.example web-app/.env.local
```

Edit `web-app/.env.local` and set your CloudFront URL (from CDK outputs after deployment):

```
VITE_CLOUDFRONT_URL=https://your-cloudfront-id.cloudfront.net
```

#### Step 2: Fetch `config.json` from your deployed stack

From the project root, run:

```bash
./scripts/fetch-config.sh
```

This queries CloudFormation for your stack's CloudFront URL, downloads `config.json`, and writes it to `web-app/public/config.json`.

If your stack name is not the default (`sample-clipping-portal`), pass it as the first argument:

```bash
./scripts/fetch-config.sh my-stack-name
./scripts/fetch-config.sh my-stack-name my-aws-profile   # also pass an AWS profile
```

To find your stack name:

```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[].StackName" --output table
```

Look for the entry that does **not** end in `-waf` (the `-waf` stack is just the WebACL in us-east-1).

#### Step 3: Start the dev server

From the project root:

```bash
npm start
```

The app runs at `http://localhost:5173`. API requests are proxied to your CloudFront distribution, and `config.json` is served by Vite from `web-app/public/`.

> **Note:** Setting `VITE_CLOUDFRONT_URL` alone is not enough. The dev server only proxies `/api` and `/proxy-video`, not `/config.json`, so without a local `config.json` the app fails to start with `JSON.parse: unexpected character at line 1 column 1` (Vite returns `index.html` as the SPA fallback).

### Running Tests

```bash
# Frontend tests
cd web-app && npm test

# CDK tests
cd deploy && npm test

# Python Lambda tests (example)
cd api/src/harvest-pipeline-python && python -m pytest
```

## 7. Configuration Management

The web application requires an Amplify configuration file (`config.json`) to connect to AWS services (Cognito, API Gateway, S3). This configuration is deployment-specific and not checked into git.

### How Configuration Works

**In production:** The config is deployed to CloudFront by CDK during deployment via the `AmplifyConfigBucketConstruct`. The app fetches it at runtime from `/config.json`.

**In local development:** Vite's dev server proxies `/config.json` requests to CloudFront using the `VITE_CLOUDFRONT_URL` from your `.env` file.

### Configuration Files

| File | Purpose | Git-tracked |
|------|---------|-------------|
| `web-app/public/config.json` | Active deployment config | No (gitignored) |
| `web-app/public/config.local.json` | Local backup of last known config | Yes |
| `web-app/.env` | Environment variables including `VITE_CLOUDFRONT_URL` | No |

### Recovering Lost Configuration

If you switch branches and lose your `config.json`:

**Option 1: Fetch from CloudFront (recommended)**
```bash
./scripts/fetch-config.sh [stack-name]
```

This queries your CDK stack for the CloudFront URL, downloads config.json, and saves it to `web-app/public/config.json`.

**Option 2: Copy from local backup**
```bash
cp web-app/public/config.local.json web-app/public/config.json
```

**Option 3: Manual retrieval via AWS CLI**
```bash
# Get CloudFront URL from stack outputs (replace with your stack name)
aws cloudformation describe-stacks \
  --stack-name sample-clipping-portal \
  --query "Stacks[0].Outputs[?contains(OutputKey, 'CloudFrontDistributionUrl')].OutputValue | [0]" \
  --output text

# Fetch config
curl https://YOUR_CLOUDFRONT_URL/config.json -o web-app/public/config.json
```

### Keeping config.local.json Updated

Whenever you redeploy and the config changes:
```bash
cp web-app/public/config.json web-app/public/config.local.json
git add web-app/public/config.local.json
git commit -m "Update local config backup"
```

### Configuration Structure

The config file contains:

```json
{
  "Auth": {
    "Cognito": {
      "userPoolId": "us-west-2_XXXXXXXXX",
      "userPoolClientId": "XXXXXXXXXXXXXXXXXXXXXXXXXX",
      "identityPoolId": "us-west-2:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
    }
  },
  "API": {
    "REST": {
      "api": {
        "endpoint": "./api",
        "region": "us-west-2"
      }
    }
  },
  "Storage": {
    "S3": {
      "bucket": "your-bucket-name",
      "region": "us-west-2"
    }
  }
}
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

### "Failed to load application configuration"

1. Check if `VITE_CLOUDFRONT_URL` is set in `web-app/.env`
2. Verify CloudFront is accessible: `curl https://YOUR_CLOUDFRONT_URL/config.json`
3. Check Vite proxy configuration in `web-app/vite.config.ts`
4. Restore from backup: `cp web-app/public/config.local.json web-app/public/config.json`

### Config Outdated After Redeployment

Run the fetch script to get the latest config:
```bash
./scripts/fetch-config.sh
```
