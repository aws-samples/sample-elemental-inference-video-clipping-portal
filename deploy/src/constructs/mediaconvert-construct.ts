/**
 * MediaConvert Construct
 *
 * Provisions MediaConvert infrastructure: IAM role, EventBridge rule for job
 * state changes, and a Completion Handler Lambda that updates DynamoDB records
 * when MediaConvert jobs complete, fail, or are canceled.
 */

import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";

export interface MediaConvertConstructProps {
    readonly videoJobsTable: cdk.aws_dynamodb.Table;
    readonly clipsTable: cdk.aws_dynamodb.Table;
    readonly downloadJobsTable: cdk.aws_dynamodb.Table;
    readonly videoAssetsBucket: cdk.aws_s3.Bucket;
    readonly stackName: string;
}

export class MediaConvertConstruct extends Construct {
    public readonly mediaConvertRoleArn: string;
    public readonly mediaConvertEndpoint: string;
    public readonly completionHandlerFunction: cdk.aws_lambda_nodejs.NodejsFunction;

    constructor(scope: Construct, id: string, props: MediaConvertConstructProps) {
        super(scope, id);

        // IAM role for MediaConvert to access S3
        const mediaConvertRole = new iam.Role(this, "MediaConvertRole", {
            assumedBy: new iam.ServicePrincipal("mediaconvert.amazonaws.com"),
            description: "Allows MediaConvert to read/write video assets in S3",
        });

        props.videoAssetsBucket.grantReadWrite(mediaConvertRole);

        this.mediaConvertRoleArn = mediaConvertRole.roleArn;

        // Regional MediaConvert endpoint
        const stack = cdk.Stack.of(this);
        this.mediaConvertEndpoint = `https://mediaconvert.${stack.region}.amazonaws.com`;

        // Completion Handler Lambda
        this.completionHandlerFunction = new cdk.aws_lambda_nodejs.NodejsFunction(this, "CompletionHandlerFn", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            handler: "handler",
            entry: "../api/src/mediaconvert-completion-handler/index.ts",
            depsLockFilePath: "../api/package-lock.json",
            timeout: cdk.Duration.seconds(30),
            memorySize: 512,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            environment: {
                CLIPS_TABLE: props.clipsTable.tableName,
                DOWNLOAD_JOBS_TABLE: props.downloadJobsTable.tableName,
                VIDEO_JOBS_TABLE: props.videoJobsTable.tableName,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
            tracing: cdk.aws_lambda.Tracing.ACTIVE,
        });

        // Grant Completion Handler read/write on all four tables
        props.clipsTable.grantReadWriteData(this.completionHandlerFunction);
        props.downloadJobsTable.grantReadWriteData(this.completionHandlerFunction);
        props.videoJobsTable.grantReadWriteData(this.completionHandlerFunction);

        // EventBridge rule for MediaConvert job state changes
        const mediaConvertRule = new events.Rule(this, "MediaConvertJobStateChangeRule", {
            ruleName: `${props.stackName}-mediaconvert-job-state-change`,
            description: "Routes MediaConvert COMPLETE/ERROR/CANCELED events to the completion handler",
            eventPattern: {
                source: ["aws.mediaconvert"],
                detailType: ["MediaConvert Job State Change"],
                detail: {
                    status: ["COMPLETE", "ERROR", "CANCELED"],
                },
            },
        });

        mediaConvertRule.addTarget(
            new targets.LambdaFunction(this.completionHandlerFunction, {
                maxEventAge: cdk.Duration.hours(2),
                retryAttempts: 2,
            }),
        );

        // Outputs
        new cdk.CfnOutput(this, "MediaConvertRoleArn", {
            value: this.mediaConvertRoleArn,
            description: "MediaConvert IAM Role ARN",
        });

        new cdk.CfnOutput(this, "CompletionHandlerFunctionName", {
            value: this.completionHandlerFunction.functionName,
            description: "MediaConvert Completion Handler Lambda Function Name",
        });
    }
}
