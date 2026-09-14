import { AttemptLimiter } from "./rate-limit.js";

// The agent runs once a minute and a pillar fetches at most two secrets per run. This leaves
// headroom for retries while bounding repeated downloads by a holder of a valid node token.
export const BOOTSTRAP_SECRET_MAX_DOWNLOADS = 60;
export const BOOTSTRAP_SECRET_WINDOW_MS = 15 * 60_000;

export class BootstrapSecretDownloadLimiter {
  private readonly limiter = new AttemptLimiter({
    maxAttempts: BOOTSTRAP_SECRET_MAX_DOWNLOADS,
    windowMs: BOOTSTRAP_SECRET_WINDOW_MS
  });

  admit(tokenHash: string, now = Date.now()): number {
    return this.limiter.admit(tokenHash, now);
  }
}
