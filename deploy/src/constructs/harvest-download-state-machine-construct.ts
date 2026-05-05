import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as lambdaPython from "@aws-cdk/aws-lambda-python-alpha";
import { Construct } from "constructs";

export interface HarvestDownloadStateMachineConstructProps {
    readonly clipsTable: cdk.aws_dynamodb.Table;
    readonly harvestJobsTable: cdk.aws_dynamodb.Table;
    readonly downloadJobsTable: cdk.aws_dynamodb.Table;
    readonly channelsTable: cdk.aws_dynamodb.Table;
    readonly systemSettingsTable: cdk.aws_dynamodb.Table;
    readonly videoAssetsBucket: cdk.aws_s3.Bucket;
    readonly mediaConvertRoleArn: string;
    readonly mediaConvertEndpoint: string;
    readonly mediaPackageChannelGroup: string;
    readonly stackName: string;
}

export class HarvestDownloadStateMachineConstruct extends Construct {
    public readonly downloadStateMachineArn: string;
    public readonly autoHarvestStateMachineArn: string;
    public readonly harvestTaskFunction: lambdaPython.PythonFunction;
    public readonly harvestPollFunction: lambdaPython.PythonFunction;
    public readonly harvestValidateFunction: lambdaPython.PythonFunction;
    public readonly transcodeTaskFunction: lambdaPython.PythonFunction;
    public readonly transcodePollFunction: lambdaPython.PythonFunction;

    constructor(scope: Construct, id: string, props: HarvestDownloadStateMachineConstructProps) {
        super(scope, id);

        const stack = cdk.Stack.of(this);

        // Common Lambda Powertools env vars
        const powertoolsEnv = {
            POWERTOOLS_SERVICE_NAME: "harvest-download",
            POWERTOOLS_METRICS_NAMESPACE: `${props.stackName}/HarvestDownload`,
            LOG_LEVEL: "INFO",
        };

        // --- Task Lambdas ---

        this.harvestTaskFunction = new lambdaPython.PythonFunction(this, "HarvestTaskFn", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            index: "main.py",
            entry: "../api/src/harvest-task",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.minutes(1),
            memorySize: 256,
            environment: {
                ...powertoolsEnv,
                HARVEST_JOBS_TABLE_NAME: props.harvestJobsTable.tableName,
                CLIPS_TABLE: props.clipsTable.tableName,
                CHANNELS_TABLE_NAME: props.channelsTable.tableName,
                SYSTEM_SETTINGS_TABLE: props.systemSettingsTable.tableName,
                VIDEO_ASSETS_BUCKET: props.videoAssetsBucket.bucketName,
                MEDIAPACKAGE_CHANNEL_GROUP: props.mediaPackageChannelGroup,
            },
        });

