/**
 * Channel Service
 *
 * Thin orchestration service that wraps ApiService methods for channel operations.
 * Provides input validation before delegating to the API layer.
 *
 * Validates Requirements: 2.7, 2.8, 12.1, 12.2
 */

import ApiService from "./apiService";

/** Validation pattern: alphanumeric with hyphens and underscores */
const NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

/** S3 URL must start with s3:// */
const S3_URL_PREFIX = "s3://";

export interface CreateChannelParams {
    channelName: string;
    inputType: string;
    inputUrl: string;
    inputName: string;
    encoderSettings: any;
}

export class ChannelService {
    private static instance: ChannelService;
    private apiService: ApiService;

    private constructor() {
        this.apiService = ApiService.getInstance();
    }

    public static getInstance(): ChannelService {
        if (!ChannelService.instance) {
            ChannelService.instance = new ChannelService();
        }
        return ChannelService.instance;
    }

    /**
     * Validate a name field (channelName or inputName).
     * Must be non-empty and match alphanumeric with hyphens/underscores.
     */
    public validateName(value: string, fieldName: string): string | null {
        const trimmed = value.trim();
        if (!trimmed) {
            return `${fieldName} is required`;
        }
        if (!NAME_PATTERN.test(trimmed)) {
            return `${fieldName} must contain only alphanumeric characters, hyphens, and underscores`;
        }
        return null;
    }

    /**
     * Validate an S3 URL. Must be non-empty and start with s3://.
     */
    public validateInputUrl(value: string): string | null {
        const trimmed = value.trim();
        if (!trimmed) {
            return "Input URL is required";
        }
        if (!trimmed.startsWith(S3_URL_PREFIX)) {
            return "Input URL must start with s3://";
        }
        return null;
    }

    /**
     * Validate all create channel inputs. Returns a map of field errors,
     * or null if everything is valid.
     */
    public validateCreateChannelParams(
        params: CreateChannelParams
    ): Record<string, string> | null {
        const errors: Record<string, string> = {};

        const channelNameError = this.validateName(params.channelName, "Channel name");
        if (channelNameError) errors.channelName = channelNameError;

        const inputNameError = this.validateName(params.inputName, "Input name");
        if (inputNameError) errors.inputName = inputNameError;

        const inputUrlError = this.validateInputUrl(params.inputUrl);
        if (inputUrlError) errors.inputUrl = inputUrlError;

        return Object.keys(errors).length > 0 ? errors : null;
    }

    /**
     * Create a new channel. Validates inputs before calling the API.
     */
    public async createChannel(params: CreateChannelParams): Promise<any> {
        const validationErrors = this.validateCreateChannelParams(params);
        if (validationErrors) {
            const firstError = Object.values(validationErrors)[0];
            throw new Error(`Validation failed: ${firstError}`);
        }

        return this.apiService.createChannel({
            channelName: params.channelName.trim(),
            inputType: params.inputType,
            inputUrl: params.inputUrl.trim(),
            inputName: params.inputName.trim(),
            encoderSettings: params.encoderSettings,
        });
    }

    /**
     * Start a MediaLive channel.
     */
    public async startChannel(channelId: string): Promise<void> {
        if (!channelId.trim()) {
            throw new Error("Channel ID is required");
        }
        return this.apiService.startChannel(channelId);
    }

    /**
     * Stop a MediaLive channel.
     */
    public async stopChannel(channelId: string): Promise<void> {
        if (!channelId.trim()) {
            throw new Error("Channel ID is required");
        }
        return this.apiService.stopChannel(channelId);
    }
}

export default ChannelService;
