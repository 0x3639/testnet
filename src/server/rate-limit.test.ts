import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttemptLimiter } from "./rate-limit.js";

describe("AttemptLimiter", () => {
  it("admits up to the limit and then blocks until the window ends", () => {
    const limiter = new AttemptLimiter({ maxAttempts: 3, windowMs: 1000 });
    assert.equal(limiter.admit("a", 0), 0);
    assert.equal(limiter.admit("a", 1), 0);
    assert.equal(limiter.admit("a", 2), 0);
    assert.equal(limiter.admit("a", 3), 997);
    assert.equal(limiter.retryAfterMs("a", 500), 500);
    assert.equal(limiter.admit("a", 1000), 0);
  });

  it("counts at admission so a burst cannot exceed the limit", () => {
    const limiter = new AttemptLimiter({ maxAttempts: 10, windowMs: 1000 });
    const admitted = Array.from({ length: 30 }, () => limiter.admit("burst", 0)).filter((delay) => delay === 0).length;
    assert.equal(admitted, 10);
  });

  it("keys are independent and reset clears a key", () => {
    const limiter = new AttemptLimiter({ maxAttempts: 1, windowMs: 1000 });
    assert.equal(limiter.admit("a", 0), 0);
    assert.equal(limiter.admit("b", 0), 0);
    assert.ok(limiter.admit("a", 1) > 0);
    limiter.reset("a");
    assert.equal(limiter.admit("a", 2), 0);
  });

  it("bounds the number of tracked keys", () => {
    const limiter = new AttemptLimiter({ maxAttempts: 5, windowMs: 60_000, maxKeys: 100 });
    for (let index = 0; index < 1000; index += 1) limiter.admit(`user-${index}`, 0);
    assert.ok(limiter.size <= 100);
  });

  it("never evicts the key being admitted, so a blocked key stays blocked when the map is full", () => {
    const limiter = new AttemptLimiter({ maxAttempts: 2, windowMs: 60_000, maxKeys: 3 });
    assert.equal(limiter.admit("victim", 0), 0);
    assert.equal(limiter.admit("victim", 1), 0);
    assert.ok(limiter.admit("victim", 2) > 0, "victim is blocked");
    limiter.admit("filler-1", 3);
    limiter.admit("filler-2", 4);
    assert.equal(limiter.size, 3);
    // The map is full and "victim" is the oldest key; re-admitting it must not reset its bucket.
    assert.ok(limiter.admit("victim", 5) > 0, "victim must remain blocked");
    // Inserting a genuinely new key evicts the oldest entry instead.
    assert.equal(limiter.admit("new", 6), 0);
    assert.equal(limiter.size, 3);
  });

  it("prunes expired keys", () => {
    const limiter = new AttemptLimiter({ maxAttempts: 5, windowMs: 1000, maxKeys: 1000 });
    for (let index = 0; index < 50; index += 1) limiter.admit(`user-${index}`, 0);
    limiter.admit("late", 60_000);
    assert.equal(limiter.size, 1);
  });
});
