import type { Result } from "@red-cup-engineering/computer-data-engine";

/** A real-timer delay of `milliseconds`; the one wait primitive every retry/backoff caller in this repo should share -- never a child-process sleep. */
export type RetryDelay = (milliseconds: number) => Promise<void>;

/** The refusal surfaced once every attempt is spent: the last attempt's refusal, plus how many attempts ran. */
export type RetryExhaustion<Refusal> = Readonly<{ attempts: number; refusal: Refusal }>;

export type RetryRequest<Value, Refusal> = Readonly<{
  /** Zero-argument async operation producing one attempt's Result. */
  operation: () => Promise<Result<Value, Refusal>>;
  /** Whether a given refusal is worth retrying; defaults to always retrying until attempts are exhausted. */
  isRetryable?: (refusal: Refusal, attempt: number) => boolean;
  /** Total attempts including the first; defaults to 3. */
  maxAttempts?: number;
  /** Delay before the second attempt, in milliseconds; defaults to 100. */
  baseDelayMs?: number;
  /** Multiplier applied to the delay after each failed attempt; defaults to 2. */
  backoffFactor?: number;
  /** Upper bound on any single delay, in milliseconds; defaults to unbounded. */
  maxDelayMs?: number;
  /** Spread the computed delay at random: `true` for ±50%, a ratio (e.g. 0.3 for ±30%) for a specific spread, or `false`/omitted for none. */
  jitter?: boolean | number;
  /** Delay implementation to await between attempts; defaults to a real setTimeout-based wait. Inject a stub in tests. */
  delay?: RetryDelay;
  /** Source of randomness for jitter; defaults to Math.random. */
  random?: () => number;
}>;

/** Waits `milliseconds` using a real timer. Exported so callers that only need the wait primitive (e.g. a circuit breaker's cooldown) need not re-derive it. */
export function delay(milliseconds: number): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("delay milliseconds must be a non-negative finite number");
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function jitterRatioOf(jitter: boolean | number | undefined): number {
  if (jitter === true) return 0.5;
  if (typeof jitter === "number") return jitter;
  return 0;
}

function backoffDelayMs(attempt: number, baseDelayMs: number, backoffFactor: number, maxDelayMs: number, jitterRatio: number, random: () => number): number {
  const raw = Math.min(baseDelayMs * backoffFactor ** (attempt - 1), maxDelayMs);
  if (jitterRatio <= 0) return raw;
  const span = raw * jitterRatio;
  return Math.max(0, raw - span + random() * span * 2);
}

/** Retries a Result-returning operation with exponential, optionally-jittered backoff between attempts. Never shells out for its delay. */
export async function retryWithBackoff<Value, Refusal>(request: RetryRequest<Value, Refusal>): Promise<Result<Value, RetryExhaustion<Refusal>>> {
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
  if (request.jitter !== undefined && typeof request.jitter !== "boolean" && (typeof request.jitter !== "number" || !Number.isFinite(request.jitter) || request.jitter < 0)) {
    throw new TypeError("jitter must be a boolean or a non-negative finite ratio");
  }
  const jitterRatio = jitterRatioOf(request.jitter);
  const isRetryable = request.isRetryable ?? (() => true);
  const wait = request.delay ?? delay;
  const random = request.random ?? Math.random;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await request.operation();
    if (result.ok) return result;
    if (attempt === maxAttempts || !isRetryable(result.refusal, attempt)) {
      return Object.freeze({ ok: false, refusal: Object.freeze({ attempts: attempt, refusal: result.refusal }) });
    }
    await wait(backoffDelayMs(attempt, baseDelayMs, backoffFactor, maxDelayMs, jitterRatio, random));
  }
  throw new Error("retryWithBackoff: unreachable"); // the loop above always returns by the maxAttempts-th iteration
}
