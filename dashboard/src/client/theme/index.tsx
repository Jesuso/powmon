import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";

// Three user choices; "system" follows the OS via prefers-color-scheme.
export type ThemePref = "light" | "dark" | "system";
export type Resolved = "light" | "dark";
export const THEME_OPTIONS: ThemePref[] = ["light", "dark", "system"];
export const DEFAULT_PREF: ThemePref = "system";
const STORAGE_KEY = "theme";

const darkMql = () => window.matchMedia("(prefers-color-scheme: dark)");

function isPref(v: unknown): v is ThemePref {
  return v === "light" || v === "dark" || v === "system";
}

// ?theme=light deep-link / override (mirrors i18n ?lang=).
function fromQuery(): ThemePref | null {
  try {
    const v = new URLSearchParams(window.location.search).get("theme");
    return isPref(v) ? v : null;
  } catch { return null; }
}

export function readPref(): ThemePref {
  const q = fromQuery();
  if (q) return q;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isPref(v)) return v;
  } catch { /* localStorage unavailable */ }
  return DEFAULT_PREF;
}

// Chart (SVG) colors can't ride CSS vars cleanly, so mirror the palette here.
export const CHART_TOKENS: Record<Resolved, {
  grid: string; axis: string; axisText: string; crosshair: string;
  tooltipBg: string; tooltipText: string; tooltipBorder: string;
  night: string; nightOpacity: number;
}> = {
  dark: {
    grid: "#1f2937", axis: "#374151", axisText: "#9ca3af", crosshair: "#6b7280",
    tooltipBg: "#111827", tooltipText: "#e5e7eb", tooltipBorder: "#374151",
    night: "#000000", nightOpacity: 0.32,
  },
  light: {
    grid: "#e5e7eb", axis: "#cbd5e1", axisText: "#475569", crosshair: "#94a3b8",
    tooltipBg: "#ffffff", tooltipText: "#0f172a", tooltipBorder: "#cbd5e1",
    night: "#64748b", nightOpacity: 0.1,
  },
};

interface ThemeCtx { pref: ThemePref; resolved: Resolved; setPref: (p: ThemePref) => void; }
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [sysDark, setSysDark] = useState<boolean>(() => darkMql().matches);

  // Track OS theme; only matters while pref === "system".
  useEffect(() => {
    const m = darkMql();
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  const resolved: Resolved = pref === "system" ? (sysDark ? "dark" : "light") : pref;

  // Drive the CSS variable swap (see styles.css [data-theme]).
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    try { localStorage.setItem(STORAGE_KEY, p); } catch { /* ignore */ }
  };

  // Persist a ?theme= override so it sticks across navigations (parity with i18n).
  useEffect(() => {
    const q = fromQuery();
    if (q) { try { localStorage.setItem(STORAGE_KEY, q); } catch { /* ignore */ } }
  }, []);

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
