import { useDraggable } from "@dnd-kit/react";
import type { Event, HoldingArea } from "@travel-planner/shared";
import { Plus } from "lucide-react";
import { KindIcon } from "./kinds";
import { gestureJustEnded } from "./gesture";
import { tip } from "./shortcuts";

// "1h 30m", "45m", "2h".
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours && `${hours}h`, rest && `${rest}m`].filter(Boolean).join(" ") || "0m";
}

const lengthOf = (event: Event) =>
  event.kind === "lodging" && event.nights ? `${event.nights} ${event.nights === 1 ? "night" : "nights"}` : formatDuration(event.durationMinutes);

type CardProps = {
  event: Event;
  selected: boolean;
  actionLabel: string;
  onSelect: () => void;
  onAction: () => void;
};

// A compact card for an Event outside any Day. Dragging it onto a Day schedules it there.
function HoldingCard({ event, selected, actionLabel, onSelect, onAction }: CardProps) {
  const { ref, handleRef, isDragging } = useDraggable({ id: event.id });
  const classes = ["holding-card", `kind-${event.kind}`, selected && "selected", isDragging && "dragging"].filter(Boolean).join(" ");
  return (
    <li ref={ref} className={classes} data-event-id={event.id}>
      <button
        type="button"
        ref={handleRef}
        className="holding-main"
        onClick={() => {
          if (!gestureJustEnded()) onSelect();
        }}
      >
        <strong>
          <KindIcon kind={event.kind} transportLabel={event.transportLabel} />
          {event.title}
        </strong>
        <span>{lengthOf(event)}</span>
      </button>
      <button type="button" className="holding-action" onClick={onAction}>
        {actionLabel}
      </button>
    </li>
  );
}

type Props = {
  backlog: Event[];
  archive: Event[];
  selectedEventId?: string;
  // The area a dragged Event is over.
  dropTarget?: string;
  onSelectEvent: (eventId: string) => void;
  onAddToBacklog: () => void;
  onMoveTo: (eventId: string, area: HoldingArea) => void;
};

// The Backlog (Events still being considered) and the Archive (Events given up on), side by side
// with the Days. Both are collapsible and both accept dragged Events.
export function HoldingAreas({ backlog, archive, selectedEventId, dropTarget, onSelectEvent, onAddToBacklog, onMoveTo }: Props) {
  const area = (name: HoldingArea) => (dropTarget === name ? "holding-area drop-target" : "holding-area");
  return (
    <aside className="holding-areas" aria-label="Holding areas">
      <details className={area("backlog")} data-drop="backlog" open>
        <summary>
          <h3>
            Backlog <span className="count">{backlog.length}</span>
          </h3>
          <button
            type="button"
            className="holding-add"
            aria-label="Add to Backlog"
            title={tip("Add to Backlog", "new-backlog")}
            // Inside the summary, so it must not also toggle the section.
            onClick={(e) => {
              e.preventDefault();
              onAddToBacklog();
            }}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </summary>
        {backlog.length === 0 ? (
          <p className="holding-empty">No ideas waiting. Add one, or drag an Event here from a Day.</p>
        ) : (
          <ul>
            {backlog.map((event) => (
              <HoldingCard
                key={event.id}
                event={event}
                selected={event.id === selectedEventId}
                actionLabel="Schedule"
                onSelect={() => onSelectEvent(event.id)}
                onAction={() => onSelectEvent(event.id)}
              />
            ))}
          </ul>
        )}
      </details>
      <details className={area("archive")} data-drop="archive">
        <summary>
          <h3>
            Archive <span className="count">{archive.length}</span>
          </h3>
          <span className="hint">given up</span>
        </summary>
        {archive.length === 0 ? (
          <p className="holding-empty">Nothing archived. Events you give up on go here. Their Todos are deleted when archived.</p>
        ) : (
          <ul>
            {archive.map((event) => (
              <HoldingCard
                key={event.id}
                event={event}
                selected={event.id === selectedEventId}
                actionLabel="Back to Backlog"
                onSelect={() => onSelectEvent(event.id)}
                onAction={() => onMoveTo(event.id, "backlog")}
              />
            ))}
          </ul>
        )}
      </details>
    </aside>
  );
}
