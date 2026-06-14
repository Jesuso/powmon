import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuthRateLimiter,
  isSecureRequest,
  resolveSecure,
  sessionCookie,
  type RateLimitConfig,
} from "./auth.ts";

const CFG: RateLimitConfig = {
  freeAttempts: 3,
  lockBaseMs: 1000,
  lockMaxMs: 8000,
  idleEvictMs: 2000,
};

test("free attempts are not locked out", () => {
  const rl = new AuthRateLimiter(CFG);
  const now = 0;
  for (let i = 0; i < CFG.freeAttempts; i++) rl.recordFailure("1.2.3.4", now);
  assert.equal(rl.retryAfterMs("1.2.3.4", now), 0);
});

test("lockout starts after free attempts and backs off exponentially", () => {
  const rl = new AuthRateLimiter(CFG);
  const now = 0;
  for (let i = 0; i < CFG.freeAttempts; i++) rl.recordFailure("ip", now);
  rl.recordFailure("ip", now); // 1st over -> base
  assert.equal(rl.retryAfterMs("ip", now), 1000);
  rl.recordFailure("ip", now); // 2nd over -> base*2
  assert.equal(rl.retryAfterMs("ip", now), 2000);
  rl.recordFailure("ip", now); // 3rd over -> base*4
  assert.equal(rl.retryAfterMs("ip", now), 4000);
});

test("lockout window is capped at lockMaxMs", () => {
  const rl = new AuthRateLimiter(CFG);
  for (let i = 0; i < 20; i++) rl.recordFailure("ip", 0);
  assert.equal(rl.retryAfterMs("ip", 0), CFG.lockMaxMs);
});

test("retryAfter decays as time passes", () => {
  const rl = new AuthRateLimiter(CFG);
  for (let i = 0; i <= CFG.freeAttempts; i++) rl.recordFailure("ip", 0); // locked 1000ms at t=0
  assert.equal(rl.retryAfterMs("ip", 400), 600);
  assert.equal(rl.retryAfterMs("ip", 1000), 0);
  assert.equal(rl.retryAfterMs("ip", 5000), 0);
});

test("success clears the IP history", () => {
  const rl = new AuthRateLimiter(CFG);
  for (let i = 0; i <= CFG.freeAttempts + 2; i++) rl.recordFailure("ip", 0);
  assert.ok(rl.retryAfterMs("ip", 0) > 0);
  rl.recordSuccess("ip");
  assert.equal(rl.retryAfterMs("ip", 0), 0);
  assert.equal(rl.size(), 0);
});

test("buckets are tracked per IP", () => {
  const rl = new AuthRateLimiter(CFG);
  for (let i = 0; i <= CFG.freeAttempts; i++) rl.recordFailure("a", 0);
  assert.ok(rl.retryAfterMs("a", 0) > 0);
  assert.equal(rl.retryAfterMs("b", 0), 0);
});

test("sweep evicts idle unlocked buckets but keeps still-locked ones", () => {
  const rl = new AuthRateLimiter(CFG);
  rl.recordFailure("idle", 0); // unlocked, lastSeen=0
  for (let i = 0; i < 10; i++) rl.recordFailure("locked", 0); // locked until 8000
  const sweepAt = 3000; // > idleEvictMs (2000), but < the locked window (8000)
  rl.sweep(sweepAt);
  assert.equal(rl.retryAfterMs("idle", sweepAt), 0); // evicted
  assert.ok(rl.retryAfterMs("locked", sweepAt) > 0); // kept, still locked
  assert.equal(rl.size(), 1);
});

test("isSecureRequest reads X-Forwarded-Proto first", () => {
  assert.equal(isSecureRequest({ "x-forwarded-proto": "https" }), true);
  assert.equal(isSecureRequest({ "x-forwarded-proto": "http" }), false);
  assert.equal(isSecureRequest({ "x-forwarded-proto": "https,http" }), true);
  assert.equal(isSecureRequest({ "x-forwarded-proto": ["https", "http"] }), true);
});

test("isSecureRequest falls back to protocol when header absent", () => {
  assert.equal(isSecureRequest({}, "https"), true);
  assert.equal(isSecureRequest({}, "http"), false);
  assert.equal(isSecureRequest({}), false);
});

test("resolveSecure honors forced modes and auto-derives otherwise", () => {
  assert.equal(resolveSecure("true", false), true);
  assert.equal(resolveSecure("false", true), false);
  assert.equal(resolveSecure("auto", true), true);
  assert.equal(resolveSecure("auto", false), false);
  assert.equal(resolveSecure(undefined, true), true);
});

test("sessionCookie carries hardening attributes and Secure only when asked", () => {
  const insecure = sessionCookie("pm_session", "v", 100, false);
  assert.match(insecure, /^pm_session=v; HttpOnly; SameSite=Strict; Path=\/; Max-Age=100$/);
  assert.doesNotMatch(insecure, /Secure/);
  const secure = sessionCookie("pm_session", "v", 100, true);
  assert.match(secure, /; Secure$/);
});
