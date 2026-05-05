import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambdaPython from "@aws-cdk/aws-lambda-python-alpha";
import { Construct } from "constructs";

export interface HarvestCleanupConstructProps {
    readonly clipsTable: cdk.aws_dynamodb.Table;
    readonly systemSettingsTable: cdk.aws_dynamodb.Table;
    readonly videoAssetsBucket: cdk.aws_s3.Bucket;
    readonly stackName: string;
}

export class HarvestCleanupConstruct extends Construct {
    public readonly cleanupFunction: lambdaPython.PythonFunction;

    constructor(scope: Construct, id: string, props: HarvestCleanupConstructProps) {
        super(scope, id);

        this.cleanupFunction = new lambdaPython.PythonFunction(this, "CleanupFn", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            index: "main.py",
            entry: "../api/src/harvest-cleanup",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.minutes(5),
            memorySize: 256,
            environment: {
                CLIPS_TABLE_NAME: props.clipsTable.tableName,
                SYSTEM_SETTINGS_TABLE: props.systemSettingsTable.tableName,
                VIDEO_ASSETS_BUCKET: props.videoAssetsBucket.bucketName,
                POWERTOOLS_SERVICE_NAME: "harvest-cleanup",
                POWERTOOLS_METRICS_NAMESPACE: `${props.stackName}/HarvestCleanup`,
                LOG_LEVEL: "INFO",
            },
        });

        // IAM: read/write on Clips table, read on System Settings, S3 delete scoped to harvested-clips/*
        props.clipsTable.grantReadWriteData(this.cleanupFunction);
        props.systemSettingsTable.grantReadData(this.cleanupFunction);

        // Scoped S3 delete permission for harvested-clips/ prefix only
        this.cleanupFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3:ListBucket"],
            resources: [props.videoAssetsBucket.bucketArn],
            conditions: {
                StringLike: { "s3:prefix": ["harvested-clips/*"] },
            },
        }));
        this.cleanupFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:DeleteObject"],
            resources: [`${props.videoAssetsBucket.bucketArn}/harvested-clips/*`],
        }));

        // EventBridge rule: run once per day
        new events.Rule(this, "CleanupScheduleRule", {
            schedule: events.Schedule.rate(cdk.Duration.days(1)),
            targets: [new targets.LambdaFunction(this.cleanupFunction)],
        });
    }
}
