/**
 * Video Processing Service
 *
 * Handles video processing operations using AWS MediaConvert
 * Supports trimming, splitting, and deleting unwanted sections
 */

import {
    VideoProcessingJob,
    VideoProcessingParameters,
    VideoProcessingStatus,
    VideoEditOperation,
    Orientation,
} from "../types";
import ApiService from "./apiService";

export interface ProcessVideoRequest {
    sourceUrl: string;
    parameters: VideoProcessingParameters;
    clipId?: string;
    reelId?: string;
    eventId?: string;
    assetType: "clip" | "reel";
    orientation?: Orientation;
}

export interface ProcessVideoResponse {
    jobId: string;
    status: VideoProcessingStatus;
    message: string;
}

export interface JobStatusResponse {
    jobId: string;
    status: VideoProcessingStatus;
    progress: number;
    outputUrl?: string;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
}

// DownloadUrlResponse removed - using generic signed URL response

export class VideoProcessingService {
    private static instance: VideoProcessingService;
    private apiService: ApiService;

    private constructor() {
        this.apiService = ApiService.getInstance();
    }



    public static getInstance(): VideoProcessingService {
        if (!VideoProcessingService.instance) {
            VideoProcessingService.instance = new VideoProcessingService();
        }
        return VideoProcessingService.instance;
    }

    /**
     * Make authenticated request to Lambda Function URL
     */


    /**
     * Start video processing using async API
     */
    public async processVideo(request: ProcessVideoRequest): Promise<ProcessVideoResponse> {
        console.log("VideoProcessingService: Starting async video processing", request);

        // Validate operations before sending
        const validationErrors = this.validateOperations(request.parameters.operations);
        if (validationErrors.length > 0) {
            throw new Error(`Invalid operations: ${validationErrors.join(", ")}`);
        }

        try {
            // Use jobs API for async video editing
            console.log("Using jobs API for async video editing");
            const response = await this.apiService.makeRequest<ProcessVideoResponse>(
                "/jobs",
                {
                    method: "POST",
                    body: JSON.stringify(request),
                }
            );

            console.log("VideoProcessingService: Processing response", response);
            return response;
        } catch (error) {
            console.error("VideoProcessingService: Failed to start processing", error);
            throw error;
        }
    }

    /**
     * Get job status
     */
    public async getJobStatus(jobId: string): Promise<JobStatusResponse> {
        try {
            const response = await this.apiService.makeRequest<JobStatusResponse>(
                `/jobs/${jobId}/status`,
            );
            return response;
        } catch (error) {
            console.error("VideoProcessingService: Failed to get job status", error);
            throw error;
        }
    }

    /**
     * Process video (no automatic polling)
     */
    public async processVideoAsync(request: ProcessVideoRequest): Promise<ProcessVideoResponse> {
        console.log("VideoProcessingService: Starting async video processing", request);
        return this.processVideo(request);
    }

    /**
     * Cancel a video processing job
     */
    public async cancelJob(jobId: string): Promise<void> {
        try {
            await this.apiService.makeRequest<void>(
                `/jobs/${jobId}`,
                {
                    method: "DELETE",
                }
            );
            console.log("VideoProcessingService: Job cancelled successfully", jobId);
        } catch (error) {
            console.error("VideoProcessingService: Failed to cancel job", error);
            throw error;
        }
    }

