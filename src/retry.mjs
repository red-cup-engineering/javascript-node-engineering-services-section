/** A real-timer delay of `milliseconds`; retry callers share this wait primitive instead of shelling out. */
export function delay(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("delay milliseconds must be a non-negative finite number");
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function jitterRatioOf(jitter) {
  if (jitter === true) return 0.5;
  if (typeof jitter === "number") return jitter;
  return 0;
}

function backoffDelayMs(attempt, baseDelayMs, backoffFactor, maxDelayMs, jitterRatio, random) {
  const raw = Math.min(baseDelayMs * backoffFactor ** (attempt - 1), maxDelayMs);
  if (jitterRatio <= 0) return raw;
  const span = raw * jitterRatio;
  return Math.max(0, raw - span + random() * span * 2);
}

/** Retries a Result-returning effect with exponential, optionally-jittered backoff. */
export async function retryWithBackoff(request) {
  if (request === null || typeof request !== "object") throw new TypeError("request must be a RetryRequest");
  if (typeof request.operation !== "function") throw new TypeError("operation must be callable");
  const maxAttempts = request.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts must be a positive integer");
  const baseDelayMs = request.baseDelayMs ?? 100;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new RangeError("baseDelayMs must be a non-negative finite number");
  const backoffFactor = request.backoffFactor ?? 2;
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1) throw new RangeError("backoffFactor must be a finite number of at least 1");
  const maxDelayMs = request.maxDelayMs ?? Number.POSITIVE_INFINITY;
  if (Number.isNaN(maxDelayMs) || maxDelayMs < 0) throw new RangeError("maxDelayMs must be a non-negative number");
  if (request.isRetryable !== undefined && typeof request.isRetryable !== "function") throw new TypeError("isRetryable must be callable");
  if (request.delay !== undefined && typeof request.delay !== "function") throw new TypeError("delay must be callable");
  if (request.random !== undefined && typeof request.random !== "function") throw new TypeError("random must be callable");
  if (request.jitter !== undefined && typeof request.jitter !== "boolean" && (typeof request.jitter !== "number" || !Number.isFinite(request.jitter) || request.jitter < 0)) throw new TypeError("jitter must be a boolean or a non-negative finite ratio");
  const jitterRatio = jitterRatioOf(request.jitter);
  const isRetryable = request.isRetryable ?? (() => true);
  const wait = request.delay ?? delay;
  const random = request.random ?? Math.random;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await request.operation();
    if (result.ok) return result;
    if (attempt === maxAttempts || !isRetryable(result.refusal, attempt)) return Object.freeze({ ok: false, refusal: Object.freeze({ attempts: attempt, refusal: result.refusal }) });
    await wait(backoffDelayMs(attempt, baseDelayMs, backoffFactor, maxDelayMs, jitterRatio, random));
  }
  throw new Error("retryWithBackoff: unreachable");
}
