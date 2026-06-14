// Auth hardening helpers for the optional settings-write gate (see index.ts).
// Pure and side-effect-free so they can be unit-tested without a live server;
// `now` is injectable for deterministic time-based tests.

export interface RateLimitConfig {
  // Failures allowed before lockouts kick in.
  freeAttempts: number;
  // First lockout window once free attempts are spent.
  lockBaseMs: number;
  // Ceiling on the (doubling) lockout window.
  lockMaxMs: number;
  // Idle buckets older than this are evicted by sweep().
  idleEvictMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  freeAttempts: 5,
  lockBaseMs: 30_000,
  lockMaxMs: 15 * 60_000,
  idleEvictMs: 60 * 60_000,
};

interface Bucket {
  fails: number;
  lockedUntil: number;
  lastSeen: number;
}

// Per-IP exponential-backoff lockout for the auth endpoint. In-memory only:
// resets on restart (acceptable — restarts already invalidate sessions), and a
// multi-process deploy would need a shared store, which this single-process
// dashboard does not use.
export class AuthRateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private cfg: RateLimitConfig = DEFAULT_RATE_LIMIT) {}

  // Milliseconds the caller must wait before another attempt, 0 if allowed now.
  retryAfterMs(ip: string, now: number = Date.now()): number {
    const b = this.buckets.get(ip);
    if (!b) return 0;
    return Math.max(0, b.lockedUntil - now);
  }

  // Record a failed attempt and (re)compute the lockout window. Each failure
  // past `freeAttempts` doubles the window, capped at `lockMaxMs`.
  recordFailure(ip: string, now: number = Date.now()): void {
    const b = this.buckets.get(ip) ?? { fails: 0, lockedUntil: 0, lastSeen: now };
    b.fails++;
    b.lastSeen = now;
    if (b.fails > this.cfg.freeAttempts) {
      const over = b.fails - this.cfg.freeAttempts;
      const lock = Math.min(this.cfg.lockBaseMs * 2 ** (over - 1), this.cfg.lockMaxMs);
      b.lockedUntil = now + lock;
    }
    this.buckets.set(ip, b);
  }

  // A correct password clears the IP's history immediately.
  recordSuccess(ip: string): void {
    this.buckets.delete(ip);
  }

  // Drop idle, unlocked buckets so the map can't grow without bound. Call
  // periodically from a timer.
  sweep(now: number = Date.now()): void {
    for (const [ip, b] of this.buckets) {
      if (b.lockedUntil <= now && now - b.lastSeen > this.cfg.idleEvictMs) {
        this.buckets.delete(ip);
      }
    }
  }

  // Test/inspection helper.
  size(): number {
    return this.buckets.size;
  }
}

// Whether the request reached us over TLS. Behind a terminating proxy
// (Cloudflare Tunnel) the original scheme arrives in X-Forwarded-Proto; we read
// the first value since proxies may append a comma-separated chain.
export function isSecureRequest(headers: Record<string, unknown>, fallbackProtocol?: string): boolean {
  const xfp = headers["x-forwarded-proto"];
  const proto = (Array.isArray(xfp) ? xfp[0] : typeof xfp === "string" ? xfp : "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (proto) return proto === "https";
  return (fallbackProtocol ?? "http").toLowerCase() === "https";
}

// COOKIE_SECURE: "true"/"false" force the flag; anything else ("auto", unset)
// derives it from the request scheme. Auto keeps plain-HTTP LAN working (a
// Secure cookie would never be stored) while turning Secure on behind TLS.
export function resolveSecure(mode: string | undefined, secureRequest: boolean): boolean {
  const m = (mode ?? "auto").trim().toLowerCase();
  if (m === "true") return true;
  if (m === "false") return false;
  return secureRequest;
}

// Build a session Set-Cookie value with the hardening attributes.
export function sessionCookie(
  name: string,
  value: string,
  maxAgeSec: number,
  secure: boolean,
): string {
  const parts = [`${name}=${value}`, "HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAgeSec}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
