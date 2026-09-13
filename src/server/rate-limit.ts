/**
 * Small in-memory attempt counter used to slow down credential guessing on the login route.
 * Attempts are counted at admission (before the expensive password check) so that a burst of
 * concurrent requests cannot slip past the limit while the first check is still running.
 * State is per process; that is sufficient because the app runs as a single replica and the
 * goal is to make online guessing impractical, not to provide a distributed quota.
 */
interface Bucket {
  attempts: number;
  windowEndsAt: number;
}

export interface AttemptLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  /** Hard cap on tracked keys; the oldest keys are evicted beyond it so memory stays bounded. */
  maxKeys?: number;
}

const PRUNE_INTERVAL_MS = 30_000;

export class AttemptLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;
  private lastPruneAt = 0;

  constructor(private readonly options: AttemptLimiterOptions) {
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  /** Milliseconds until the key is allowed again, or 0 if it is not currently blocked. */
  retryAfterMs(key: string, now = Date.now()): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    if (bucket.windowEndsAt <= now) {
      this.buckets.delete(key);
      return 0;
    }
    return bucket.attempts >= this.options.maxAttempts ? bucket.windowEndsAt - now : 0;
  }

  /**
   * Counts one attempt and returns the retry delay if the key is now over its limit.
   * Returns 0 when the attempt is admitted.
   */
  admit(key: string, now = Date.now()): number {
    this.prune(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.windowEndsAt <= now) {
      bucket = { attempts: 0, windowEndsAt: now + this.options.windowMs };
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    }
    if (bucket.attempts >= this.options.maxAttempts) return bucket.windowEndsAt - now;
    bucket.attempts += 1;
    return 0;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }

  private prune(now: number): void {
    if (now - this.lastPruneAt >= PRUNE_INTERVAL_MS) {
      this.lastPruneAt = now;
      for (const [key, bucket] of this.buckets) {
        if (bucket.windowEndsAt <= now) this.buckets.delete(key);
      }
    }
    // Map iteration order is insertion order, so the first keys are the oldest.
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}
