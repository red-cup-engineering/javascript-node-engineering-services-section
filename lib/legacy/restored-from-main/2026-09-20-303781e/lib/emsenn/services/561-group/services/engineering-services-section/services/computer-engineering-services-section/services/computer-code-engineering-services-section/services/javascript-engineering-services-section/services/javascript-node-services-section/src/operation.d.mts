import type { Writable } from "node:stream";
import { type DataType, type FromJsonSchema, type JsonSchema, type Result } from "@red-cup-engineering/computer-data-engine";
export type OperationRefusal = Readonly<{
    reason: string;
    message: string;
}>;
export type OperationDefinition<Input extends JsonSchema = true, Output extends JsonSchema = true> = Readonly<{
    name: string;
    description: string;
    operation: (input: FromJsonSchema<Input>) => FromJsonSchema<Output> | Promise<FromJsonSchema<Output>>;
    inputSchema?: Input;
    outputSchema?: Output;
}>;
export type OperationExecutor<Output = unknown> = Readonly<{
    name: string;
    description: string;
    inputType: DataType;
    outputType: DataType;
    invoke(input: unknown): Promise<Result<Output, OperationRefusal>>;
}>;
export type OperationStreams = Readonly<{
    arguments: readonly string[];
    standardInput: AsyncIterable<string | Uint8Array>;
    standardOutput: Writable;
}>;
export type OperationRun = Readonly<{
    exitCode: 0 | 2;
    processed: number;
    refused: number;
}>;
export type OperationCatalog = Readonly<{
    name: string;
    description: string;
    operations: Readonly<Record<string, OperationExecutor>>;
}>;
/** Bind one implementation to shared domain and codomain declarations; invalid declarations throw before execution. */
export declare function createJavascriptNodeOperation<const Input extends JsonSchema = true, const Output extends JsonSchema = true>(definition: OperationDefinition<Input, Output>): OperationExecutor<FromJsonSchema<Output>>;
/** Execute a schema-bound command over explicitly supplied streams; returns process disposition without exiting. */
export declare function runJavascriptNodeOperation<const Input extends JsonSchema = true, const Output extends JsonSchema = true>(definition: OperationDefinition<Input, Output>, streams: OperationStreams): Promise<OperationRun>;
/** Select a named operation while reusing the same input, output, and refusal interpreter. */
export declare function runJavascriptNodeOperationCatalog(catalog: OperationCatalog, streams: OperationStreams): Promise<OperationRun>;
