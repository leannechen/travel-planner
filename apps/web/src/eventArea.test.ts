import type { Place } from "@travel-planner/shared";
import { describe, expect, it } from "vitest";
import { eventArea } from "./eventArea";

const place = (id: string, area: string): [string, Place] => [id, { id, name: id, address: "", area, lat: 0, lng: 0 }];
const places = new Map([place("fushimi", "Fushimi Ward, Kyoto"), place("kyoto-st", "Shimogyo Ward, Kyoto"), place("osaka", "Chuo Ward, Osaka"), place("blank", ""), place("beppu", "Beppu")]);
const event = (kind: "attraction" | "transport", placeId: string | null, destinationId: string | null = null) => ({ kind, placeId, destinationId });

describe("eventArea", () => {
  it("shows the place's area, and nothing without a known place", () => {
    expect(eventArea(event("attraction", "fushimi"), places)).toBe("Fushimi Ward, Kyoto");
    expect(eventArea(event("attraction", null), places)).toBe("");
    expect(eventArea(event("attraction", "unknown"), places)).toBe("");
    expect(eventArea(event("attraction", "blank"), places)).toBe("");
  });

  it("shows the two cities of a Transport Event", () => {
    expect(eventArea(event("transport", "kyoto-st", "osaka"), places)).toBe("Kyoto → Osaka");
  });

  it("shows the areas when both ends are in one city, and the one end there is", () => {
    expect(eventArea(event("transport", "fushimi", "kyoto-st"), places)).toBe("Fushimi Ward, Kyoto → Shimogyo Ward, Kyoto");
    expect(eventArea(event("transport", "osaka", null), places)).toBe("Chuo Ward, Osaka");
    expect(eventArea(event("transport", "unknown", "osaka"), places)).toBe("→ Chuo Ward, Osaka");
    expect(eventArea(event("transport", "blank", "osaka"), places)).toBe("→ Chuo Ward, Osaka");
    expect(eventArea(event("transport", "beppu", "osaka"), places)).toBe("Beppu → Osaka");
  });
});
