import ApiService from "./apiService";
import { Orientation } from "../types";

export type DownloadStatus = "harvesting" | "pending" | "processing" | "completed" | "failed";
export type ItemType = "clip" | "reel";

export interface DownloadItem {
    id: string;
    type: ItemType;
}

export interface DownloadJob {
    jobId: string;
    itemId: string;
    itemType: ItemType;
    download_status: DownloadStatus;
    progress: number;
    s3OutputKey?: string;
    createdAt: string;
    updatedAt: string;
    errorMessage?: string;
}

export interface CreateDownloadJobsResponse {
    message?: string;
    processed: Array<{ id: string; type?: ItemType; jobId: string; status?: DownloadStatus; executionArn?: string }>;
    skipped: Array<{ id: string; type?: ItemType; reason: string }>;
}

export interface GetDownloadUrlResponse {
    jobId: string;
    downloadUrl?: string;
    expiresIn?: number;
    status: DownloadStatus;
    downloads?: Array<{
        orientation: string;
        downloadUrl?: string;
        s3OutputKey?: string;
        expiresIn?: number;
        error?: string;
    }>;
}

export interface DownloadJobStatusResponse {
    jobId: string;
    status: DownloadStatus;
    downloadUrl?: string;
    correlationId?: string;
    errorMessage?: string;
}

class DownloadService {
    private apiService = ApiService.getInstance();

    async createDownloadJobs(items: DownloadItem[], orientation: Orientation = "portrait"): Promise<CreateDownloadJobsResponse> {
        return this.apiService.makeRequest<CreateDownloadJobsResponse>("/download-clips", {
            method: "POST",
            body: JSON.stringify({ items, orientation }),
        });
    }

    async getDownloadUrl(jobId: string): Promise<GetDownloadUrlResponse> {
        const originalError = console.error;
        console.error = () => {}; // Suppress error logging
        
        try {
            return await this.apiService.makeRequest<GetDownloadUrlResponse>(`/download-clips/${jobId}`);
        } catch (error: any) {
            console.error = originalError; // Restore console.error
            
            // Log user-friendly message for expected statuses
            if (error.response?.status === 400 && error.response?.data?.status) {
                console.log(`Download job ${jobId}: ${error.response.data.status}`);
                throw error;
            }
            
            // Log unexpected errors normally
            console.error("Unexpected download error:", error);
            throw error;
        } finally {
            console.error = originalError;
        }
    }

    async getDownloadJobStatus(jobId: string): Promise<DownloadJobStatusResponse> {
        return this.apiService.makeRequest<DownloadJobStatusResponse>(`/download-clips/${jobId}`);
    }

    async getPresignedUrl(s3Key: string): Promise<{ downloadUrl: string; expiresIn: number }> {
        return this.apiService.makeRequest<{ downloadUrl: string; expiresIn: number }>("/download-clips/presign", {
            method: "POST",
            body: JSON.stringify({ s3Key }),
        });
    }

    async downloadMp4Direct(s3Key: string, fileName: string): Promise<void> {
        const { downloadUrl } = await this.getPresignedUrl(s3Key);

        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
    }

    async downloadClip(jobId: string, itemName: string): Promise<void> {
        const resp = await this.getDownloadJobStatus(jobId) as any;

        // If per-orientation downloads are available, download each one
        if (resp.downloads && resp.downloads.length > 0) {
            for (const dl of resp.downloads) {
                if (dl.downloadUrl) {
                    const response = await fetch(dl.downloadUrl);
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);

                    const link = document.createElement("a");
                    link.href = blobUrl;
                    link.download = `${itemName}-${dl.orientation}.mp4`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(blobUrl);
                }
            }
            return;
        }

        // Fallback: single downloadUrl (legacy)
        if (resp.downloadUrl) {
            const response = await fetch(resp.downloadUrl);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement("a");
            link.href = blobUrl;
            link.download = `${itemName}.mp4`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
            return;
        }

        throw new Error("No download URLs available");
    }
}

export default new DownloadService();
