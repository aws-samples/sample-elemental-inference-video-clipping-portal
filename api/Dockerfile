# Multi-stage build to get FFmpeg binaries
# Explicitly specify linux/amd64 platform for AWS Lambda compatibility
FROM --platform=linux/amd64 amazonlinux:2 AS ffmpeg-builder

# Install dependencies and FFmpeg
RUN yum update -y && \
    yum install -y wget tar xz && \
    cd /tmp && \
    wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar -xf ffmpeg-release-amd64-static.tar.xz && \
    mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

# Use AWS Lambda Node.js 20 base image with explicit platform
FROM --platform=linux/amd64 public.ecr.aws/lambda/nodejs:20

# Copy FFmpeg binaries from builder stage
COPY --from=ffmpeg-builder /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-builder /usr/local/bin/ffprobe /usr/local/bin/ffprobe

# Verify FFmpeg installation
RUN ffmpeg -version && ffprobe -version

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including TypeScript and ts-node)
RUN npm install && npm cache clean --force

# Copy TypeScript source code
COPY src/ ./src/

# Create JavaScript wrappers for all handlers
RUN echo "require('ts-node/register'); const { handler } = require('./src/video-processor/index.ts'); module.exports = { handler };" > video-processor.js
RUN echo "require('ts-node/register'); const { handler } = require('./src/reels/index.ts'); module.exports = { handler };" > reels.js
RUN echo "require('ts-node/register'); const { handler } = require('./src/reel-processing/index.ts'); module.exports = { handler };" > reel-processing.js
RUN echo "require('ts-node/register'); const { handler } = require('./src/download-processing/index.ts'); module.exports = { handler };" > download-processing.js

# Default to video processor (can be overridden with CMD in CDK)
#checkov:skip=CKV_DOCKER_3:AWS Lambda base images manage user context internally; the runtime executes as non-root regardless of Dockerfile USER directive
CMD ["video-processor.handler"]