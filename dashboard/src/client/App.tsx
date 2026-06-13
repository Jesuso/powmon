import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import SunCalc from "suncalc";
import { dateLocale } from "./i18n/index.ts";
import { getHistory, getLatest, getStates, getConfig, getSettings, getDaily, openStream } from "./api.ts";
import { StatTiles } from "./components/StatTiles.tsx";
import { TimeSeriesChart, type Gap, type RefLine } from "./components/TimeSeriesChart.tsx";
import { StateTimeline } from "./components/StateTimeline.tsx";
import { SettingsPage } from "./components/SettingsPage.tsx";
import { DayPicker } from "./components/DayPicker.tsx";
import { LangSwitch } from "./components/LangSwitch.tsx";
import { ThemeSwitch } from "./components/ThemeSwitch.tsx";
import {
  CHART_PANELS, NUMERIC_FIELDS, NUMERIC_KEYS,
  type FieldMeta, type HistoryPoint, type InverterState, type StateTransition,
  DEFAULT_BILLING,
  type ConfigResponse, type TariffSettings, type BillingSettings, type LocationSettings, type DailyRow,
} from "../shared/types.ts";

// Battery-chart reference lines drawn from live config setpoints (drift-proof).
// All voltages → right axis. Labels/tips live in i18n (chartRef.* / chartTip.*).
const BATTERY_REFS: { key: string; color: string }[] = [
  { key: "battery_to_mains_v", color: "#ef4444" },
  { key: "mains_to_battery_v", color: "#f59e0b" },
  { key: "float_v", color: "#14b8a6" },
  { key: "boost_v", color: "#0ea5e9" },
  { key: "equalize_v", color: "#ec4899" },
];

const META = Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.key, f])) as Record<string, FieldMeta>;

// "today" is day mode: the domain pins to one local day's 00:00–24:00
// (SOLARMAN-style: remaining hours show as empty space). The day navigator
// steps to any past day and can overlay a second day. Others are rolling.
type RangeKey = "1h" | "6h" | "today" | "7d" | "30d";
const RANGE_KEYS: RangeKey[] = ["1h", "6h", "today", "7d", "30d"];
const ROLLING_HOURS: Partial<Record<RangeKey, number>> = { "1h": 1, "6h": 6, "7d": 168, "30d": 720 };

const DAY_MS = 86_400_000;
const PICKER_DAYS = 30; // mirrors server RETENTION_DAYS — older days have no samples
const startOfToday = (): number => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function rangeWindow(key: RangeKey, dayStart?: number): { since: number; until: number } {
  if (key === "today") {
    const s = dayStart ?? startOfToday();
    return { since: s, until: s + DAY_MS };
  }
  const h = ROLLING_HOURS[key] ?? 6;
  return { since: Date.now() - h * 3600_000, until: Date.now() };
}

// Detail ladder. Options for a span are the rungs that yield 8–2000 points;
// the default is the middle rung (1h→1m, 24h→5m, 7d→1h, …). Derived from the
// active span, so the picker keeps working inside a zoom.
const BUCKET_LADDER = [10, 60, 300, 900, 3600, 21600, 86400];

function bucketOptions(spanMs: number): number[] {
  return BUCKET_LADDER.filter((b) => {
    const n = spanMs / (b * 1000);
    return n >= 8 && n <= 2000;
  });
}

function defaultBucket(spanMs: number): number {
  const opts = bucketOptions(spanMs);
  return opts[Math.floor((opts.length - 1) / 2)] ?? 60;
}