    /**
     * Validate video edit operations
     */
    public validateOperations(operations: VideoEditOperation[]): string[] {
        const errors: string[] = [];

        if (!operations || operations.length === 0) {
            errors.push("At least one operation is required");
            return errors;
        }

        // Sort operations by order
        const sortedOps = [...operations].sort((a, b) => a.order - b.order);

        for (let i = 0; i < sortedOps.length; i++) {
            const op = sortedOps[i];

            // Basic validation
            if (op.startTime < 0) {
                errors.push(`Operation ${op.id}: Start time cannot be negative`);
            }

            // Split operations can have startTime === endTime (they represent a point)
            // Other operations need endTime > startTime
            if (op.type === "split") {
                if (op.endTime !== op.startTime) {
                    errors.push(
                        `Operation ${op.id}: Split operations must have startTime equal to endTime`,
                    );
                }
            } else {
                if (op.endTime <= op.startTime) {
                    errors.push(`Operation ${op.id}: End time must be greater than start time`);
                }
            }

            // Type-specific validation
            switch (op.type) {
                case "trim":
                    // Validate trim operation
                    if (op.endTime - op.startTime < 1) {
                        errors.push(`Operation ${op.id}: Trim duration must be at least 1 second`);
                    }
                    break;

                case "delete":
                    // Validate delete operation
                    if (op.endTime - op.startTime < 0.1) {
                        errors.push(
                            `Operation ${op.id}: Delete duration must be at least 0.1 seconds`,
                        );
                    }
                    break;

                case "split":
                    // Validate split operation
                    // Split operations would need additional validation for split points
                    break;

                case "merge":
                    // Validate merge operation
                    // Merge operations would need additional validation for segments
                    break;
            }
        }

        // Check for overlapping operations of incompatible types
        for (let i = 0; i < sortedOps.length - 1; i++) {
            const current = sortedOps[i];
            const next = sortedOps[i + 1];

            if (this.operationsOverlap(current, next)) {
                if (!this.areOperationsCompatible(current.type, next.type)) {
                    errors.push(
                        `Operations ${current.id} and ${next.id} overlap and are incompatible`,
                    );
                }
            }
        }

        return errors;
    }

    /**
     * Check if two operations overlap in time
     */
    private operationsOverlap(op1: VideoEditOperation, op2: VideoEditOperation): boolean {
        return !(op1.endTime <= op2.startTime || op2.endTime <= op1.startTime);
    }

    /**
     * Check if two operation types are compatible when overlapping
     */
    private areOperationsCompatible(type1: string, type2: string): boolean {
        // Define compatibility rules
        const compatibilityMatrix: Record<string, string[]> = {
            trim: [], // Trim operations should not overlap
            delete: [], // Delete operations should not overlap
            split: ["trim", "delete"], // Split can work with trim and delete
            merge: ["split"], // Merge can work with split
        };

        return (
            compatibilityMatrix[type1]?.includes(type2) ||
            compatibilityMatrix[type2]?.includes(type1) ||
            false
        );
    }

    /**
     * Estimate output duration based on operations
     */
    public estimateOutputDuration(
        originalDuration: number,
        operations: VideoEditOperation[],
    ): number {
        const enabledOps = operations.filter((op) => op.enabled);

        if (enabledOps.length === 0) {
            return originalDuration;
        }

        let estimatedDuration = originalDuration;

        // Apply operations in order
        const sortedOps = [...enabledOps].sort((a, b) => a.order - b.order);

        for (const op of sortedOps) {
            switch (op.type) {
                case "trim":
                    // Trim sets the total duration to the trimmed range
                    estimatedDuration = op.endTime - op.startTime;
                    break;

                case "delete":
                    // Delete removes duration
                    const deleteDuration = op.endTime - op.startTime;
                    estimatedDuration = Math.max(0, estimatedDuration - deleteDuration);
                    break;

                case "split":
                    // Split doesn't change total duration
                    break;

                case "merge":
                    // Merge would need more complex calculation
                    break;
            }
        }

        return Math.max(0, estimatedDuration);
    }

    /**
     * Generate operation summary for display
     */
    public generateOperationSummary(operations: VideoEditOperation[]): string {
        const enabledOps = operations.filter((op) => op.enabled);

        if (enabledOps.length === 0) {
            return "No operations applied";
        }

        const summary = enabledOps
            .map((op) => {
                const duration = op.endTime - op.startTime;
                return `${op.type.toUpperCase()}: ${this.formatTime(op.startTime)}-${this.formatTime(op.endTime)} (${this.formatTime(duration)})`;
            })
            .join(", ");

        return summary;
    }

    /**
     * Format time in MM:SS format
     */
    private formatTime(seconds: number): string {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    }
}

// Export singleton instance
const videoProcessingService = VideoProcessingService.getInstance();
export default videoProcessingService;

// Export types for convenience
export type {
    VideoProcessingJob,
    VideoProcessingParameters,
    VideoProcessingStatus,
    VideoEditOperation,
};
