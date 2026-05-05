import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "@cloudscape-design/global-styles/index.css";
import "./index.css";
import App from "./App.tsx";
import AmplifyConfigService from "./services/amplifyConfigService";
import ConfigLoader from "./components/common/Loading/ConfigLoader";

// Initialize the app with dynamic Amplify configuration
const initializeApp = async () => {
    const root = createRoot(document.getElementById("root")!);
    
    // Show loading state
    root.render(<ConfigLoader />);
    
    try {
        const configService = AmplifyConfigService.getInstance();
        const amplifyConfig: any = await configService.fetchConfig();
        const updateConfig = {
            Auth: amplifyConfig.Auth,
            API: amplifyConfig.API,
            Storage: {
                S3: {
                    bucket: amplifyConfig.aws_video_assets_bucket,
                    region:
                        amplifyConfig.aws_video_assets_bucket_region || amplifyConfig.Auth.region,
                },
            },
        };

        // Validate required configuration
        if (!amplifyConfig.aws_video_assets_bucket) {
            throw new Error("Missing aws_video_assets_bucket in configuration");
        }

        console.log("Amplify Storage config:", {
            bucket: amplifyConfig.aws_video_assets_bucket,
            region: amplifyConfig.aws_video_assets_bucket_region || amplifyConfig.Auth.region,
            fullConfig: updateConfig.Storage,
            hasAuth: !!amplifyConfig.Auth,
            hasAPI: !!amplifyConfig.API,
        });
        Amplify.configure(updateConfig);

        root.render(
            <Authenticator.Provider>
                <App />
            </Authenticator.Provider>,
        );
    } catch (error) {
        console.error("Failed to initialize application:", error);

        // Render error state
        root.render(
            <ConfigLoader message="Failed to load application configuration. Please refresh the page." />,
        );
    }
};

// Initialize the app
initializeApp();