        this.harvestPollFunction = new lambdaPython.PythonFunction(this, "HarvestPollFn", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            index: "main.py",
            entry: "../api/src/harvest-poll",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            environment: {
                ...powertoolsEnv,
            },
        });

        this.harvestValidateFunction = new lambdaPython.PythonFunction(this, "HarvestValidateFn", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            index: "main.py",
            entry: "../api/src/harvest-validate",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.minutes(1),
            memorySize: 256,
            environment: {
                ...powertoolsEnv,
                CLIPS_TABLE: props.clipsTable.tableName,
                VIDEO_ASSETS_BUCKET: props.videoAssetsBucket.bucketName,
            },
        });

        this.transcodeTaskFunction = new lambdaPython.PythonFunction(this, "TranscodeTaskFn", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            index: "main.py",
            entry: "../api/src/transcode-task",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            environment: {
                ...powertoolsEnv,
                MC_ENDPOINT: props.mediaConvertEndpoint,
                VIDEO_ASSETS_BUCKET: props.videoAssetsBucket.bucketName,
            },
        });

        this.transcodePollFunction = new lambdaPython.PythonFunction(this, "TranscodePollFn", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            index: "main.py",
            entry: "../api/src/transcode-poll",
            architecture: lambda.Architecture.ARM_64,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            environment: {
                ...powertoolsEnv,
                MC_ENDPOINT: props.mediaConvertEndpoint,
            },
        });

        // --- IAM: Least-privilege per Lambda ---

        // Harvest Task: DynamoDB (HarvestJobs write, Clips read, Channels read, SystemSettings read), S3 read, MediaPackage V2
        props.harvestJobsTable.grantReadWriteData(this.harvestTaskFunction);
        props.clipsTable.grantReadData(this.harvestTaskFunction);
        props.channelsTable.grantReadData(this.harvestTaskFunction);
        props.systemSettingsTable.grantReadData(this.harvestTaskFunction);
        props.videoAssetsBucket.grantRead(this.harvestTaskFunction);
        this.harvestTaskFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "mediapackagev2:CreateHarvestJob",
                "mediapackagev2:GetHarvestJob",
                "mediapackagev2:GetOriginEndpoint",
                "mediapackagev2:GetChannel",
                "mediapackagev2:GetChannelGroup",
                "mediapackagev2:TagResource",
            ],
            resources: ["*"],
        }));

        // Harvest Poll: MediaPackage V2 read
        this.harvestPollFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "mediapackagev2:GetHarvestJob",
            ],
            resources: ["*"],
        }));

        // Harvest Validate: S3 list/read/delete, Clips read/write
        props.clipsTable.grantReadWriteData(this.harvestValidateFunction);
        props.videoAssetsBucket.grantReadWrite(this.harvestValidateFunction);

        // Transcode Task: MediaConvert create job, IAM PassRole for MC role
        this.transcodeTaskFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ["mediaconvert:CreateJob"],
            resources: [
                `arn:aws:mediaconvert:${stack.region}:${stack.account}:jobs/*`,
                `arn:aws:mediaconvert:${stack.region}:${stack.account}:queues/*`,
            ],
        }));
        this.transcodeTaskFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [props.mediaConvertRoleArn],
        }));

        // Transcode Poll: MediaConvert get job
        this.transcodePollFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ["mediaconvert:GetJob"],
            resources: [
                `arn:aws:mediaconvert:${stack.region}:${stack.account}:jobs/*`,
            ],
        }));

        // --- Download State Machine ---

        // IAM role for the state machine execution
        const downloadSmRole = new iam.Role(this, "DownloadSmRole", {
            assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
            description: "Execution role for the Download Step Functions state machine",
        });

        // Lambda invoke permissions for all 5 task Lambdas
        downloadSmRole.addToPolicy(new iam.PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [
                this.harvestTaskFunction.functionArn,
                this.harvestPollFunction.functionArn,
                this.harvestValidateFunction.functionArn,
                this.transcodeTaskFunction.functionArn,
                this.transcodePollFunction.functionArn,
            ],
        }));

        // DynamoDB permissions for inline updateItem states (Clips + DownloadJobs)
        downloadSmRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "dynamodb:UpdateItem",
                "dynamodb:GetItem",
            ],
            resources: [
                props.clipsTable.tableArn,
                props.downloadJobsTable.tableArn,
            ],
        }));

        // Load and substitute ASL definition
        const aslBody = fs.readFileSync(
            path.join(__dirname, "..", "state-machines", "download-workflow.asl.json"),
            "utf-8",
        );

        const substitutedAsl = aslBody
            .replace(/\$\{HarvestTaskFunctionArn\}/g, this.harvestTaskFunction.functionArn)
            .replace(/\$\{HarvestPollFunctionArn\}/g, this.harvestPollFunction.functionArn)
            .replace(/\$\{HarvestValidateFunctionArn\}/g, this.harvestValidateFunction.functionArn)
            .replace(/\$\{TranscodeTaskFunctionArn\}/g, this.transcodeTaskFunction.functionArn)
            .replace(/\$\{TranscodePollFunctionArn\}/g, this.transcodePollFunction.functionArn)
            .replace(/\$\{ClipsTableName\}/g, props.clipsTable.tableName)
            .replace(/\$\{DownloadJobsTableName\}/g, props.downloadJobsTable.tableName);

        const downloadStateMachine = new stepfunctions.StateMachine(this, "DownloadStateMachine", {
            stateMachineName: `${props.stackName}-DownloadWorkflow`,
            definitionBody: stepfunctions.DefinitionBody.fromString(substitutedAsl),
            role: downloadSmRole,
            tracingEnabled: true,
        });

        this.downloadStateMachineArn = downloadStateMachine.stateMachineArn;

        // --- Auto-Harvest State Machine ---

        const autoHarvestSmRole = new iam.Role(this, "AutoHarvestSmRole", {
            assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
            description: "Execution role for the AutoHarvest Step Functions state machine",
        });

        // Lambda invoke permissions for the 3 harvest task Lambdas (reused from Download workflow)
        autoHarvestSmRole.addToPolicy(new iam.PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [
                this.harvestTaskFunction.functionArn,
                this.harvestPollFunction.functionArn,
                this.harvestValidateFunction.functionArn,
            ],
        }));

        // DynamoDB permissions: read System Settings, read/write Clips, read/write HarvestJobs
        autoHarvestSmRole.addToPolicy(new iam.PolicyStatement({
            actions: ["dynamodb:GetItem"],
            resources: [props.systemSettingsTable.tableArn],
        }));

        autoHarvestSmRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "dynamodb:UpdateItem",
                "dynamodb:GetItem",
            ],
            resources: [props.clipsTable.tableArn],
        }));

        const autoHarvestAslBody = fs.readFileSync(
            path.join(__dirname, "..", "state-machines", "auto-harvest-workflow.asl.json"),
            "utf-8",
        );

        const substitutedAutoHarvestAsl = autoHarvestAslBody
            .replace(/\$\{HarvestTaskFunctionArn\}/g, this.harvestTaskFunction.functionArn)
            .replace(/\$\{HarvestPollFunctionArn\}/g, this.harvestPollFunction.functionArn)
            .replace(/\$\{HarvestValidateFunctionArn\}/g, this.harvestValidateFunction.functionArn)
            .replace(/\$\{ClipsTableName\}/g, props.clipsTable.tableName)
            .replace(/\$\{SystemSettingsTableName\}/g, props.systemSettingsTable.tableName);

        const autoHarvestStateMachine = new stepfunctions.StateMachine(this, "AutoHarvestStateMachine", {
            stateMachineName: `${props.stackName}-AutoHarvestWorkflow`,
            definitionBody: stepfunctions.DefinitionBody.fromString(substitutedAutoHarvestAsl),
            role: autoHarvestSmRole,
            tracingEnabled: true,
        });

        this.autoHarvestStateMachineArn = autoHarvestStateMachine.stateMachineArn;

        // --- Outputs ---

        new cdk.CfnOutput(this, "DownloadStateMachineArn", {
            value: downloadStateMachine.stateMachineArn,
            description: "Download Workflow State Machine ARN",
        });

        new cdk.CfnOutput(this, "AutoHarvestStateMachineArn", {
            value: autoHarvestStateMachine.stateMachineArn,
            description: "AutoHarvest Workflow State Machine ARN",
        });

        new cdk.CfnOutput(this, "HarvestTaskFunctionName", {
            value: this.harvestTaskFunction.functionName,
            description: "Harvest Task Lambda Function Name",
        });

        new cdk.CfnOutput(this, "HarvestValidateFunctionName", {
            value: this.harvestValidateFunction.functionName,
            description: "Harvest Validate Lambda Function Name",
        });

        new cdk.CfnOutput(this, "TranscodeTaskFunctionName", {
            value: this.transcodeTaskFunction.functionName,
            description: "Transcode Task Lambda Function Name",
        });
    }
}
