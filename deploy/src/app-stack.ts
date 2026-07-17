/**
 * Copyright 2024 Amazon.com, Inc. and its affiliates. All Rights Reserved.
 *
 * Licensed under the Amazon Software License (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *   http://aws.amazon.com/asl/
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { createPythonFunction } from "./constructs/python-function";
import { Construct } from "constructs";

import { ApiGatewayV2CloudFrontConstruct } from "./constructs/apigatewayv2-cloudfront-construct";
import { ApiGatewayV2LambdaConstruct } from "./constructs/apigatewayv2-lambda-construct";
import { CloudFrontS3WebSiteConstruct } from "./constructs/cloudfront-s3-website-construct";
import { CognitoWebNativeConstruct } from "./constructs/cognito-web-native-construct";
import { DynamoDBConstruct } from "./constructs/dynamodb-construct";
import { SsmParameterReaderConstruct } from "./constructs/ssm-parameter-reader-construct";
import { MediaPackageV2Construct } from "./constructs/mediapackage-v2-construct";
import { HarvestPipelinePythonConstruct } from "./constructs/harvest-pipeline-python-construct";
import { MediaLiveLambdaConstruct } from "./constructs/medialive-lambda-construct";
import { DownloadMp4LambdaConstruct } from "./constructs/download-mp4-lambda-construct";
import { MediaConvertConstruct } from "./constructs/mediaconvert-construct";
import { SystemSettingsConstruct } from "./constructs/system-settings-construct";
import { HarvestDownloadStateMachineConstruct } from "./constructs/harvest-download-state-machine-construct";
import { HarvestCleanupConstruct } from "./constructs/harvest-cleanup-construct";

export interface AppStackProps extends cdk.StackProps {
    readonly ssmWafArnParameterName: string;
    readonly ssmWafArnParameterRegion: string;
}

/**
 * AppStack for an S3 website and api gatewayv2 proxied through a CloudFront distribution
 *
 * copy this file and its dependencies into your project, then change the name of this file to a better name.
 * The only thing that needs to be configured is the webAppBuildPath
 *
 * see s3-website-cloudfront-apigatewayv2-appstack.png for architecture diagram
 */
export class AppStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: AppStackProps) {
        super(scope, id, props);

        const webAppBuildPath = "../web-app/dist";

        const cognito = new CognitoWebNativeConstruct(this, "Cognito", props);

        const cfWafWebAcl = new SsmParameterReaderConstruct(this, "SsmWafParameter", {
            ssmParameterName: props.ssmWafArnParameterName,
            ssmParameterRegion: props.ssmWafArnParameterRegion,
        }).getValue();

        // Create DynamoDB tables
        const database = new DynamoDBConstruct(this, "Database", {
            tableNamePrefix: `${this.stackName}-`,
        });

        // Create single S3 bucket for all video assets with organized prefixes
        const videoAssetsBucket = new cdk.aws_s3.Bucket(this, "VideoAssetsBucket", {
            lifecycleRules: [
                {
                    id: "DeleteIncompleteMultipartUploads",
                    abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
                },
                {
                    id: "TransitionRawVideosToIA",
                    prefix: "events/",
                    transitions: [
                        {
                            storageClass: cdk.aws_s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        },
                        {
                            storageClass: cdk.aws_s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(90),
                        },
                    ],
                },
                {
                    id: "DeleteTempFiles",
                    prefix: "temp/",
                    expiration: cdk.Duration.days(7), // Clean up temp files after 7 days
                },
                {
                    id: "DeleteOldProcessingJobs",
                    prefix: "processing-jobs/",
                    expiration: cdk.Duration.days(30), // Clean up old job artifacts
                },
            ],
            publicReadAccess: false,
            blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
            encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change to RETAIN for production
            enforceSSL: true, // Require SSL for all requests
        });

        videoAssetsBucket.grantReadWrite(cognito.authenticatedRole);

