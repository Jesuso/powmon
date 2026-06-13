import { useTranslation } from "react-i18next";
import { THEME_OPTIONS, useTheme, type ThemePref } from "../theme/index.tsx";

const ICONS: Record<ThemePref, string> = { light: "☀", dark: "☾", system: "◐" };

// Segmented icon toggle: ☀ light | ☾ dark | ◐ system. Swaps CSS vars live — no reload.
export function ThemeSwitch() {
  const { t } = useTranslation();
  const { pref, setPref } = useTheme();
  return (
    <div className="theme" role="group" aria-label={t("theme.aria")}>
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt}
          className={opt === pref ? "on" : ""}
          aria-pressed={opt === pref}
          aria-label={t(`theme.${opt}`)}
          title={t(`theme.${opt}`)}
          onClick={() => setPref(opt)}
        >
          {ICONS[opt]}
        </button>
      ))}
    </div>
  );
}
