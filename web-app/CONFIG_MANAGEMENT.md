# Configuration Management Guide

## Overview

The web application requires an Amplify configuration file to connect to AWS services (Cognito, API Gateway, S3). This configuration is deployment-specific and not checked into git.

## Configuration Files

- `public/config.json` - Deployment-specific config (gitignored, fetched from CloudFront)
- `public/config.local.json` - Local backup config (checked into git)
- `.env` - Environment variables including `VITE_CLOUDFRONT_URL`

## How It Works

### In Production
The config is deployed to CloudFront by CDK during deployment via the `AmplifyConfigBucketConstruct`.

### In Local Development
Vite's dev server proxies `/config.json` requests to CloudFront using the `VITE_CLOUDFRONT_URL` from your `.env` file.

## Recovering Lost Configuration

If you switch branches and lose your `config.json`, you have several options:

### Option 1: Fetch from CloudFront (Recommended)
```bash
./scripts/fetch-config.sh [stack-name]
```

This script:
1. Queries your CDK stack for the CloudFront URL
2. Downloads the config.json from CloudFront
3. Saves it to `web-app/public/config.json`

### Option 2: Copy from Local Backup
```bash
cp web-app/public/config.local.json web-app/public/config.json
```

### Option 3: Manual Retrieval via AWS CLI
```bash
# Get CloudFront URL from stack outputs
aws cloudformation describe-stacks \
  --stack-name elemental-clip-portal \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionUrl'].OutputValue" \
  --output text

# Fetch config
curl https://YOUR_CLOUDFRONT_URL/config.json -o web-app/public/config.json
```

## Preventing Future Issues

### Keep config.local.json Updated
Whenever you update your deployment and the config changes:
```bash
cp web-app/public/config.json web-app/public/config.local.json
git add web-app/public/config.local.json
git commit -m "Update local config backup"
```

### Use Git Hooks (Optional)
Create a post-checkout hook to automatically restore config:
```bash
# .git/hooks/post-checkout
#!/bin/bash
if [ ! -f web-app/public/config.json ] && [ -f web-app/public/config.local.json ]; then
  echo "Restoring config.json from local backup..."
  cp web-app/public/config.local.json web-app/public/config.json
fi
```

## Troubleshooting

### "Failed to load application configuration"

1. Check if `VITE_CLOUDFRONT_URL` is set in `.env`:
   ```bash
   cat web-app/.env | grep VITE_CLOUDFRONT_URL
   ```

2. Verify CloudFront is accessible:
   ```bash
   curl https://YOUR_CLOUDFRONT_URL/config.json
   ```

3. Check Vite proxy configuration in `web-app/vite.config.ts`

4. Restore from backup:
   ```bash
   cp web-app/public/config.local.json web-app/public/config.json
   ```

### Config is outdated after redeployment

Run the fetch script to get the latest config:
```bash
./scripts/fetch-config.sh
```

## Configuration Structure

The config file contains:
- **Auth.Cognito**: User pool and identity pool IDs for authentication
- **API.REST**: API Gateway endpoint configuration
- **Storage.S3**: S3 bucket for video assets
- **aws_cloudfront_url**: CloudFront distribution URL

Example:
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
