import { allEvents, todoGroups, type Todo, type Trip } from "@travel-planner/shared";
import { ListChecks, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCollapsed } from "./collapsed";
import { TodoList } from "./TodoList";
import { useT } from "./preferences";

type Props = {
  trip: Trip;
  onSelectEvent: (eventId: string) => void;
  onAdd: (text: string, eventId: string | null) => Promise<void>;
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  id?: string;
  // The session ended: the Todos can be read, not changed.
  readOnly?: boolean;
};

// All Todos of a Trip: the Trip's own first, then each Event's under the Event's name. New Event
// Todos are added in the Event's panel; only Trip Todos are added here.
export function TodosPanel({ trip, onSelectEvent, onAdd, onToggle, onDelete, id, readOnly }: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useCollapsed("todos");
  // The phone drawer (it has an id) is always open; desktop can shut the panel to a narrow strip.
  const shut = collapsed && !id;
  if (shut) {
    return (
      <aside className="todos-panel strip" aria-label={t("todo.panel")}>
        <button type="button" className="ib" aria-label={t("panel.expand")} title={t("panel.expand")} onClick={() => setCollapsed(false)}>
          <PanelRightOpen size={18} aria-hidden="true" />
        </button>
        <button type="button" className="strip-icon" aria-label={`${t("todo.panel")} ${trip.todos.length}`} title={t("todo.panel")} onClick={() => setCollapsed(false)}>
          <ListChecks size={18} aria-hidden="true" />
          <span className="count">{trip.todos.length}</span>
        </button>
      </aside>
    );
  }
  const groups = todoGroups(trip.todos, allEvents(trip), trip.days);
  return (
    <aside id={id} className="todos-panel" aria-label={t("todo.panel")}>
      <h3>
        {t("todo.panel")} <span className="count">{trip.todos.length}</span>
        {!id && (
          <button type="button" className="ib panel-toggle" aria-label={t("panel.collapse")} title={t("panel.collapse")} onClick={() => setCollapsed(true)}>
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
        )}
      </h3>
      {groups.map((group) =>
        group.eventId === null ? (
          <section key="trip">
            <h4>{t("todo.trip")}</h4>
            <TodoList
              todos={group.todos}
              label={t("todo.tripList")}
              addLabel={t("todo.addTrip")}
              onAdd={readOnly ? undefined : (text) => onAdd(text, null)}
              onToggle={onToggle}
              onDelete={onDelete}
              readOnly={readOnly}
            />
          </section>
        ) : (
          <section key={group.eventId}>
            <h4>
              <button type="button" onClick={() => onSelectEvent(group.eventId!)}>
                {group.title}
              </button>
              <span className="hint">
                {" · "}
                {typeof group.place === "object" && group.place ? t("day.title", { n: group.place.day }) : t(group.place === "archive" ? "area.archive" : "area.backlog")}
              </span>
            </h4>
            <TodoList todos={group.todos} label={t("todo.ofEvent", { title: group.title ?? "" })} onToggle={onToggle} onDelete={onDelete} readOnly={readOnly} />
          </section>
        ),
      )}
    </aside>
  );
}
