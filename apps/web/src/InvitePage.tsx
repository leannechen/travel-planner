import type { InvitationPreview } from "@travel-planner/shared";
import { Check, LogIn, Mail, Map as MapIcon, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { LoginErrorStrip, PreferenceSwitches } from "./AccountMenu";
import { acceptInvitation, getInvitationPreview, resendVerification } from "./api";
import { useAuth } from "./AuthProvider";
import { usePreferences } from "./preferences";

type Props = {
  token: string;
  // The invitation was accepted: show the Trip.
  onJoined: (trip: { tripId: string; tripTitle: string }) => void;
  // Leave the invitation for the user's own Trips.
  onLeave: () => void;
};

type Outcome = "checking" | "wrong_account" | "email_not_verified" | "invitation_not_found" | "error";

// The page behind an invitation link (design 41 and 48): who invited whom to what, then login or
// sign-up with the invited address, then the Trip. The invitation is accepted by the server only
// for an account whose verified email is the invited one (PRD §8).
export function InvitePage({ token, onJoined, onLeave }: Props) {
  const { t } = usePreferences();
  const auth = useAuth();
  const [preview, setPreview] = useState<InvitationPreview | "gone" | "error" | undefined>();
  const [outcome, setOutcome] = useState<Outcome>("checking");
  // Counts tries, so "I've verified" asks the server again.
  const [attempt, setAttempt] = useState(0);
  const [retried, setRetried] = useState(false);
  const [resend, setResend] = useState<"idle" | "sent" | "failed">("idle");

  useEffect(() => {
    getInvitationPreview(token).then(
      (found) => setPreview(found ?? "gone"),
      () => setPreview("error"),
    );
  }, [token]);

  const loggedIn = auth.status === "user";
  useEffect(() => {
    if (!loggedIn) return;
    let current = true;
    setOutcome("checking");
    acceptInvitation(token).then(
      (result) => {
        if (!current) return;
        if (result.ok) onJoined(result.trip);
        else setOutcome(result.reason);
      },
      () => current && setOutcome("error"),
    );
    return () => {
      current = false;
    };
  }, [loggedIn, token, attempt]);

  const returnTo = `/?invite=${encodeURIComponent(token)}`;

  async function verified() {
    setRetried(true);
    setResend("idle");
    try {
      await auth.refreshToken();
    } catch {
      // The attempt below says what is wrong.
    }
    setAttempt((n) => n + 1);
  }

  async function sendAgain() {
    setResend("idle");
    try {
      await resendVerification();
      setResend("sent");
    } catch {
      setResend("failed");
    }
  }

  function body() {
    if (preview === undefined || auth.status === "loading") return <p>{t("invite.loading")}</p>;
    if (preview === "error") return <p role="alert">{t("invite.error")}</p>;
    if (preview === "gone" || outcome === "invitation_not_found") {
      return (
        <>
          <h1>{t("invite.invalidTitle")}</h1>
          <p>{t("invite.invalidBody")}</p>
          <button type="button" className="btn" onClick={onLeave}>
            {t("invite.goTrips")}
          </button>
        </>
      );
    }
    const inviter = preview.inviterEmail ?? t("invite.someone");
    if (!loggedIn) {
      return (
        <>
          <span className="invite-badge">
            <Mail size={12} aria-hidden="true" />
            {t("invite.badge")}
          </span>
          <h1>
            {t("invite.headline", { inviter })}
            <br />
            <span>{preview.tripTitle}</span>
          </h1>
          <p>
            {t("invite.sentToPrefix")}
            <strong>{preview.invitedEmail}</strong>
            {t("invite.sentToSuffix")}
          </p>
          <div className="invite-actions">
            <button type="button" className="btn pri lg" onClick={() => void auth.login(returnTo, {})}>
              <LogIn size={16} aria-hidden="true" />
              {t("invite.login")}
            </button>
            <button type="button" className="btn lg" onClick={() => void auth.login(returnTo, { screenHint: "signup" })}>
              {t("invite.signup")}
            </button>
          </div>
        </>
      );
    }
    if (outcome === "wrong_account") {
      return (
        <>
          <span className="invite-badge">
            <Mail size={12} aria-hidden="true" />
            {t("invite.badge")}
          </span>
          <h1>{t("invite.wrongTitle")}</h1>
          <p>{t("invite.wrongBody", { inviter, email: preview.invitedEmail, trip: preview.tripTitle })}</p>
          <div className="invite-account">
            <small>{t("invite.loggedInAs")}</small>
            <strong>{auth.email}</strong>
          </div>
          <div className="invite-actions">
            <button type="button" className="btn pri lg" onClick={() => void auth.login(returnTo, { prompt: "login" })}>
              <Repeat size={16} aria-hidden="true" />
              {t("invite.loginAs", { email: preview.invitedEmail })}
            </button>
            <button type="button" className="btn lg" onClick={onLeave}>
              {t("invite.goTrips")}
            </button>
          </div>
          <small>{t("invite.loginAsNote", { email: preview.invitedEmail })}</small>
        </>
      );
    }
    if (outcome === "email_not_verified") {
      return (
        <>
          <span className="invite-badge">
            <Mail size={12} aria-hidden="true" />
            {t("invite.badge")}
          </span>
          <h1>{t("invite.verifyTitle")}</h1>
          <p>{t("invite.verifyBody", { email: preview.invitedEmail, trip: preview.tripTitle })}</p>
          <div className="invite-actions">
            <button type="button" className="btn pri lg" onClick={() => void verified()}>
              <Check size={16} aria-hidden="true" />
              {t("invite.verified")}
            </button>
            <button type="button" className="btn lg" onClick={() => void sendAgain()}>
              <Mail size={16} aria-hidden="true" />
              {t("invite.resend")}
            </button>
          </div>
          {retried && <p role="status">{t("invite.notVerifiedYet")}</p>}
          {resend === "sent" && <p role="status">{t("invite.resent", { email: preview.invitedEmail })}</p>}
          {resend === "failed" && <p role="alert">{t("invite.resendFailed")}</p>}
        </>
      );
    }
    if (outcome === "error") return <p role="alert">{t("invite.error")}</p>;
    return <p>{t("invite.loading")}</p>;
  }

  return (
    <main className="landing invite-page">
      <header>
        <span className="logo" aria-hidden="true">
          <MapIcon size={18} />
        </span>
        <strong>{t("app.title")}</strong>
        <span className="spacer" />
        <div className="landing-switches">
          <PreferenceSwitches />
        </div>
      </header>
      <LoginErrorStrip />
      <section className="landing-hero">{body()}</section>
    </main>
  );
}
