/**
 * API Service for handling API Gateway integration using Amplify API
 */

import { fetchAuthSession } from "aws-amplify/auth";
import type {
    Event,
    Clip,
    CreateEventRequest,
    UpdateEventRequest,
    CreateClipRequest,
    Job,
    CreateJobRequest,
} from "../types";

export class ApiService {
    private static instance: ApiService;
    private baseUrl: string;
    private isDevelopment: boolean;

    private constructor() {
        this.baseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
        this.isDevelopment = import.meta.env.VITE_DEV_MODE
            ? import.meta.env.VITE_DEV_MODE === "true"
            : true;
    }

    public static getInstance(): ApiService {
        if (!ApiService.instance) {
            ApiService.instance = new ApiService();
        }
        return ApiService.instance;
    }

    /**
     * Get authentication headers for API requests
     */
    private async getAuthHeaders(): Promise<Record<string, string>> {
        try {
            const session = await fetchAuthSession();
            const token = session.tokens?.idToken?.toString();

            return {
                "Content-Type": "application/json",
                Authorization: token ? `Bearer ${token}` : "",
            };
        } catch {
            console.warn("No authenticated session found, using basic headers");
            return {
                "Content-Type": "application/json",
            };
        }
    }

    /**
     * Make authenticated API request
     */
    public async makeRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        // In development mode, use mock data
        // if (this.isDevelopment && !endpoint.includes("/video/")) {
        //     return this.getMockData<T>(endpoint, options);
        // }

