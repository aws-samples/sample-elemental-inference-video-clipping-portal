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
import { Construct } from "constructs";

export interface MediaPackageV2ConstructProps {
    readonly channelGroupName?: string;
    readonly videoAssetsBucket: cdk.aws_s3.Bucket;
    readonly harvestJobRole?: cdk.aws_iam.Role;
    readonly stackName: string;
    readonly clipsTable: cdk.aws_dynamodb.Table;
    readonly harvestJobsTable: cdk.aws_dynamodb.Table;
}

export class MediaPackageV2Construct extends Construct {
    public readonly channelGroup: cdk.aws_mediapackagev2.CfnChannelGroup;
    public readonly harvestJobRole: cdk.aws_iam.Role;
    public readonly lambdaExecutionRole: cdk.aws_iam.Role;

    constructor(scope: Construct, id: string, props: MediaPackageV2ConstructProps) {
        super(scope, id);

        // Grant MediaPackage V2 service principal permission to write to S3 bucket
        this.setS3BucketPolicy(props);

        // Create or use provided harvest job role
        this.harvestJobRole = props.harvestJobRole || this.createHarvestJobRole(props);

        // Create Lambda execution role for harvest pipeline functions
        this.lambdaExecutionRole = this.createLambdaExecutionRole(props);

        // Create MediaPackage V2 Channel Group
        // Channels and origin endpoints are now created dynamically via the Channels page
        const channelGroupName = props.channelGroupName || `harvest-channel-group-${cdk.Names.uniqueId(this).toLowerCase()}`;
        this.channelGroup = new cdk.aws_mediapackagev2.CfnChannelGroup(this, "ChannelGroup", {
            channelGroupName: channelGroupName,
            description: `MediaPackage V2 Channel Group for ${props.stackName} video harvesting`,
            tags: [
                {
                    key: "Project",
                    value: props.stackName,
                },
                {
                    key: "Component",
                    value: "VideoHarvestingPipeline",
                },
                {
                    key: "Purpose",
                    value: "LiveVideoHarvesting",
                },
            ],
        });

        // Output important values for reference
        new cdk.CfnOutput(this, "ChannelGroupName", {
            value: this.channelGroup.channelGroupName,
            description: "MediaPackage V2 Channel Group Name",
            exportName: `${props.stackName}-MediaPackageV2-ChannelGroup`,
        });

        new cdk.CfnOutput(this, "HarvestJobRoleArn", {
            value: this.harvestJobRole.roleArn,
            description: "IAM Role ARN for MediaPackage V2 Harvest Jobs",
            exportName: `${props.stackName}-MediaPackageV2-HarvestJobRole`,
        });

        new cdk.CfnOutput(this, "LambdaExecutionRoleArn", {
            value: this.lambdaExecutionRole.roleArn,
            description: "IAM Role ARN for Lambda functions in harvest pipeline",
            exportName: `${props.stackName}-MediaPackageV2-LambdaExecutionRole`,
        });
    }

    private createHarvestJobRole(props: MediaPackageV2ConstructProps): cdk.aws_iam.Role {
        // Create IAM role for MediaPackage V2 harvest jobs
        const harvestJobRole = new cdk.aws_iam.Role(this, "HarvestJobRole", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("mediapackagev2.amazonaws.com"),
            description: "IAM role for MediaPackage V2 harvest jobs to access S3",
        });

