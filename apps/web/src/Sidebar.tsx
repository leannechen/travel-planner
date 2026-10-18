import { CircleHelp, Menu, Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tip } from "./shortcuts";
import { LANGUAGES, isLanguage, type Theme } from "./i18n";
import { usePreferences } from "./preferences";

const THEMES: { id: Theme; icon: typeof Sun; label: "sidebar.themeSystem" | "sidebar.themeLight" | "sidebar.themeDark" }[] = [
  { id: "system", icon: SunMoon, label: "sidebar.themeSystem" },
  { id: "light", icon: Sun, label: "sidebar.themeLight" },
  { id: "dark", icon: Moon, label: "sidebar.themeDark" },
];

// The language and theme switches, and the shortcut list. On desktop they sit at the bottom of a
// slim left sidebar; on a phone they are behind a "..." button (design spec §5, §8).
export function Sidebar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLElement>(null);

  // The phone menu closes on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    // Captured first, and marked handled, so the page's own Escape (clear the selection) stays out.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <nav ref={menu} className={open ? "sidebar open" : "sidebar"} aria-label={t("sidebar.label")}>
      <button type="button" className="sidebar-more" aria-expanded={open} aria-label={t("sidebar.more")} title={t("sidebar.more")} onClick={() => setOpen(!open)}>
        <Menu size={18} aria-hidden="true" />
      </button>
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
        <button type="button" className="sidebar-shortcuts" aria-label={t("shortcuts.title")} title={tip(t("shortcuts.title"), "help")} onClick={() => { setOpen(false); onShowShortcuts(); }}>
          <CircleHelp size={16} aria-hidden="true" />
          <span>{t("shortcuts.title")}</span>
        </button>
      </div>
    </nav>
  );
}
