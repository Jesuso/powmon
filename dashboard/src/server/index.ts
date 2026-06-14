import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import mqtt from "mqtt";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { Store } from "./db.ts";
import { AuthRateLimiter, isSecureRequest, resolveSecure, sessionCookie } from "./auth.ts";
import { NUMERIC_KEYS, DEFAULT_TARIFF, DEFAULT_BILLING, type InverterState, type HistoryResponse, type LatestResponse, type StatesResponse, type ConfigResponse, type SettingsResponse, type TariffSettings, type BillingSettings, type LocationSettings, type DailyResponse } from "../shared/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const API_PORT = Number(process.env.API_PORT ?? 3001);
const MQTT_HOST = process.env.MQTT_HOST ?? "127.0.0.1";
const MQTT_PORT = Number(process.env.MQTT_PORT ?? 1883);
const BASE = process.env.BASE_TOPIC ?? "solar/inverter";
const DB_PATH = process.env.DB_PATH ?? join(ROOT, "data.db");
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 30);

// Coordinates are only used for sunrise/sunset night-shading, which needs no
// parcel-level precision. Full lat/lon is stored, but unauthenticated reads get
// it rounded to this many decimals (2 dp ≈ 1.1 km — hides the house, keeps
// sunrise/sunset accurate to well under a minute). Clamped to a sane 0..7.
const LOCATION_PUBLIC_DECIMALS = (() => {
  const n = Number(process.env.LOCATION_PUBLIC_DECIMALS ?? 2);
  return Number.isInteger(n) && n >= 0 && n <= 7 ? n : 2;
})();

// ---- optional settings-write auth ----
// SETTINGS_PASSWORD unset/empty -> no gate (fully backward-compatible).
// When set, PUT /api/settings requires a valid signed session cookie minted by
// POST /api/auth. Cookie is httpOnly + signed (HMAC-SHA256) so it can't be forged.
const SETTINGS_PASSWORD = process.env.SETTINGS_PASSWORD ?? "";
const AUTH_ENABLED = SETTINGS_PASSWORD.length > 0;
const SESSION_TTL_MS = 7 * 86400_000;
const COOKIE_NAME = "pm_session";
// Per-process secret: rotates on restart (invalidates old sessions) and keeps
// the raw password out of the cookie signature.
const SESSION_SECRET = randomBytes(32);

// Trust X-Forwarded-* so req.ip is the real client (not the proxy) and the
// scheme is read from X-Forwarded-Proto. Enable ONLY behind a trusted proxy
// (e.g. the Cloudflare Tunnel connector) — on a bare LAN it would let a client
// spoof its IP and dodge the rate limiter. Off by default (LAN-safe).
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? "");
// "auto" (default) sets the cookie Secure flag from the request scheme;
// "true"/"false" force it. Auto keeps plain-HTTP LAN logins working.
const COOKIE_SECURE_MODE = process.env.COOKIE_SECURE ?? "auto";

// Per-IP exponential-backoff lockout on POST /api/auth.
const authLimiter = new AuthRateLimiter();

function mintSession(): string {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = createHmac("sha256", SESSION_SECRET).update(exp).digest("hex");
  return `${exp}.${sig}`;
}

function validSession(cookieHeader: string | undefined): boolean {
  const raw = parseCookie(cookieHeader)[COOKIE_NAME];
  if (!raw) return false;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return false;
  const exp = raw.slice(0, dot), sig = raw.slice(dot + 1);
  const want = createHmac("sha256", SESSION_SECRET).update(exp).digest("hex");
  if (!timingSafeEqualHex(sig, want)) return false;
  const expN = Number(exp);
  return Number.isFinite(expN) && expN > Date.now();
}

// Length-safe constant-time compare for hex strings.
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex"), bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

// Compare via fixed-length SHA-256 digests so timingSafeEqual never sees a
// length mismatch (which would itself leak length and throw).
function passwordMatches(input: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(SETTINGS_PASSWORD).digest();
  return timingSafeEqual(a, b);
}

function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    const v = part.slice(eq + 1).trim();
    // Malformed %-encoding would throw URIError; fall back to the raw value so a
    // bad cookie can't turn every auth check into a 500.
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

const store = new Store(DB_PATH);

// ---- in-memory latest ----
let latest: { ts: number; state: InverterState } | null = (() => {
  const row = store.latest();
  if (!row) return null;
  try { return { ts: row.ts, state: JSON.parse(row.data) }; } catch { return null; }
})();
let online = false;

// ---- SSE clients ----
const clients = new Set<import("node:http").ServerResponse>();
function broadcast(event: string, data: unknown) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch { /* dropped */ } }
}

