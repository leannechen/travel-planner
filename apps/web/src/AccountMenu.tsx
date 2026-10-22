import { ChevronRight, LogIn, LogOut, Map as MapIcon, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { LANGUAGES } from "./i18n";
import { useIsPhone } from "./phone";
import { usePreferences } from "./preferences";
import { THEMES } from "./Sidebar";

// Language and theme as two rows of buttons, for the phone account sheet and the Landing page.
export function PreferenceSwitches() {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  return (
    <>
      <div className="pref-row">
        <span>{t("account.language")}</span>
        <div className="seg" role="group" aria-label={t("account.language")}>
          {LANGUAGES.map((l) => (
            <button key={l.id} type="button" aria-pressed={language === l.id} title={l.label} onClick={() => setLanguage(l.id)}>
              {l.short}
            </button>
          ))}
        </div>
      </div>
      <div className="pref-row">
        <span>{t("account.theme")}</span>
        <div className="seg" role="group" aria-label={t("account.theme")}>
          {THEMES.map(({ id, icon: Icon, label }) => (
            <button key={id} type="button" aria-pressed={theme === id} aria-label={t(label)} title={t(label)} onClick={() => setTheme(id)}>
              <Icon size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// The first letter of the email, as the avatar (Auth0 gives an email, not necessarily a picture).
const initialOf = (email: string | undefined) => (email?.trim()[0] ?? "?").toUpperCase();

type Props = {
  // Opens the list of Trips ("My Trips", desktop menu only). Without it the menu has no such row
  // (the Landing page, which has no list to open).
  onOpenTripList?: () => void;
  // Logs in again after the session expired (popup first, see the page).
  onRelogin?: () => void;
};

// The account spot at the top right. While the app starts it is a neutral circle, never "Log in"
// first. A guest sees a Log in button (a person icon and a sheet on phone), a user an avatar with a
// menu (a sheet on phone), and an expired session the plain Log in button.
export function AccountMenu({ onOpenTripList, onRelogin }: Props) {
  const { t } = usePreferences();
  const auth = useAuth();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // The menu closes on Escape or a click outside it. Escape is taken first, so the page's own
  // Escape (clear the selection) stays out.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!phone && !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, phone]);

  if (auth.status === "loading") {
    return <span className="account-spot loading" role="status" aria-label={t("account.loading")} aria-busy="true" />;
  }

  if (auth.status === "expired") {
    return (
      <button type="button" className={phone ? "btn pri account-login icon" : "btn pri account-login"} aria-label={t("account.login")} onClick={onRelogin}>
        <LogIn size={16} aria-hidden="true" />
        {!phone && t("account.login")}
      </button>
    );
  }

  if (auth.status === "guest" && !phone) {
    return (
      <button type="button" className="btn pri account-login" title={t("account.loginToSaveTip")} onClick={() => void auth.login()}>
        {t("account.loginToSave")}
      </button>
    );
  }

  const guest = auth.status === "guest";
  return (
    <div className="account" ref={root}>
      <button
        type="button"
        className="avatar"
        aria-label={t("account.label")}
        aria-haspopup={phone ? "dialog" : "menu"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {guest ? <User size={17} aria-hidden="true" /> : initialOf(auth.email)}
      </button>
      {open && !phone && (
        <div className="account-menu" role="menu">
          <p className="account-email">
            <span className="avatar small" aria-hidden="true">
              {initialOf(auth.email)}
            </span>
            {auth.email}
          </p>
          {onOpenTripList && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenTripList();
              }}
            >
              <MapIcon size={15} aria-hidden="true" />
              {t("account.myTrips")}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => void auth.logout()}>
            <LogOut size={15} aria-hidden="true" />
            {t("account.logout")}
          </button>
        </div>
      )}
      {open && phone && (
        <>
          <div className="sheet-scrim" onClick={() => setOpen(false)} />
          <aside className="account-sheet" role="dialog" aria-label={t("account.label")}>
            <div className="sheet-handle" aria-hidden="true" />
            <button type="button" className="icon-btn sheet-close" aria-label={t("generic.close")} onClick={() => setOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
            {guest ? (
              <>
                <header className="account-head">
                  <span className="avatar" aria-hidden="true">
                    <User size={17} />
                  </span>
                  <div>
                    <strong>{t("account.guest")}</strong>
                    <small>{t("account.guestNote")}</small>
                  </div>
                </header>
                <button type="button" className="btn pri lg" onClick={() => void auth.login()}>
                  <LogIn size={16} aria-hidden="true" />
                  {t("account.loginToSave")}
                </button>
                <p className="account-warning">{t("account.guestWarning")}</p>
              </>
            ) : (
              <header className="account-head">
                <span className="avatar" aria-hidden="true">
                  {initialOf(auth.email)}
                </span>
                <div>
                  <strong>{auth.email}</strong>
                  <small>{t("account.loggedIn")}</small>
                </div>
              </header>
            )}
            <PreferenceSwitches />
            {!guest && (
              <button type="button" className="account-logout" onClick={() => void auth.logout()}>
                <LogOut size={17} aria-hidden="true" />
                {t("account.logout")}
              </button>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

// Phone, guest: the slim banner under the top bar that leads to login.
export function GuestBanner() {
  const { t } = usePreferences();
  const auth = useAuth();
  if (auth.status !== "guest") return null;
  return (
    <button type="button" className="guest-banner" onClick={() => void auth.login()}>
      <User size={15} aria-hidden="true" />
      <span>{t("account.loginToSave")}</span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
  );
}

// The session ended: a banner that stays until the user logs in (it cannot be dismissed, as the
// Trip stays read-only meanwhile).
export function ExpiredBanner({ onRelogin }: { onRelogin: () => void }) {
  const { t } = usePreferences();
  const auth = useAuth();
  if (auth.status !== "expired") return null;
  return (
    <div className="session-banner" role="alert">
      <span>
        <strong>{t("auth.expiredTitle")}</strong> {t("auth.expiredHint")}
      </span>
      <button type="button" className="btn sm" onClick={onRelogin}>
        {t("account.login")}
      </button>
    </div>
  );
}

// Shown only when Auth0 sent the user back with an error; the page is as the user left it.
export function LoginErrorStrip() {
  const { t } = usePreferences();
  const auth = useAuth();
  if (!auth.loginError) return null;
  return (
    <div className="login-error" role="alert">
      <span>{t("auth.loginFailed")}</span>
      <button type="button" className="icon-btn" aria-label={t("generic.close")} onClick={auth.dismissLoginError}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
