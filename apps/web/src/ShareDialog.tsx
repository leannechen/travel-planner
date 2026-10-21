import { emailSchema, type Sharing } from "@travel-planner/shared";
import { Link as LinkIcon, Mail, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, getSharing, inviteEditor, removeEditor, revokeInvitation } from "./api";
import { useT } from "./preferences";

type Props = {
  tripId: string;
  tripTitle: string;
  // The Owner's own address, for their row in the list.
  ownerEmail: string | undefined;
  onClose: () => void;
};

const inviteLink = (token: string) => `${window.location.origin}/?invite=${encodeURIComponent(token)}`;

// Share (design 19): the Owner invites Editors by email and sees who can edit. The link-sharing
// switch for Viewers comes with step 19. Changes are saved at once; there is no Save button.
export function ShareDialog({ tripId, tripTitle, ownerEmail, onClose }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [sharing, setSharing] = useState<Sharing | undefined>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | undefined>();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    getSharing(tripId).then(setSharing, () => setLoadFailed(true));
  }, [tripId]);

  // True when the change was made.
  async function change(action: () => Promise<unknown>, failure?: (err: Error) => string | undefined) {
    setError(undefined);
    try {
      await action();
    } catch (err) {
      const known = err instanceof Error ? failure?.(err) : undefined;
      setError(known ?? (err instanceof Error ? err.message : t("generic.error")));
      return false;
    }
    try {
      setSharing(await getSharing(tripId));
    } catch {
      setLoadFailed(true);
    }
    return true;
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (busy || email.trim() === "") return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(t("share.invalidEmail"));
      return;
    }
    setBusy(true);
    const done = await change(
      () => inviteEditor(tripId, parsed.data),
      (err) => (err instanceof ApiError ? { own_address: t("share.ownAddress"), already_editor: t("share.alreadyEditor") }[err.code ?? ""] : undefined),
    );
    setBusy(false);
    if (done) setEmail((current) => (current === email ? "" : current));
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(token);
    } catch {
      // Without clipboard access the link can still be read from the invitation email.
    }
  }

  return (
    <dialog ref={dialog} className="confirm-dialog settings-dialog share-dialog" aria-labelledby="share-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
      <div className="settings-head">
        <h2 id="share-title">{t("share.title")}</h2>
        <button type="button" className="ib" aria-label={t("generic.close")} title={t("generic.closeEsc")} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="settings-trip">{tripTitle}</p>
      <div className="settings-field">
        <label htmlFor="share-email">{t("share.editors")}</label>
        <form className="share-invite" noValidate onSubmit={(e) => void invite(e)}>
          <span className="share-email">
            <Mail size={15} aria-hidden="true" />
            <input id="share-email" type="email" autoFocus autoComplete="off" placeholder={t("share.invitePlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
          </span>
          <button type="submit" className="btn" disabled={busy || email.trim() === ""}>
            {t("share.invite")}
          </button>
        </form>
        <p className="hint">{t("share.hint")}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      {loadFailed && <p role="alert">{t("share.loadError")}</p>}
      <ul className="share-people">
        <li>
          <span className="avatar-dot" aria-hidden="true">{(ownerEmail ?? "?").charAt(0).toUpperCase()}</span>
          <span className="share-who">{ownerEmail ?? ""}</span>
          <span className="share-role">{t("share.owner")}</span>
        </li>
        {sharing?.editors.map((editor) => (
          <li key={editor.userId}>
            <span className="avatar-dot" aria-hidden="true">{(editor.email ?? "?").charAt(0).toUpperCase()}</span>
            <span className="share-who">{editor.email}</span>
            <span className="share-role">{t("share.editor")}</span>
            <button type="button" className="ib" aria-label={t("share.remove", { email: editor.email ?? "" })} title={t("share.remove", { email: editor.email ?? "" })} onClick={() => void change(() => removeEditor(tripId, editor.userId))}>
              <X size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
        {sharing?.invitations.map((invitation) => (
          <li key={invitation.id} className="pending">
            <span className="avatar-dot" aria-hidden="true"><Mail size={13} /></span>
            <span className="share-who">{invitation.email}</span>
            <span className="share-role">{t("share.pending")}</span>
            <button type="button" className="ib" aria-label={t("share.copyLink")} title={copied === invitation.token ? t("share.copied") : t("share.copyLink")} onClick={() => void copy(invitation.token)}>
              <LinkIcon size={15} aria-hidden="true" />
            </button>
            <button type="button" className="ib" aria-label={t("share.withdraw", { email: invitation.email })} title={t("share.withdraw", { email: invitation.email })} onClick={() => void change(() => revokeInvitation(tripId, invitation.id))}>
              <X size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {copied && <p role="status" className="hint">{t("share.copied")}</p>}
    </dialog>
  );
}
