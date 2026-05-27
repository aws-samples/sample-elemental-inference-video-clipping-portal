// Event Management Types
// Orientation types for video processing
export type Orientation = 'landscape' | 'portrait' | 'both';

export type ProvisioningStatus = 'CREATING' | 'ACTIVE' | 'FAILED' | 'DELETING';

export interface Channel {
    id: string;
    name: string;
    region: string;
    configuration: string;
    manifestUrl?: string;
    landscapeManifestUrl?: string;
    verticalManifestUrl?: string;
    createdAt: string;
    updatedAt: string;
    provisioningStatus?: ProvisioningStatus;
    provisioningError?: string;
}

export interface Event {
    id: string;
    name: string;
    description: string;
    status: EventStatus;
    startDateTime: string;
    endDateTime: string;
    duration: number; // in minutes
    mediaPackage?: string;
    mediaLiveChannel: string;
    generateMP4: boolean;
    createdAt: string;
    updatedAt: string;
    clips: number;
    autoGenerateHighlight: boolean;
    highlightTemplateId?: string;
    videoUrl?: string; // Optional video URL for playback
    outputSettings?: Template;
    isActiveForStarfish?: boolean;
}

export type EventStatus = "live" | "ended" | "scheduled" | "idle";

// Clip Management Types
export interface Clip {
    id: string;
    name: string;
    description?: string;
    eventId: string;
    eventName: string;
    startTime: number; // in seconds
    endTime: number; // in seconds
    duration: number; // in seconds
    status: ClipStatus;
    resolution: string;
    format: string;
    mediaPackage: string;
    mediaLiveChannel: string;
    age: number; // in seconds since creation
    createdAt: string;
    updatedAt: string;
    tags: string[];
    customTags: string[];
    latency?: number;
    editTime?: number;
    harvestingTime?: number; // Time in seconds from Inference detection to harvest completion
    sourceKey?: string; // S3 key for getting signedUrl (current version)
    sourceKeys?: Record<string, string>; // Orientation → S3 prefix map (from auto-harvest)
    originalSourceKey?: string; // Original source key before any modifications
    originalAssetId?: string; // Reference to original clip this was generated from

    // Video Processing
    lastProcessedAt?: string;

    // Download Job
    downloadJobId?: string;

    // Video Editing Operations
    editOperations?: VideoEditOperation[];
    
    // Lock state
    locked?: boolean;

    // Orientation
    orientation?: 'landscape' | 'portrait';

    // Harvested orientations tracking
    harvestedOrientations?: string[];

    // MP4 output key
    mp4Key?: string;
}

export type ClipStatus =
    | "processing"
    | "completed"
    | "original"
    | "edit_in_progress"
    | "modified"
    | "review_in_progress"
    | "discarded"
    | "reviewed"
    | "failed";

// Annotations
export interface Annotation {
    id: string;
    clipId: string;
    text: string;
    position: AnnotationPosition;
    timestamp: number;
    createdAt: string;
}

export type AnnotationPosition =
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center";

// Component Props Types
export interface NavigationItem {
    text: string;
    href: string;
    type: "link" | "section";
    items?: NavigationItem[];
}

export interface BreadcrumbItem {
    text: string;
    href?: string;
}

export interface TimelineMarker {
    time: number;
    type: "clip" | "annotation" | "feedback";
    data: any;
}

// API Request/Response Types
export interface CreateEventRequest {
    name: string;
    description: string;
    startDateTime: string;
    endDateTime: string;
    duration: string | number;
    mediaLiveChannel: string;
    autoGenerateHighlight: boolean;
    generateMP4: boolean;
    sportsType: string;
    highlightTemplateId?: string;
    outputSettings?: Template;
}

export interface UpdateEventRequest extends Partial<CreateEventRequest> {
    id: string;
}

export interface CreateClipRequest {
    name: string;
    description?: string;
    eventId: string;
    startTime: number;
    endTime: number;
}

export interface Template {
    name: string;
    reelName?: string;
    id: string;
    resolution: string;
    format: string;
    backgroundMusic: boolean;
    clipLength: number;
    keyMoments: string[];
    gameType: string;
    // Auto-highlight specific fields
    eventId?: string; // Optional: associate with specific event
    autoGenerate?: boolean; // Whether to auto-generate highlights (default: false)
}

// Video Processing Types
export type VideoProcessingStatus =
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled"
    | "original"
    | "edit_in_progress"
    | "modified";

export interface VideoProcessingJob {
    assetType?: string;
    jobId: string;
    clipId?: string;
    reelId?: string;
    eventId?: string;
    status: VideoProcessingStatus;
    progress: number;
    sourceUrl: string;
    outputUrl?: string;
    originalAssetId?: string;
    parameters: VideoProcessingParameters;
    mediaConvertJobId?: string;
    createdAt: string;
    updatedAt: string;
    errorMessage?: string;
}

export interface VideoProcessingParameters {
    operations: VideoEditOperation[];
    outputSettings: VideoOutputSettings;
    clipName?: string;
    reelName?: string;
}

export interface VideoOutputSettings {
    format: "mp4" | "mov" | "webm" | "hls";
    quality: "high" | "medium" | "low";
    resolution?: string;
    frameRate?: number;
    bitrate?: number;
}

// Video Edit Operations
export type VideoEditOperationType = "trim" | "split" | "delete" | "merge";

export interface VideoEditOperation {
    id: string;
    type: VideoEditOperationType;
    startTime: number;
    endTime: number;
    order: number;
    enabled: boolean;
    description?: string;
}

export interface TrimOperation extends VideoEditOperation {
    type: "trim";
    // Trim keeps only the content between startTime and endTime
}

export interface SplitOperation extends VideoEditOperation {
    type: "split";
    // Split creates split points at the specified time
    splitPoints: number[];
}

export interface DeleteOperation extends VideoEditOperation {
    type: "delete";
    // Delete removes content between startTime and endTime
}

export interface MergeOperation extends VideoEditOperation {
    type: "merge";
    // Merge combines multiple segments (not implemented)
}

// Video Segment for video editing operations (internal use in video editor)
export interface VideoSegment {
    id: string;
    startTime: number;
    endTime: number;
    duration: number;
    order: number;
    enabled: boolean;
    sourceClipId?: string;
    name?: string;
    color?: string;
}

// MediaConvert Job Status Update
export interface MediaConvertJobUpdate {
    jobId: string;
    mediaConvertJobId: string;
    status: VideoProcessingStatus;
    progress: number;
    outputDetails?: MediaConvertOutputDetails;
    errorMessage?: string;
    timestamp: string;
}

export interface MediaConvertOutputDetails {
    outputGroupDetails: Array<{
        outputDetails: Array<{
            outputFilePaths: string[];
            durationInMs: number;
            videoDetails?: {
                widthInPx: number;
                heightInPx: number;
            };
        }>;
    }>;
}

// Job Management Types (alias for VideoProcessingJob for consistency)
export type Job = VideoProcessingJob;

export interface CreateJobRequest {
    sourceBucket: string;
    sourceKey: string;
    parameters: VideoProcessingParameters;
    clipId?: string;
    eventId?: string;
    orientation?: Orientation;
}
