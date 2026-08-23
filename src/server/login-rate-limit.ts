interface LoginAttemptEntry {
  attempts: number;
  windowStartedAt: number;
  blockedUntil: number;
}

interface LoginAttemptLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxEntries?: number;
}

export class LoginAttemptLimiter {
  private readonly entries = new Map<string, LoginAttemptEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxEntries: number;

  constructor(options: LoginAttemptLimiterOptions) {
    this.maxAttempts = options.maxAttempts;
    this.windowMs = options.windowMs;
    this.lockoutMs = options.lockoutMs;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8000;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  retryAfterMs(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;

    if (now >= entry.windowStartedAt + this.windowMs && now >= entry.blockedUntil) {
      this.entries.delete(key);
      return 0;
    }
    return Math.max(0, entry.blockedUntil - now);
  }

  recordAttempt(key: string, now = Date.now()): number {
    this.prune(now);
    const existing = this.entries.get(key);
    const entry =
      existing && now < existing.windowStartedAt + this.windowMs
        ? existing
        : { attempts: 0, windowStartedAt: now, blockedUntil: now };

    entry.attempts += 1;
    const delay =
      entry.attempts >= this.maxAttempts
        ? this.lockoutMs
        : Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (entry.attempts - 1));
    entry.blockedUntil = now + delay;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.enforceBound();
    return delay;
  }

  success(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now >= entry.windowStartedAt + this.windowMs && now >= entry.blockedUntil) {
        this.entries.delete(key);
      }
    }
  }

  private enforceBound(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }
}