        const headers = await this.getAuthHeaders();

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers: {
                ...headers,
                ...options.headers,
            },
        });

        if (!response.ok) {
            let errorData = {};
            try {
                const text = await response.text();
                if (text.trim()) {
                    errorData = JSON.parse(text);
                }
            } catch {
                // Ignore parsing errors for error responses
            }
            
            const error: any = new Error(`API request failed: ${response.statusText}`);
            error.response = {
                status: response.status,
                data: errorData,
            };
            throw error;
        }

        const text = await response.text();
        
        // Handle empty responses
        if (!text.trim()) {
            return {} as T;
        }

        // Try to parse JSON, return empty object if parsing fails
        try {
            return JSON.parse(text);
        } catch (error) {
            console.warn('Failed to parse JSON response:', error);
            return {} as T;
        }
    }

    // Events API
    public async getEvents(): Promise<Event[]> {
        return this.makeRequest<Event[]>("/events");
    }

    public async getEvent(id: string): Promise<Event> {
        return this.makeRequest<Event>(`/events/${id}`);
    }

    public async createEvent(event: CreateEventRequest): Promise<Event> {
        return this.makeRequest<Event>("/events", {
            method: "POST",
            body: JSON.stringify(event),
        });
    }

    public async updateEvent(event: UpdateEventRequest): Promise<Event> {
        return this.makeRequest<Event>(`/events/${event.id}`, {
            method: "PUT",
            body: JSON.stringify(event),
        });
    }

    public async deleteEvent(id: string, deleteClips: boolean = false): Promise<void> {
        const queryParam = deleteClips ? '?deleteClips=true' : '';
        return this.makeRequest<void>(`/events/${id}${queryParam}`, {
            method: "DELETE",
        });
    }

    public async activateEvent(id: string): Promise<Event> {
        return this.makeRequest<Event>(`/events/${id}/activate`, {
            method: "PUT",
        });
    }

    public async deactivateEvent(id: string): Promise<Event & { warning?: string }> {
        return this.makeRequest<Event & { warning?: string }>(`/events/${id}/deactivate`, {
            method: "PUT",
        });
    }

    // Channels API
    public async getChannels(): Promise<any[]> {
        return this.makeRequest<any[]>("/channels");
    }

    public async getChannel(id: string): Promise<any> {
        return this.makeRequest<any>(`/channels/${id}`);
    }

    public async getChannelStatus(channelId: string): Promise<{ channelId: string; state: string; arn: string; name: string }> {
        return this.makeRequest<{ channelId: string; state: string; arn: string; name: string }>(`/medialive/channels/${channelId}/status`);
    }

    public async createChannel(request: {
        channelName: string;
        inputType: string;
        inputUrl: string;
        inputName: string;
        encoderSettings: any;
    }): Promise<{ executionArn: string; status: string }> {
        return this.makeRequest<{ executionArn: string; status: string }>('/channels', {
            method: 'POST',
            body: JSON.stringify(request),
        });
    }

    public async getChannelCreationStatus(executionArn: string): Promise<{
        status: string;
        output?: any;
        error?: any;
    }> {
        const encodedArn = encodeURIComponent(executionArn);
        return this.makeRequest<{ status: string; output?: any; error?: any }>(
            `/channels/status/${encodedArn}`
        );
    }

    public async startChannel(channelId: string): Promise<void> {
        return this.makeRequest<void>(`/medialive/channels/${channelId}/start`, {
            method: 'POST',
        });
    }

    public async stopChannel(channelId: string): Promise<void> {
        return this.makeRequest<void>(`/medialive/channels/${channelId}/stop`, {
            method: 'POST',
        });
    }

    public async deleteChannel(channelId: string): Promise<{ executionArn: string; status: string }> {
        return this.makeRequest<{ executionArn: string; status: string }>(`/channels/${channelId}`, {
            method: 'DELETE',
        });
    }


    // Clips API
    public async getClips(): Promise<Clip[]> {
        const response = await this.makeRequest<{ clips: Clip[], count: number }>("/clips");
        return response.clips;
    }

    public async getClipsByEventId(eventId: string): Promise<Clip[]> {
        const response = await this.makeRequest<{ clips: Clip[], count: number }>(`/clips?eventId=${eventId}`);
        return response.clips;
    }

    public async getClip(id: string): Promise<Clip> {
        return this.makeRequest<Clip>(`/clips/${id}`);
    }

    public async createClip(clip: CreateClipRequest): Promise<Clip> {
        return this.makeRequest<Clip>("/clips", {
            method: "POST",
            body: JSON.stringify(clip),
        });
    }

    public async updateClip(clip: Partial<Clip> & { id: string }): Promise<Clip> {
        return this.makeRequest<Clip>(`/clips/${clip.id}`, {
            method: "PUT",
            body: JSON.stringify(clip),
        });
    }

    public async deleteClip(id: string): Promise<void> {
        return this.makeRequest<void>(`/clips/${id}`, {
            method: "DELETE",
        });
    }

    // Templates API
    public async getTemplates(): Promise<any[]> {
        return this.makeRequest<any[]>("/templates");
    }

    public async getTemplate(id: string): Promise<any> {
        return this.makeRequest<any>(`/templates/${id}`);
    }

    public async createTemplate(template: any): Promise<any> {
        return this.makeRequest<any>("/templates", {
            method: "POST",
            body: JSON.stringify(template),
        });
    }

    public async updateTemplate(template: any): Promise<any> {
        return this.makeRequest<any>(`/templates/${template.id}`, {
            method: "PUT",
            body: JSON.stringify(template),
        });
    }

    public async deleteTemplate(id: string): Promise<void> {
        return this.makeRequest<void>(`/templates/${id}`, { method: "DELETE" });
    }

    // Enhanced Templates API (now supports both regular and auto-highlight templates)
    public async getTemplatesWithFilters(filters?: {
        eventId?: string;
        gameType?: string;
        autoGenerate?: boolean;
    }): Promise<any[]> {
        let endpoint = "/templates";
        
        if (filters) {
            const params = new URLSearchParams();
            if (filters.eventId) params.append("eventId", filters.eventId);
            if (filters.gameType) params.append("gameType", filters.gameType);
            if (filters.autoGenerate !== undefined) params.append("autoGenerate", filters.autoGenerate.toString());
            
            if (params.toString()) {
                endpoint += `?${params.toString()}`;
            }
        }
        
        return this.makeRequest<any[]>(endpoint);
    }

    // Jobs API (Video Processing Jobs)
    public async getJobs(filters?: {
        clipId?: string;
        eventId?: string;
        status?: string;
    }): Promise<Job[]> {
        let endpoint = "/jobs";

        if (filters) {
            const params = new URLSearchParams();
            if (filters.clipId) params.append("clipId", filters.clipId);
            if (filters.eventId) params.append("eventId", filters.eventId);
            if (filters.status) params.append("status", filters.status);

            if (params.toString()) {
                endpoint += `?${params.toString()}`;
            }
        }

        return this.makeRequest<Job[]>(endpoint);
    }

    public async getJob(id: string): Promise<Job> {
        return this.makeRequest<Job>(`/jobs/${id}`);
    }

    public async createJob(job: CreateJobRequest): Promise<Job> {
        return this.makeRequest<Job>("/video/process", {
            method: "POST",
            body: JSON.stringify(job),
        });
    }

    public async updateJob(job: Partial<Job> & { jobId: string }): Promise<Job> {
        return this.makeRequest<Job>(`/jobs/${job.jobId}`, {
            method: "PUT",
            body: JSON.stringify(job),
        });
    }

    public async deleteJob(id: string): Promise<void> {
        return this.makeRequest<void>(`/jobs/${id}`, {
            method: "DELETE",
        });
    }

    public async getJobStatus(jobId: string): Promise<Job> {
        return this.makeRequest<Job>(`/video/status/${jobId}`);
    }
}

export default ApiService;
