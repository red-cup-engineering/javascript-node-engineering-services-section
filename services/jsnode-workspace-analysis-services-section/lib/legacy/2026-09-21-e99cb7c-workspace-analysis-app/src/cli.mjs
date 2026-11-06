#!/usr/bin/env node
import path from "node:path";
import { createJsnodeWorkspacePlatform } from "./service.mjs";
import { JSNODE_TOOLS, jsnodeInstructions } from "./mcp.mjs";
import { serveMcpToolServerStdio } from "@red-cup-engineering/mcp-tool-server/stdio";
import { createWebApplication } from "@red-cup-engineering/computer-web-platform/application";
import { startWebServer } from "@red-cup-engineering/computer-web-server/node";
import { mcpResource } from "@red-cup-engineering/mcp-engineering-services-section/mcp-http-server";
export async function runCli(argv = process.argv.slice(2)) {
    const command = argv[0] ?? "mcp";
    if (!["mcp", "serve"].includes(command))
        throw new TypeError("usage: workspace-analysis [mcp|serve] [--root directory] [--port number] [--host address]");
    const option = (name, fallback) => {
        const index = argv.indexOf(name);
        return index < 0 ? fallback : argv[index + 1] ?? fallback;
    };
    const platform = createJsnodeWorkspacePlatform({ name: "jsnode-workspace", root: path.resolve(option("--root", process.cwd())), ...(argv.includes("--interval") ? { intervalSeconds: Number(option("--interval", "60")) } : {}), ...(argv.includes("--journal-root") ? { journalRoot: path.resolve(option("--journal-root", process.cwd())) } : {}) });
    const serverInfo = { name: "jsnode-workspace", version: "0.8.0" };
    if (command === "mcp") {
        const server = await serveMcpToolServerStdio({ serverInfo, platform, tools: JSNODE_TOOLS,
            instructions: jsnodeInstructions(serverInfo.name), executionOptions: name => ({ allowedEffects: platform.operation(name)?.effects ?? [] }),
        });
        const close = async () => { await server.close(); await platform.close(); };
        process.once("SIGINT", () => { void close(); });
        process.once("SIGTERM", () => { void close(); });
        return;
    }
    const app = createWebApplication({ platform, resources: [mcpResource({ serverInfo, tools: JSNODE_TOOLS, operations: platform.operations(), instructions: jsnodeInstructions(serverInfo.name) })] });
    const listener = await startWebServer(app, { host: option("--host", "127.0.0.1"), port: Number(option("--port", "18808")) });
    process.once("SIGINT", () => { void listener.close(); });
    process.once("SIGTERM", () => { void listener.close(); });
    process.stdout.write(`jsnode-workspace listening on port ${listener.port}\n`);
}
if (import.meta.main)
    runCli().catch(error => { console.error(error); process.exitCode = 1; });
//# sourceMappingURL=cli.mjs.map
