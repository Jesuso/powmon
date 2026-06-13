import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "../i18n/index.ts";

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toLocaleDateString("sv"); // yyyy-mm-dd, local tz

interface Props {
  valueMs: number; // local midnight of the selected day
  onChange: (ms: number) => void;
  minMs: number;
  maxMs: number;
  dataDays?: Set<string>; // iso days that have samples → dot marker
  dashed?: boolean; // compare picker: dashed border matching the overlay style
}

// Dropdown calendar. Custom rather than <input type="date"> so it can mark
// which days actually hold data and render theme-consistent in every browser.
export function DayPicker({ valueMs, onChange, minMs, maxMs, dataDays, dashed }: Props) {
  const { t } = useTranslation();
  const locale = dateLocale();
  const [open, setOpen] = useState(false);
  // First-of-month anchor for the visible grid; resyncs to the value on open.
  const [view, setView] = useState<Date>(() => { const d = new Date(valueMs); d.setDate(1); return d; });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const label = valueMs === todayStart
    ? t("app.today", { defaultValue: "Today" })
    : valueMs === todayStart - DAY_MS
      ? t("app.yesterday", { defaultValue: "Yesterday" })
      : new Date(valueMs).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });

  // Monday-first 6-week grid (es-MX expectation; en tolerates it fine).
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // trailing days of the previous month
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - lead);
    return Array.from({ length: 42 }, (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime());
  }, [view]);

  const dows = useMemo(() => {
    const mon = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(mon.getTime() + i * DAY_MS).toLocaleDateString(locale, { weekday: "narrow" }));
  }, [locale]);

  const canPrev = new Date(view.getFullYear(), view.getMonth(), 0).getTime() >= minMs;
  const canNext = new Date(view.getFullYear(), view.getMonth() + 1, 1).getTime() <= maxMs;

  return (
    <div className="daypicker" ref={wrapRef}>
      <button className={dashed ? "day-btn cmp" : "day-btn"} aria-haspopup="dialog" aria-expanded={open}
        title={t("app.pickDay", { defaultValue: "Pick a day" })}
        onClick={() => {
          setOpen((o) => !o);
          const d = new Date(valueMs); d.setDate(1); setView(d);
        }}>
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
          <rect x="1" y="2.5" width="12" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.4" />
          <line x1="4.4" y1="0.8" x2="4.4" y2="3.6" stroke="currentColor" strokeWidth="1.4" />
          <line x1="9.6" y1="0.8" x2="9.6" y2="3.6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        {label}
        <span className="day-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cal-pop" role="dialog">
          <div className="cal-head">
            <button disabled={!canPrev} aria-label={t("app.prevMonth", { defaultValue: "Previous month" })}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button>
            <span>{view.toLocaleDateString(locale, { month: "long", year: "numeric" })}</span>
            <button disabled={!canNext} aria-label={t("app.nextMonth", { defaultValue: "Next month" })}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button>
          </div>
          <div className="cal-grid">
            {dows.map((d, i) => <span key={`dow${i}`} className="cal-dow">{d}</span>)}
            {cells.map((ms) => {
              const cls = [
                "cal-day",
                ms === valueMs ? "sel" : "",
                new Date(ms).getMonth() !== view.getMonth() ? "out" : "",
                dataDays?.has(isoDay(ms)) ? "dot" : "",
              ].filter(Boolean).join(" ");
              return (
                <button key={ms} className={cls} disabled={ms < minMs || ms > maxMs}
                  onClick={() => { onChange(ms); setOpen(false); }}>
                  {new Date(ms).getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
