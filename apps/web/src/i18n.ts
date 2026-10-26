import { en, zh, type MessageKey } from "./messages";

export type Language = "en" | "zh";
export const LANGUAGES: { id: Language; label: string; htmlLang: string }[] = [
  { id: "en", label: "English", htmlLang: "en" },
  { id: "zh", label: "繁體中文", htmlLang: "zh-Hant" },
];

const dictionaries: Record<Language, Record<string, string>> = { en, zh };

export type Params = Record<string, string | number>;

// The text for `key` with `{name}` placeholders filled in. With a `count`, `key_one` is used for 1
// and `key_other` otherwise (falling back to `key_other` when a language has only one form).
export function translate(language: Language, key: MessageKey | (string & {}), params: Params = {}): string {
  const dictionary = dictionaries[language];
  const plural = typeof params.count === "number" ? (params.count === 1 ? `${key}_one` : `${key}_other`) : undefined;
  const template = (plural && (dictionary[plural] ?? dictionary[`${key}_other`])) ?? dictionary[key] ?? (en as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

// The language for a first visit: Traditional Chinese for a browser set to it, else English.
export function detectLanguage(browserLanguages: readonly string[]): Language {
  return browserLanguages.some((l) => /^zh/i.test(l)) ? "zh" : "en";
}

export type Theme = "system" | "light" | "dark";

export const isLanguage = (value: unknown): value is Language => value === "en" || value === "zh";
export const isTheme = (value: unknown): value is Theme => value === "system" || value === "light" || value === "dark";
