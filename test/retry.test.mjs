import assert from "node:assert/strict";
import test from "node:test";
import { delay, retryWithBackoff } from "../src/retry.mjs";

function immediateDelay(record = []) {
  return async (milliseconds) => { record.push(milliseconds); };
}

function refuse(refusal) { return { ok: false, refusal }; }
function succeed(value) { return { ok: true, value }; }

test("succeeds on the first attempt without ever delaying", async () => {
  const waits = [];
  let calls = 0;
  const result = await retryWithBackoff({
    operation: async () => { calls += 1; return succeed("first-try"); },
    delay: immediateDelay(waits),
  });
  assert.deepEqual(result, { ok: true, value: "first-try" });
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test("succeeds after N retries, delaying with exponential backoff between attempts", async () => {
  const waits = [];
  let calls = 0;
  const result = await retryWithBackoff({
    operation: async () => {
      calls += 1;
      return calls < 3 ? refuse({ code: "transient" }) : succeed("third-try");
    },
    maxAttempts: 5,
    baseDelayMs: 10,
    backoffFactor: 2,
    delay: immediateDelay(waits),
  });
  assert.deepEqual(result, { ok: true, value: "third-try" });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]); // delay before attempt 2, then before attempt 3
});

test("exhausts attempts and returns the last refusal with an attempt count", async () => {
  const waits = [];
  let calls = 0;
  const result = await retryWithBackoff({
    operation: async () => { calls += 1; return refuse({ code: "still-broken", attempt: calls }); },
    maxAttempts: 4,
    baseDelayMs: 5,
    delay: immediateDelay(waits),
  });
  assert.equal(calls, 4);
  assert.deepEqual(result, { ok: false, refusal: { attempts: 4, refusal: { code: "still-broken", attempt: 4 } } });
  assert.equal(waits.length, 3); // no delay follows the final attempt
});

test("isRetryable stops retrying early and reports the attempt it stopped at", async () => {
  const waits = [];
  let calls = 0;
  const result = await retryWithBackoff({
    operation: async () => { calls += 1; return refuse({ code: calls === 1 ? "transient" : "permanent" }); },
    maxAttempts: 10,
    isRetryable: (refusal) => refusal.code === "transient",
    delay: immediateDelay(waits),
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: false, refusal: { attempts: 2, refusal: { code: "permanent" } } });
});

test("never retries when maxAttempts is 1", async () => {
  let calls = 0;
  const result = await retryWithBackoff({
    operation: async () => { calls += 1; return refuse({ code: "nope" }); },
    maxAttempts: 1,
    delay: immediateDelay(),
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, refusal: { attempts: 1, refusal: { code: "nope" } } });
});

test("applies jitter within ±50% of the raw backoff instead of the exact exponential value", async () => {
  const waits = [];
  let calls = 0;
  await retryWithBackoff({
    operation: async () => { calls += 1; return calls < 3 ? refuse({ code: "transient" }) : succeed("done"); },
    baseDelayMs: 100,
    backoffFactor: 2,
    jitter: true,
    random: () => 0, // deterministic: random()=0 pins the jittered delay to raw - span (the low end)
    delay: immediateDelay(waits),
  });
  assert.deepEqual(waits, [50, 100]); // raw 100 -> low end 50; raw 200 -> low end 100
});

test("accepts a numeric jitter ratio instead of a boolean, for callers with a specific spread", async () => {
  const waits = [];
  let calls = 0;
  await retryWithBackoff({
    operation: async () => { calls += 1; return calls < 2 ? refuse({ code: "transient" }) : succeed("done"); },
    baseDelayMs: 100,
    jitter: 0.3, // ±30%
    random: () => 0, // pins to the low end: raw - raw*0.3
    delay: immediateDelay(waits),
  });
  assert.deepEqual(waits, [70]);
});

test("respects maxDelayMs as a cap on the computed backoff", async () => {
  const waits = [];
  let calls = 0;
  await retryWithBackoff({
    operation: async () => { calls += 1; return calls < 4 ? refuse({ code: "transient" }) : succeed("done"); },
    maxAttempts: 5,
    baseDelayMs: 100,
    backoffFactor: 10,
    maxDelayMs: 250,
    delay: immediateDelay(waits),
  });
  assert.deepEqual(waits, [100, 250, 250]);
});

test("rejects a non-callable operation", async () => {
  await assert.rejects(() => retryWithBackoff({ operation: undefined }), TypeError);
});

test("rejects a non-positive-integer maxAttempts", async () => {
  await assert.rejects(() => retryWithBackoff({ operation: async () => succeed(1), maxAttempts: 0 }), RangeError);
});

test("delay() rejects a negative wait and otherwise resolves once its timer elapses", async () => {
  assert.throws(() => delay(-1), RangeError);
  await delay(0); // resolves promptly; exercises the real-timer path without slowing the suite
});
