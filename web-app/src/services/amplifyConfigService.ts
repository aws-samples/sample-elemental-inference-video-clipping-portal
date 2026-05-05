/**
 * Service to fetch Amplify configuration from API Gateway
 */

export interface AmplifyConfig {
    aws_project_region: string;
    aws_cognito_identity_pool_id: string;
    aws_cognito_region: string;
    aws_user_pools_id: string;
    aws_user_pools_web_client_id: string;
    oauth: Record<string, any>;
    aws_cognito_username_attributes: string[];
    aws_cognito_social_providers: string[];
    aws_cognito_signup_attributes: string[];
    aws_cognito_mfa_configuration: string;
    aws_cognito_mfa_types: string[];
    aws_cognito_password_protection_settings: {
        passwordPolicyMinLength: number;
        passwordPolicyCharacters: string[];
    };
    aws_cognito_verification_mechanisms: string[];
    aws_appsync_graphqlEndpoint: string;
    aws_appsync_region: string;
    aws_appsync_authenticationType: string;
    aws_user_files_s3_bucket: string;
    aws_user_files_s3_bucket_region: string;
    aws_video_assets_bucket: string;
    aws_video_assets_bucket_region: string;
    aws_cloudfront_url?: string;
    API?: {
        REST?: {
            [key: string]: {
                endpoint: string;
                region: string;
            };
        };
    };
    Storage?: {
        AWSS3?: {
            bucket: string;
            region: string;
        };
    };
}

class AmplifyConfigService {
    private static instance: AmplifyConfigService;
    private config: AmplifyConfig | null = null;
    private configEndpoint: string = "/config.json";

    private constructor() {}

    public static getInstance(): AmplifyConfigService {
        if (!AmplifyConfigService.instance) {
            AmplifyConfigService.instance = new AmplifyConfigService();
        }
        return AmplifyConfigService.instance;
    }

    /**
     * Fetch Amplify configuration from API Gateway
     */
    public async fetchConfig(): Promise<AmplifyConfig> {
        if (this.config) {
            return this.config;
        }

        try {
            const response = await fetch(this.configEndpoint, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch Amplify config: ${response.statusText}`);
            }

            this.config = await response.json();
            return this.getRequiredConfig();
        } catch (error) {
            console.error("Error fetching Amplify configuration:", error);
            return this.getRequiredConfig();
        }
    }

    /**
     * Get cached configuration
     */
    public getConfig(): AmplifyConfig | null {
        return this.config;
    }

    /**
     * Get cached configuration (throws if not available)
     */
    public getRequiredConfig(): AmplifyConfig {
        if (!this.config) {
            throw new Error("Amplify configuration not loaded");
        }
        return this.config;
    }

    /**
     * Clear cached configuration
     */
    public clearConfig(): void {
        this.config = null;
    }
}

export default AmplifyConfigService;
