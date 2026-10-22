// @vitest-environment jsdom
import type { Place } from "@travel-planner/shared";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlaces } from "./api";
import { DayTimeline } from "./DayTimeline";
import { makeDay, makeEvent, renderApp } from "./test-helpers";

vi.mock("./api", () => ({ getPlaces: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const place = (id: string, area: string): Place => ({ id, name: id, address: "", area, lat: 35, lng: 135 });

const day = makeDay(1, [
  makeEvent({ title: "Fushimi", startMinute: 540, durationMinutes: 120, placeId: "area-fushimi" }),
  makeEvent({ title: "Train", kind: "transport", startMinute: 720, durationMinutes: 60, placeId: "area-kyoto", destinationId: "area-osaka" }),
  makeEvent({ title: "Nowhere", startMinute: 900, durationMinutes: 60 }),
]);

function show(shown = day) {
  renderApp(
    <DayTimeline dayId={shown.id} events={shown.events} range={{ startMinute: 480, endMinute: 1320 }} onSelectEvent={vi.fn()} onCreateAt={vi.fn()} onChangeTimes={vi.fn()} legs={[]} onOpenLeg={vi.fn()} />,
  );
  return (title: string) => screen.getByText(title).closest("button")!.querySelector(".event-text > span")!.textContent;
}

describe("the area on an Event block", () => {
  it("follows the time, a Transport Event shows both cities, and no location shows the time only", async () => {
    vi.mocked(getPlaces).mockResolvedValue([place("area-fushimi", "Fushimi Ward, Kyoto"), place("area-kyoto", "Shimogyo Ward, Kyoto"), place("area-osaka", "Chuo Ward, Osaka")]);
    const text = show();
    expect(text("Nowhere")).toBe("15:00 – 16:00");
    expect(await screen.findByText("09:00 – 11:00 · Fushimi Ward, Kyoto")).toBeTruthy();
    expect(text("Train")).toBe("12:00 – 13:00 · Kyoto → Osaka");
    expect(text("Nowhere")).toBe("15:00 – 16:00");
  });

  it("shows the time only when the place is unknown", async () => {
    vi.mocked(getPlaces).mockResolvedValue([]);
    const text = show(makeDay(1, [makeEvent({ title: "Fushimi", startMinute: 540, durationMinutes: 120, placeId: "area-gone" })]));
    await vi.waitFor(() => expect(getPlaces).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(text("Fushimi")).toBe("09:00 – 11:00");
  });
});
