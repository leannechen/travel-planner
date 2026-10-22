// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayTimeline } from "./DayTimeline";
import { makeDay, makeEvent, renderApp } from "./test-helpers";
import type { DropPreview } from "./dropPreview";

afterEach(cleanup);

const day = makeDay(1, [makeEvent({ title: "Kiyomizu", startMinute: 540, durationMinutes: 60 }), makeEvent({ title: "Fushimi", startMinute: 720, durationMinutes: 60 })]);
const kiyomizuId = day.events[0]!.id;

function show(dropPreview?: DropPreview) {
  renderApp(
    <DayTimeline
      dayId={day.id}
      events={day.events}
      range={{ startMinute: 480, endMinute: 1320 }}
      dropPreview={dropPreview}
      onSelectEvent={vi.fn()}
      onCreateAt={vi.fn()}
      onChangeTimes={vi.fn()}
      legs={[]}
      onOpenLeg={vi.fn()}
    />,
  );
  return (title: string) => screen.getByText(title).closest("button")!.querySelector(".event-text > span")!.textContent;
}

describe("a dragged card", () => {
  it("shows its own time without a preview", () => {
    expect(show()("Kiyomizu")).toBe("09:00 – 10:00");
  });

  it("shows the time it would get on the same Day", () => {
    expect(show({ eventId: kiyomizuId, startMinute: 615 })("Kiyomizu")).toBe("10:15 – 11:15");
  });

  it("names the other Day it would land on", () => {
    expect(show({ eventId: kiyomizuId, startMinute: 660, dayPosition: 3 })("Kiyomizu")).toBe("Day 3 · 11:00 – 12:00");
  });

  it("names the holding area it would land in", () => {
    expect(show({ eventId: kiyomizuId, area: "archive" })("Kiyomizu")).toBe("Archive");
  });

  it("leaves the other cards alone", () => {
    expect(show({ eventId: kiyomizuId, startMinute: 615 })("Fushimi")).toBe("12:00 – 13:00");
  });
});
