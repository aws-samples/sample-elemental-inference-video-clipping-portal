import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { createPythonFunction } from "./python-function";
import { Construct } from "constructs";

export interface DownloadMp4LambdaConstructProps {
    readonly downloadJobsTable: cdk.aws_dynamodb.Table;
    readonly clipsTable: cdk.aws_dynamodb.Table;
    readonly videoAssetsBucket: cdk.aws_s3.Bucket;
    readonly downloadStateMachineArn: string;
}

export class DownloadMp4LambdaConstruct extends Construct {
    public readonly downloadApiFunction: lambda.Function;

    constructor(scope: Construct, id: string, props: DownloadMp4LambdaConstructProps) {
        super(scope, id);

        const stack = cdk.Stack.of(this);

        this.downloadApiFunction = createPythonFunction(this, "DownloadApiFunction", {
            architecture: lambda.Architecture.ARM_64,
            handler: "main.lambda_handler",
            entry: "../api/src/download-api",
            timeout: cdk.Duration.seconds(30),
            memorySize: 512,
            environment: {
                CLIPS_TABLE: props.clipsTable.tableName,
                DOWNLOAD_JOBS_TABLE: props.downloadJobsTable.tableName,
                VIDEO_ASSETS_BUCKET: props.videoAssetsBucket.bucketName,
                DOWNLOAD_STATE_MACHINE_ARN: props.downloadStateMachineArn,
                POWERTOOLS_SERVICE_NAME: "download-api",
                POWERTOOLS_METRICS_NAMESPACE: `${stack.stackName}/DownloadAPI`,
                LOG_LEVEL: "INFO",
            },
        });

        // DynamoDB permissions
        props.downloadJobsTable.grantReadWriteData(this.downloadApiFunction);
        props.clipsTable.grantReadWriteData(this.downloadApiFunction);

        // S3 read for presigned URL generation
        props.videoAssetsBucket.grantRead(this.downloadApiFunction);

        // Step Functions: start Download State Machine executions
        this.downloadApiFunction.addToRolePolicy(
            new cdk.aws_iam.PolicyStatement({
                actions: ["states:StartExecution"],
                resources: [props.downloadStateMachineArn],
            }),
        );
    }
}
