import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { NUMERIC_FIELDS, TILE_GROUPS, type InverterState } from "../../shared/types.ts";

const META = Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.key, f]));

// Money rows derived from daily/lifetime energy counters × tariff rate.
const MONEY_ROWS: { key: string; src: string; color: string }[] = [
  { key: "spent_today", src: "today_grid_kwh", color: "#6366f1" },
  { key: "saved_today", src: "today_pv_kwh", color: "#22c55e" },
  { key: "saved_total", src: "total_pv_kwh", color: "#16a34a" },
];

function fmt(v: number | string | undefined): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v;
  return Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
}

function fmtMoney(v: number, currency: string): string {
  return `${currency}${v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;
}

interface Props {
  state: InverterState | null;
  money?: { rate: number; currency: string };
  period?: { pv_kwh: number; grid_kwh: number; label: string } | null;
}

function Row({ label, tip, color, children }: {
  label: string; tip: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="group-row">
      <span className="row-dot" style={{ background: color }} />
      <span className="row-label">{label}</span>
      <span className="row-value">{children}</span>
      <button className="tile-info" aria-label={`${label}: ${tip}`} title={tip}>i</button>
      <div className="tile-tip" role="tooltip">{tip}</div>
    </div>
  );
}

export function StatTiles({ state, money, period }: Props) {
  const { t } = useTranslation();
  return (
    <div className="groups">
      {TILE_GROUPS.map((g) => (
        <Fragment key={g.id}>
          <section className="card group-card">
            <div className="group-title">{t(`group.${g.id}`)}</div>
            {g.fields.map((key) => {
              const m = META[key];
              const v = state?.[key];
              return (
                <Row key={key} label={t(`field.${key}`)} tip={t(`tip.${key}`)} color={m?.color ?? "#374151"}>
                  {fmt(v)}
                  <span className="row-unit">{m?.unit}</span>
                </Row>
              );
            })}
            {g.id === "daily" && money && MONEY_ROWS.map(({ key, src, color }) => {
              const kwh = state?.[src];
              const v = typeof kwh === "number" ? kwh * money.rate : undefined;
              return (
                <Row key={key} label={t(`field.${key}`)} tip={t(`tip.${key}`)} color={color}>
                  {v === undefined ? "—" : fmtMoney(v, money.currency)}
                </Row>
              );
            })}
          </section>
          {g.id === "daily" && period && (
            <section className="card group-card">
              <div className="group-title">{t("group.period")}</div>
              <div className="group-sub">{period.label}</div>
              <Row label={t("field.period_pv_kwh")} tip={t("tip.period_pv_kwh")} color="#f59e0b">
                {fmt(period.pv_kwh)}
                <span className="row-unit">kWh</span>
              </Row>
              <Row label={t("field.period_grid_kwh")} tip={t("tip.period_grid_kwh")} color="#6366f1">
                {fmt(period.grid_kwh)}
                <span className="row-unit">kWh</span>
              </Row>
              {money && (
                <>
                  <Row label={t("field.period_spent")} tip={t("tip.period_spent")} color="#6366f1">
                    {fmtMoney(period.grid_kwh * money.rate, money.currency)}
                  </Row>
                  <Row label={t("field.period_saved")} tip={t("tip.period_saved")} color="#22c55e">
                    {fmtMoney(period.pv_kwh * money.rate, money.currency)}
                  </Row>
                </>
              )}
            </section>
          )}
        </Fragment>
      ))}
    </div>
  );
}
