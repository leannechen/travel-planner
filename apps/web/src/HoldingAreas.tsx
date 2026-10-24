import { useDraggable } from "@dnd-kit/react";
import type { Event, HoldingArea } from "@travel-planner/shared";
import { Archive, Bookmark, ChevronDown, ChevronRight, Lightbulb, PanelLeftClose, PanelLeftOpen, Plus, type LucideIcon } from "lucide-react";
import { useCollapsed } from "./collapsed";
import { CompactSidebarContext } from "./Sidebar";
import { KindIcon } from "./kinds";
import { gestureJustEnded } from "./gesture";
import { useT } from "./preferences";
import { useContext, type ReactNode } from "react";
import { ChangedEventsContext } from "./liveContext";
import { tip } from "./shortcuts";

// "1h 30m", "45m", "2h".
export function formatDuration(minutes: number, t: ReturnType<typeof useT>) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return t("duration.hm", { h, m });
  return h ? t("duration.h", { h }) : t("duration.m", { m });
}

const lengthOf = (event: Event, t: ReturnType<typeof useT>) =>
  event.kind === "lodging" && event.nights ? t("count.night", { count: event.nights }) : formatDuration(event.durationMinutes, t);

type CardProps = {
  event: Event;
  selected: boolean;
  actionLabel: string;
  onSelect: () => void;
  onAction: () => void;
};

// A compact card for an Event outside any Day. Dragging it onto a Day schedules it there.
function HoldingCard({ event, selected, actionLabel, onSelect, onAction }: CardProps) {
  const t = useT();
  const { ref, handleRef, isDragging } = useDraggable({ id: event.id });
  const changedByOther = useContext(ChangedEventsContext).has(event.id);
  const classes = ["holding-card", `kind-${event.kind}`, selected && "selected", isDragging && "dragging", changedByOther && "changed"].filter(Boolean).join(" ");
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
        <span>{lengthOf(event, t)}</span>
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
  // Fills the bottom of the column.
  footer?: ReactNode;
  // Phone drawer: show only this area, always open.
  only?: HoldingArea;
  id?: string;
  // The session ended: nothing can be added.
  readOnly?: boolean;
  // A Viewer: no Archive and no way to add.
  viewer?: boolean;
};

