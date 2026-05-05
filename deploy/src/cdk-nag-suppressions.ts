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
import { NagSuppressions } from "cdk-nag";

/**
 * General cdk nag suppressions to allow infrastructure that is acceptable for a prototype
 */
export const suppressCdkNagRules = (stack: cdk.Stack) => {
    // General
    NagSuppressions.addStackSuppressions(
        stack,
        [
            {
                id: "AwsSolutions-APIG1",
                reason: "API Gateway access logging not required for prototype",
            },
            {
                id: "AwsSolutions-CFR1",
                reason: "CloudFront geo restrictions not required for prototype",
            },
            {
                id: "AwsSolutions-CFR3",
                reason: "CloudFront access logging not required for prototype",
            },
            {
                id: "AwsSolutions-CFR4",
                reason: "Custom certificate required for enabling this rule.  Not required for prototype",
            },
            { id: "AwsSolutions-COG2", reason: "Cognito MFA not required for prototype" },
            {
                id: "AwsSolutions-COG3",
                reason: "Cognito advanced security mode not required for prototype",
            },
            {
                id: "AwsSolutions-IAM4",
                reason: "AWS managed policies allowed for prototype",
                appliesTo: [
                    /**
                     * Add AWS managed policies here that you want to allow in the CDK stack.
                     * These should be AWS managed policies that are not overly permissive,
                     * and are thus reasonable to use in prototype code––such as the ones below.
                     *
                     * DO NOT ADD e.g. AmazonSageMakerFullAccess, AmazonS3FullAccess, AWSGlueServiceRole
                     */
                    "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                    "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
                    "Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonSSMManagedInstanceCore",

                    "Policy::arn:<AWS::Partition>:iam::aws:policy/AWSXRayDaemonWriteAccess",
                ],
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "IAM wildcard allowed",
                appliesTo: [
                    "Action::s3:Abort*",
                    "Action::s3:DeleteObject*",
                    "Action::s3:GetObject*",
                    "Action::s3:GetBucket*",
                    "Action::s3:Get*",
                    "Action::s3:List*",
                    "Action::s3:Put*",
                    "Action::s3:PutObject*",
                    "Action::mediaconvert:*",
                    {
                        regex: "/^Resource::arn:aws:s3:*\\*$/",
                    },
                    {
                        regex: "/^Resource::<.*Bucket.+Arn>.*/\\*$/",
                    },
                    {
                        regex: "/^Resource::<.*Table.+Arn>/index/\\*$/",
                    },
                    // MediaConvert permissions with justification
                    "Resource::*", // DescribeEndpoints is a service-level operation that requires wildcard
                    "Resource::arn:aws:mediaconvert:us-east-1:<AWS::AccountId>:jobs/*",

                    {
                        regex: "/^Resource::<HarvestPipelinePythonHarvestApiFn.+\\.Arn>:\\*$/",
                    },
                    {
                        regex: "/^Resource::<MedialiveClientMediaLiveApiClientFn.+\\.Arn>:\\*$/",
                    },
                    {
                        regex: "/^Resource::<CreateFeedFunction.+\\.Arn>:\\*$/",
                    },
                    {
                        regex: "/^Resource::arn:aws:mediaconvert:[^:]+:[^:]+:jobs/\\*$/",
                    }, // Job IDs are dynamically generated and cannot be predicted
                    "Resource::arn:aws:logs:us-east-1:<AWS::AccountId>:log-group:/aws/mediapackagev2/*",
                    "Resource::arn:aws:cloudwatch:us-east-1:<AWS::AccountId>:*",
                    "Resource::arn:aws:logs:us-east-1:<AWS::AccountId>:*",
                    "Resource::arn:aws:logs:us-west-2:<AWS::AccountId>:log-group:/aws/mediapackagev2/*",
                    "Resource::arn:aws:cloudwatch:us-west-2:<AWS::AccountId>:*",
                    "Resource::arn:aws:logs:us-west-2:<AWS::AccountId>:*",
                    {
                        regex: "/^Resource::arn:aws:logs:[^:]+:[0-9]{12}:log-group:/aws/mediapackagev2/\\*$/",
                    }, // MediaPackage V2 log groups with actual account ID (any region)
                    {
                        regex: "/^Resource::arn:aws:cloudwatch:[^:]+:[0-9]{12}:\\*$/",
                    }, // CloudWatch metrics with actual account ID (any region)
                    {
                        regex: "/^Resource::arn:aws:logs:[^:]+:[0-9]{12}:\\*$/",
                    }, // CloudWatch logs with actual account ID (any region)
                    {
                        regex: "/^Resource::arn:aws:sns:[^:]+:[^:]+:.+-\\*$/",
                    }, // SNS topics with stack-specific naming patterns
                    {
                        regex: "/^Resource::arn:aws:lambda:\\*:\\*:function:<.+>$/",
                    }, // Lambda function invocation with dynamic function names
                    {
                        regex: "/^Resource::arn:aws:cloudformation:[^:]+:[0-9]{12}:stack/[^/]+/\\*$/",
                    }, // CloudFormation DescribeStacks requires wildcard for stack versions
                    {
                        regex: "/^Resource::arn:aws:states:[^:]+:[0-9]{12}:execution:[^:]+:\\*$/",
                    }, // Step Functions execution ARNs require wildcard for dynamic execution names
                ],
            },
            { id: "AwsSolutions-L1", reason: "Latest runtime not required for prototype" },
            { id: "AwsSolutions-S1", reason: "S3 server access logs not required for prototype" },
            {
                id: "AwsSolutions-S10",
                reason: "S3 SSL enforcement implemented via bucket policy and enforceSSL property",
            },
            {
                id: "AwsSolutions-SQS3",
                reason: "SQS DLQ not required for prototype harvest event processing",
            },
            {
                id: "AwsSolutions-SQS4",
                reason: "SQS SSL enforcement not required for prototype internal messaging",
            },
            {
                id: "AwsSolutions-SNS3",
                reason: "SNS SSL enforcement not required for prototype internal notifications",
            },
            {
                id: "AwsSolutions-SF1",
                reason: "Step Functions ERROR-level logging is sufficient for prototype; ALL-level logging generates excessive volume",
            },
        ],
        true,
    );

    stack.node.findAll().forEach(({ node }: { node: any }) => {
        const re = [
            new RegExp(`${stack.stackName}/Custom::CDKBucketDeployment.+/Resource`, "g"),
            new RegExp(
                `${stack.stackName}/Custom::CDKBucketDeployment.+/ServiceRole/DefaultPolicy/Resource`,
                "g",
            ),
        ];
        if (re.some((r) => r.test(node.path))) {
            NagSuppressions.addResourceSuppressionsByPath(stack, node.path, [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "DeploymentBucket adds * to custom resources and default policy",
                    appliesTo: [
                        {
                            regex: "/^Resource::*/g",
                        },
                    ],
                },
            ]);
        }
    });
};
