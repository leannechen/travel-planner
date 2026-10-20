import { Map as MapIcon } from "lucide-react";
import { useState } from "react";
import { PreferenceSwitches } from "./AccountMenu";
import { useAuth } from "./AuthProvider";
import { usePreferences } from "./preferences";
import { Toast } from "./Toast";

// Where Log out ends up (design 39), until the full Landing page with the sample Trip comes in
// step 22: the name, the language and theme switches, Log in, and a way to start planning as a guest.
export function Landing({ onStart }: { onStart: () => void }) {
  const { t } = usePreferences();
  const auth = useAuth();
  const [toast, setToast] = useState(true);
  return (
    <main className="landing">
      <header>
        <span className="logo" aria-hidden="true">
          <MapIcon size={18} />
        </span>
        <strong>{t("app.title")}</strong>
        <span className="spacer" />
        <div className="landing-switches">
          <PreferenceSwitches />
        </div>
        <button type="button" className="link" onClick={() => void auth.login("/")}>
          {t("account.login")}
        </button>
      </header>
      <section className="landing-hero">
        <h1>
          {t("landing.headline1")}
          <br />
          <span>{t("landing.headline2")}</span>
        </h1>
        <p>{t("landing.lead")}</p>
        <button type="button" className="btn pri lg" onClick={onStart}>
          <MapIcon size={16} aria-hidden="true" />
          {t("landing.start")}
        </button>
        <small>{t("landing.note")}</small>
      </section>
      {toast && <Toast message={t("auth.loggedOut")} onDismiss={() => setToast(false)} />}
    </main>
  );
}