function bucketLabel(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${s / 60}m`;
  if (s < 86400) return `${s / 3600}h`;
  return `${s / 86400}d`;
}

function readZoom(): [number, number] | null {
  const p = new URLSearchParams(window.location.search);
  const from = Number(p.get("from")), to = Number(p.get("to"));
  if (Number.isFinite(from) && Number.isFinite(to) && from < to) return [from, to];
  return null;
}

// Latest billing-period start ≤ now: anchor_day of a month aligned with
// anchor_month every period_months (e.g. CFE: every 2 months from Jan 13).
function periodStart(now: Date, b: BillingSettings): Date {
  const p = Math.max(1, b.period_months);
  for (let i = 0; i <= p; i++) {
    const cand = new Date(now.getFullYear(), now.getMonth() - i, b.anchor_day);
    const aligned = (((cand.getMonth() - (b.anchor_month - 1)) % p) + p) % p === 0;
    if (cand <= now && aligned) return cand;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const isoDay = (d: Date) => d.toLocaleDateString("sv"); // yyyy-mm-dd, local tz

// Detect outages: a gap is any inter-sample Δt > 3× the median cadence.
function computeGaps(pts: HistoryPoint[]): { threshold: number; gaps: Gap[] } {
  if (pts.length < 3) return { threshold: Infinity, gaps: [] };
  const dts: number[] = [];
  for (let i = 1; i < pts.length; i++) dts.push(pts[i].t - pts[i - 1].t);
  const med = [...dts].sort((a, b) => a - b)[Math.floor(dts.length / 2)] || 0;
  const threshold = Math.max(med * 3, 60_000);
  const gaps: Gap[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > threshold) gaps.push({ from: pts[i - 1].t, to: pts[i].t });
  }
  return { threshold, gaps };
}

export function App() {
  const { t } = useTranslation();
  const [state, setState] = useState<InverterState | null>(null);
  const [online, setOnline] = useState(false);
  const [ts, setTs] = useState<number | null>(null);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  // Day mode: which local day is shown + an optional second day overlaid.
  const [dayStart, setDayStart] = useState<number>(() => startOfToday());
  const [compareStart, setCompareStart] = useState<number | null>(null);
  const [comparePoints, setComparePoints] = useState<HistoryPoint[]>([]);
  const [bucketS, setBucketS] = useState<number>(() => {
    const z = readZoom();
    return defaultBucket(z ? z[1] - z[0] : DAY_MS);
  });
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(() => readZoom());
  const [transitions, setTransitions] = useState<StateTransition[]>([]);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [route, setRoute] = useState(() => window.location.hash);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(() => {
    try { return localStorage.getItem("advancedPanels") === "1"; } catch { return false; }
  });
  const toggleAdvanced = useCallback(() => {
    setShowAdvanced((v) => {
      try { localStorage.setItem("advancedPanels", v ? "0" : "1"); } catch { /* */ }
      return !v;
    });
  }, []);
  const [tariff, setTariff] = useState<TariffSettings | null>(null);
  const [billing, setBilling] = useState<BillingSettings>(DEFAULT_BILLING);
  const [location, setLocation] = useState<LocationSettings | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);

  // Daily rows covering at least one full billing period; refreshed hourly
  // so a wall tablet survives midnights.
  useEffect(() => {
    const days = (Math.max(1, billing.period_months) + 1) * 31;
    const load = () => getDaily(days).then((d) => setDaily(d.days)).catch(() => {});
    load();
    const id = setInterval(load, 3600_000);
    return () => clearInterval(id);
  }, [billing.period_months]);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const onSettings = route.startsWith("#/settings");

  // Default x-domain follows the loaded window; "today" pins to the full
  // local day; a zoom overrides both.
  const dataDomain = useMemo<[number, number]>(() => {
    if (rangeKey === "today") {
      const w = rangeWindow("today", dayStart);
      return [w.since, w.until];
    }
    if (!points.length) { const w = rangeWindow(rangeKey); return [w.since, w.until]; }
    return [points[0].t, points[points.length - 1].t];
  }, [points, rangeKey, dayStart]);
  const domain = zoom ?? dataDomain;

  const applyZoom = useCallback((range: [number, number] | null) => {
    setZoom(range);
    if (range) setBucketS(defaultBucket(range[1] - range[0]));
    const url = new URL(window.location.href);
    if (range) {
      url.searchParams.set("from", String(Math.round(range[0])));
      url.searchParams.set("to", String(Math.round(range[1])));
    } else {
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    }
    window.history.replaceState(null, "", url);
  }, []);

  const pickRange = useCallback((key: RangeKey) => {
    setRangeKey(key);
    applyZoom(null);
    // Compare only exists in day mode; the Today button also resets the day.
    if (key === "today") setDayStart(startOfToday());
    else setCompareStart(null);
    const w = rangeWindow(key);
    setBucketS(defaultBucket(w.until - w.since));
  }, [applyZoom]);

  // ---- day navigator (day mode only) ----
  const isToday = dayStart === startOfToday();
  const minDay = startOfToday() - PICKER_DAYS * DAY_MS;
  const stepDay = useCallback((delta: number) => {
    setDayStart((d) => Math.max(minDay, Math.min(startOfToday(), d + delta * DAY_MS)));
  }, [minDay]);
  const toggleCompare = useCallback(() => {
    // Default comparison: the day before the one on screen (today vs yesterday).
    setCompareStart((c) => (c == null ? Math.max(minDay, dayStart - DAY_MS) : null));
  }, [dayStart, minDay]);
  // Days that actually have samples → dots in the calendar.
  const dataDays = useMemo(() => new Set(daily.map((r) => r.date)), [daily]);

  // Esc collapses an expanded chart first, then exits a zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expanded) setExpanded(null);
      else applyZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyZoom, expanded]);

  // SSE samples merge into the bucket the loaded history uses, so the array
  // stays ~600 points no matter how long the page is left open.
  const bucketMsRef = useRef(10_000);

  const loadHistory = useCallback(async (key: RangeKey, b: number, dStart: number) => {
    const { since, until } = rangeWindow(key, dStart);
    // Day mode bounds the fetch on both ends so a past day stays that day.
    const isDay = key === "today";
    const [hist, st] = await Promise.all([
      getHistory(since, { until: isDay ? until : undefined, bucketS: b }),
      getStates(since, isDay ? until : undefined),
    ]);
    bucketMsRef.current = hist.bucketMs;
    setPoints(hist.points);
    setTransitions(st.transitions);
  }, []);

  // config is static between snapshots — fetch once (+ manual refresh button).
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try { setConfig(await getConfig()); }
    finally { setConfigLoading(false); }
  }, []);

  // initial latest + history + config + tariff
  useEffect(() => {
    getLatest().then((l) => { setState(l.state); setOnline(l.online); setTs(l.ts); });
    getSettings().then((s) => {
      setTariff(s.tariff);
      setBilling(s.billing ?? DEFAULT_BILLING);
      setLocation(s.location ?? null);
    }).catch(() => {});
    loadConfig();
  }, [loadConfig]);
  // Range view fetch; a zoom refetches its own window at the selected detail
  // (defaulted to the zoom span's middle rung), TradingView-style.
  useEffect(() => {
    if (zoom) {
      getHistory(zoom[0], { until: zoom[1], bucketS }).then((hist) => {
        bucketMsRef.current = hist.bucketMs;
        setPoints(hist.points);
      }).catch(() => {});
      return;
    }
    loadHistory(rangeKey, bucketS, dayStart);
  }, [rangeKey, bucketS, zoom, loadHistory, dayStart]);

  // Compare overlay: fetch the second day at the same detail, then shift its
  // timestamps onto the shown day's clock so both share one 00–24h axis.
  useEffect(() => {
    if (rangeKey !== "today" || compareStart == null) { setComparePoints([]); return; }
    const offset = dayStart - compareStart;
    getHistory(compareStart, { until: compareStart + DAY_MS, bucketS })
      .then((hist) => setComparePoints(hist.points.map((p) => ({ ...p, t: p.t + offset }))))
      .catch(() => setComparePoints([]));
  }, [rangeKey, compareStart, dayStart, bucketS]);

  // live stream
  useEffect(() => {
    return openStream({
      onStatus: setOnline,
      onState: (t, s) => {
        setState(s); setTs(t); setOnline(true);
        // Viewing a past day: keep the header/tiles live but don't graft
        // today's samples onto another day's chart.
        const w = rangeWindow(rangeKey, dayStart);
        if (t < w.since || t > w.until) return;
        setPoints((prev) => {
          // Merge each live sample into its bucket (running avg + min/max
          // envelope) so the array stays bounded however long the page lives.
          const bMs = bucketMsRef.current || 10_000;
          const t0 = Math.floor(t / bMs) * bMs;
          const cutoff = w.since;
          const last = prev[prev.length - 1];
          if (last && last.t === t0) {
            const n = (Number.isFinite(last.__n) ? last.__n : 1) + 1;
            const merged: HistoryPoint = { ...last, __n: n };
            for (const k of NUMERIC_KEYS) {
              const v = s[k];
              if (typeof v !== "number") continue;
              const avg = merged[k];
              merged[k] = Number.isFinite(avg) ? avg + (v - avg) / n : v;
              const mn = merged[`${k}__min`], mx = merged[`${k}__max`];
              merged[`${k}__min`] = Number.isFinite(mn) ? Math.min(mn, v) : v;
              merged[`${k}__max`] = Number.isFinite(mx) ? Math.max(mx, v) : v;
            }
            return [...prev.slice(0, -1), merged].filter((p) => p.t >= cutoff);
          }
          const pt: HistoryPoint = { t: t0, __n: 1 };
          for (const k of NUMERIC_KEYS) {
            const v = s[k];
            if (typeof v === "number") { pt[k] = v; pt[`${k}__min`] = v; pt[`${k}__max`] = v; }
          }
          return [...prev, pt].filter((p) => p.t >= cutoff);
        });
        // append a state transition when machine/charge flips
        const m = (s.machine_state_txt as string) ?? "?";
        const ch = (s.charge_state_txt as string) ?? "?";
        setTransitions((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.machine === m && last.charge === ch) return prev;
          return [...prev, { t, machine: m, charge: ch }];
        });
      },
    });
  }, [rangeKey, dayStart]);

  const panels = useMemo(
    () => CHART_PANELS.map((p) => ({
      ...p,
      metas: p.series.map((k) => META[k]).filter(Boolean),
      metasRight: (p.seriesRight ?? []).map((k) => META[k]).filter(Boolean),
    })),
    []
  );

  const { threshold: gapThreshold, gaps } = useMemo(() => computeGaps(points), [points]);

  // Night bands (sunset → next sunrise) clipped to the visible domain.
  const nights = useMemo<Gap[]>(() => {
    if (!location) return [];
    const out: Gap[] = [];
    const day = new Date(domain[0] - 86_400_000);
    day.setHours(12, 0, 0, 0); // noon anchors avoid DST edge cases
    for (let d = day; d.getTime() < domain[1] + 86_400_000; d = new Date(d.getTime() + 86_400_000)) {
      const sunset = SunCalc.getTimes(d, location.lat, location.lon).sunset.getTime();
      const sunrise = SunCalc.getTimes(new Date(d.getTime() + 86_400_000), location.lat, location.lon).sunrise.getTime();
      if (sunrise > domain[0] && sunset < domain[1]) {
        out.push({ from: Math.max(sunset, domain[0]), to: Math.min(sunrise, domain[1]) });
      }
    }
    return out;
  }, [location, domain]);

  const batteryRefs = useMemo<RefLine[]>(() => {
    const m = new Map((config?.setpoints ?? []).map((s) => [s.key, s.value]));
    return BATTERY_REFS.flatMap(({ key, color }) => {
      const v = m.get(key);
      if (typeof v !== "number") return [];
      if (key === "equalize_v" && m.get("equalize_enable") === 0) return [];
      const tipVars = {
        v,
        boostMins: m.get("boost_duration_min"),
        eqMins: m.get("equalize_time_min"),
        eqDays: m.get("equalize_interval_d"),
      };
      return [{
        value: v, color, axis: "right" as const,
        label: `${t(`chartRef.${key}`)} ${v}`,
        tip: t(`chartTip.${key}`, tipVars),
      }];
    });
  }, [config, t]);

  const fmtDay = useCallback(
    (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: "short", month: "short", day: "numeric" }),
    []
  );
  const comparing = rangeKey === "today" && compareStart != null;
  const compareLabel = comparing ? fmtDay(compareStart!) : undefined;

  const placeholder = t("app.placeholder");
  const modeTxt = state?.machine_state_txt as string | undefined;
  const chargeTxt = state?.charge_state_txt as string | undefined;
  const mode = modeTxt ? t(`mode.${modeTxt}`, { defaultValue: modeTxt }) : placeholder;
  const charge = chargeTxt ? t(`chargeState.${chargeTxt}`, { defaultValue: chargeTxt }) : placeholder;
  const age = ts ? Math.round((Date.now() - ts) / 1000) : null;
  const rate = tariff ? tariff.price_kwh * (1 + tariff.tax_pct / 100) : null;
  const money = rate != null && tariff ? { rate, currency: tariff.currency } : undefined;

  // Billing-period-to-date = completed days from /api/daily + today live from
  // state, so the card stays current between hourly refetches.
  const period = useMemo(() => {
    const now = new Date();
    const start = periodStart(now, billing);
    const p = Math.max(1, billing.period_months);
    const end = new Date(start.getFullYear(), start.getMonth() + p, start.getDate() - 1);
    const startStr = isoDay(start), today = isoDay(now);
    let pv = 0, grid = 0, any = false;
    for (const r of daily) {
      if (r.date < startStr || r.date >= today) continue;
      pv += r.pv_kwh ?? 0; grid += r.grid_kwh ?? 0; any = true;
    }
    const tPv = state?.today_pv_kwh, tGrid = state?.today_grid_kwh;
    if (typeof tPv === "number") { pv += tPv; any = true; }
    if (typeof tGrid === "number") { grid += tGrid; any = true; }
    if (!any) return null;
    const f = (d: Date) => d.toLocaleDateString(dateLocale(), { month: "short", day: "numeric" });
    return { pv_kwh: pv, grid_kwh: grid, label: `${f(start)} – ${f(end)}` };
  }, [daily, state, billing]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" data-on={online} />
          <h1>{t("app.title")}</h1>
        </div>
        <div className="meta">
          {!onSettings && (
            <>
              <span className="badge">{mode}</span>
              <span className="badge alt">{t("app.chargeLabel")}: {charge}</span>
              <span className="age">
                {online ? (age !== null ? t("app.ago", { n: age }) : placeholder) : t("app.offline")}
              </span>
            </>
          )}
          <LangSwitch />
          <ThemeSwitch />
          <button
            className={onSettings ? "gear on" : "gear"}
            aria-label={t("settings.aria")}
            title={t("settings.aria")}
            onClick={() => { window.location.hash = onSettings ? "" : "#/settings"; }}
          >
            ⚙
          </button>
        </div>
      </header>

      {onSettings ? (
        <SettingsPage config={config} configLoading={configLoading} onRefreshConfig={loadConfig}
          onSaved={(s) => { setTariff(s.tariff); setBilling(s.billing); setLocation(s.location); }} />
      ) : (
        <div className="layout">
          <aside className="side">
            <StatTiles state={state} money={money} period={period} />
          </aside>

          <div className="maincol">
            <div className="toolbar">
              <button className={showAdvanced ? "adv-toggle on" : "adv-toggle"} onClick={toggleAdvanced}
                aria-pressed={showAdvanced}
                title={t("app.advancedTip", { defaultValue: "Extra panels for debugging: grid voltage history, real vs apparent power" })}>
                <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
                  <rect x="1" y="7" width="2.6" height="5" rx="0.6" fill="currentColor" />
                  <rect x="5.2" y="4" width="2.6" height="8" rx="0.6" fill="currentColor" />
                  <rect x="9.4" y="1" width="2.6" height="11" rx="0.6" fill="currentColor" />
                </svg>
                {t("app.advanced", { defaultValue: "Show advanced charts" })}
              </button>
              <div className="toolbar-right">
              <div className="ranges">
                {RANGE_KEYS.map((key) => (
                  <button key={key} className={!zoom && key === rangeKey ? "on" : ""} onClick={() => pickRange(key)}>
                    {key === "today" ? t("app.today", { defaultValue: "Today" }) : key}
                  </button>
                ))}
                {zoom && <button className="on">{t("app.custom", { defaultValue: "Custom" })}</button>}
              </div>
              <div className="ranges" aria-label={t("app.bucketAria", { defaultValue: "Detail" })}>
                {bucketOptions(zoom ? zoom[1] - zoom[0] : rangeWindow(rangeKey).until - rangeWindow(rangeKey).since).map((b) => (
                  <button key={b} className={b === bucketS ? "on" : ""} onClick={() => setBucketS(b)}>
                    {bucketLabel(b)}
                  </button>
                ))}
              </div>
              </div>
            </div>

            {rangeKey === "today" && (
              <div className="daynav">
                <button className="daynav-step" onClick={() => stepDay(-1)} disabled={dayStart <= minDay}
                  aria-label={t("app.prevDay", { defaultValue: "Previous day" })}
                  title={t("app.prevDay", { defaultValue: "Previous day" })}>‹</button>
                <DayPicker valueMs={dayStart} onChange={setDayStart} minMs={minDay} maxMs={startOfToday()} dataDays={dataDays} />
                <button className="daynav-step" onClick={() => stepDay(1)} disabled={isToday}
                  aria-label={t("app.nextDay", { defaultValue: "Next day" })}
                  title={t("app.nextDay", { defaultValue: "Next day" })}>›</button>
                <span className="daynav-sep" aria-hidden="true" />
                <button className={comparing ? "daynav-cmp on" : "daynav-cmp"} onClick={toggleCompare}
                  aria-pressed={comparing}
                  title={t("app.compareTip", { defaultValue: "Overlay a second day on the charts" })}>
                  ⇄ {t("app.compare", { defaultValue: "Compare" })}
                </button>
                {comparing && (
                  <>
                    <span className="daynav-vs">{t("app.vs", { defaultValue: "vs" })}</span>
                    <DayPicker valueMs={compareStart!} onChange={setCompareStart} minMs={minDay} maxMs={startOfToday()} dataDays={dataDays} dashed />
                  </>
                )}
              </div>
            )}

            <StateTimeline domain={domain} transitions={transitions} hoverT={hoverT} onHover={setHoverT} onZoom={applyZoom} />

            <main className={expanded ? "charts expanded" : "charts"}>
              {panels
                .filter((p) => (expanded ? p.id === expanded : !p.advanced || showAdvanced))
                .map((p) => (
                <TimeSeriesChart key={p.id} title={t(`panel.${p.id}`)} unit={p.unit} series={p.metas} data={points}
                  seriesRight={p.metasRight.length ? p.metasRight : undefined}
                  unitRight={p.unitRight} leftDomain={p.leftDomain}
                  domain={domain} hoverT={hoverT} onHover={setHoverT} onZoom={applyZoom}
                  gaps={gaps} gapThreshold={gapThreshold} nights={nights}
                  refLines={p.id === "battery" ? batteryRefs : undefined}
                  compareData={comparing && comparePoints.length ? comparePoints : undefined}
                  compareLabel={comparing && comparePoints.length ? compareLabel : undefined}
                  money={p.id === "energy" ? money : undefined}
                  expanded={p.id === expanded}
                  expandLabel={p.id === expanded ? t("app.collapse", { defaultValue: "Collapse" }) : t("app.expand", { defaultValue: "Expand" })}
                  onToggleExpand={() => setExpanded(expanded === p.id ? null : p.id)} />
              ))}
            </main>

            <footer className="foot">
              {t("app.footer", {
                n: points.length,
                w: zoom
                  ? t("app.custom", { defaultValue: "Custom" })
                  : rangeKey !== "today" ? rangeKey
                  : (isToday ? t("app.today", { defaultValue: "Today" }) : fmtDay(dayStart))
                    + (comparing ? ` ${t("app.vs", { defaultValue: "vs" })} ${compareLabel}` : ""),
              })}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
