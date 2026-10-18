import { allEvents, todoGroups, type Todo, type Trip } from "@travel-planner/shared";
import { TodoList } from "./TodoList";

type Props = {
  trip: Trip;
  onSelectEvent: (eventId: string) => void;
  onAdd: (text: string, eventId: string | null) => Promise<void>;
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
};

// All Todos of a Trip: the Trip's own first, then each Event's under the Event's name. New Event
// Todos are added in the Event's panel; only Trip Todos are added here.
export function TodosPanel({ trip, onSelectEvent, onAdd, onToggle, onDelete }: Props) {
  const groups = todoGroups(trip.todos, allEvents(trip), trip.days);
  return (
    <aside className="todos-panel" aria-label="Todos">
      <h3>
        Todos <span className="count">{trip.todos.length}</span>
      </h3>
      {groups.map((group) =>
        group.eventId === null ? (
          <section key="trip">
            <h4>Trip</h4>
            <TodoList
              todos={group.todos}
              label="Trip Todos"
              addLabel="Add a Trip Todo"
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
              <span className="hint"> · {group.place}</span>
            </h4>
            <TodoList todos={group.todos} label={`Todos of ${group.title}`} onToggle={onToggle} onDelete={onDelete} />
          </section>
        ),
      )}
    </aside>
  );
}
