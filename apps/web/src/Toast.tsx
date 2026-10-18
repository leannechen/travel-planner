import { useEffect } from "react";

type Props = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
};

const TOAST_MS = 8000;

// A short message at the bottom of the screen with an optional action (Undo). It goes away by
// itself; a new message (new key) starts the time again.
export function Toast({ message, actionLabel, onAction, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
