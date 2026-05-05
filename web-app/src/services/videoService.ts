/**
 * Video Service for handling video assets using signed URLs
 */

import AmplifyConfigService from "./amplifyConfigService";

export class VideoService {
    private static instance: VideoService;
    private configService: AmplifyConfigService;

    private constructor() {
        this.configService = AmplifyConfigService.getInstance();
    }

    public static getInstance(): VideoService {
        if (!VideoService.instance) {
            VideoService.instance = new VideoService();
        }
        return VideoService.instance;
    }

    /**
     * Get URL for a video asset via CloudFront
     */
    public async getSignedUrl(sourceKey: string, expiresIn: number = 3600): Promise<string> {
        try {
            // Get CloudFront URL from runtime config (deployed config.json)
            const config = this.configService.getConfig();
            const cloudFrontDomain = config?.aws_cloudfront_url || import.meta.env.VITE_CLOUDFRONT_URL;
            
            if (!cloudFrontDomain) {
                throw new Error("CloudFront URL not configured");
            }

            // Remove leading slash and construct CloudFront URL
            const cleanKey = sourceKey.startsWith('/') ? sourceKey.substring(1) : sourceKey;
            const cloudFrontUrl = `${cloudFrontDomain}/${cleanKey}`;

            return cloudFrontUrl;
        } catch (error) {
            console.error("VideoService: Failed to get CloudFront URL:", error);
            throw new Error(
                `Failed to get CloudFront URL for video: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Get signed URL for video thumbnail
     */
    public async getThumbnailUrl(sourceKey: string): Promise<string> {
        // Assume thumbnail has same key but with .jpg extension
        const thumbnailKey = sourceKey.replace(/\.[^/.]+$/, ".jpg");
        return this.getSignedUrl(thumbnailKey);
    }

    /**
     * Get video assets bucket name from configuration
     */
    public getVideoAssetsBucket(): string {
        const config = this.configService.getConfig();
        if (!config?.aws_video_assets_bucket) {
            throw new Error("Video assets bucket not configured");
        }
        return config.aws_video_assets_bucket;
    }

    /**
     * Get video assets bucket region from configuration
     */
    public getVideoAssetsBucketRegion(): string {
        const config = this.configService.getConfig();
        if (!config?.aws_video_assets_bucket_region) {
            throw new Error("Video assets bucket region not configured");
        }
        return config.aws_video_assets_bucket_region;
    }

    /**
     * Parse S3 URL to extract source key
     */
    public parseS3UrlToKey(s3Url: string): string {
        try {
            if (s3Url.startsWith("s3://")) {
                // s3://bucket/key format
                const url = new URL(s3Url);
                return url.pathname.substring(1); // Remove leading slash
            } else if (s3Url.includes(".s3.") || s3Url.includes("s3.amazonaws.com")) {
                // HTTPS S3 URL format
                const url = new URL(s3Url);
                return url.pathname.substring(1); // Remove leading slash
            } else {
                throw new Error(`Unsupported URL format: ${s3Url}`);
            }
        } catch (error) {
            console.error("VideoService: Failed to parse S3 URL:", error);
            throw new Error(`Invalid S3 URL format: ${s3Url}`);
        }
    }

    /**
     * Check if a URL is an S3 URL that needs signing
     */
    public isS3Url(url: string): boolean {
        return url.startsWith("s3://") || url.includes(".s3.") || url.includes("s3.amazonaws.com");
    }

    /**
     * Check if clip is within time-shift window (14 days)
     * @param startTime - Unix timestamp (seconds) for clip start
     * @returns true if clip is within 14-day startover window
     */
    public isWithinTimeShiftWindow(startTime: number): boolean {
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        const fourteenDaysAgo = now - (14 * 24 * 60 * 60); // 14 days in seconds
        return startTime >= fourteenDaysAgo;
    }

    /**
     * Get time-shifted manifest URL for a clip
     * @param baseManifestUrl - MediaPackage manifest URL from channel
     * @param startTime - Unix timestamp (seconds) for clip start
     * @param endTime - Unix timestamp (seconds) for clip end
     * @returns Time-shifted manifest URL with query parameters
     * @throws Error if clip is outside 14-day window
     */
    public getTimeShiftUrl(baseManifestUrl: string, startTime: number, endTime: number): string {
        if (!this.isWithinTimeShiftWindow(startTime)) {
            throw new Error('Clip is outside 14-day time-shift window');
        }
        
        // For CMAF content, use standard query parameter notation
        // REF: https://docs.aws.amazon.com/mediapackage/latest/userguide/time-shifted.html
        const queryString = `start=${startTime}&end=${endTime}`;
        
        return `${baseManifestUrl}?${queryString}`;
    }

    /**
     * Get signed URL from any video source (S3 URL or key)
     */
    public async getVideoUrl(source: string): Promise<string> {
        if (this.isS3Url(source)) {
            // Extract key from S3 URL and get signed URL
            const key = this.parseS3UrlToKey(source);
            return this.getSignedUrl(key);
        } else if (source.startsWith("http")) {
            // Already a signed URL or public URL
            return source;
        } else {
            // Assume it's a key
            return this.getSignedUrl(source);
        }
    }

    /**
     * Get HLS video URL for a clip from S3
     * Handles both original clips (sourceKey is path) and modified clips (sourceKey includes .m3u8)
     * @param sourceKey - S3 source key from clip record
     * @returns CloudFront URL for HLS playback
     */
    public async getClipHlsUrl(sourceKey: string): Promise<string> {
        let hlsPath: string;
        
        if (sourceKey.endsWith('.m3u8')) {
            // Modified clips: sourceKey already includes the master playlist path
            hlsPath = sourceKey;
        } else {
            // Original clips: sourceKey is just the path, append main.m3u8
            hlsPath = sourceKey.endsWith('/') 
                ? `${sourceKey}main.m3u8`
                : `${sourceKey}/main.m3u8`;
        }
        
        return this.getVideoUrl(hlsPath);
    }
}

export default VideoService;
