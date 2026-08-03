// JRoute ships a single locale (English). The upstream `config/i18n.json`
// catalogue of 43 locales was removed with the rest of the OmniRoute tree, and
// `src/i18n/messages/` contains only `en.json`, so the locale set is declared
// inline here rather than read from a config file that no longer exists.

export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Display metadata for every locale, kept in the same shape the codebase has
 * historically consumed (`code`, `label`, `name`, `flag`), plus `native` and
 * `english` aliases for call sites that want a stable field name regardless of
 * the underlying display string.
 */
export const LANGUAGES: readonly {
  code: Locale;
  label: string;
  name: string;
  native: string;
  english: string;
  flag: string;
}[] = [
  {
    code: "en",
    label: "EN",
    name: "English",
    native: "English",
    english: "English",
    flag: "🇺🇸",
  },
];

export const RTL_LOCALES: readonly Locale[] = [];

export const LOCALE_COOKIE = "NEXT_LOCALE";
