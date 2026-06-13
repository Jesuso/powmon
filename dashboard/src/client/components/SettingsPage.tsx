import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSettings, putSettings } from "../api.ts";
import { dateLocale } from "../i18n/index.ts";
import { ConfigPanel } from "./ConfigPanel.tsx";
import {
  DEFAULT_TARIFF, DEFAULT_BILLING,
  type ConfigResponse, type SettingsResponse,
} from "../../shared/types.ts";

interface Props {
  config: ConfigResponse | null;
  configLoading: boolean;
  onRefreshConfig: () => void;
  onSaved: (s: SettingsResponse) => void;
}

type Status = "loading" | "idle" | "saving" | "saved" | "error";

function SaveRow({ note, status, valid, onSave, t }: {
  note: string; status: Status; valid: boolean; onSave: () => void;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <div className="settings-actions">
      <span className="settings-effective">{note}</span>
      <button className="settings-save" disabled={!valid || status === "saving" || status === "loading"} onClick={onSave}>
        {status === "saving" ? "…" : status === "saved" ? t("settings.saved") : t("settings.save")}
      </button>
    </div>
  );
}

export function SettingsPage({ config, configLoading, onRefreshConfig, onSaved }: Props) {
  const { t } = useTranslation();
  const locale = dateLocale();
  // Inputs held as strings so partial edits ("4.", "") don't fight the user.
  const [price, setPrice] = useState(String(DEFAULT_TARIFF.price_kwh));
  const [tax, setTax] = useState(String(DEFAULT_TARIFF.tax_pct));
  const [currency, setCurrency] = useState(DEFAULT_TARIFF.currency);
  const [periodMonths, setPeriodMonths] = useState(String(DEFAULT_BILLING.period_months));
  const [anchorDay, setAnchorDay] = useState(String(DEFAULT_BILLING.anchor_day));
  const [anchorMonth, setAnchorMonth] = useState(String(DEFAULT_BILLING.anchor_month));
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [tariffStatus, setTariffStatus] = useState<Status>("loading");
  const [billingStatus, setBillingStatus] = useState<Status>("loading");
  const [locationStatus, setLocationStatus] = useState<Status>("loading");

  useEffect(() => {
    getSettings()
      .then(({ tariff, billing, location }) => {
        setPrice(String(tariff.price_kwh));
        setTax(String(tariff.tax_pct));
        setCurrency(tariff.currency);
        setPeriodMonths(String(billing.period_months));
        setAnchorDay(String(billing.anchor_day));
        setAnchorMonth(String(billing.anchor_month));
        if (location) { setLat(String(location.lat)); setLon(String(location.lon)); }
        setTariffStatus("idle");
        setBillingStatus("idle");
        setLocationStatus("idle");
      })
      .catch(() => { setTariffStatus("error"); setBillingStatus("error"); setLocationStatus("error"); });
  }, []);

  const priceN = Number(price), taxN = Number(tax);
  const tariffValid =
    Number.isFinite(priceN) && priceN >= 0 &&
    Number.isFinite(taxN) && taxN >= 0 && taxN <= 100 &&
    currency.trim().length > 0;
  const effective = tariffValid ? priceN * (1 + taxN / 100) : null;

  const pmN = Number(periodMonths), adN = Number(anchorDay), amN = Number(anchorMonth);
  const billingValid =
    Number.isInteger(pmN) && pmN >= 1 && pmN <= 12 &&
    Number.isInteger(adN) && adN >= 1 && adN <= 28 &&
    Number.isInteger(amN) && amN >= 1 && amN <= 12;

  const latN = Number(lat), lonN = Number(lon);
  const locationEmpty = lat.trim() === "" && lon.trim() === "";
  const locationValid = locationEmpty ||
    (Number.isFinite(latN) && latN >= -90 && latN <= 90 &&
     Number.isFinite(lonN) && lonN >= -180 && lonN <= 180 &&
     lat.trim() !== "" && lon.trim() !== "");

  async function save(section: "tariff" | "billing" | "location") {
    const setStatus =
      section === "tariff" ? setTariffStatus :
      section === "billing" ? setBillingStatus : setLocationStatus;
    setStatus("saving");
    try {
      const body =
        section === "tariff"
          ? { tariff: { price_kwh: priceN, tax_pct: taxN, currency: currency.trim() } }
          : section === "billing"
            ? { billing: { period_months: pmN, anchor_day: adN, anchor_month: amN } }
            : { location: locationEmpty ? null : { lat: latN, lon: lonN } };
      const saved = await putSettings(body);
      onSaved(saved);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  const monthName = (m: number) =>
    new Date(2000, m - 1, 1).toLocaleDateString(locale, { month: "long" });

  return (
    <div className="settings">
      <div className="card settings-card">
        <div className="card-head">
          <span className="card-title">{t("settings.tariff")}</span>
        </div>
        <p className="settings-hint">{t("settings.tariffHint")}</p>
        <div className="settings-form">
          <label>
            <span>{t("settings.price")}</span>
            <input type="number" min="0" step="0.01" inputMode="decimal"
              value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            <span>{t("settings.tax")}</span>
            <input type="number" min="0" max="100" step="0.1" inputMode="decimal"
              value={tax} onChange={(e) => setTax(e.target.value)} />
          </label>
          <label>
            <span>{t("settings.currency")}</span>
            <input type="text" maxLength={8}
              value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </label>
        </div>
        <SaveRow t={t} status={tariffStatus} valid={tariffValid} onSave={() => save("tariff")}
          note={effective !== null
            ? t("settings.effective", { v: `${currency.trim()}${effective.toFixed(2)}` })
            : t("settings.invalid")} />
        {tariffStatus === "error" && <div className="settings-error">{t("settings.error")}</div>}
      </div>

      <div className="card settings-card">
        <div className="card-head">
          <span className="card-title">{t("settings.billing")}</span>
        </div>
        <p className="settings-hint">{t("settings.billingHint")}</p>
        <div className="settings-form">
          <label>
            <span>{t("settings.periodMonths")}</span>
            <input type="number" min="1" max="12" step="1" inputMode="numeric"
              value={periodMonths} onChange={(e) => setPeriodMonths(e.target.value)} />
          </label>
          <label>
            <span>{t("settings.anchorDay")}</span>
            <input type="number" min="1" max="28" step="1" inputMode="numeric"
              value={anchorDay} onChange={(e) => setAnchorDay(e.target.value)} />
          </label>
          {pmN > 1 && (
            <label>
              <span>{t("settings.anchorMonth")}</span>
              <select value={anchorMonth} onChange={(e) => setAnchorMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <SaveRow t={t} status={billingStatus} valid={billingValid} onSave={() => save("billing")}
          note={billingValid
            ? t("settings.billingNote", { n: pmN, d: adN })
            : t("settings.invalid")} />
        {billingStatus === "error" && <div className="settings-error">{t("settings.error")}</div>}
      </div>

      <div className="card settings-card">
        <div className="card-head">
          <span className="card-title">{t("settings.location")}</span>
        </div>
        <p className="settings-hint">{t("settings.locationHint")}</p>
        <div className="settings-form">
          <label>
            <span>{t("settings.lat")}</span>
            <input type="number" min="-90" max="90" step="0.0001" inputMode="decimal"
              placeholder="29.0729" value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label>
            <span>{t("settings.lon")}</span>
            <input type="number" min="-180" max="180" step="0.0001" inputMode="decimal"
              placeholder="-110.9559" value={lon} onChange={(e) => setLon(e.target.value)} />
          </label>
        </div>
        <SaveRow t={t} status={locationStatus} valid={locationValid} onSave={() => save("location")}
          note={locationEmpty ? t("settings.locationOff") : locationValid ? `${lat}, ${lon}` : t("settings.invalid")} />
        {locationStatus === "error" && <div className="settings-error">{t("settings.error")}</div>}
      </div>

      <ConfigPanel data={config} loading={configLoading} onRefresh={onRefreshConfig} />
    </div>
  );
}
