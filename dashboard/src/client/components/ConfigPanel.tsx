import { useState } from "react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "../i18n/index.ts";
import type { ConfigResponse } from "../../shared/types.ts";

interface Props {
  data: ConfigResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

// Compact relative age (s/m/h/d) — snapshots can be hours or days old.
function relAge(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function ConfigPanel({ data, loading, onRefresh }: Props) {
  const { t } = useTranslation();
  const locale = dateLocale();
  const [showLog, setShowLog] = useState(false);
  const setpoints = data?.setpoints ?? [];
  const history = data?.history ?? [];
  const updatedTs = setpoints.length ? Math.max(...setpoints.map((s) => s.ts)) : null;

  return (
    <div className="card config-card">
      <div className="card-head">
        <span className="card-title">{t("panel.config")}</span>
        <span className="config-meta">
          {updatedTs != null && (
            <span className="card-unit" title={new Date(updatedTs).toLocaleString(locale)}>
              {t("config.updated", { rel: relAge(updatedTs) })}
            </span>
          )}
          <button className="config-refresh" onClick={onRefresh} disabled={loading}>
            {loading ? "…" : t("config.refresh")}
          </button>
        </span>
      </div>

      {setpoints.length === 0 ? (
        <div className="config-empty">{t("config.empty")}</div>
      ) : (
        <div className="config-grid">
          {setpoints.map((s) => (
            <div key={s.key} className="config-cell">
              <span className="config-label">{t(`config.${s.key}`, { defaultValue: s.name })}</span>
              <span className="config-value">
                {s.value}
                {s.unit ? <small> {s.unit}</small> : null}
              </span>
              <span className="config-badge" title={`reg ${s.reg}`}>[{s.param}]</span>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="config-log">
          <button className="config-log-toggle" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "▾" : "▸"} {t("config.changelog", { n: history.length })}
          </button>
          {showLog && (
            <ul className="config-log-list">
              {history.map((h) => (
                <li key={`${h.ts}-${h.key}`}>
                  <span className="config-log-time">{new Date(h.ts).toLocaleString(locale)}</span>
                  <span className="config-log-key">{t(`config.${h.key}`, { defaultValue: h.key })}</span>
                  <span className="config-log-delta">
                    {h.old == null ? "—" : h.old} → <b>{h.new}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
