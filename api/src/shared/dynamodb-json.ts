/**
 * DynamoDB JSON Serialization Helpers
 *
 * The AWS SDK v3 DynamoDBDocumentClient unmarshals DynamoDB Set attributes
 * (SS / NS / BS) into native JavaScript Set instances. JSON.stringify on a
 * Set returns "{}" because Set is not a plain object and is not iterable in
 * a way the default stringifier understands. This silently corrupts API
 * responses that include Set-typed attributes, e.g. `harvestedOrientations`
 * on clip records (written by the harvest state machine as a String Set).
 *
 * Use `jsonReplacer` as the second argument to JSON.stringify in any Lambda
 * that returns DynamoDB-derived data so Sets serialize as plain arrays.
 */

/**
 * JSON.stringify replacer that converts Set instances into arrays so they
 * survive serialization. All other values are passed through unchanged.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

/**
 * Convenience wrapper around JSON.stringify that applies `jsonReplacer`.
 */
export function stringifyForApi(body: unknown): string {
    return JSON.stringify(body, jsonReplacer);
}
