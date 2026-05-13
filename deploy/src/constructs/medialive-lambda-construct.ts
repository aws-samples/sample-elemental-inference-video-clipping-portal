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
import * as lambdaPython from "@aws-cdk/aws-lambda-python-alpha";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface MediaLiveLambdaConstructProps {
    readonly stackName: string;
    readonly mediaLiveApiEndpoint?: string;
    readonly channelsTable: cdk.aws_dynamodb.ITable;
}

export class MediaLiveLambdaConstruct extends Construct {
    public readonly mediaLiveApiClientFunction: lambdaPython.PythonFunction;
    public readonly mediaLiveServiceRole: iam.Role;

    constructor(scope: Construct, id: string, props: MediaLiveLambdaConstructProps) {
        super(scope, id);

        // Create MediaLive service role
        this.mediaLiveServiceRole = this.createMediaLiveServiceRole(props.stackName);

        // Create MediaLive API Client Lambda Function
        this.mediaLiveApiClientFunction = new lambdaPython.PythonFunction(
            this,
            "MediaLiveApiClientFn",
            {
                functionName: `${props.stackName}-medialive-api-client`,
                runtime: lambda.Runtime.PYTHON_3_12,
                handler: "lambda_handler",
                index: "main.py",
                entry: "../api/src/medialive-api-client",
                timeout: cdk.Duration.seconds(30),
                memorySize: 256,
                environment: {
                    MEDIALIVE_API_ENDPOINT: props.mediaLiveApiEndpoint || "",
                    MEDIALIVE_SERVICE_ROLE_ARN: this.mediaLiveServiceRole.roleArn,
                    CHANNELS_TABLE_NAME: props.channelsTable.tableName,
                },
                tracing: lambda.Tracing.ACTIVE,
            },
        );

        // Grant DynamoDB write permissions for Channels table
        props.channelsTable.grantWriteData(this.mediaLiveApiClientFunction);

        // Grant MediaLive API permissions
        this.mediaLiveApiClientFunction.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "medialive:CreateChannel",
                    "medialive:UpdateChannel",
                    "medialive:DeleteChannel",
                    "medialive:StartChannel",
                    "medialive:StopChannel",
                    "medialive:DescribeChannel",
                    "medialive:CreateInput",
                    "medialive:UpdateInput",
                    "medialive:DeleteInput",
                    "medialive:DescribeInput",
                    "medialive:DescribeThumbnails",
                ],
                resources: ["*"],
            }),
        );

        // Grant Elemental Inference permissions to the Lambda execution role.
        // MediaLive validates that the caller has elemental-inference:GetFeed when
        // creating a channel with Inference features enabled.
        this.mediaLiveApiClientFunction.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "elemental-inference:GetFeed",
                    "elemental-inference:ListFeeds",
                ],
                resources: ["*"],
            }),
        );

        // Grant PassRole permission for MediaLive service role
        this.mediaLiveApiClientFunction.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["iam:PassRole"],
                resources: [this.mediaLiveServiceRole.roleArn],
            }),
        );

        // Suppress cdk-nag warnings for MediaLive Lambda function role
        NagSuppressions.addResourceSuppressions(
            this.mediaLiveApiClientFunction,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Lambda requires wildcard resources for medialive operations as MediaLive does not support resource-level permissions for all actions",
                    appliesTo: [
                        "Resource::*"
                    ],
                },
            ],
            true,
        );

        // Output function ARN
        new cdk.CfnOutput(this, "MediaLiveApiClientFunctionArn", {
            value: this.mediaLiveApiClientFunction.functionArn,
            description: "MediaLive API Client Lambda Function ARN",
            exportName: `${props.stackName}-MediaLiveApiClient-FunctionArn`,
        });

        // Output service role ARN
        new cdk.CfnOutput(this, "MediaLiveServiceRoleArn", {
            value: this.mediaLiveServiceRole.roleArn,
            description: "MediaLive Service Role ARN",
            exportName: `${props.stackName}-MediaLiveService-RoleArn`,
        });
    }

    /**
     * Create MediaLive service role with required permissions
     */
    private createMediaLiveServiceRole(stackName: string): iam.Role {
        const role = new iam.Role(this, "MediaLiveServiceRole", {
            roleName: `${stackName}-medialive-service-role`,
            assumedBy: new iam.ServicePrincipal("medialive.amazonaws.com"),
            description: "Service role for MediaLive channels",
        });

        role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "s3:ListBucket",
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:DeleteObject",
                    "mediapackage:*",
                ],
                resources: ["*"],
            }),
        );

        role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "mediastore:ListContainers",
                    "mediastore:PutObject",
                    "mediastore:GetObject",
                    "mediastore:DeleteObject",
                    "mediastore:DescribeObject",
                ],
                resources: ["*"],
            }),
        );

        role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                    "logs:DescribeLogStreams",
                    "logs:DescribeLogGroups",
                ],
                resources: ["arn:aws:logs:*:*:*"],
            }),
        );

        role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "mediaconnect:ManagedDescribeFlow",
                    "mediaconnect:ManagedAddOutput",
                    "mediaconnect:ManagedRemoveOutput",
                ],
                resources: ["*"],
            }),
        );

        role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "ec2:describeSubnets",
                    "ec2:describeNetworkInterfaces",
                    "ec2:createNetworkInterface",
                    "ec2:createNetworkInterfacePermission",
                    "ec2:deleteNetworkInterface",
                    "ec2:deleteNetworkInterfacePermission",
                    "ec2:describeSecurityGroups",
                    "ec2:describeAddresses",
                    "ec2:associateAddress",
                ],
                resources: ["*"],
            }),
        );

        role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["mediapackagev2:*"],
                resources: ["*"],
            }),
        );

        role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "elemental-inference:AssociateFeed",
                    "elemental-inference:DisassociateFeed",
                    "elemental-inference:GetFeed",
                    "elemental-inference:ListFeeds",
                ],
                resources: ["*"],
            }),
        );

        // Suppress cdk-nag warnings for MediaLive service role
        NagSuppressions.addResourceSuppressions(
            role,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "MediaLive service role requires wildcard resources for mediapackage, mediapackagev2, elemental-inference, and logs as these services have limited resource-level permission support",
                    appliesTo: [
                        "Action::mediapackage:*",
                        "Action::mediapackagev2:*",
                        "Resource::arn:aws:logs:*:*:*",
                        "Resource::*",
                    ],
                },
            ],
            true,
        );

        return role;
    }

    /**
     * Grant permission for a Lambda function to invoke the MediaLive API client
     */
    public grantInvoke(grantee: lambda.IFunction): void {
        this.mediaLiveApiClientFunction.grantInvoke(grantee);

        // Suppress cdk-nag warning for Lambda invoke wildcard (needed for versions/aliases)
        NagSuppressions.addResourceSuppressions(
            grantee,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Lambda invoke permission requires wildcard for function versions and aliases",
                    appliesTo: [`Resource::<MediaLiveClientMediaLiveApiClientFnXXXXXXXX.Arn>:*`],
                },
            ],
            true,
        );
    }

    /**
     * Grant permission for multiple Lambda functions to invoke the MediaLive API client
     */
    public grantInvokeToMultiple(grantees: lambda.IFunction[]): void {
        grantees.forEach((grantee) => this.grantInvoke(grantee));
    }
}
