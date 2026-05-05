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

export interface AmplifyConfigBucketConstructProps extends cdk.StackProps {
    /**
     * The Cognito UserPoolId to authenticate users in the front-end
     */
    readonly userPoolId: string;

    /**
     * The Cognito AppClientId to authenticate users in the front-end
     */
    readonly appClientId: string;

    /**
     * The Cognito IdentityPoolId to authenticate users in the front-end
     */
    readonly identityPoolId: string;

    /**
     * The bucket in which the frontend assets are stored
     */
    readonly frontendBucket: cdk.aws_s3.Bucket;

    /**
     * The name of the bucket to use as storage using Amplify SDK if required
     */
    readonly storageBucketName?: string;

    /**
     * If you use Amplify SDK to access an API serving under /api path set this boolean to true
     */
    readonly withApi?: boolean;
}

const defaultProps: Partial<AmplifyConfigBucketConstructProps> = {};

/**
 * Deploys a lambda to the api gateway under the path `/api/amplify-config`.
 * The route is unauthenticated.  Use this with `apigatewayv2-cloudfront` for a CORS free
 * amplify configuration setup
 */
export class AmplifyConfigBucketConstruct extends Construct {
    constructor(parent: Construct, name: string, props: AmplifyConfigBucketConstructProps) {
        super(parent, name);

        props = { ...defaultProps, ...props };

        // get the parent stack reference for the stackName and the aws region
        const stack = cdk.Stack.of(this);
        const region = stack.region;
        const amplifyConfig: any = {
            Auth: {
                mandatorySignIn: true,
                region: region,
                userPoolId: props.userPoolId,
                userPoolWebClientId: props.appClientId,
                identityPoolId: props.identityPoolId,
            },
        };
        if (props.withApi) {
            // Add or remove extra config properties you may need here like API or storage
            amplifyConfig.API = {
                endpoints: [
                    {
                        name: "api",
                        endpoint: "./api",
                        region: region,
                    },
                ],
            };
        }
        if (props.storageBucketName) {
            amplifyConfig.Storage = {
                region: region,
                bucket: props.storageBucketName,
                identityPoolId: props.identityPoolId,
            };
        }

        new cdk.aws_s3_deployment.BucketDeployment(
            this,
            `AmplifyConfigBucketDeployment${Date.now()}`,
            {
                sources: [cdk.aws_s3_deployment.Source.jsonData("config.json", amplifyConfig)],
                destinationBucket: props.frontendBucket,
                contentType: "application/json",
                destinationKeyPrefix: "config",
            },
        );
    }
}
