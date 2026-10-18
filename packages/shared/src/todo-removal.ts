import type { Day, Event, Todo } from "./index";

export type TodoDeletionSummary = { count: number; byOthers: number };

// How many Todos go with an Event when it is archived or deleted (PRD §5), and how many of them
// someone other than `userId` made. Done Todos count too.
export function summarizeTodoDeletion(todos: readonly Todo[], eventId: string, userId: string): TodoDeletionSummary {
  const own = todos.filter((t) => t.eventId === eventId);
  return { count: own.length, byOthers: own.filter((t) => t.createdBy !== userId).length };
}

// The confirmation appears only when something would be lost, and not once the user has chosen
// "do not remind me again".
export function needsTodoConfirmation(summary: TodoDeletionSummary, skipReminder: boolean): boolean {
  return summary.count > 0 && !skipReminder;
}

export function dropEventTodos(todos: readonly Todo[], eventId: string): Todo[] {
  return todos.filter((t) => t.eventId !== eventId);
}

export type TodoPlace = { day: number } | "backlog" | "archive";
export type TodoGroup = { eventId: string | null; title: string | null; place: TodoPlace | null; todos: Todo[] };

// The Todos panel: Trip Todos first (always shown), then one group per Event that has Todos, in
// the order of the Events given. `place` is `{ day: 2 }`, "backlog" or "archive"; the interface words it.
export function todoGroups(
  todos: readonly Todo[],
  events: readonly Pick<Event, "id" | "title" | "dayId" | "holding">[],
  days: readonly Pick<Day, "id" | "position">[],
): TodoGroup[] {
  const groups: TodoGroup[] = [{ eventId: null, title: null, place: null, todos: todos.filter((t) => t.eventId === null) }];
  for (const event of events) {
    const own = todos.filter((t) => t.eventId === event.id);
    if (own.length === 0) continue;
    const day = days.find((d) => d.id === event.dayId);
    const place: TodoPlace = day ? { day: day.position } : event.holding === "archive" ? "archive" : "backlog";
    groups.push({ eventId: event.id, title: event.title, place, todos: own });
  }
  return groups;
}
