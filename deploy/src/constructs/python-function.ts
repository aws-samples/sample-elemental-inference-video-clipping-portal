/**
 * Python Lambda factory
 *
 * Creates a Python Lambda using only stable `aws-cdk-lib` APIs (no alpha/experimental
 * packages). Replaces the `@aws-cdk/aws-lambda-python-alpha` `PythonFunction` construct.
 *
 * Bundling mirrors what the alpha construct did: run pip against the function's
 * requirements.txt inside the Lambda build image and copy the source alongside the
 * installed dependencies. The bundling image platform is pinned to the target Lambda
 * architecture so that any dependency shipping native wheels resolves to the correct
 * architecture (defends against future native deps; current deps are pure Python).
 */

import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface PythonFunctionOptions
    extends Omit<lambda.FunctionProps, "code" | "handler" | "runtime"> {
    /** Directory containing the handler module and requirements.txt (e.g. "../api/src/create-feed-lambda"). */
    readonly entry: string;
    /** Handler in "module.function" form (e.g. "main.lambda_handler"). Defaults to "main.lambda_handler". */
    readonly handler?: string;
    /** Python runtime. Defaults to PYTHON_3_12. */
    readonly runtime?: lambda.Runtime;
}

const DEFAULT_RUNTIME = lambda.Runtime.PYTHON_3_12;
const DEFAULT_HANDLER = "main.lambda_handler";

/**
 * Create a Python Lambda function with requirements.txt bundling, defaulting to ARM64.
 */
export function createPythonFunction(
    scope: Construct,
    id: string,
    options: PythonFunctionOptions,
): lambda.Function {
    const runtime = options.runtime ?? DEFAULT_RUNTIME;
    const architecture = options.architecture ?? lambda.Architecture.ARM_64;
    const platform =
        architecture === lambda.Architecture.ARM_64 ? "linux/arm64" : "linux/amd64";

    // Strip the fields we handle explicitly; pass everything else straight through.
    const { entry, handler, runtime: _runtime, architecture: _architecture, ...rest } = options;

    return new lambda.Function(scope, id, {
        ...rest,
        runtime,
        architecture,
        handler: handler ?? DEFAULT_HANDLER,
        code: lambda.Code.fromAsset(entry, {
            bundling: {
                image: runtime.bundlingImage,
                platform,
                command: [
                    "bash",
                    "-c",
                    "pip install -r requirements.txt -t /asset-output && cp -r . /asset-output",
                ],
            },
        }),
    });
}
