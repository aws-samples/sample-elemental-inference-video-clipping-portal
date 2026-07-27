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

import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { createPythonFunction } from "./python-function";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import { Construct } from "constructs";
import { ApiGatewayV2LambdaConstruct } from "./apigatewayv2-lambda-construct";

export interface HarvestPipelinePythonConstructProps {
    readonly videoAssetsBucket: cdk.aws_s3.Bucket;
    readonly harvestJobsTable: cdk.aws_dynamodb.Table;
    readonly clipsTable: cdk.aws_dynamodb.Table;
    readonly eventsTable: cdk.aws_dynamodb.Table;
    readonly mediaPackageChannelGroup: string;
    readonly systemSettingsTable?: cdk.aws_dynamodb.Table;
    readonly autoHarvestStateMachineArn?: string;
    readonly stackName: string;
    readonly api: cdk.aws_apigatewayv2.HttpApi;
}

export class HarvestPipelinePythonConstruct extends Construct {
    public readonly harvestProcessorFunction: lambda.Function;
    public readonly harvestApiFunction: lambda.Function;
    public readonly pythonLayer: lambda.LayerVersion;
    public readonly deadLetterQueue: sqs.Queue;
    public readonly alertingTopic: sns.Topic;

    constructor(scope: Construct, id: string, props: HarvestPipelinePythonConstructProps) {
        super(scope, id);

        // Create SNS topic for alerting
        this.alertingTopic = new sns.Topic(this, "HarvestPipelineAlerts", {
            displayName: `${props.stackName} Harvest Pipeline Alerts`,
            topicName: `${props.stackName}-harvest-pipeline-alerts`,
        });

        // Create Dead Letter Queue for failed events
        this.deadLetterQueue = new sqs.Queue(this, "HarvestPipelineDLQ", {
            queueName: `${props.stackName}-harvest-pipeline-dlq`,
            retentionPeriod: cdk.Duration.days(14),
            visibilityTimeout: cdk.Duration.minutes(5),
        });

        // Create Python Lambda Layer for dependencies
        this.pythonLayer = new lambda.LayerVersion(this, "HarvestPipelinePythonLayer", {
            layerVersionName: `${props.stackName}-harvest-pipeline-python-layer`,
            code: lambda.Code.fromAsset("../api/src/harvest-pipeline-python", {
                bundling: {
                    image: lambda.Runtime.PYTHON_3_12.bundlingImage,
                    command: [
                        "bash", "-c",
                        [
                            "pip install -r requirements.txt -t /asset-output/python/",
                            "cp -r . /asset-output/python/",
                        ].join(" && "),
                    ],
                    user: "root",
                },
            }),
            compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
            compatibleArchitectures: [lambda.Architecture.ARM_64],
            description: "Python dependencies and utilities for harvest pipeline",
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Create EventBridge Harvest Processor Lambda Function
        this.harvestProcessorFunction = createPythonFunction(this, "HarvestProcessorFn", {
            handler: "main.lambda_handler",
            entry: "../api/src/harvest-pipeline-python",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.minutes(5),
            memorySize: 1024,
            layers: [this.pythonLayer],
            deadLetterQueue: this.deadLetterQueue,
            retryAttempts: 2,
            environment: {
                // S3 and DynamoDB configuration
                VIDEO_ASSETS_BUCKET: props.videoAssetsBucket.bucketName,
                HARVEST_JOBS_TABLE_NAME: props.harvestJobsTable.tableName,
                CLIPS_TABLE: props.clipsTable.tableName,
                EVENTS_TABLE: props.eventsTable.tableName,
                
                // MediaPackage V2 configuration
                MEDIAPACKAGE_CHANNEL_GROUP: props.mediaPackageChannelGroup,
                
                // AWS configuration
                AWS_STACK_NAME: props.stackName,
                
                // AWS Lambda Powertools configuration
                POWERTOOLS_SERVICE_NAME: "harvest-pipeline",
                POWERTOOLS_METRICS_NAMESPACE: `${props.stackName}/HarvestPipeline`,
                LOG_LEVEL: "INFO",
                
                // System settings
                SYSTEM_SETTINGS_TABLE: props.systemSettingsTable?.tableName || '',
                
                // Auto-Harvest Step Functions integration
                AUTOHARVEST_STATE_MACHINE_ARN: props.autoHarvestStateMachineArn || '',
                
                // Event association configuration
                EVENT_ASSOCIATION_TIME_WINDOW_MINUTES: "30",
                EVENT_ASSOCIATION_CREATE_DEFAULT: "false",
                EVENT_ASSOCIATION_SKIP_ON_NO_MATCH: "false",
                EVENT_ASSOCIATION_MAX_AGE_HOURS: "24",
                
                // Resilience configuration
                MAX_RETRIES: "3",
                BASE_DELAY: "1.0",
                MAX_DELAY: "10.0",
                BACKOFF_MULTIPLIER: "2.0",
            },
            tracing: lambda.Tracing.ACTIVE,
        });

        // Create Harvest API Lambda Function for REST endpoints
        this.harvestApiFunction = createPythonFunction(this, "HarvestApiFn", {
            handler: "main.api_handler",
            entry: "../api/src/harvest-pipeline-python",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.seconds(30),
            memorySize: 512,
            layers: [this.pythonLayer],
            environment: {
                // S3 and DynamoDB configuration
                VIDEO_ASSETS_BUCKET: props.videoAssetsBucket.bucketName,
                HARVEST_JOBS_TABLE_NAME: props.harvestJobsTable.tableName,
                CLIPS_TABLE: props.clipsTable.tableName,
                
                // MediaPackage V2 configuration
                MEDIAPACKAGE_CHANNEL_GROUP: props.mediaPackageChannelGroup,
                
                // AWS configuration
                AWS_STACK_NAME: props.stackName,
                
                // System settings
                SYSTEM_SETTINGS_TABLE: props.systemSettingsTable?.tableName || '',
                
                // AWS Lambda Powertools configuration
                POWERTOOLS_SERVICE_NAME: "harvest-api",
                POWERTOOLS_METRICS_NAMESPACE: `${props.stackName}/HarvestAPI`,
                LOG_LEVEL: "INFO",
            },
            tracing: lambda.Tracing.ACTIVE,
        });

        // Grant permissions to harvest processor function
        this.grantHarvestProcessorPermissions(props);

        // Grant permissions to harvest API function
        this.grantHarvestApiPermissions(props);

        // Create EventBridge rule for Starfish events
        this.createEventBridgeRule(props);

        // Create API Gateway routes for harvest API
        this.createApiRoutes(props);

        // Create CloudWatch alarms and monitoring
        this.createMonitoring(props);

        // Output important values
        this.createOutputs(props);
    }

    private grantHarvestProcessorPermissions(props: HarvestPipelinePythonConstructProps): void {
        // Grant DynamoDB permissions
        props.harvestJobsTable.grantReadWriteData(this.harvestProcessorFunction);
        props.clipsTable.grantReadWriteData(this.harvestProcessorFunction);
        props.eventsTable.grantReadData(this.harvestProcessorFunction);

        // Grant S3 permissions
        props.videoAssetsBucket.grantRead(this.harvestProcessorFunction);

        // Grant System Settings table read access
        if (props.systemSettingsTable) {
            props.systemSettingsTable.grantReadData(this.harvestProcessorFunction);
        }

        // Grant MediaPackage V2 permissions
        this.harvestProcessorFunction.addToRolePolicy(
            new iam.PolicyStatement({
                sid: "MediaPackageV2Operations",
                effect: iam.Effect.ALLOW,
                actions: [
                    "mediapackagev2:CreateHarvestJob",
                    "mediapackagev2:GetHarvestJob",
                    "mediapackagev2:ListHarvestJobs",
                    "mediapackagev2:DeleteHarvestJob",
                    "mediapackagev2:GetOriginEndpoint",
                    "mediapackagev2:GetChannel",
                    "mediapackagev2:GetChannelGroup",
                    "mediapackagev2:TagResource",
                ],
                resources: ["*"], // MediaPackage V2 doesn't support resource-level permissions yet
            }),
        );

        // Grant SNS permissions for alerting
        this.alertingTopic.grantPublish(this.harvestProcessorFunction);

        // Grant Step Functions permission to start AutoHarvest executions
        if (props.autoHarvestStateMachineArn) {
            this.harvestProcessorFunction.addToRolePolicy(
                new iam.PolicyStatement({
                    sid: "StepFunctionsStartAutoHarvest",
                    effect: iam.Effect.ALLOW,
                    actions: ["states:StartExecution"],
                    resources: [props.autoHarvestStateMachineArn],
                }),
            );
        }

        // Grant CloudWatch permissions for custom metrics
        this.harvestProcessorFunction.addToRolePolicy(
            new iam.PolicyStatement({
                sid: "CloudWatchMetrics",
                effect: iam.Effect.ALLOW,
                actions: [
                    "cloudwatch:PutMetricData",
                ],
                resources: ["*"],
                conditions: {
                    StringEquals: {
                        "cloudwatch:namespace": `${props.stackName}/HarvestPipeline`,
                    },
                },
            }),
        );
    }

    private grantHarvestApiPermissions(props: HarvestPipelinePythonConstructProps): void {
        // Grant DynamoDB read/write permissions (needs write for saving harvest job records)
        props.harvestJobsTable.grantReadWriteData(this.harvestApiFunction);
        props.clipsTable.grantReadData(this.harvestApiFunction);
        props.eventsTable.grantReadData(this.harvestApiFunction);

        // Grant S3 permissions for presigned URLs and harvest destination
        props.videoAssetsBucket.grantReadWrite(this.harvestApiFunction);

        // Grant System Settings table read access
        if (props.systemSettingsTable) {
            props.systemSettingsTable.grantReadData(this.harvestApiFunction);
        }

        // Grant MediaPackage V2 permissions for on-demand harvest job creation
        this.harvestApiFunction.addToRolePolicy(
            new iam.PolicyStatement({
                sid: "MediaPackageV2Operations",
                effect: iam.Effect.ALLOW,
                actions: [
                    "mediapackagev2:CreateHarvestJob",
                    "mediapackagev2:GetHarvestJob",
                    "mediapackagev2:ListHarvestJobs",
                    "mediapackagev2:GetOriginEndpoint",
                    "mediapackagev2:GetChannel",
                    "mediapackagev2:GetChannelGroup",
                    "mediapackagev2:TagResource",
                ],
                resources: ["*"], // MediaPackage V2 doesn't support resource-level permissions yet
            }),
        );

        // Grant CloudWatch permissions for custom metrics
        this.harvestApiFunction.addToRolePolicy(
            new iam.PolicyStatement({
                sid: "CloudWatchMetrics",
                effect: iam.Effect.ALLOW,
                actions: [
                    "cloudwatch:PutMetricData",
                ],
                resources: ["*"],
                conditions: {
                    StringEquals: {
                        "cloudwatch:namespace": `${props.stackName}/HarvestAPI`,
                    },
                },
            }),
        );
    }

    private createEventBridgeRule(props: HarvestPipelinePythonConstructProps): void {
        // Create CloudWatch log group for Starfish events
        const starfishLogGroup = new logs.LogGroup(this, "StarfishEventsLogGroup", {
            logGroupName: `/aws/events/${props.stackName}/starfish-events`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create EventBridge rule to capture Starfish events from default bus
        const starfishEventRule = new events.Rule(this, "StarfishHighlightRule", {
            ruleName: `${props.stackName}-starfish-highlight-events`,
            description: "Captures Starfish highlight metadata events for harvest processing",
            eventPattern: {
                source: ["aws.elemental-inference"],
                detailType: ["Clip Metadata Generated"],
            },
        });

        // Add CloudWatch Logs target
        starfishEventRule.addTarget(new targets.CloudWatchLogGroup(starfishLogGroup));

        // Add Lambda target with DLQ
        starfishEventRule.addTarget(
            new targets.LambdaFunction(this.harvestProcessorFunction, {
                deadLetterQueue: this.deadLetterQueue,
                maxEventAge: cdk.Duration.hours(2),
                retryAttempts: 2,
            }),
        );

        // Create CloudWatch alarm for DLQ messages
        const dlqAlarm = this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
        }).createAlarm(this, "HarvestPipelineDLQAlarm", {
            alarmName: `${props.stackName}-harvest-pipeline-dlq-messages`,
            alarmDescription: "Alarm when messages appear in harvest pipeline DLQ",
            threshold: 1,
            evaluationPeriods: 1,
            treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // Send DLQ alarm to SNS
        dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertingTopic));
    }

    private createApiRoutes(props: HarvestPipelinePythonConstructProps): void {
        // Create API Gateway routes for harvest jobs
        new ApiGatewayV2LambdaConstruct(this, "HarvestJobsListAPI", {
            lambdaFn: this.harvestApiFunction,
            routePath: "/api/harvest-jobs",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: props.api,
        });

        new ApiGatewayV2LambdaConstruct(this, "HarvestJobDetailsAPI", {
            lambdaFn: this.harvestApiFunction,
            routePath: "/api/harvest-jobs/{jobId}",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: props.api,
        });

        new ApiGatewayV2LambdaConstruct(this, "HarvestJobClipUrlAPI", {
            lambdaFn: this.harvestApiFunction,
            routePath: "/api/harvest-jobs/{jobId}/clip-url",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: props.api,
        });
    }

    private createMonitoring(props: HarvestPipelinePythonConstructProps): void {
        // Create CloudWatch alarms for harvest processor function
        const processorErrorAlarm = this.harvestProcessorFunction.metricErrors({
            period: cdk.Duration.minutes(5),
        }).createAlarm(this, "HarvestProcessorErrorAlarm", {
            alarmName: `${props.stackName}-harvest-processor-errors`,
            alarmDescription: "Alarm when harvest processor function has errors",
            threshold: 1,
            evaluationPeriods: 1,
            treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        const processorDurationAlarm = this.harvestProcessorFunction.metricDuration({
            period: cdk.Duration.minutes(5),
        }).createAlarm(this, "HarvestProcessorDurationAlarm", {
            alarmName: `${props.stackName}-harvest-processor-duration`,
            alarmDescription: "Alarm when harvest processor function duration is high",
            threshold: 240000, // 4 minutes (80% of 5-minute timeout)
            evaluationPeriods: 2,
            treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // Create CloudWatch alarms for harvest API function
        const apiErrorAlarm = this.harvestApiFunction.metricErrors({
            period: cdk.Duration.minutes(5),
        }).createAlarm(this, "HarvestApiErrorAlarm", {
            alarmName: `${props.stackName}-harvest-api-errors`,
            alarmDescription: "Alarm when harvest API function has errors",
            threshold: 5,
            evaluationPeriods: 2,
            treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // Send alarms to SNS
        processorErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertingTopic));
        processorDurationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertingTopic));
        apiErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertingTopic));

        // Create CloudWatch Dashboard
        const dashboard = new cdk.aws_cloudwatch.Dashboard(this, "HarvestPipelineDashboard", {
            dashboardName: `${props.stackName}-harvest-pipeline`,
        });

        // Add widgets to dashboard
        dashboard.addWidgets(
            new cdk.aws_cloudwatch.GraphWidget({
                title: "Harvest Processor Function Metrics",
                left: [
                    this.harvestProcessorFunction.metricInvocations(),
                    this.harvestProcessorFunction.metricErrors(),
                ],
                right: [this.harvestProcessorFunction.metricDuration()],
            }),
        );

        dashboard.addWidgets(
            new cdk.aws_cloudwatch.GraphWidget({
                title: "Harvest API Function Metrics",
                left: [
                    this.harvestApiFunction.metricInvocations(),
                    this.harvestApiFunction.metricErrors(),
                ],
                right: [this.harvestApiFunction.metricDuration()],
            }),
        );

        dashboard.addWidgets(
            new cdk.aws_cloudwatch.GraphWidget({
                title: "Dead Letter Queue Messages",
                left: [this.deadLetterQueue.metricApproximateNumberOfMessagesVisible()],
            }),
        );
    }

    private createOutputs(props: HarvestPipelinePythonConstructProps): void {
        new cdk.CfnOutput(this, "HarvestProcessorFunctionName", {
            value: this.harvestProcessorFunction.functionName,
            description: "Harvest Processor Lambda Function Name",
            exportName: `${props.stackName}-HarvestProcessor-FunctionName`,
        });

        new cdk.CfnOutput(this, "HarvestApiFunctionName", {
            value: this.harvestApiFunction.functionName,
            description: "Harvest API Lambda Function Name",
            exportName: `${props.stackName}-HarvestAPI-FunctionName`,
        });

        new cdk.CfnOutput(this, "PythonLayerArn", {
            value: this.pythonLayer.layerVersionArn,
            description: "Python Layer ARN for Harvest Pipeline",
            exportName: `${props.stackName}-HarvestPipeline-PythonLayer`,
        });

        new cdk.CfnOutput(this, "DeadLetterQueueUrl", {
            value: this.deadLetterQueue.queueUrl,
            description: "Dead Letter Queue URL for failed harvest events",
            exportName: `${props.stackName}-HarvestPipeline-DLQ`,
        });

        new cdk.CfnOutput(this, "AlertingTopicArn", {
            value: this.alertingTopic.topicArn,
            description: "SNS Topic ARN for harvest pipeline alerts",
            exportName: `${props.stackName}-HarvestPipeline-Alerts`,
        });
    }
}