import { CircleHelp, Moon, Sun, SunMoon } from "lucide-react";
import { tip } from "./shortcuts";
import { LANGUAGES, isLanguage, type Theme } from "./i18n";
import { usePreferences } from "./preferences";

export const THEMES: { id: Theme; icon: typeof Sun; label: "sidebar.themeSystem" | "sidebar.themeLight" | "sidebar.themeDark" }[] = [
  { id: "system", icon: SunMoon, label: "sidebar.themeSystem" },
  { id: "light", icon: Sun, label: "sidebar.themeLight" },
  { id: "dark", icon: Moon, label: "sidebar.themeDark" },
];

// The language and theme switches, and the shortcut list, at the bottom of the slim left sidebar.
// On a phone they are in the account sheet instead (AccountMenu).
export function Sidebar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  return (
    <nav className="sidebar" aria-label={t("sidebar.label")}>
      <div className="sidebar-controls">
        <label>
          <span>{t("sidebar.language")}</span>
          <select aria-label={t("sidebar.language")} title={LANGUAGES.find((l) => l.id === language)!.label} value={language} onChange={(e) => isLanguage(e.target.value) && setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id} title={l.label}>
                {l.short}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label={t("sidebar.theme")} className="theme-switch">
          {THEMES.map(({ id, icon: Icon, label }) => (
            <button key={id} type="button" aria-pressed={theme === id} aria-label={t(label)} title={t(label)} onClick={() => setTheme(id)}>
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        <button type="button" className="btn sidebar-shortcuts" aria-label={t("shortcuts.title")} title={tip(t("shortcuts.title"), "help")} onClick={onShowShortcuts}>
          <CircleHelp size={16} aria-hidden="true" />
          <span>{t("shortcuts.title")}</span>
        </button>
      </div>
    </nav>
  );
}
