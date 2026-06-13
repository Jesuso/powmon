import Database from "better-sqlite3";
import { NUMERIC_KEYS, type HistoryPoint, type ConfigSetpoint, type ConfigChange } from "../shared/types.ts";

const KEYSET = new Set(NUMERIC_KEYS);

export class Store {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private bumpStmt!: Database.Statement;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS samples (ts INTEGER PRIMARY KEY, data TEXT NOT NULL);`
    );
    // Config tables are written by powmr_config_poll.py --save; create defensively
    // so a fresh DB (no snapshot yet) doesn't 500 on /api/config.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, param INTEGER, reg INTEGER, name TEXT, raw INTEGER, value REAL, unit TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS config_history (ts INTEGER, key TEXT, old REAL, new REAL, source TEXT, PRIMARY KEY (ts, key));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS daily (date TEXT PRIMARY KEY, pv_kwh REAL, grid_kwh REAL, load_kwh REAL);
    `);
    // Backfill/refresh daily rows from whatever samples still exist. Samples
    // prune at RETENTION_DAYS; daily rows are tiny and kept forever, so
    // billing periods longer than the retention window still add up.
    this.db.exec(`
      INSERT INTO daily (date, pv_kwh, grid_kwh, load_kwh)
      SELECT date(ts / 1000, 'unixepoch', 'localtime'),
             max(json_extract(data, '$.today_pv_kwh')),
             max(json_extract(data, '$.today_grid_kwh')),
             max(json_extract(data, '$.today_load_kwh'))
      FROM samples GROUP BY 1
      ON CONFLICT(date) DO UPDATE SET
        pv_kwh   = max(coalesce(daily.pv_kwh, 0),   coalesce(excluded.pv_kwh, 0)),
        grid_kwh = max(coalesce(daily.grid_kwh, 0), coalesce(excluded.grid_kwh, 0)),
        load_kwh = max(coalesce(daily.load_kwh, 0), coalesce(excluded.load_kwh, 0));
    `);
    this.bumpStmt = this.db.prepare(
      `INSERT INTO daily (date, pv_kwh, grid_kwh, load_kwh) VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         pv_kwh   = max(coalesce(daily.pv_kwh, 0),   coalesce(excluded.pv_kwh, 0)),
         grid_kwh = max(coalesce(daily.grid_kwh, 0), coalesce(excluded.grid_kwh, 0)),
         load_kwh = max(coalesce(daily.load_kwh, 0), coalesce(excluded.load_kwh, 0))`
    );
    this.insertStmt = this.db.prepare("INSERT OR REPLACE INTO samples (ts, data) VALUES (?, ?)");
  }

  insert(ts: number, jsonText: string): void {
    this.insertStmt.run(ts, jsonText);
  }

  latest(): { ts: number; data: string } | null {
    const row = this.db.prepare("SELECT ts, data FROM samples ORDER BY ts DESC LIMIT 1").get() as
      | { ts: number; data: string }
      | undefined;
    return row ?? null;
  }

  // Bucketed min/avg/max per field ("f", "f__min", "f__max") so coarse views
  // can show an honest envelope instead of an average that never happened.
  // Only whitelisted fields are interpolated into SQL.
  history(since: number, until: number, bucketMs: number, fields: string[]): HistoryPoint[] {
    const safe = fields.filter((f) => KEYSET.has(f));
    if (safe.length === 0) return [];
    const cols = safe
      .map((f) =>
        `avg(json_extract(data, '$.${f}')) AS "${f}", ` +
        `min(json_extract(data, '$.${f}')) AS "${f}__min", ` +
        `max(json_extract(data, '$.${f}')) AS "${f}__max"`)
      .join(", ");
    // CAST is load-bearing: better-sqlite3 binds JS numbers as REAL, and
    // float division makes every sample its own group (no bucketing at all).
    const sql =
      `SELECT (ts / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS t, ${cols} ` +
      `FROM samples WHERE ts >= ? AND ts <= ? ` +
      `GROUP BY ts / CAST(? AS INTEGER) ORDER BY t ASC`;
    const rows = this.db.prepare(sql).all(bucketMs, bucketMs, since, until, bucketMs) as HistoryPoint[];
    // round to keep payload small
    for (const r of rows) {
      for (const f of safe) {
        for (const k of [f, `${f}__min`, `${f}__max`]) {
          const v = r[k];
          if (typeof v === "number") r[k] = Math.round(v * 100) / 100;
        }
      }
    }
    return rows;
  }

  // State flips: scan range, emit a row only when machine OR charge changes
  // from the previous sample (so markers land on the exact transition ts).
  states(since: number, until: number): { t: number; machine: string; charge: string }[] {
    const rows = this.db
      .prepare(
        "SELECT ts AS t, " +
          "json_extract(data, '$.machine_state_txt') AS machine, " +
          "json_extract(data, '$.charge_state_txt') AS charge " +
          "FROM samples WHERE ts >= ? AND ts <= ? ORDER BY ts ASC"
      )
      .all(since, until) as { t: number; machine: string | null; charge: string | null }[];
    const out: { t: number; machine: string; charge: string }[] = [];
    let pm: string | null = null, pc: string | null = null;
    for (const r of rows) {
      const m = r.machine ?? "?", c = r.charge ?? "?";
      if (m !== pm || c !== pc) { out.push({ t: r.t, machine: m, charge: c }); pm = m; pc = c; }
    }
    return out;
  }

  // Read-only config snapshot + recent change log.
  config(): { setpoints: ConfigSetpoint[]; history: ConfigChange[] } {
    const setpoints = this.db
      .prepare("SELECT key, param, reg, name, raw, value, unit, ts FROM config ORDER BY param")
      .all() as ConfigSetpoint[];
    const history = this.db
      .prepare("SELECT ts, key, old, new, source FROM config_history ORDER BY ts DESC LIMIT 100")
      .all() as ConfigChange[];
    return { setpoints, history };
  }

  // The today_* counters reset at midnight, so each local day's max IS that
  // day's total — even if the daemon was down part of the day.
  bumpDaily(ts: number, pv: number | null, grid: number | null, load: number | null): void {
    const date = new Date(ts).toLocaleDateString("sv"); // sv = ISO yyyy-mm-dd, local tz
    this.bumpStmt.run(date, pv, grid, load);
  }

  daily(sinceMs: number): { date: string; pv_kwh: number; grid_kwh: number; load_kwh: number }[] {
    const since = new Date(sinceMs).toLocaleDateString("sv");
    return this.db
      .prepare("SELECT date, pv_kwh, grid_kwh, load_kwh FROM daily WHERE date >= ? ORDER BY date ASC")
      .all(since) as { date: string; pv_kwh: number; grid_kwh: number; load_kwh: number }[];
  }

  // App settings: one JSON value per key.
  getSetting<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value) as T; } catch { return null; }
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
  }

  prune(olderThanMs: number): number {
    const info = this.db.prepare("DELETE FROM samples WHERE ts < ?").run(Date.now() - olderThanMs);
    return info.changes;
  }

  count(): number {
    return (this.db.prepare("SELECT count(*) c FROM samples").get() as { c: number }).c;
  }
}
