# JSNode workspace operations

Workspace package discovery, authored source and declaration analysis, context projection, duplication planning, glossary/section discovery, and fabrication evidence bind to `computer-platform` operations. `createJsnodeWorkspacePlatform({name, root, intervalSeconds?, journalRoot?})` returns the shared platform with cached observations owned by one provider lifetime. Start, execute, and close use that platform directly.

`jsnode_report` exposes graph/grid/quotient/spectrum, consistency/dependency/build/lifecycle reports, package neighbourhood and symbol graphs, SVG, and workspace/package/domain/role/type RDF. Select `kind`; package/domain/role/type reports also take `name`, and package graphs accept `up`/`down` depths. Existing search, query, type-flow, and discovery tools remain operation declarations in the same registry.

`jsnode-server mcp --root PATH` binds the platform to shared MCP stdio. `jsnode-server serve --root PATH --port 18808` binds the same operations to `/mcp` through `web-application` and the shared MCP HTTP resource. The default HTTP host is loopback. `--interval SECONDS` enables periodic refresh and `--journal-root PATH` records operation counts and errors. The package has no private HTTP application, HTML presentation system, tool executor, or system registry.

Programmatic callers can compose the returned platform into another shared web application. Operation effects are explicit: pass the selected operation's effects only after admitting that operation for the caller. `JSNODE_TOOLS` adds MCP annotations to the same catalog; it is metadata, not a separate runtime.

Function and type discovery uses `@red-cup-engineering/javascript-computer` directly. Results include definition file/line ranges, declaration provenance when present, and only manifest-supported public import routes. Unbuilt source remains discoverable; absent annotations are not inferred. Function search accepts `match`; function and type listings accept `offset` and `limit` (default 50, maximum 200).

Run `npm test` for discovery, journaling, typed execution, report, and shared MCP HTTP integration coverage.
