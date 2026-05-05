/**
 * Clip Service
 * 
 * Handles clip-related operations including CRUD operations and status updates
 */

import { Clip } from "../types";
import ApiService from "./apiService";

export class ClipService {
    private static instance: ClipService;
    private apiService: ApiService;

    private constructor() {
        this.apiService = ApiService.getInstance();
    }

    public static getInstance(): ClipService {
        if (!ClipService.instance) {
            ClipService.instance = new ClipService();
        }
        return ClipService.instance;
    }

    /**
     * Get all clips
     */
    public async getClips(): Promise<Clip[]> {
        return this.apiService.getClips();
    }

    /**
     * Get clips by event ID
     */
    public async getClipsByEventId(eventId: string): Promise<Clip[]> {
        return this.apiService.getClipsByEventId(eventId);
    }

    /**
     * Get a specific clip by ID
     */
    public async getClip(id: string): Promise<Clip> {
        return this.apiService.getClip(id);
    }

    /**
     * Update a clip
     */
    public async updateClip(id: string, updates: Partial<Clip>): Promise<Clip> {
        return this.apiService.updateClip({ ...updates, id });
    }

    /**
     * Update clip status
     */
    public async updateClipStatus(id: string, status: Clip['status']): Promise<Clip> {
        return this.updateClip(id, { status });
    }

    /**
     * Mark clip as processing started
     */
    public async markClipProcessingStarted(id: string): Promise<Clip> {
        return this.updateClipStatus(id, "edit_in_progress");
    }

    /**
     * Mark clip as processing completed
     */
    public async markClipProcessingCompleted(id: string): Promise<Clip> {
        return this.updateClip(id, { status: "modified" });
    }

    /**
     * Mark clip as processing failed (revert to original)
     */
    public async markClipProcessingFailed(id: string): Promise<Clip> {
        return this.updateClipStatus(id, "original");
    }
}

// Export singleton instance
const clipService = ClipService.getInstance();
export default clipService;