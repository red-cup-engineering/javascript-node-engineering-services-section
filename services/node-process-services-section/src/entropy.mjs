import { randomUUID } from "node:crypto";
/**
 * Node process entropy boundary reads.
 */
/** Read one host process entropy token as a UUID string. */
export function processRandomUuid() {
    return randomUUID();
}