// ---- MQTT ----
const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, { reconnectPeriod: 3000 });
client.on("connect", () => {
  client.subscribe([`${BASE}/state`, `${BASE}/status`]);
  console.log(`[mqtt] connected ${MQTT_HOST}:${MQTT_PORT}, sub ${BASE}/state|status`);
});
client.on("error", (e) => console.error("[mqtt] error", e.message));
client.on("message", (topic, payload) => {
  if (topic === `${BASE}/status`) {
    online = payload.toString() === "online";
    broadcast("status", { online });
    return;
  }
  if (topic === `${BASE}/state`) {
    let state: InverterState;
    try { state = JSON.parse(payload.toString()); } catch { return; }
    const ts = Date.now();
    store.insert(ts, payload.toString());
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    store.bumpDaily(ts, num(state.today_pv_kwh), num(state.today_grid_kwh), num(state.today_load_kwh));
    latest = { ts, state };
    online = true;
    broadcast("state", { ts, state });
  }
});

// ---- retention ----
setInterval(() => {
  const n = store.prune(RETENTION_DAYS * 86400_000);
  if (n) console.log(`[prune] removed ${n} old rows`);
}, 3600_000).unref();

// ---- HTTP ----
const app = Fastify({ logger: false, trustProxy: TRUST_PROXY });

// Evict idle rate-limit buckets so the map can't grow without bound.
setInterval(() => authLimiter.sweep(), 600_000).unref();

app.get("/api/health", async () => ({ ok: true, rows: store.count(), online }));

app.get("/api/latest", async (): Promise<LatestResponse> => ({
  online,
  ts: latest?.ts ?? null,
  state: latest?.state ?? null,
}));

app.get("/api/history", async (req): Promise<HistoryResponse> => {
  const q = req.query as Record<string, string | undefined>;
  const now = Date.now();
  const since = q.since ? Number(q.since) : now - 6 * 3600_000;
  const until = q.until ? Number(q.until) : now;
  const fields = q.fields ? q.fields.split(",").filter(Boolean) : NUMERIC_KEYS;
  // auto bucket: aim for ~600 points, floor at the 10s poll cadence
  const explicit = q.bucket ? Number(q.bucket) * 1000 : 0;
  const auto = Math.ceil((until - since) / 600 / 10000) * 10000;
  const bucketMs = Math.max(10000, explicit || auto);
  const points = store.history(since, until, bucketMs, fields);
  return { since, until, bucketMs, fields, points };
});

app.get("/api/states", async (req): Promise<StatesResponse> => {
  const q = req.query as Record<string, string | undefined>;
  const now = Date.now();
  const since = q.since ? Number(q.since) : now - 6 * 3600_000;
  const until = q.until ? Number(q.until) : now;
  return { since, until, transitions: store.states(since, until) };
});

app.get("/api/config", async (): Promise<ConfigResponse> => store.config());

app.get("/api/daily", async (req): Promise<DailyResponse> => {
  const q = req.query as Record<string, string | undefined>;
  const days = Math.min(366, Math.max(1, Number(q.days ?? 31) || 31));
  return { days: store.daily(Date.now() - days * 86400_000) };
});

// ---- app settings (tariff) ----
function cleanTariff(t: unknown): TariffSettings | null {
  const o = t as Record<string, unknown> | undefined;
  const price = Number(o?.price_kwh), tax = Number(o?.tax_pct);
  const cur = typeof o?.currency === "string" ? o.currency.trim().slice(0, 8) : "";
  if (!Number.isFinite(price) || price < 0 || price > 1000) return null;
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) return null;
  if (!cur) return null;
  return { price_kwh: price, tax_pct: tax, currency: cur };
}

function cleanBilling(b: unknown): BillingSettings | null {
  const o = b as Record<string, unknown> | undefined;
  const period = Number(o?.period_months), day = Number(o?.anchor_day), month = Number(o?.anchor_month);
  if (!Number.isInteger(period) || period < 1 || period > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 28) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { period_months: period, anchor_day: day, anchor_month: month };
}

