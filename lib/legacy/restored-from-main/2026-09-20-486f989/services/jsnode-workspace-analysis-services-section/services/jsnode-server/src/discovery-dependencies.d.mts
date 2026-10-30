/**
 * discovery-dependencies — ambient declarations for the plain-JS packages
 * `discovery.mts` and `service.mts` import (none ship a `.d.mts`), narrowed
 * to the shapes actually read/called.
 */
declare module "@red-cup-engineering/markdown-engineering-services-section/read-markdown-frontmatter" {
  export function readMarkdownFrontmatter(
    text: string,
    options?: { readonly absentFrontmatter?: "null" | "empty" | "throw" },
  ): { readonly format: string | null; readonly frontmatter: Readonly<Record<string, unknown>> | null; readonly body: string };
}

declare module "@red-cup-engineering/term-engineering-services-section/carrier" {
  export function recognizeTermMarkdown(input: { readonly text: string; readonly filename: string }): {
    readonly admitted: boolean;
    readonly findings: readonly unknown[];
    readonly [key: string]: unknown;
  };
}


declare module "@red-cup-engineering/execute-javascript-node-command-service" {
  export interface JavascriptNodeCommandExecutionRequest {
    readonly type: "JavascriptNodeCommandExecutionRequest";
    readonly version: 1;
    readonly command: string;
    readonly arguments: readonly string[];
    readonly directory: string;
    readonly environment: Readonly<Record<string, string>> | null;
    readonly input: string | null;
  }
  export interface JavascriptNodeCommandExecutionResult {
    readonly type: "JavascriptNodeCommandExecutionResult";
    readonly version: 1;
    readonly status: number | null;
    readonly signal: string | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly error: string;
  }
  export interface JavascriptNodeCommandExecutionReceipt {
    readonly type: "JavascriptNodeCommandExecutionReceipt";
    readonly version: 1;
    readonly request: JavascriptNodeCommandExecutionRequest;
    readonly result: JavascriptNodeCommandExecutionResult;
  }
  export function executeJavascriptNodeCommand(
    candidateRequest: JavascriptNodeCommandExecutionRequest,
  ): JavascriptNodeCommandExecutionReceipt;
}

declare module "@red-cup-engineering/fabricate-markdown-jsnode-operation-package-service/mcp" {
  export function listFabricationRecords(
    root: string,
    options?: { readonly maxDepth?: number; readonly limit?: number },
  ): {
    readonly kind: string;
    readonly root: string;
    readonly receipts: readonly Readonly<Record<string, unknown>>[];
    readonly workOrders: readonly Readonly<Record<string, unknown>>[];
  };
}
