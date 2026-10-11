function schemaContract(schema) {
    return Object.freeze({
        assert(value) {
            const issue = schemaIssue(schema, value, "");
            if (issue !== undefined)
                throw new TypeError(issue);
            return value;
        },
    });
}
function schemaIssue(schema, value, path) {
    if (schema.const !== undefined && value !== schema.const)
        return `${path || "/"} must equal ${JSON.stringify(schema.const)}`;
    if (schema.enum !== undefined && !schema.enum.includes(value))
        return `${path || "/"} must be one of ${schema.enum.join(", ")}`;
    if (schema.type !== undefined) {
        const accepted = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!accepted.some((type) => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value) : typeof value === type))
            return `${path || "/"} has an invalid type`;
    }
    if (schema.type === "string" && schema.minLength !== undefined && value.length < schema.minLength)
        return `${path || "/"} must not be empty`;
    if (schema.type === "array") {
        if (schema.minItems !== undefined && value.length < schema.minItems)
            return `${path || "/"} must contain at least ${schema.minItems} item`;
        if (schema.items !== undefined) {
            for (const [index, item] of value.entries()) {
                const issue = schemaIssue(schema.items, item, `${path}/${index}`);
                if (issue !== undefined)
                    return issue;
            }
        }
    }
    if (schema.type === "object" && value !== null && !Array.isArray(value)) {
        for (const key of schema.required ?? [])
            if (!(key in value))
                return `${path || "/"} requires ${key}`;
        if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in (schema.properties ?? {}))))
            return `${path || "/"} has an unknown property`;
        for (const [key, child] of Object.entries(schema.properties ?? {})) {
            if (!(key in value))
                continue;
            const issue = schemaIssue(child, value[key], `${path}/${key}`);
            if (issue !== undefined)
                return issue;
        }
    }
    return undefined;
}
const idSchema = { type: "string", minLength: 1 };
const nonemptyStringSequenceSchema = { type: "array", minItems: 1, items: idSchema };
const jsonValueSchema = {};
export const serviceLifecycleEventSchema = {
    $id: "node-process/services/lifecycle-event",
    title: "ServiceLifecycleEvent",
    description: "A uniform service-side event for a concrete Node process, protocol, stream, socket, listener, or child-process lifecycle transition.",
    type: "object",
    required: ["kind", "service", "boundary", "event", "at", "ok", "evidence"],
    properties: {
        kind: { const: "node-process.services.lifecycle-event" },
        service: idSchema,
        boundary: { enum: ["child-process", "http-listener", "mcp-stdio", "process-main", "stream", "websocket-upgrade"] },
        event: { enum: ["backpressure", "close", "drain", "error", "exit", "listening", "ready", "spawn", "start", "stream-close", "stream-open", "upgrade"] },
        at: { type: "string", minLength: 1 },
        ok: { type: "boolean" },
        code: { type: "integer" },
        signal: { type: ["string", "null"] },
        detail: jsonValueSchema,
        evidence: nonemptyStringSequenceSchema,
    },
    additionalProperties: false,
};
export const serviceLifecycleRecordSchema = {
    $id: "node-process/services/lifecycle-record",
    title: "ServiceLifecycleRecord",
    description: "A finite service lifecycle record collecting schema-checked events for one service boundary.",
    type: "object",
    required: ["kind", "service", "boundary", "events", "ok"],
    properties: {
        kind: { const: "node-process.services.lifecycle-record" },
        service: idSchema,
        boundary: { enum: ["child-process", "http-listener", "mcp-stdio", "process-main", "stream", "websocket-upgrade"] },
        events: { type: "array", minItems: 1, items: serviceLifecycleEventSchema },
        ok: { type: "boolean" },
    },
    additionalProperties: false,
};
export const serviceLifecycleEventContract = schemaContract(serviceLifecycleEventSchema);
export const serviceLifecycleRecordContract = schemaContract(serviceLifecycleRecordSchema);
