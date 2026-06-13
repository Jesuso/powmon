import { useTranslation } from "react-i18next";
import { SUPPORTED, currentLang } from "../i18n/index.ts";

// Language dropdown. Scales to any number of locales — adding a language is
// one JSON file + one SUPPORTED entry. changeLanguage re-renders, no reload.
export function LangSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <select
      className="langsel"
      value={currentLang()}
      aria-label={t("lang.aria")}
      title={t("lang.aria")}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
    >
      {SUPPORTED.map((lng) => (
        <option key={lng} value={lng}>{t(`lang.${lng}`)}</option>
      ))}
    </select>
  );
}
