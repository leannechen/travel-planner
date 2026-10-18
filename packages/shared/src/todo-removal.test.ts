import { describe, expect, it } from "vitest";
import type { Todo } from "./index";
import { dropEventTodos, needsTodoConfirmation, summarizeTodoDeletion, todoGroups } from "./todo-removal";

const ME = "00000000-0000-4000-8000-000000000001";
const MEI = "00000000-0000-4000-8000-000000000002";
const E1 = "10000000-0000-4000-8000-000000000001";
const E2 = "10000000-0000-4000-8000-000000000002";

let n = 0;
const todo = (eventId: string | null, createdBy = ME, done = false): Todo => ({
  id: `20000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  eventId,
  text: `Todo ${n}`,
  done,
  createdBy,
});

describe("summarizeTodoDeletion", () => {
  it("counts only the Todos of that Event", () => {
    const todos = [todo(E1), todo(E1), todo(E2), todo(null)];
    expect(summarizeTodoDeletion(todos, E1, ME)).toEqual({ count: 2, byOthers: 0 });
  });

  it("counts Todos made by other people, done or not", () => {
    const todos = [todo(E1, MEI), todo(E1, MEI, true), todo(E1, ME)];
    expect(summarizeTodoDeletion(todos, E1, ME)).toEqual({ count: 3, byOthers: 2 });
  });

  it("is empty for an Event without Todos", () => {
    expect(summarizeTodoDeletion([todo(null), todo(E2)], E1, ME)).toEqual({ count: 0, byOthers: 0 });
  });
});

describe("needsTodoConfirmation", () => {
  it("asks only when there is at least one Todo", () => {
    expect(needsTodoConfirmation({ count: 0, byOthers: 0 }, false)).toBe(false);
    expect(needsTodoConfirmation({ count: 1, byOthers: 0 }, false)).toBe(true);
  });

  it("does not ask once the user chose not to be reminded", () => {
    expect(needsTodoConfirmation({ count: 3, byOthers: 1 }, true)).toBe(false);
  });
});

describe("dropEventTodos", () => {
  it("removes the Todos of one Event and keeps the rest", () => {
    const keep = [todo(E2), todo(null)];
    expect(dropEventTodos([todo(E1), ...keep, todo(E1)], E1)).toEqual(keep);
  });
});

describe("todoGroups", () => {
  const events = [
    { id: E1, title: "Fushimi Inari", dayId: "d1", holding: null },
    { id: E2, title: "Ramen", dayId: null, holding: "backlog" as const },
  ];
  const days = [{ id: "d1", position: 1 }];

  it("lists Trip Todos first, then each Event's Todos with where it is", () => {
    const a = todo(E2);
    const b = todo(null);
    const c = todo(E1);
    expect(todoGroups([a, b, c], events, days)).toEqual([
      { eventId: null, title: null, place: null, todos: [b] },
      { eventId: E1, title: "Fushimi Inari", place: { day: 1 }, todos: [c] },
      { eventId: E2, title: "Ramen", place: "backlog", todos: [a] },
    ]);
  });

  it("always has the Trip group, even with no Todos", () => {
    expect(todoGroups([], events, days)).toEqual([{ eventId: null, title: null, place: null, todos: [] }]);
  });

  it("skips a Todo whose Event is not on the board", () => {
    expect(todoGroups([todo("10000000-0000-4000-8000-0000000000ff")], events, days)).toHaveLength(1);
  });
});
