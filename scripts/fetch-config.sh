#!/bin/bash

# Script to fetch Amplify configuration from deployed CloudFront distribution
# Usage: ./scripts/fetch-config.sh [stack-name] [aws-profile]
# Examples:
#   ./scripts/fetch-config.sh
#   ./scripts/fetch-config.sh elemental-clip-portal
#   ./scripts/fetch-config.sh elemental-clip-portal demo-dev

set -e

STACK_NAME="${1:-elemental-clip-portal}"
AWS_PROFILE="${2:-${AWS_PROFILE}}"
OUTPUT_FILE="web-app/public/config.json"

# Build AWS CLI profile argument if profile is specified
PROFILE_ARG=""
if [ -n "$AWS_PROFILE" ]; then
  PROFILE_ARG="--profile $AWS_PROFILE"
  echo "Using AWS profile: $AWS_PROFILE"
fi

echo "Fetching CloudFront URL from CDK stack outputs..."
echo "Stack: $STACK_NAME"

# Get CloudFront URL from CDK outputs
# Try multiple possible output key patterns (handles CDK-generated hash suffixes)
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
  $PROFILE_ARG \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?contains(OutputKey, 'CloudFrontDistributionUrl')].OutputValue | [0]" \
  --output text)

# Fallback: try to construct URL from domain name if direct URL not found
if [ -z "$CLOUDFRONT_URL" ] || [ "$CLOUDFRONT_URL" = "None" ]; then
  echo "CloudFront URL output not found, trying domain name..."
  CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks \
    $PROFILE_ARG \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?contains(OutputKey, 'CloudFrontDistributionDomainName')].OutputValue | [0]" \
    --output text)
  
  if [ -n "$CLOUDFRONT_DOMAIN" ] && [ "$CLOUDFRONT_DOMAIN" != "None" ]; then
    CLOUDFRONT_URL="https://${CLOUDFRONT_DOMAIN}"
  fi
fi

if [ -z "$CLOUDFRONT_URL" ] || [ "$CLOUDFRONT_URL" = "None" ]; then
  echo "Error: Could not find CloudFront URL in stack outputs"
  echo ""
  echo "Available stacks:"
  aws cloudformation list-stacks $PROFILE_ARG --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[].StackName" --output table
  echo ""
  echo "Available outputs for stack '$STACK_NAME':"
  aws cloudformation describe-stacks $PROFILE_ARG --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" --output table
  exit 1
fi

echo "CloudFront URL: $CLOUDFRONT_URL"
echo "Fetching config.json from CloudFront..."

# Fetch the config file
curl -s "${CLOUDFRONT_URL}/config.json" -o "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
  echo "✓ Successfully fetched config to $OUTPUT_FILE"
  echo ""
  echo "Config contents:"
  cat "$OUTPUT_FILE" | jq '.' 2>/dev/null || cat "$OUTPUT_FILE"
else
  echo "✗ Failed to fetch config from CloudFront"
  exit 1
fi
