// Shared between fastify server and visx client.

export type InverterState = Record<string, number | string> & {
  battery_soc?: number;
  battery_voltage?: number;
  battery_power?: number;
  pv_total_power?: number;
  load_power?: number;
  machine_state_txt?: string;
};

// Display label lives in i18n as `field.<key>` (see client/i18n/locales/*.json).
export interface FieldMeta {
  key: string;
  unit: string;
  color: string;
}

// Every numeric field we persist + can chart. Order = legend order.
export const NUMERIC_FIELDS: FieldMeta[] = [
  { key: "battery_soc",       unit: "%",  color: "#22c55e" },
  { key: "battery_voltage",   unit: "V",  color: "#8b5cf6" },
  { key: "battery_current",   unit: "A",  color: "#15803d" },
  { key: "battery_power",     unit: "W",  color: "#84cc16" },
  { key: "pv1_voltage",       unit: "V",  color: "#f59e0b" },
  { key: "pv1_current",       unit: "A",  color: "#d97706" },
  { key: "pv1_power",         unit: "W",  color: "#fbbf24" },
  { key: "pv_total_power",    unit: "W",  color: "#f59e0b" },
  { key: "pv_charge_current", unit: "A",  color: "#eab308" },
  { key: "grid_voltage",      unit: "V",  color: "#6366f1" },
  { key: "grid_current",      unit: "A",  color: "#4f46e5" },
  { key: "grid_freq",         unit: "Hz", color: "#818cf8" },
  { key: "output_voltage",    unit: "V",  color: "#06b6d4" },
  { key: "output_current",    unit: "A",  color: "#0891b2" },
  { key: "output_freq",       unit: "Hz", color: "#22d3ee" },
  { key: "load_current",      unit: "A",  color: "#ef4444" },
  { key: "load_power",        unit: "W",  color: "#ef4444" },
  { key: "load_apparent",     unit: "VA", color: "#f87171" },
  { key: "load_percent",      unit: "%",  color: "#fca5a5" },
  { key: "dc_bus_voltage",    unit: "V",  color: "#a78bfa" },
  { key: "temp_dcdc",         unit: "°C", color: "#fb7185" },
  { key: "temp_dcac",         unit: "°C", color: "#f43f5e" },
  { key: "temp_transformer",  unit: "°C", color: "#e11d48" },
  { key: "temp_ambient",      unit: "°C", color: "#fda4af" },
  { key: "today_pv_kwh",      unit: "kWh", color: "#f59e0b" },
  { key: "today_load_kwh",    unit: "kWh", color: "#ef4444" },
  { key: "today_grid_kwh",    unit: "kWh", color: "#6366f1" },
  { key: "total_pv_kwh",      unit: "kWh", color: "#d97706" },
  { key: "total_load_kwh",    unit: "kWh", color: "#dc2626" },
];

export const NUMERIC_KEYS: string[] = NUMERIC_FIELDS.map((f) => f.key);

// Chart panels: each renders several series on one axis pair.
// Title lives in i18n as `panel.<id>` (see client/i18n/locales/*.json).
export interface ChartPanel {
  id: string;
  unit: string;
  series: string[]; // field keys (left axis)
  seriesRight?: string[]; // field keys on a second, right-hand axis
  unitRight?: string;
  leftDomain?: [number, number]; // fixed left-axis domain (e.g. SOC 0–100%)
  advanced?: boolean; // hidden unless "Advanced" is toggled (debug-grade panels)
}

export const CHART_PANELS: ChartPanel[] = [
  { id: "power", unit: "W", series: ["pv_total_power", "load_power", "battery_power"] },
  { id: "energy", unit: "kWh", series: ["today_pv_kwh", "today_grid_kwh", "today_load_kwh"] },
  { id: "battery", unit: "%", series: ["battery_soc"], unitRight: "V", seriesRight: ["battery_voltage"], leftDomain: [0, 100] },
  { id: "ac", unit: "V", series: ["grid_voltage", "output_voltage"], advanced: true },
  { id: "load", unit: "W / VA", series: ["load_power", "load_apparent"], advanced: true },
  { id: "temps", unit: "°C", series: ["temp_dcdc", "temp_dcac", "temp_transformer", "temp_ambient"] },
];

// Live stat groups (sidebar on wide screens, top grid on narrow).
// Title lives in i18n as `group.<id>`. Money rows render inside "daily".
export interface TileGroup { id: string; fields: string[] }
export const TILE_GROUPS: TileGroup[] = [
  { id: "daily",   fields: ["today_pv_kwh", "today_grid_kwh", "today_load_kwh"] },
  { id: "power",   fields: ["pv_total_power", "load_power", "battery_power", "load_percent"] },
  { id: "battery", fields: ["battery_soc", "battery_voltage"] },
  { id: "ac",      fields: ["grid_voltage", "output_voltage"] },
  { id: "temps",   fields: ["temp_transformer", "temp_ambient"] },
];

// One bucketed history point: { t: epochMs, [field]: avgValue }
export interface HistoryPoint {
  t: number;
  [field: string]: number;
}

export interface HistoryResponse {
  since: number;
  until: number;
  bucketMs: number;
  fields: string[];
  points: HistoryPoint[];
}

export interface LatestResponse {
  online: boolean;
  ts: number | null;
  state: InverterState | null;
}

// State timeline: one entry per machine/charge change (server-detected flip).
export interface StateTransition {
  t: number;
  machine: string; // machine_state_txt
  charge: string;  // charge_state_txt
}

export interface StatesResponse {
  since: number;
  until: number;
  transitions: StateTransition[];
}

// Per-day energy totals derived from the midnight-reset counters.
export interface DailyRow {
  date: string; // YYYY-MM-DD, server-local
  pv_kwh: number;
  grid_kwh: number;
  load_kwh: number;
}
export interface DailyResponse {
  days: DailyRow[];
}

// App settings — persisted server-side so every device sees the same values.
export interface TariffSettings {
  price_kwh: number; // utility price per kWh, pre-tax
  tax_pct: number;   // tax applied on top, percent
  currency: string;  // display symbol, e.g. "$"
}
export const DEFAULT_TARIFF: TariffSettings = { price_kwh: 4.6, tax_pct: 16, currency: "$" };

// Billing cycle: utility bills land every `period_months`, starting on
// `anchor_day`; `anchor_month` fixes which months periods start in when the
// cycle spans more than one month (e.g. CFE bimonthly from Jan 13).
export interface BillingSettings {
  period_months: number; // 1 = monthly, 2 = bimonthly, …
  anchor_day: number;    // 1-28, day the period starts
  anchor_month: number;  // 1-12, any month a period started in
}
export const DEFAULT_BILLING: BillingSettings = { period_months: 1, anchor_day: 1, anchor_month: 1 };

// Coordinates for sunrise/sunset (night shading on charts). Null = unset.
export interface LocationSettings {
  lat: number;
  lon: number;
}

export interface SettingsResponse {
  tariff: TariffSettings;
  billing: BillingSettings;
  location: LocationSettings | null;
}

// Inverter config setpoints (read-only snapshot from powmr_config_poll.py --save).
export interface ConfigSetpoint {
  key: string; param: number; reg: number; name: string;
  raw: number; value: number; unit: string; ts: number;
}
export interface ConfigChange {
  ts: number; key: string; old: number | null; new: number; source: string;
}
export interface ConfigResponse {
  setpoints: ConfigSetpoint[];
  history: ConfigChange[];
}