        // Add specific S3 permissions for the video assets bucket
        harvestJobRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "S3HarvestJobAccess",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "s3:PutObject",
                    "s3:PutObjectAcl",
                    "s3:GetObject",
                    "s3:GetObjectVersion",
                    "s3:DeleteObject",
                    "s3:ListBucket",
                ],
                resources: [
                    props.videoAssetsBucket.bucketArn,
                    `${props.videoAssetsBucket.bucketArn}/*`,
                ],
            }),
        );

        // Add permissions for harvest job operations
        harvestJobRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "MediaPackageV2HarvestOperations",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "mediapackagev2:CreateHarvestJob",
                    "mediapackagev2:GetHarvestJob",
                    "mediapackagev2:ListHarvestJobs",
                    "mediapackagev2:DeleteHarvestJob",
                    "mediapackagev2:GetOriginEndpoint",
                    "mediapackagev2:GetChannel",
                    "mediapackagev2:GetChannelGroup",
                ],
                resources: ["*"], // MediaPackage V2 doesn't support resource-level permissions yet
            }),
        );

        // Add CloudWatch Logs permissions for harvest job logging
        harvestJobRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "CloudWatchLogsAccess",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                    "logs:DescribeLogGroups",
                    "logs:DescribeLogStreams",
                ],
                resources: [
                    `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/mediapackagev2/*`,
                ],
            }),
        );

        return harvestJobRole;
    }

    private createLambdaExecutionRole(props: MediaPackageV2ConstructProps): cdk.aws_iam.Role {
        // Create IAM role for Lambda functions in the harvest pipeline
        const lambdaExecutionRole = new cdk.aws_iam.Role(this, "LambdaExecutionRole", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
            description: "IAM role for Lambda functions in the harvest pipeline",
            managedPolicies: [
                // Basic Lambda execution role
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                // X-Ray tracing permissions for Lambda Powertools
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"),
            ],
        });

        // Add MediaPackage V2 permissions for Lambda functions
        lambdaExecutionRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "MediaPackageV2Operations",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "mediapackagev2:CreateHarvestJob",
                    "mediapackagev2:GetHarvestJob",
                    "mediapackagev2:ListHarvestJobs",
                    "mediapackagev2:DeleteHarvestJob",
                    "mediapackagev2:GetOriginEndpoint",
                    "mediapackagev2:GetChannel",
                    "mediapackagev2:GetChannelGroup",
                ],
                resources: ["*"], // MediaPackage V2 doesn't support resource-level permissions yet
            }),
        );

        // Add S3 permissions for harvest job management
        lambdaExecutionRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "S3HarvestJobManagement",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "s3:GetObject",
                    "s3:GetObjectVersion",
                    "s3:ListBucket",
                    "s3:GetBucketLocation",
                    "s3:GetObjectAttributes",
                ],
                resources: [
                    props.videoAssetsBucket.bucketArn,
                    `${props.videoAssetsBucket.bucketArn}/*`,
                ],
            }),
        );

        // Add CloudWatch permissions for metrics and logging
        lambdaExecutionRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "CloudWatchMetricsAndLogs",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "cloudwatch:PutMetricData",
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                resources: [
                    `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:*`,
                    `arn:aws:cloudwatch:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:*`,
                ],
            }),
        );

        // Add SNS permissions for alerting
        lambdaExecutionRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "SNSAlerting",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "sns:Publish",
                ],
                resources: [
                    `arn:aws:sns:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${props.stackName}-*`,
                ],
            }),
        );

        // Add EventBridge permissions for event processing
        lambdaExecutionRole.addToPolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "EventBridgeAccess",
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                    "events:PutEvents",
                ],
                resources: [
                    `arn:aws:events:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:event-bus/default`,
                ],
            }),
        );

        return lambdaExecutionRole;
    }

    private setS3BucketPolicy(props: MediaPackageV2ConstructProps): void {
        // Grant MediaPackage V2 service principal permission to write harvest job outputs to S3
        props.videoAssetsBucket.addToResourcePolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "AllowMediaPackageV2HarvestJobs",
                effect: cdk.aws_iam.Effect.ALLOW,
                principals: [new cdk.aws_iam.ServicePrincipal("mediapackagev2.amazonaws.com")],
                actions: [
                    "s3:PutObject",
                    "s3:PutObjectAcl",
                    "s3:GetObject",
                    "s3:ListBucket",
                ],
                resources: [
                    props.videoAssetsBucket.bucketArn,
                    `${props.videoAssetsBucket.bucketArn}/*`,
                ],
            }),
        );
    }
}