        // Create MediaPackage V2 construct for video harvesting pipeline
        const mediaPackageV2 = new MediaPackageV2Construct(this, "MediaPackageV2", {
            videoAssetsBucket: videoAssetsBucket,
            stackName: this.stackName,
            clipsTable: database.clipsTable,
            harvestJobsTable: database.harvestJobsTable,
        });

        // Create video processing jobs table
        const videoJobsTable = new cdk.aws_dynamodb.Table(this, "VideoJobsTable", {
            partitionKey: { name: "jobId", type: cdk.aws_dynamodb.AttributeType.STRING },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });

        // Create Jobs API Lambda Function (for API Gateway)
        const jobsApiFunction = new cdk.aws_lambda_nodejs.NodejsFunction(this, "JobsApiFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            handler: "handler",
            entry: "../api/src/jobs-api/index.ts",
            depsLockFilePath: "../api/package-lock.json",
            timeout: cdk.Duration.seconds(30),
            memorySize: 512,
            environment: {
                JOBS_TABLE: videoJobsTable.tableName,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });

        // Grant permissions to jobs API function
        videoJobsTable.grantReadWriteData(jobsApiFunction);
        videoAssetsBucket.grantRead(cognito.authenticatedRole);

        // Add explicit policy for video assets access
        cognito.authenticatedRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: ["s3:GetObject", "s3:GetObjectVersion"],
                resources: [videoAssetsBucket.bucketArn, `${videoAssetsBucket.bucketArn}/*`],
            }),
        );

        // Create website with video assets bucket configuration (now Function URL is available)
        // webAclArn: cfWafWebAcl,
        const website = new CloudFrontS3WebSiteConstruct(this, "WebApp", {
            userPoolId: cognito.userPool.userPoolId,
            appClientId: cognito.webClientId,
            identityPoolId: cognito.identityPoolId,
            webSiteBuildPath: webAppBuildPath,
            webAclArn: cfWafWebAcl,
            withApi: true,
            videoAssetsBucketName: videoAssetsBucket.bucketName,
            videoAssetsBucket: videoAssetsBucket,
        });

        // Set S3 CORS to restrict origins to the CloudFront domain (and localhost for local dev)
        // @secure_recommendation: Restrict cross-origin access to CloudFront-fronted domains and localhost dev
        // only; avoid wildcard (*). We use https://*.cloudfront.net instead of referencing the distribution's
        // DomainName attribute to break a CloudFormation circular dependency between the bucket (CORS origin
        // references distribution) and the distribution (bucket is an OAC origin).
        const cfnBucket = videoAssetsBucket.node.defaultChild as cdk.aws_s3.CfnBucket;
        cfnBucket.corsConfiguration = {
            corsRules: [
                {
                    allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
                    allowedOrigins: [
                        "https://*.cloudfront.net",
                        "http://localhost:5173",
                    ],
                    allowedHeaders: ["*"],
                    exposedHeaders: ["ETag"],
                },
            ],
        };

        // Create API Gateway
        const api = new ApiGatewayV2CloudFrontConstruct(this, "Api", {
            cloudFrontDistribution: website.cloudFrontDistribution,
            userPool: cognito.userPool,
            userPoolClient: cognito.webClientUserPool,
        });

        // Events Lambda Function
        const eventsFunction = new cdk.aws_lambda_nodejs.NodejsFunction(this, "EventsFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            handler: "handler",
            entry: "../api/src/events/index.ts",
            depsLockFilePath: "../api/package-lock.json",
            timeout: cdk.Duration.minutes(5),
            environment: {
                EVENTS_TABLE: database.eventsTable.tableName,
                CLIPS_TABLE: database.clipsTable.tableName,
                VIDEO_ASSETS_BUCKET: videoAssetsBucket.bucketName,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });

        database.eventsTable.grantReadWriteData(eventsFunction);
        database.clipsTable.grantReadWriteData(eventsFunction);
        videoAssetsBucket.grantReadWrite(eventsFunction);

        new ApiGatewayV2LambdaConstruct(this, "EventsApiGateway", {
            lambdaFn: eventsFunction,
            routePath: "/api/events",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.POST,
                cdk.aws_apigatewayv2.HttpMethod.PUT,
                cdk.aws_apigatewayv2.HttpMethod.DELETE,
            ],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "EventsApiGatewayWithId", {
            lambdaFn: eventsFunction,
            routePath: "/api/events/{id}",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.PUT,
                cdk.aws_apigatewayv2.HttpMethod.DELETE,
            ],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "EventsApiGatewayActivate", {
            lambdaFn: eventsFunction,
            routePath: "/api/events/{id}/activate",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.PUT,
            ],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "EventsApiGatewayDeactivate", {
            lambdaFn: eventsFunction,
            routePath: "/api/events/{id}/deactivate",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.PUT,
            ],
            api: api.apiGatewayV2,
        });

        // Channels Lambda Function (Python - for native Elemental Inference SDK support)
        const channelsFunction = createPythonFunction(this, "ChannelsFunction", {
            functionName: `${this.stackName}-channels-api`,
            handler: "main.lambda_handler",
            entry: "../api/src/channels-python",
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                CHANNELS_TABLE_NAME: database.channelsTable.tableName,
                CLOUDFORMATION_STACK_NAME: this.stackName,
                CHANNEL_GROUP_NAME: mediaPackageV2.channelGroup.channelGroupName,
                INFERENCE_STAGE: "prod",
                POWERTOOLS_SERVICE_NAME: "channels-api",
                POWERTOOLS_METRICS_NAMESPACE: `${this.stackName}/ChannelsAPI`,
                LOG_LEVEL: "INFO",
            },
            tracing: cdk.aws_lambda.Tracing.ACTIVE,
        });

        database.channelsTable.grantReadWriteData(channelsFunction);

        // Channels Lambda needs to invoke the MediaLive API Client Lambda
        // (will be granted after medialiveClient is created below)

        // CloudFormation describe (fallback for channel group name resolution)
        channelsFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["cloudformation:DescribeStacks"],
            resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/${this.stackName}/*`],
        }));
        // MediaPackageV2 channel management
        channelsFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "mediapackagev2:CreateChannel",
                "mediapackagev2:DeleteChannel",
            ],
            resources: ["*"],
        }));

        new ApiGatewayV2LambdaConstruct(this, "ChannelsApiGateway", {
            lambdaFn: channelsFunction,
            routePath: "/api/channels",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET, cdk.aws_apigatewayv2.HttpMethod.POST],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "ChannelsApiGatewayWithId", {
            lambdaFn: channelsFunction,
            routePath: "/api/channels/{id}",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET, cdk.aws_apigatewayv2.HttpMethod.DELETE],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "ChannelsStatusApiGateway", {
            lambdaFn: channelsFunction,
            routePath: "/api/channels/status/{executionArn}",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: api.apiGatewayV2,
        });

        // Clips Lambda Function
        const clipsFunction = new cdk.aws_lambda_nodejs.NodejsFunction(this, "ClipsFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            handler: "handler",
            entry: "../api/src/clips/index.ts",
            depsLockFilePath: "../api/package-lock.json",
            timeout: cdk.Duration.minutes(5),
            environment: {
                CLIPS_TABLE: database.clipsTable.tableName,
                VIDEO_ASSETS_BUCKET: videoAssetsBucket.bucketName,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });

        database.clipsTable.grantReadWriteData(clipsFunction);
        videoAssetsBucket.grantReadWrite(clipsFunction);

        new ApiGatewayV2LambdaConstruct(this, "ClipsApiGateway", {
            lambdaFn: clipsFunction,
            routePath: "/api/clips",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.POST,
                cdk.aws_apigatewayv2.HttpMethod.PUT,
                cdk.aws_apigatewayv2.HttpMethod.DELETE,
            ],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "ClipsApiGatewayWithId", {
            lambdaFn: clipsFunction,
            routePath: "/api/clips/{id}",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.PUT,
                cdk.aws_apigatewayv2.HttpMethod.DELETE,
            ],
            api: api.apiGatewayV2,
        });



        // MediaConvert infrastructure (IAM role, EventBridge rule, Completion Handler)
        const mediaConvert = new MediaConvertConstruct(this, "MediaConvert", {
            videoJobsTable: videoJobsTable,
            clipsTable: database.clipsTable,
            downloadJobsTable: database.downloadJobsTable,
            videoAssetsBucket: videoAssetsBucket,
            stackName: this.stackName,
        });

        // System Settings API
        const systemSettings = new SystemSettingsConstruct(this, "SystemSettings", {
            systemSettingsTable: database.systemSettingsTable,
            api: api.apiGatewayV2,
            stackName: this.stackName,
        });


        // Update Jobs API function with video editing capabilities
        jobsApiFunction.addEnvironment("CLIPS_TABLE", database.clipsTable.tableName);
        jobsApiFunction.addEnvironment("VIDEO_ASSETS_BUCKET", videoAssetsBucket.bucketName);
        jobsApiFunction.addEnvironment("MC_ROLE_ARN", mediaConvert.mediaConvertRoleArn);
        jobsApiFunction.addEnvironment("MC_ENDPOINT", mediaConvert.mediaConvertEndpoint);

        // Grant Jobs API Lambda permission to pass the MediaConvert role
        jobsApiFunction.addToRolePolicy(
            new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: ["iam:PassRole"],
                resources: [mediaConvert.mediaConvertRoleArn],
            }),
        );

        // Grant Jobs API Lambda permission to create MediaConvert jobs
        jobsApiFunction.addToRolePolicy(
            new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: ["mediaconvert:CreateJob", "mediaconvert:GetJob"],
                resources: [
                    `arn:aws:mediaconvert:${this.region}:${this.account}:jobs/*`,
                    `arn:aws:mediaconvert:${this.region}:${this.account}:queues/*`,
                ],
            }),
        );

        // Grant additional permissions to jobs API function
        database.clipsTable.grantReadWriteData(jobsApiFunction);
        videoAssetsBucket.grantRead(jobsApiFunction);

        // Templates Lambda Function
        const templatesFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
            this,
            "TemplatesFunction",
            {
                runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
                architecture: cdk.aws_lambda.Architecture.ARM_64,
                handler: "handler",
                entry: "../api/src/templates/index.ts",
                depsLockFilePath: "../api/package-lock.json",
                timeout: cdk.Duration.minutes(5),
                environment: {
                    TEMPLATES_TABLE: database.templatesTable.tableName,
                },
                bundling: {
                    externalModules: ["@aws-sdk/*"],
                },
            },
        );

        database.templatesTable.grantReadWriteData(templatesFunction);

        new ApiGatewayV2LambdaConstruct(this, "TemplatesApiGateway", {
            lambdaFn: templatesFunction,
            routePath: "/api/templates",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.POST,
                cdk.aws_apigatewayv2.HttpMethod.PUT,
                cdk.aws_apigatewayv2.HttpMethod.DELETE,
            ],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "TemplatesApiGatewayWithId", {
            lambdaFn: templatesFunction,
            routePath: "/api/templates/{id}",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.PUT,
                cdk.aws_apigatewayv2.HttpMethod.DELETE,
            ],
            api: api.apiGatewayV2,
        });

        // Jobs Management API Routes
        new ApiGatewayV2LambdaConstruct(this, "JobsApiGateway", {
            lambdaFn: jobsApiFunction,
            routePath: "/api/jobs",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.POST,
            ],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "JobsWithIdApiGateway", {
            lambdaFn: jobsApiFunction,
            routePath: "/api/jobs/{jobId}",
            methods: [
                cdk.aws_apigatewayv2.HttpMethod.GET,
                cdk.aws_apigatewayv2.HttpMethod.PUT,
                cdk.aws_apigatewayv2.HttpMethod.DELETE,
            ],
            api: api.apiGatewayV2,
        });

        // Job Status API Route (for checking job status)
        new ApiGatewayV2LambdaConstruct(this, "JobStatusApiGateway", {
            lambdaFn: jobsApiFunction,
            routePath: "/api/jobs/{jobId}/status",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: api.apiGatewayV2,
        });

        // Download Clips API Routes are defined after HarvestDownloadSM construct below

        // Create Python Harvest Pipeline construct
        const harvestPipelinePython = new HarvestPipelinePythonConstruct(
            this,
            "HarvestPipelinePython",
            {
                videoAssetsBucket: videoAssetsBucket,
                harvestJobsTable: database.harvestJobsTable,
                clipsTable: database.clipsTable,
                eventsTable: database.eventsTable,
                mediaPackageChannelGroup: mediaPackageV2.channelGroup.channelGroupName,
                systemSettingsTable: database.systemSettingsTable,
                stackName: this.stackName,
                api: api.apiGatewayV2,
            },
        );

        // Harvest API invoke is no longer needed for Download API — Step Functions handles harvesting

        jobsApiFunction.addEnvironment("HARVEST_API_FUNCTION_NAME", harvestPipelinePython.harvestApiFunction.functionName);
        harvestPipelinePython.harvestApiFunction.grantInvoke(jobsApiFunction);



        // Create Harvest/Download Step Functions workflow and task Lambdas
        const harvestDownloadSm = new HarvestDownloadStateMachineConstruct(this, "HarvestDownloadSM", {
            clipsTable: database.clipsTable,
            harvestJobsTable: database.harvestJobsTable,
            downloadJobsTable: database.downloadJobsTable,
            channelsTable: database.channelsTable,
            systemSettingsTable: database.systemSettingsTable,
            videoAssetsBucket: videoAssetsBucket,
            mediaConvertRoleArn: mediaConvert.mediaConvertRoleArn,
            mediaConvertEndpoint: mediaConvert.mediaConvertEndpoint,
            mediaPackageChannelGroup: mediaPackageV2.channelGroup.channelGroupName,
            stackName: this.stackName,
        });

        // Wire AutoHarvest State Machine ARN into the Clip Detection Handler
        harvestPipelinePython.harvestProcessorFunction.addEnvironment(
            "AUTOHARVEST_STATE_MACHINE_ARN",
            harvestDownloadSm.autoHarvestStateMachineArn,
        );
        harvestPipelinePython.harvestProcessorFunction.addToRolePolicy(
            new cdk.aws_iam.PolicyStatement({
                actions: ["states:StartExecution"],
                resources: [harvestDownloadSm.autoHarvestStateMachineArn],
            }),
        );

        // Instantiate Download API construct now that we have the state machine ARN
        const downloadClips = new DownloadMp4LambdaConstruct(this, "DownloadMp4Pipeline", {
            downloadJobsTable: database.downloadJobsTable,
            clipsTable: database.clipsTable,
            videoAssetsBucket: videoAssetsBucket,
            downloadStateMachineArn: harvestDownloadSm.downloadStateMachineArn,
        });

        // MC_ROLE_ARN is passed to the Download API so it can forward it to the state machine input
        downloadClips.downloadApiFunction.addEnvironment("MC_ROLE_ARN", mediaConvert.mediaConvertRoleArn);

        // Harvest Cleanup Lambda (scheduled daily to purge expired clip content)
        new HarvestCleanupConstruct(this, "HarvestCleanup", {
            clipsTable: database.clipsTable,
            systemSettingsTable: database.systemSettingsTable,
            videoAssetsBucket: videoAssetsBucket,
            stackName: this.stackName,
        });

        // Download Clips API Routes
        new ApiGatewayV2LambdaConstruct(this, "DownloadClipsRequestApiGateway", {
            lambdaFn: downloadClips.downloadApiFunction,
            routePath: "/api/download-clips",
            methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "DownloadClipsPresignApiGateway", {
            lambdaFn: downloadClips.downloadApiFunction,
            routePath: "/api/download-clips/presign",
            methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "DownloadClipsUrlApiGateway", {
            lambdaFn: downloadClips.downloadApiFunction,
            routePath: "/api/download-clips/{jobId}",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: api.apiGatewayV2,
        });

        // Create MediaLive API client Lambda for managing channels
        const medialiveClient = new MediaLiveLambdaConstruct(this, "MedialiveClient", {
            stackName: this.stackName,
            mediaLiveApiEndpoint: `https://medialive.${this.region}.amazonaws.com`,
            channelsTable: database.channelsTable,
        });

        // Grant MediaLive service role read access to the video assets bucket
        videoAssetsBucket.grantRead(medialiveClient.mediaLiveServiceRole);

        // MediaLive Status Lambda Function
        const medialiveStatusFunction = new cdk.aws_lambda_nodejs.NodejsFunction(this, "MedialiveStatusFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            handler: "handler",
            entry: "../api/src/medialive-status/index.ts",
            depsLockFilePath: "../api/package-lock.json",
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            environment: {
                MEDIALIVE_API_CLIENT_FUNCTION_NAME: medialiveClient.mediaLiveApiClientFunction.functionName,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });

        medialiveClient.mediaLiveApiClientFunction.grantInvoke(medialiveStatusFunction);

        new ApiGatewayV2LambdaConstruct(this, "MedialiveStatusApiGateway", {
            lambdaFn: medialiveStatusFunction,
            routePath: "/api/medialive/channels/{channelId}/status",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "MedialiveStartApiGateway", {
            lambdaFn: medialiveStatusFunction,
            routePath: "/api/medialive/channels/{channelId}/start",
            methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "MedialiveStopApiGateway", {
            lambdaFn: medialiveStatusFunction,
            routePath: "/api/medialive/channels/{channelId}/stop",
            methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
            api: api.apiGatewayV2,
        });

        new ApiGatewayV2LambdaConstruct(this, "MedialiveThumbnailApiGateway", {
            lambdaFn: medialiveStatusFunction,
            routePath: "/api/medialive/channels/{channelId}/thumbnail",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: api.apiGatewayV2,
        });

        // Grant channels Lambda permission to invoke the MediaLive API Client
        medialiveClient.mediaLiveApiClientFunction.grantInvoke(channelsFunction);
        channelsFunction.addEnvironment("MEDIALIVE_API_CLIENT_FUNCTION_NAME", medialiveClient.mediaLiveApiClientFunction.functionName);

        // Create Feed Lambda (invoked by Step Functions for Elemental Inference feed operations)
        const createFeedFunction = createPythonFunction(this, "CreateFeedFunction", {
            functionName: `${this.stackName}-create-feed`,
            handler: "main.lambda_handler",
            entry: "../api/src/create-feed-lambda",
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: cdk.Duration.minutes(2),
            memorySize: 256,
            environment: {
                INFERENCE_STAGE: "prod",
                POWERTOOLS_SERVICE_NAME: "create-feed-lambda",
                POWERTOOLS_METRICS_NAMESPACE: `${this.stackName}/CreateFeedLambda`,
                LOG_LEVEL: "INFO",
            },
            tracing: cdk.aws_lambda.Tracing.ACTIVE,
        });

        // Grant create-feed Lambda permission to manage Elemental Inference feeds and MediaPackage policies
        createFeedFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "elemental-inference:CreateFeed",
                "elemental-inference:DeleteFeed",
                "elemental-inference:UpdateFeed",
                "elemental-inference:GetFeed",
            ],
            resources: ["*"], // Elemental Inference does not support resource-level permissions
        }));
        createFeedFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "mediapackagev2:PutOriginEndpointPolicy",
                "mediapackagev2:DeleteOriginEndpointPolicy",
            ],
            resources: ["*"], // MediaPackage V2 does not support resource-level permissions for policies
        }));

        // Step Functions IAM role for CreateChannel state machine
        const createChannelSfnRole = new cdk.aws_iam.Role(this, "CreateChannelSfnRole", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("states.amazonaws.com"),
            description: "IAM role for CreateChannel Step Functions state machine",
        });

        // MediaPackageV2 permissions for the state machine
        createChannelSfnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "mediapackagev2:CreateChannel",
                "mediapackagev2:CreateOriginEndpoint",
                "mediapackagev2:PutOriginEndpointPolicy",
                "mediapackagev2:DeleteChannel",
                "mediapackagev2:DeleteOriginEndpoint",
                "mediapackagev2:DeleteOriginEndpointPolicy",
            ],
            resources: ["*"],
        }));

        // Lambda invoke permissions for create-feed and medialive-api-client
        createChannelSfnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [
                createFeedFunction.functionArn,
                medialiveClient.mediaLiveApiClientFunction.functionArn,
            ],
        }));

        // DynamoDB permissions for persisting channel records and handling failures
        createChannelSfnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
            ],
            resources: [database.channelsTable.tableArn],
        }));

        // Load and substitute ASL definition for CreateChannel state machine
        const aslDefinitionBody = fs.readFileSync(
            path.join(__dirname, "state-machines", "create-channel.asl.json"),
            "utf-8",
        );
        const substitutedAsl = aslDefinitionBody
            .replace(/\$\{CreateFeedFunctionArn\}/g, createFeedFunction.functionArn)
            .replace(/\$\{MediaLiveClientFunctionArn\}/g, medialiveClient.mediaLiveApiClientFunction.functionArn)
            .replace(/\$\{ChannelsTableName\}/g, database.channelsTable.tableName);

        const createChannelStateMachine = new cdk.aws_stepfunctions.StateMachine(this, "CreateChannelStateMachine", {
            stateMachineName: `${this.stackName}-CreateChannel`,
            definitionBody: cdk.aws_stepfunctions.DefinitionBody.fromString(substitutedAsl),
            role: createChannelSfnRole,
            tracingEnabled: true,
        });

        // Pass state machine ARN to channels-api Lambda
        channelsFunction.addEnvironment("CHANNEL_CREATION_STATE_MACHINE_ARN", createChannelStateMachine.stateMachineArn);

        // Grant channels-api Lambda permissions to start and describe Step Functions executions
        channelsFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "states:StartExecution",
                "states:DescribeExecution",
            ],
            resources: [
                createChannelStateMachine.stateMachineArn,
                `arn:aws:states:${this.region}:${this.account}:execution:${this.stackName}-CreateChannel:*`,
            ],
        }));

        // DeleteChannel Step Functions state machine
        const deleteAslBody = fs.readFileSync(
            path.join(__dirname, "state-machines", "delete-channel.asl.json"),
            "utf-8",
        );
        const substitutedDeleteAsl = deleteAslBody
            .replace(/\$\{CreateFeedFunctionArn\}/g, createFeedFunction.functionArn)
            .replace(/\$\{MediaLiveClientFunctionArn\}/g, medialiveClient.mediaLiveApiClientFunction.functionArn)
            .replace(/\$\{ChannelsTableName\}/g, database.channelsTable.tableName);

        const deleteChannelStateMachine = new cdk.aws_stepfunctions.StateMachine(this, "DeleteChannelStateMachine", {
            stateMachineName: `${this.stackName}-DeleteChannel`,
            definitionBody: cdk.aws_stepfunctions.DefinitionBody.fromString(substitutedDeleteAsl),
            role: createChannelSfnRole, // reuse same role — has all needed permissions
            tracingEnabled: true,
        });

        channelsFunction.addEnvironment("CHANNEL_DELETION_STATE_MACHINE_ARN", deleteChannelStateMachine.stateMachineArn);

        // Extend channels-api permissions to include the delete state machine
        channelsFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "states:StartExecution",
                "states:DescribeExecution",
            ],
            resources: [
                createChannelStateMachine.stateMachineArn,
                `arn:aws:states:${this.region}:${this.account}:execution:${this.stackName}-CreateChannel:*`,
                deleteChannelStateMachine.stateMachineArn,
                `arn:aws:states:${this.region}:${this.account}:execution:${this.stackName}-DeleteChannel:*`,
            ],
        }));

        // Events Lambda: add CHANNELS_TABLE and CREATE_FEED_FUNCTION_NAME env vars
        // for feed callbackMetadata update during event activation (AC4.2, AC4.3)
        eventsFunction.addEnvironment("CHANNELS_TABLE", database.channelsTable.tableName);
        eventsFunction.addEnvironment("CREATE_FEED_FUNCTION_NAME", createFeedFunction.functionName);

        // Grant events Lambda read access to Channels table for feedId lookup
        database.channelsTable.grantReadData(eventsFunction);

        // Grant events Lambda permission to invoke the create-feed Lambda for feed updates
        createFeedFunction.grantInvoke(eventsFunction);

        // Auto-Activate Scheduler Lambda (runs every minute via EventBridge)
        const autoActivateScheduler = createPythonFunction(this, "AutoActivateScheduler", {
            functionName: `${this.stackName}-auto-activate-scheduler`,
            handler: "main.lambda_handler",
            entry: "../api/src/auto-activate-scheduler",
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: cdk.Duration.seconds(60),
            environment: {
                EVENTS_TABLE: database.eventsTable.tableName,
                SYSTEM_SETTINGS_TABLE: database.systemSettingsTable.tableName,
                CHANNELS_TABLE: database.channelsTable.tableName,
                CREATE_FEED_FUNCTION_NAME: createFeedFunction.functionName,
                POWERTOOLS_SERVICE_NAME: "auto-activate-scheduler",
                POWERTOOLS_METRICS_NAMESPACE: `${this.stackName}/AutoActivateScheduler`,
                LOG_LEVEL: "INFO",
            },
        });

        // IAM permissions for scheduler
        database.eventsTable.grantReadWriteData(autoActivateScheduler);
        database.systemSettingsTable.grantReadData(autoActivateScheduler);
        database.channelsTable.grantReadData(autoActivateScheduler);
        createFeedFunction.grantInvoke(autoActivateScheduler);

        // EventBridge rule: invoke scheduler every minute
        new cdk.aws_events.Rule(this, "AutoActivateScheduleRule", {
            schedule: cdk.aws_events.Schedule.rate(cdk.Duration.minutes(1)),
            targets: [new cdk.aws_events_targets.LambdaFunction(autoActivateScheduler)],
        });

        // Harvest pipeline Lambda: add CHANNELS_TABLE_NAME env var and read access
        // for dynamic per-channel MediaPackage resource resolution (AC5.1)
        harvestPipelinePython.harvestProcessorFunction.addEnvironment("CHANNELS_TABLE_NAME", database.channelsTable.tableName);
        database.channelsTable.grantReadData(harvestPipelinePython.harvestProcessorFunction);

        // Note: Starfish/Elemental Inference API is now accessed directly via native boto3 client
        // The custom Lambda wrapper has been removed in favor of native SDK support (boto3 >= 1.42.56)
        // Harvest pipeline and onboarding scripts use boto3.client('elementalinference') directly

        // Set ALLOWED_ORIGIN on all API-facing Lambdas for CORS
        const allowedOrigin = `https://${website.cloudFrontDistribution.distributionDomainName}`;
        for (const fn of [
            eventsFunction,
            clipsFunction,
            jobsApiFunction,
            templatesFunction,
            medialiveStatusFunction,
            channelsFunction,
            downloadClips.downloadApiFunction,
            systemSettings.systemSettingsFunction,
        ]) {
            fn.addEnvironment("ALLOWED_ORIGIN", allowedOrigin);
        }

        // Output important values
        new cdk.CfnOutput(this, "VideoAssetsBucketName", {
            value: videoAssetsBucket.bucketName,
            description: "Name of the S3 bucket for all video assets",
        });

        new cdk.CfnOutput(this, "VideoJobsTableName", {
            value: videoJobsTable.tableName,
            description: "Name of the DynamoDB table for video processing jobs",
        });



        // MediaPackage V2 outputs
        new cdk.CfnOutput(this, "MediaPackageV2ChannelGroupName", {
            value: mediaPackageV2.channelGroup.channelGroupName,
            description: "MediaPackage V2 Channel Group Name for harvest jobs",
        });

        new cdk.CfnOutput(this, "MediaPackageV2HarvestJobRoleArn", {
            value: mediaPackageV2.harvestJobRole.roleArn,
            description: "IAM Role ARN for MediaPackage V2 harvest jobs",
        });

    }
}
