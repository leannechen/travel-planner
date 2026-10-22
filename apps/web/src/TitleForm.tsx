import { useState, type FormEvent } from "react";
import { useT } from "./preferences";

type Props = {
  label: string;
  submitLabel: string;
  onSubmit: (title: string) => Promise<void>;
  disabled?: boolean;
  // Starts with this text, and keeps it after submitting (a rename).
  initial?: string;
};

export function TitleForm({ label, submitLabel, onSubmit, disabled = false, initial = "" }: Props) {
  const t = useT();
  const [title, setTitle] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || pending || disabled) return;

    setPending(true);
    setError(undefined);
    try {
      await onSubmit(trimmed);
      if (initial === "") setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("generic.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input autoFocus={initial !== ""} aria-label={label} placeholder={label} value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" disabled={pending || disabled}>
        {submitLabel}
      </button>
      {error && <span role="alert"> {error}</span>}
    </form>
  );
}
