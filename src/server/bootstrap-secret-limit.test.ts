import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOOTSTRAP_SECRET_MAX_DOWNLOADS,
  BOOTSTRAP_SECRET_WINDOW_MS,
  BootstrapSecretDownloadLimiter
} from "./bootstrap-secret-limit.js";

describe("BootstrapSecretDownloadLimiter", () => {
  it("admits the bounded per-token quota and returns a retry delay until the window expires", () => {
    const limiter = new BootstrapSecretDownloadLimiter();
    for (let index = 0; index < BOOTSTRAP_SECRET_MAX_DOWNLOADS; index += 1) {
      assert.equal(limiter.admit("pillar-token-hash", 0), 0);
    }
    assert.equal(limiter.admit("pillar-token-hash", 0), BOOTSTRAP_SECRET_WINDOW_MS);
    assert.equal(limiter.admit("another-token-hash", 0), 0);
    assert.equal(limiter.admit("pillar-token-hash", BOOTSTRAP_SECRET_WINDOW_MS), 0);
  });
});
