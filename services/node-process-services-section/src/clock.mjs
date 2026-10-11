/**
 * Node process clock boundary reads.
 */
/** Read the host process clock as the package's UTC boundary instant. */
export function processIsoNow() {
    return new Date().toISOString();
}
/** Read the host process clock as epoch milliseconds for local request traces. */
export function processMillisNow() {
    return Date.now();
}
