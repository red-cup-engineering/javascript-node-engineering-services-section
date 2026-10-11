/**
 * Finite Node process-main boundary runner.
 */
import { serviceLifecycleEvent, serviceLifecycleRecord } from "./lifecycle.mjs";
/** Summarize a finite process main invocation as a lifecycle record. `at` is the boundary instant (e.g. `processIsoNow()`), supplied by the caller at the kernel edge. */
export function processMainLifecycleRecord(name, code, at) {
    const service = `src/integrations/process/services/main-runner:runProcessMain:${name}`;
    const evidence = Object.freeze(["src/main-runner.mjs", "src/main-runner:runProcessMain"]);
    return serviceLifecycleRecord({
        service,
        boundary: "process-main",
        events: Object.freeze([
            serviceLifecycleEvent({ service, boundary: "process-main", event: "start", at, ok: true, evidence }),
            serviceLifecycleEvent({ service, boundary: "process-main", event: "exit", at, ok: code === 0, code, evidence }),
        ]),
    });
}
/** Bind a finite service main to Node's stderr and exit-code process boundary. */
export async function runProcessMain(main, options) {
    const exit = options.exit ?? ((code) => {
        // Let the process exit naturally so large stdout payloads finish draining
        // into the pipe; process.exit() here truncated them at racy offsets. The
        // unref'd timer hard-exits only if a stray handle keeps the loop alive.
        process.exitCode = code;
        setTimeout(() => process.exit(code), 5000).unref();
    });
    const writeError = options.writeError ?? ((text) => process.stderr.write(text));
    let code;
    try {
        code = await main();
    }
    catch (error) {
        writeError(`${options.name}: ${error instanceof Error ? error.message : String(error)}\n`);
        exit(1);
        return;
    }
    exit(code);
}
