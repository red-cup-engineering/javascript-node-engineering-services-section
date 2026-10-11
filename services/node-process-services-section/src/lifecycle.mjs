/**
 * SchemaContract-checked service lifecycle event and record construction.
 */
import { serviceLifecycleEventContract, serviceLifecycleRecordContract, } from "./lifecycle-schema-schema.mjs";
/** Construct one schema-checked lifecycle event at a concrete service boundary. `input.at` is
 * required -- clock.mjs's processIsoNow() used to backfill it when omitted, which made this
 * module's own purity depend on that clock read (data/records/house-architecture-norms.json,
 * "hull-never-imports-kernel"); every call site already passes `at` explicitly (its own
 * processIsoNow()/options.now() read, at the kernel edge), so the fallback had no live caller. */
export function serviceLifecycleEvent(input) {
    const event = {
        kind: "node-process.services.lifecycle-event",
        service: input.service,
        boundary: input.boundary,
        event: input.event,
        at: input.at,
        ok: input.ok ?? true,
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.detail === undefined ? {} : { detail: input.detail }),
        evidence: Object.freeze([...(input.evidence ?? [input.service])]),
    };
    return serviceLifecycleEventContract.assert(Object.freeze(event));
}
/** Collect schema-checked lifecycle events into one finite service-boundary record. */
export function serviceLifecycleRecord(input) {
    const events = Object.freeze([...input.events]);
    return serviceLifecycleRecordContract.assert(Object.freeze({
        kind: "node-process.services.lifecycle-record",
        service: input.service,
        boundary: input.boundary,
        events,
        ok: input.ok ?? events.every((event) => event.ok),
    }));
}
