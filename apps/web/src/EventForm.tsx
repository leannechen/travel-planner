import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_START_MINUTE,
  formatMinute,
  parseTime,
  type CreateEventInput,
} from "@travel-planner/shared";
import { useState, type FormEvent } from "react";

type Props = {
  onSubmit: (input: CreateEventInput) => Promise<void>;
  disabled?: boolean;
};

// A plain form for adding an Event with a time. Step 4 replaces it with creating on the axis.
export function EventForm({ onSubmit, disabled = false }: Props) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(formatMinute(DEFAULT_START_MINUTE));
  const [duration, setDuration] = useState(String(DEFAULT_DURATION_MINUTES));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || pending || disabled) return;

    const startMinute = parseTime(start);
    const durationMinutes = Number(duration);
    if (startMinute === undefined || !Number.isInteger(durationMinutes) || durationMinutes < 1) {
      setError("Enter a start time and a duration in whole minutes");
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      await onSubmit({ title: trimmed, startMinute, durationMinutes });
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="event-form" onSubmit={handleSubmit}>
      <input
        aria-label="Event title"
        placeholder="Event title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input aria-label="Start time" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      <input
        aria-label="Duration in minutes"
        type="number"
        min={1}
        max={1440}
        step={5}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
      />
      <button type="submit" disabled={pending || disabled}>
        Add event
      </button>
      {error && <span role="alert"> {error}</span>}
    </form>
  );
}
