import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { detectLanguage, isLanguage, isTheme, LANGUAGES, translate, type Language, type Params, type Theme } from "./i18n";
import type { MessageKey } from "./messages";

// The language and the theme are kept in this browser until accounts exist (step 18).
const LANGUAGE_KEY = "travel-planner.language";
const THEME_KEY = "travel-planner.theme";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts until the page is closed.
  }
}

type Preferences = {
  language: Language;
  setLanguage: (language: Language) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  t: (key: MessageKey, params?: Params) => string;
};

const PreferencesContext = createContext<Preferences | undefined>(undefined);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = read(LANGUAGE_KEY);
    return isLanguage(saved) ? saved : detectLanguage(navigator.languages ?? []);
  });
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = read(THEME_KEY);
    return isTheme(saved) ? saved : "system";
  });

  useLayoutEffect(() => {
    document.documentElement.lang = LANGUAGES.find((l) => l.id === language)!.htmlLang;
  }, [language]);

  // "system" leaves the attribute off so the stylesheet follows the system setting.
  useLayoutEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    write(LANGUAGE_KEY, next);
  }, []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    write(THEME_KEY, next);
  }, []);
  const t = useCallback((key: MessageKey, params?: Params) => translate(language, key, params), [language]);

  const value = useMemo(() => ({ language, setLanguage, theme, setTheme, t }), [language, setLanguage, theme, setTheme, t]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences needs a PreferencesProvider");
  return value;
}

export const useT = () => usePreferences().t;
