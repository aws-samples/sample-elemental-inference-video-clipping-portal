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

/**
 * Default system settings seeded at deploy time.
 * Uses conditional writes (attribute_not_exists) so existing values are never overwritten.
 */
const SYSTEM_SETTINGS_DEFAULTS: Record<string, string> = {
    autoHarvest: "false",
    harvestBufferSeconds: "0",
    autoActivateInference: "false",
    autoActivateConflictResolution: "prefer_running",
    harvestRetentionDays: "30",
    harvestCleanupDryRun: "true",
};

export interface DynamoDBConstructProps {
    readonly tableNamePrefix?: string;
}

export class DynamoDBConstruct extends Construct {
    public readonly eventsTable: cdk.aws_dynamodb.Table;
    public readonly channelsTable: cdk.aws_dynamodb.Table;
    public readonly clipsTable: cdk.aws_dynamodb.Table;
    public readonly templatesTable: cdk.aws_dynamodb.Table;
    public readonly harvestJobsTable: cdk.aws_dynamodb.Table;
    public readonly downloadJobsTable: cdk.aws_dynamodb.Table;
    public readonly systemSettingsTable: cdk.aws_dynamodb.Table;

    constructor(scope: Construct, id: string, props?: DynamoDBConstructProps) {
        super(scope, id);

        const tableNamePrefix = props?.tableNamePrefix || "";

        // Events Table
        this.eventsTable = new cdk.aws_dynamodb.Table(this, "EventsTable", {
            tableName: `${tableNamePrefix}Events`,
            partitionKey: {
                name: "id",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
            pointInTimeRecovery: true,
        });

        // Add GSI for querying events by mediaLiveChannel
        this.eventsTable.addGlobalSecondaryIndex({
            indexName: "MediaLiveChannelIndex",
            partitionKey: {
                name: "mediaLiveChannel",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });

        // Add GSI for querying events by name (for Starfish callbackMetadata matching)
        this.eventsTable.addGlobalSecondaryIndex({
            indexName: "EventNameIndex",
            partitionKey: {
                name: "name",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });

        // Channels Table
        this.channelsTable = new cdk.aws_dynamodb.Table(this, "ChannelsTable", {
            tableName: `${tableNamePrefix}Channels`,
            partitionKey: {
                name: "id",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
            pointInTimeRecovery: true,
        });

        // Add GSI for looking up channels by Inference feed ARN
        this.channelsTable.addGlobalSecondaryIndex({
            indexName: "FeedArnIndex",
            partitionKey: {
                name: "feedArn",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });

        // Clips Table
        this.clipsTable = new cdk.aws_dynamodb.Table(this, "ClipsTable", {
            tableName: `${tableNamePrefix}Clips`,
            partitionKey: {
                name: "id",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
            pointInTimeRecovery: true,
        });

        // Add GSI for querying clips by event
        this.clipsTable.addGlobalSecondaryIndex({
            indexName: "EventIdIndex",
            partitionKey: {
                name: "eventId",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });

        // Templates Table - unified for both regular templates and auto-highlight templates
        this.templatesTable = new cdk.aws_dynamodb.Table(this, "TemplatesTable", {
            tableName: `${tableNamePrefix}Templates`,
            partitionKey: {
                name: "id",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
            pointInTimeRecovery: true,
        });

        // Add GSI for querying templates by game type and event (for auto-highlight functionality)
        this.templatesTable.addGlobalSecondaryIndex({
            indexName: "GameTypeEventIndex",
            partitionKey: {
                name: "gameType",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: "eventId",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });



        // Harvest Jobs Table
        this.harvestJobsTable = new cdk.aws_dynamodb.Table(this, "HarvestJobsTable", {
            tableName: `${tableNamePrefix}HarvestJobs`,
            partitionKey: {
                name: "job_id",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
            pointInTimeRecovery: true,
        });

        // Add GSI for querying harvest jobs by status
        this.harvestJobsTable.addGlobalSecondaryIndex({
            indexName: "StatusIndex",
            partitionKey: {
                name: "status",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: "created_at",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });

        // Add GSI for querying harvest jobs by channel
        this.harvestJobsTable.addGlobalSecondaryIndex({
            indexName: "ChannelIndex",
            partitionKey: {
                name: "channel_id",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: "created_at",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });

        // Download Jobs Table
        this.downloadJobsTable = new cdk.aws_dynamodb.Table(this, "DownloadJobsTable", {
            tableName: `${tableNamePrefix}DownloadJobs`,
            partitionKey: {
                name: "jobId",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });

        // System Settings Table
        this.systemSettingsTable = new cdk.aws_dynamodb.Table(this, "SystemSettingsTable", {
            tableName: `${tableNamePrefix}SystemSettings`,
            partitionKey: {
                name: "settingKey",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
            pointInTimeRecovery: true,
        });

        // Seed default system settings (conditional writes — won't overwrite existing values)
        this.seedSystemSettingsDefaults();

        // Output table names for reference
        new cdk.CfnOutput(this, "EventsTableName", {
            value: this.eventsTable.tableName,
            description: "Events DynamoDB Table Name",
        });

        new cdk.CfnOutput(this, "ChannelsTableName", {
            value: this.channelsTable.tableName,
            description: "Channels DynamoDB Table Name",
        });

        new cdk.CfnOutput(this, "ClipsTableName", {
            value: this.clipsTable.tableName,
            description: "Clips DynamoDB Table Name",
        });

        new cdk.CfnOutput(this, "TemplatesTableName", {
            value: this.templatesTable.tableName,
            description: "Templates DynamoDB Table Name (unified for regular and auto-highlight templates)",
        });

        new cdk.CfnOutput(this, "HarvestJobsTableName", {
            value: this.harvestJobsTable.tableName,
            description: "Harvest Jobs DynamoDB Table Name",
        });

        new cdk.CfnOutput(this, "DownloadJobsTableName", {
            value: this.downloadJobsTable.tableName,
            description: "Download Jobs DynamoDB Table Name",
        });

        new cdk.CfnOutput(this, "SystemSettingsTableName", {
            value: this.systemSettingsTable.tableName,
            description: "System Settings DynamoDB Table Name",
        });
    }

    /**
     * Seeds the SystemSettings table with default values using conditional PutItem calls.
     * Each setting uses `attribute_not_exists(settingKey)` so user-configured values
     * are never overwritten on redeployment.
     */
    private seedSystemSettingsDefaults(): void {
        const entries = Object.entries(SYSTEM_SETTINGS_DEFAULTS);
        const now = new Date().toISOString();

        // Build a BatchWriteItem-style seed using individual AwsCustomResource PutItem calls.
        // We use individual calls because BatchWriteItem doesn't support condition expressions.
        for (const [key, value] of entries) {
            new cdk.custom_resources.AwsCustomResource(this, `SeedSetting-${key}`, {
                onCreate: {
                    service: "DynamoDB",
                    action: "putItem",
                    parameters: {
                        TableName: this.systemSettingsTable.tableName,
                        Item: {
                            settingKey: { S: key },
                            settingValue: { S: value },
                            updatedAt: { S: now },
                        },
                        ConditionExpression: "attribute_not_exists(settingKey)",
                    },
                    // Ignore ConditionalCheckFailedException — means the setting already exists
                    ignoreErrorCodesMatching: "ConditionalCheckFailedException",
                    physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
                        `seed-setting-${key}`,
                    ),
                },
                policy: cdk.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
                    resources: [this.systemSettingsTable.tableArn],
                }),
                installLatestAwsSdk: false,
            });
        }
    }
}
