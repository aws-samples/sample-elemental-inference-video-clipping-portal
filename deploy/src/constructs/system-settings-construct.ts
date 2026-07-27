import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { ApiGatewayV2LambdaConstruct } from "./apigatewayv2-lambda-construct";

export interface SystemSettingsConstructProps {
    readonly systemSettingsTable: cdk.aws_dynamodb.Table;
    readonly api: cdk.aws_apigatewayv2.HttpApi;
    readonly stackName: string;
}

export class SystemSettingsConstruct extends Construct {
    public readonly systemSettingsFunction: cdk.aws_lambda_nodejs.NodejsFunction;

    constructor(scope: Construct, id: string, props: SystemSettingsConstructProps) {
        super(scope, id);

        this.systemSettingsFunction = new cdk.aws_lambda_nodejs.NodejsFunction(this, "SystemSettingsFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            handler: "handler",
            entry: "../api/src/system-settings/index.ts",
            depsLockFilePath: "../api/package-lock.json",
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            environment: {
                SYSTEM_SETTINGS_TABLE: props.systemSettingsTable.tableName,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });

        props.systemSettingsTable.grantReadWriteData(this.systemSettingsFunction);

        new ApiGatewayV2LambdaConstruct(this, "SettingsGetApiGateway", {
            lambdaFn: this.systemSettingsFunction,
            routePath: "/api/settings/{settingKey}",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            api: props.api,
        });

        new ApiGatewayV2LambdaConstruct(this, "SettingsPutApiGateway", {
            lambdaFn: this.systemSettingsFunction,
            routePath: "/api/settings/{settingKey}",
            methods: [cdk.aws_apigatewayv2.HttpMethod.PUT],
            api: props.api,
        });

        new cdk.CfnOutput(this, "SystemSettingsFunctionName", {
            value: this.systemSettingsFunction.functionName,
            description: "System Settings Lambda function name",
        });
    }
}
