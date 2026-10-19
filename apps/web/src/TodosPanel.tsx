import { allEvents, todoGroups, type Todo, type Trip } from "@travel-planner/shared";
import { TodoList } from "./TodoList";
import { useT } from "./preferences";

type Props = {
  trip: Trip;
  onSelectEvent: (eventId: string) => void;
  onAdd: (text: string, eventId: string | null) => Promise<void>;
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  id?: string;
};

// All Todos of a Trip: the Trip's own first, then each Event's under the Event's name. New Event
// Todos are added in the Event's panel; only Trip Todos are added here.
export function TodosPanel({ trip, onSelectEvent, onAdd, onToggle, onDelete, id }: Props) {
  const t = useT();
  const groups = todoGroups(trip.todos, allEvents(trip), trip.days);
  return (
    <aside id={id} className="todos-panel" aria-label={t("todo.panel")}>
      <h3>
        {t("todo.panel")} <span className="count">{trip.todos.length}</span>
      </h3>
      {groups.map((group) =>
        group.eventId === null ? (
          <section key="trip">
            <h4>{t("todo.trip")}</h4>
            <TodoList
              todos={group.todos}
              label={t("todo.tripList")}
              addLabel={t("todo.addTrip")}
              onAdd={(text) => onAdd(text, null)}
              onToggle={onToggle}
              onDelete={onDelete}
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
            <TodoList todos={group.todos} label={t("todo.ofEvent", { title: group.title ?? "" })} onToggle={onToggle} onDelete={onDelete} />
          </section>
        ),
      )}
    </aside>
  );
}
