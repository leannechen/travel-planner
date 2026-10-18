import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  title: string;
  confirmLabel: string;
  // Danger (red) for deleting, primary (blue) for a move that is not a loss of the Event itself.
  tone?: "danger" | "primary";
  // Shows a "Do not remind me again" checkbox; its state is passed to onConfirm.
  reminderOption?: boolean;
  children: ReactNode;
  onConfirm: (skipReminder: boolean) => void;
  onCancel: () => void;
};

// A modal confirmation. Cancel is focused first, so Enter never confirms by accident; Escape cancels.
export function ConfirmDialog({ title, confirmLabel, tone = "danger", reminderOption, children, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [skip, setSkip] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="confirm-title">{title}</h2>
      {children}
      {reminderOption && (
        <label className="dialog-reminder">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          Do not remind me again
        </label>
      )}
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={tone === "danger" ? "danger" : "primary"} onClick={() => onConfirm(skip)}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
