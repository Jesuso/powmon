import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import es from "./locales/es.json";

// Add a language: drop a <code>.json under ./locales, import it, register below.
export const SUPPORTED = ["en", "es"] as const;
export type Lang = (typeof SUPPORTED)[number];

// English is the source/fallback: any key missing in another language falls back here.
export const FALLBACK: Lang = "en";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: FALLBACK,
    supportedLngs: SUPPORTED,
    nonExplicitSupportedLngs: true, // es-MX, es-ES -> es
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      caches: ["localStorage"],
      lookupQuerystring: "lang", // ?lang=es deep-links / overrides
      lookupLocalStorage: "lang",
    },
    react: { useSuspense: false }, // resources are bundled & sync, no Suspense needed
  });

// Current UI language normalized to a supported code (es-MX -> es).
export function currentLang(): Lang {
  const base = (i18n.resolvedLanguage ?? i18n.language ?? FALLBACK).split("-")[0];
  return (SUPPORTED as readonly string[]).includes(base) ? (base as Lang) : FALLBACK;
}

// BCP-47 locale for Intl/Date formatting, tracking the active language.
export function dateLocale(): string {
  return currentLang() === "es" ? "es-MX" : "en-US";
}

export default i18n;
