import { useState, type FormEvent } from "react";

type Props = {
  label: string;
  submitLabel: string;
  onSubmit: (title: string) => Promise<void>;
};

export function TitleForm({ label, submitLabel, onSubmit }: Props) {
  const [title, setTitle] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await onSubmit(trimmed);
    setTitle("");
  }

  return (
    <form onSubmit={handleSubmit}>
      <input aria-label={label} placeholder={label} value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
