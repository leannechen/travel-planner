import { Bookmark, Clock, Flag, Footprints, Info, LoaderCircle, Map as MapIcon, Route, Sparkles, Users, Utensils } from "lucide-react";
import type { Trip } from "@travel-planner/shared";
import { useEffect, useState, type ReactNode } from "react";
import { AccountMenu, PreferenceSwitches } from "./AccountMenu";
import { listTrips, openSampleTrip } from "./api";
import { useAuth } from "./AuthProvider";
import { chooseTrip, readRememberedTripId } from "./currentTrip";
import { peekGuestId } from "./guest";
import { usePreferences } from "./preferences";
import { Toast } from "./Toast";

// Which call to action the page offers (design 16, 16b, 16c, 16d). The page is the same otherwise.
type Variant = "new" | "guest" | "account" | "account-empty";

// The Landing page. A visitor with no Trip opens the sample Trip, which makes an editable copy
// without logging in; anyone with a Trip (a guest's in this browser, or an account's) can continue
// with the one opened last. Opening the sample again opens the copy they already have.
export function Landing({ loggedOut, onOpenTrip }: { loggedOut: boolean; onOpenTrip: (tripId: string) => void }) {
  const { t } = usePreferences();
  const auth = useAuth();
  const [toastDismissed, setToastDismissed] = useState(false);
  // After logging in from this page, the guest's Trips were added to the account.
  const merged = auth.arrival?.merged ?? 0;
  const toast = toastDismissed ? undefined : loggedOut ? t("auth.loggedOut") : merged > 0 ? t("auth.merged", { count: merged }) : undefined;
  // The user's Trips, or undefined while they are not known yet.
  const [trips, setTrips] = useState<Pick<Trip, "id">[] | undefined>();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (auth.status === "loading") return;
    // A guest who never opened a Trip has no session on the server: nothing to ask for.
    const mayHaveTrips = auth.status === "user" || (auth.status === "guest" && peekGuestId() !== undefined);
    if (!mayHaveTrips) {
      setTrips([]);
      return;
    }
    let current = true;
    listTrips().then(
      (found) => current && setTrips(found),
      // Not knowing the Trips is the same as having none: the sample still opens.
      () => current && setTrips([]),
    );
    return () => {
      current = false;
    };
  }, [auth.status]);

  const continueTo = trips && chooseTrip(trips, readRememberedTripId());
  const loggedIn = auth.status === "user";
  const variant: Variant = continueTo ? (loggedIn ? "account" : "guest") : loggedIn ? "account-empty" : "new";
  const known = trips !== undefined && auth.status !== "loading";

  async function openSample() {
    // The session ended while away: the server would refuse; log in again first.
    if (auth.status === "expired") {
      void auth.login("/");
      return;
    }
    setOpening(true);
    setFailed(false);
    try {
      onOpenTrip((await openSampleTrip()).tripId);
    } catch {
      setOpening(false);
      setFailed(true);
    }
  }

  const sampleButton = (
    <button type="button" className="btn pri home-cta" disabled={opening} onClick={() => void openSample()}>
      {opening ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <MapIcon size={18} aria-hidden="true" />}
      {opening ? t("landing.opening") : t("landing.sample")}
    </button>
  );

  const actions: Record<Variant, ReactNode> = {
    new: (
      <div className="home-actions">
        {sampleButton}
        <small>{t("landing.note.new")}</small>
      </div>
    ),
    "account-empty": (
      <div className="home-actions">
        {sampleButton}
        <small>{t("landing.note.account")}</small>
      </div>
    ),
    guest: (
      <>
        <div className="home-actions">
          <ContinueButton onClick={() => onOpenTrip(continueTo!.id)} />
          <SampleLink busy={opening} onClick={() => void openSample()} />
        </div>
        <p className="home-note">
          <Info size={15} aria-hidden="true" />
          {t("landing.note.guest")}
        </p>
      </>
    ),
    account: (
      <div className="home-actions">
        <ContinueButton onClick={() => onOpenTrip(continueTo!.id)} />
        <SampleLink busy={opening} onClick={() => void openSample()} />
      </div>
    ),
  };

  const badge = { new: "landing.badge.new", guest: "landing.badge.back", account: "landing.badge.back", "account-empty": "landing.badge.sample" } as const;

  return (
    <main className="home">
      <header className="home-header">
        <span className="logo" aria-hidden="true">
          <MapIcon size={19} />
        </span>
        <strong>{t("app.title")}</strong>
        <span className="spacer" />
        <div className="landing-switches">
          <PreferenceSwitches />
        </div>
        {auth.status === "user" ? (
          <AccountMenu />
        ) : auth.status === "loading" ? (
          <span className="account-spot loading" role="status" aria-label={t("account.loading")} aria-busy="true" />
        ) : (
          <button type="button" className="btn tonal" onClick={() => void auth.login("/")}>
            {t("account.login")}
          </button>
        )}
      </header>

      <section className="home-hero" aria-busy={!known}>
        <div className="home-copy">
          {known && (
            <span className="home-badge">
              <Sparkles size={14} aria-hidden="true" />
              {t(badge[variant])}
            </span>
          )}
          <h1>
            {t("landing.headline1")}
            <br />
            <span>{t("landing.headline2")}</span>
          </h1>
          <p className="home-lead">{t("landing.lead")}</p>
          <p className="home-lead short">{t("landing.leadShort")}</p>
          {known ? (
            actions[variant]
          ) : (
            // Until the session and the Trips are known, which action to offer is not either: a disabled button holds the place.
            <div className="home-actions">
              <button type="button" className="btn pri home-cta" disabled aria-busy="true">
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
                {t("landing.loading")}
              </button>
            </div>
          )}
          {failed && (
            <p className="home-error" role="alert">
              {t("landing.error")}
            </p>
          )}
        </div>

        <div className="home-photos" aria-hidden="true">
          <img className="p1" src="/landing/venice.jpg" alt="" />
          <img className="p2" src="/landing/landing-top-right.jpg" alt="" />
          <img className="p3" src="/landing/swiss-lake.jpg" alt="" />
          <div className="home-cards">
            <div className="home-card attraction">
              <span>
                <Flag size={14} />
                {t("landing.card.gondola")}
              </span>
              <small>17:00 – 17:40</small>
            </div>
            <span className="home-leg">
              <Footprints size={13} />
              {t("landing.card.walk")}
            </span>
            <div className="home-card meal">
              <span>
                <Utensils size={14} />
                {t("landing.card.dinner")}
              </span>
              <small>19:00 – 20:30</small>
            </div>
          </div>
        </div>
      </section>

      <section className="home-features">
        <Feature tone="a" icon={<Clock size={20} />} title={t("landing.feature.axis")} text={t("landing.feature.axisText")} />
        <Feature tone="t" icon={<Route size={20} />} title={t("landing.feature.legs")} text={t("landing.feature.legsText")} />
        <Feature tone="m" icon={<Bookmark size={20} />} title={t("landing.feature.backlog")} text={t("landing.feature.backlogText")} />
        <Feature tone="l" icon={<Users size={20} />} title={t("landing.feature.together")} text={t("landing.feature.togetherText")} />
      </section>
      {toast && <Toast message={toast} onDismiss={() => setToastDismissed(true)} />}
    </main>
  );
}

function ContinueButton({ onClick }: { onClick: () => void }) {
  const { t } = usePreferences();
  return (
    <button type="button" className="btn pri home-cta" onClick={onClick}>
      <MapIcon size={18} aria-hidden="true" />
      {t("landing.continue")}
    </button>
  );
}

function SampleLink({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const { t } = usePreferences();
  return (
    <button type="button" className="link" disabled={busy} onClick={onClick}>
      {busy ? t("landing.opening") : t("landing.sample")}
    </button>
  );
}

function Feature({ tone, icon, title, text }: { tone: "a" | "t" | "m" | "l"; icon: ReactNode; title: string; text: string }) {
  return (
    <div className="home-feature">
      <span className={`home-feature-icon ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <b>{title}</b>
      <span>{text}</span>
    </div>
  );
}
