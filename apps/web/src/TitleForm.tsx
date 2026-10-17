import { useState, type FormEvent } from "react";

type Props = {
  label: string;
  submitLabel: string;
  onSubmit: (title: string) => Promise<void>;
  disabled?: boolean;
};

export function TitleForm({ label, submitLabel, onSubmit, disabled = false }: Props) {
  const [title, setTitle] = useState("");
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
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input aria-label={label} placeholder={label} value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" disabled={pending || disabled}>
        {submitLabel}
      </button>
      {error && <span role="alert"> {error}</span>}
    </form>
  );
}