function cleanLocation(l: unknown): LocationSettings | null {
  const o = l as Record<string, unknown> | undefined;
  const lat = Number(o?.lat), lon = Number(o?.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// Round lat/lon to `decimals` places for unauthenticated reads. Stored value is
// untouched; this only shapes what goes on the wire.
function coarsenLocation(loc: LocationSettings | null, decimals: number): LocationSettings | null {
  if (!loc) return loc;
  const f = 10 ** decimals;
  return { lat: Math.round(loc.lat * f) / f, lon: Math.round(loc.lon * f) / f };
}

function settingsSnapshot(): SettingsResponse {
  return {
    tariff: store.getSetting<TariffSettings>("tariff") ?? DEFAULT_TARIFF,
    billing: store.getSetting<BillingSettings>("billing") ?? DEFAULT_BILLING,
    location: store.getSetting<LocationSettings>("location") ?? null,
  };
}

// The settings owner (authed session, or no gate at all) gets full-precision
// coordinates for editing; everyone else gets them coarsened so a public read
// can't reveal the house. Same owner test as /api/auth.
app.get("/api/settings", async (req): Promise<SettingsResponse> => {
  const snap = settingsSnapshot();
  const authed = AUTH_ENABLED ? validSession(req.headers.cookie) : true;
  if (!authed) snap.location = coarsenLocation(snap.location, LOCATION_PUBLIC_DECIMALS);
  return snap;
});

// ---- auth (only meaningful when SETTINGS_PASSWORD is set) ----
// Whether a gate is active, and whether this request already holds a session.
app.get("/api/auth", async (req) => ({
  required: AUTH_ENABLED,
  authed: AUTH_ENABLED ? validSession(req.headers.cookie) : true,
}));

app.post("/api/auth", async (req, reply) => {
  if (!AUTH_ENABLED) return { ok: true, required: false };
  const ip = req.ip || "unknown";

  // Locked out? Refuse before touching the password so brute force can't even
  // probe the compare. 429 + Retry-After per RFC 6585.
  // Locked out? Refuse before touching the password so brute force can't even
  // probe the compare. 429 + Retry-After per RFC 6585. No log here: while locked
  // this branch is hit on every request, so logging it would let an attacker
  // flood the log — the lockout is logged once below, when it engages.
  const waitMs = authLimiter.retryAfterMs(ip);
  if (waitMs > 0) {
    reply.header("Retry-After", String(Math.ceil(waitMs / 1000)));
    return reply.code(429).send({ error: "too many attempts", retry_after: Math.ceil(waitMs / 1000) });
  }

  const body = req.body as { password?: unknown } | undefined;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !passwordMatches(password)) {
    const lockedMs = authLimiter.recordFailure(ip);
    // Log the event, never the attempted value. Bounded: once locked, the 429
    // branch above returns before we reach here.
    const note = lockedMs > 0 ? ` — locked out ${Math.ceil(lockedMs / 1000)}s` : "";
    console.warn(`[auth] failed attempt ip=${ip}${note}`);
    return reply.code(401).send({ error: "invalid password" });
  }

  authLimiter.recordSuccess(ip);
  const secure = resolveSecure(COOKIE_SECURE_MODE, isSecureRequest(req.headers, req.protocol));
  reply.header("Set-Cookie", sessionCookie(COOKIE_NAME, mintSession(), SESSION_TTL_MS / 1000, secure));
  return { ok: true };
});

// Partial update: validate and persist whichever sections are present.
app.put("/api/settings", async (req, reply): Promise<SettingsResponse | { error: string }> => {
  if (AUTH_ENABLED && !validSession(req.headers.cookie)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const body = req.body as Partial<SettingsResponse> | undefined;
  if (body?.tariff !== undefined) {
    const tariff = cleanTariff(body.tariff);
    if (!tariff) return reply.code(400).send({ error: "invalid tariff" });
    store.setSetting("tariff", tariff);
  }
  if (body?.billing !== undefined) {
    const billing = cleanBilling(body.billing);
    if (!billing) return reply.code(400).send({ error: "invalid billing" });
    store.setSetting("billing", billing);
  }
  if (body?.location !== undefined) {
    const location = body.location === null ? null : cleanLocation(body.location);
    if (body.location !== null && !location) return reply.code(400).send({ error: "invalid location" });
    store.setSetting("location", location);
  }
  return settingsSnapshot();
});

app.get("/api/stream", (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 3000\n\n`);
  if (latest) res.write(`event: state\ndata: ${JSON.stringify(latest)}\n\n`);
  res.write(`event: status\ndata: ${JSON.stringify({ online })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => { try { res.write(`: ping\n\n`); } catch { /* */ } }, 20000);
  req.raw.on("close", () => { clearInterval(ping); clients.delete(res); });
});

// ---- static (prod build) ----
const DIST = join(ROOT, "dist");
if (existsSync(DIST)) {
  await app.register(fastifyStatic, { root: DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
  console.log(`[http] serving build from ${DIST}`);
} else {
  console.log(`[http] no build (dev mode) — run vite dev separately`);
}

app.listen({ port: API_PORT, host: "0.0.0.0" })
  .then(() => console.log(`[http] api on :${API_PORT}`))
  .catch((e) => { console.error(e); process.exit(1); });