// The Backlog (Events still being considered) and the Archive (Events given up on), side by side
// with the Days. Both are collapsible and both accept dragged Events.
export function HoldingAreas({ backlog, archive, selectedEventId, dropTarget, onSelectEvent, onAddToBacklog, onMoveTo, footer, only, id, readOnly, viewer }: Props) {
  const t = useT();
  const [backlogCollapsed, setBacklogCollapsed] = useCollapsed("backlog");
  const [archiveCollapsed, setArchiveCollapsed] = useCollapsed("archive");
  const area = (name: HoldingArea) => (dropTarget === name ? "holding-area drop-target" : "holding-area");
  // The phone drawer shows one area, always open; on desktop each area collapses to its title bar.
  const backlogShut = !only && backlogCollapsed;
  const archiveShut = !only && archiveCollapsed;
  // Both shut: the column is a narrow strip of icons, each reopening its area (and a drop target).
  const strip = !only && backlogShut && (archiveShut || !!viewer);
  // The summary's own click is handled here, not by the browser, so `open` follows our state.
  const toggle = (shut: boolean, set: (value: boolean) => void) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!only) set(!shut);
  };
  if (strip) {
    return (
      <aside id={id} className="holding-areas strip" aria-label={t("area.holding")}>
        <button type="button" className="ib" aria-label={t("panel.expand")} title={t("panel.expand")} onClick={() => { setBacklogCollapsed(false); setArchiveCollapsed(false); }}>
          <PanelLeftOpen size={18} aria-hidden="true" />
        </button>
        <button type="button" className={`strip-icon${dropTarget === "backlog" ? " drop-target" : ""}`} data-drop="backlog" aria-label={`${t("area.backlog")} ${backlog.length}`} title={t("area.backlog")} onClick={() => setBacklogCollapsed(false)}>
          <Bookmark size={18} aria-hidden="true" />
          <span className="count">{backlog.length}</span>
        </button>
        {!viewer && (
          <button type="button" className={`strip-icon${dropTarget === "archive" ? " drop-target" : ""}`} data-drop="archive" aria-label={`${t("area.archive")} ${archive.length}`} title={t("area.archive")} onClick={() => setArchiveCollapsed(false)}>
            <Archive size={18} aria-hidden="true" />
            <span className="count">{archive.length}</span>
          </button>
        )}
        <CompactSidebarContext.Provider value={true}>{footer}</CompactSidebarContext.Provider>
      </aside>
    );
  }
  return (
    <aside id={id} className={only ? "holding-areas only" : "holding-areas"} aria-label={t("area.holding")}>
      {only !== "archive" && (
      <details className={area("backlog")} data-drop="backlog" open={!backlogShut}>
        <summary tabIndex={only ? -1 : undefined} onClick={toggle(backlogShut, setBacklogCollapsed)}>
          {!only && (backlogShut ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />)}
          <h3>
            {t("area.backlog")} <span className="count">{backlog.length}</span>
          </h3>
          {!viewer && (
          <button
            type="button"
            className="holding-add"
            disabled={readOnly}
            aria-label={t("area.addToBacklog")}
            title={tip(t("area.addToBacklog"), "new-backlog")}
            // Inside the summary, so it must not also toggle the section.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAddToBacklog();
            }}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
          )}
          {!only && (
            <button
              type="button"
              className="ib"
              aria-label={t("panel.collapse")}
              title={t("panel.collapse")}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setBacklogCollapsed(true);
                setArchiveCollapsed(true);
              }}
            >
              <PanelLeftClose size={16} aria-hidden="true" />
            </button>
          )}
        </summary>
        {backlog.length === 0 ? (
          <EmptyArea icon={Lightbulb} title={t("area.backlogEmpty")} help={t("area.backlogEmptyHelp")}>
            {!viewer && (
              <button type="button" className="btn tonal sm" disabled={readOnly} onClick={onAddToBacklog}>
                <Plus size={14} aria-hidden="true" />
                {t("area.addToBacklog")}
              </button>
            )}
          </EmptyArea>
        ) : (
          <ul>
            {backlog.map((event) => (
              <HoldingCard
                key={event.id}
                event={event}
                selected={event.id === selectedEventId}
                actionLabel={t("area.schedule")}
                onSelect={() => onSelectEvent(event.id)}
                onAction={() => onSelectEvent(event.id)}
              />
            ))}
          </ul>
        )}
      </details>
      )}
      {only !== "backlog" && !viewer && (
      <details className={area("archive")} data-drop="archive" open={only === "archive" || !archiveShut}>
        <summary tabIndex={only ? -1 : undefined} onClick={toggle(archiveShut, setArchiveCollapsed)}>
          {!only && (archiveShut ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />)}
          <h3>
            {t("area.archive")} <span className="count">{archive.length}</span>
          </h3>
          <span className="hint">{t("area.givenUp")}</span>
        </summary>
        {archive.length === 0 ? (
          <EmptyArea icon={Archive} title={t("area.archiveEmpty")} help={t("area.archiveEmptyHelp")} />
        ) : (
          <ul>
            {archive.map((event) => (
              <HoldingCard
                key={event.id}
                event={event}
                selected={event.id === selectedEventId}
                actionLabel={t("area.backToBacklog")}
                onSelect={() => onSelectEvent(event.id)}
                onAction={() => onMoveTo(event.id, "backlog")}
              />
            ))}
          </ul>
        )}
      </details>
      )}
      {footer}
    </aside>
  );
}

// The empty state of a holding area (design 28): an icon tile, a bold line, one muted line and at
// most one action, centred.
function EmptyArea({ icon: Icon, title, help, children }: { icon: LucideIcon; title: string; help: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <strong>{title}</strong>
      <p>{help}</p>
      {children}
    </div>
  );
}
