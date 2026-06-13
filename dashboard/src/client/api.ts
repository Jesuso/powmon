import type { HistoryResponse, LatestResponse, InverterState, StatesResponse, ConfigResponse, SettingsResponse, DailyResponse } from "../shared/types.ts";

export async function getLatest(): Promise<LatestResponse> {
  const r = await fetch("/api/latest");
  return r.json();
}

export async function getHistory(
  sinceMs: number,
  opts?: { until?: number; bucketS?: number; fields?: string[] }
): Promise<HistoryResponse> {
  const p = new URLSearchParams({ since: String(sinceMs) });
  if (opts?.until) p.set("until", String(opts.until));
  if (opts?.bucketS) p.set("bucket", String(opts.bucketS));
  if (opts?.fields?.length) p.set("fields", opts.fields.join(","));
  const r = await fetch(`/api/history?${p}`);
  return r.json();
}

export async function getStates(sinceMs: number, untilMs?: number): Promise<StatesResponse> {
  const p = new URLSearchParams({ since: String(sinceMs) });
  if (untilMs) p.set("until", String(untilMs));
  const r = await fetch(`/api/states?${p}`);
  return r.json();
}

export async function getConfig(): Promise<ConfigResponse> {
  const r = await fetch("/api/config");
  return r.json();
}

export async function getDaily(days = 31): Promise<DailyResponse> {
  const r = await fetch(`/api/daily?days=${days}`);
  return r.json();
}

export async function getSettings(): Promise<SettingsResponse> {
  const r = await fetch("/api/settings");
  return r.json();
}

export async function putSettings(s: Partial<SettingsResponse>): Promise<SettingsResponse> {
  const r = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!r.ok) throw new Error(`save failed (${r.status})`);
  return r.json();
}

export interface StreamHandlers {
  onState: (ts: number, state: InverterState) => void;
  onStatus: (online: boolean) => void;
}

// Returns a cleanup fn.
export function openStream(h: StreamHandlers): () => void {
  const es = new EventSource("/api/stream");
  es.addEventListener("state", (e) => {
    const { ts, state } = JSON.parse((e as MessageEvent).data);
    h.onState(ts, state);
  });
  es.addEventListener("status", (e) => {
    const { online } = JSON.parse((e as MessageEvent).data);
    h.onStatus(online);
  });
  return () => es.close();
}
