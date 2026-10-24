import { CircleHelp, Languages, Moon, Sun, SunMoon } from "lucide-react";
import { createContext, useContext } from "react";
import { tip } from "./shortcuts";
import { LANGUAGES, isLanguage, type Theme } from "./i18n";
import { usePreferences } from "./preferences";

export const THEMES: { id: Theme; icon: typeof Sun; label: "sidebar.themeSystem" | "sidebar.themeLight" | "sidebar.themeDark" }[] = [
  { id: "system", icon: SunMoon, label: "sidebar.themeSystem" },
  { id: "light", icon: Sun, label: "sidebar.themeLight" },
  { id: "dark", icon: Moon, label: "sidebar.themeDark" },
];

// The narrow strip of the collapsed left column shows each switch as one icon button.
export const CompactSidebarContext = createContext(false);

// The language and theme switches, and the shortcut list, at the bottom of the slim left sidebar.
// On a phone they are in the account sheet instead (AccountMenu).
export function Sidebar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  const compact = useContext(CompactSidebarContext);
  if (compact) {
    // One click moves to the next language or theme.
    const nextLanguage = LANGUAGES[(LANGUAGES.findIndex((l) => l.id === language) + 1) % LANGUAGES.length]!;
    const themeIndex = THEMES.findIndex((x) => x.id === theme);
    const current = THEMES[themeIndex]!;
    const nextTheme = THEMES[(themeIndex + 1) % THEMES.length]!;
    return (
      <nav className="sidebar compact" aria-label={t("sidebar.label")}>
        <button type="button" className="strip-icon" aria-label={t("sidebar.language")} title={`${t("sidebar.language")}: ${LANGUAGES.find((l) => l.id === language)!.label}`} onClick={() => setLanguage(nextLanguage.id)}>
          <Languages size={18} aria-hidden="true" />
        </button>
        <button type="button" className="strip-icon" aria-label={t("sidebar.theme")} title={`${t("sidebar.theme")}: ${t(current.label)}`} onClick={() => setTheme(nextTheme.id)}>
          <current.icon size={18} aria-hidden="true" />
        </button>
        <button type="button" className="strip-icon" aria-label={t("shortcuts.title")} title={tip(t("shortcuts.title"), "help")} onClick={onShowShortcuts}>
          <CircleHelp size={18} aria-hidden="true" />
        </button>
      </nav>
    );
  }
  return (
    <nav className="sidebar" aria-label={t("sidebar.label")}>
      <div className="sidebar-controls">
        <label>
          <span>{t("sidebar.language")}</span>
          <select aria-label={t("sidebar.language")} title={LANGUAGES.find((l) => l.id === language)!.label} value={language} onChange={(e) => isLanguage(e.target.value) && setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id} title={l.label}>
                {l.label}
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
