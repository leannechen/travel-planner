// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { chooseTrip, readView, readWantedTripId, rememberTripId, rememberView } from "./currentTrip";

const trips = [{ id: "a" }, { id: "b" }, { id: "c" }];

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("chooseTrip", () => {
  it("shows the wanted Trip", () => expect(chooseTrip(trips, "b")).toBe(trips[1]));
  it("shows the first Trip when none is wanted", () => expect(chooseTrip(trips, undefined)).toBe(trips[0]));
  it("shows the first Trip when the wanted one is gone", () => expect(chooseTrip(trips, "deleted")).toBe(trips[0]));
  it("shows nothing without Trips", () => expect(chooseTrip([], "a")).toBeUndefined());
});

describe("the remembered Trip", () => {
  it("is kept in the URL and the browser", () => {
    rememberTripId("b");
    expect(window.location.search).toBe("?trip=b");
    expect(readWantedTripId()).toBe("b");
    window.history.replaceState(null, "", "/");
    expect(readWantedTripId()).toBe("b");
  });

  it("prefers the URL to the browser", () => {
    rememberTripId("b");
    window.history.replaceState(null, "", "/?trip=c");
    expect(readWantedTripId()).toBe("c");
  });

  it("can be forgotten", () => {
    rememberTripId("b");
    rememberTripId(undefined);
    expect(window.location.search).toBe("");
    expect(readWantedTripId()).toBeUndefined();
  });
});

describe("the view", () => {
  it("is the schedule unless the URL says map", () => {
    expect(readView()).toBe("schedule");
    window.history.replaceState(null, "", "/?view=nonsense");
    expect(readView()).toBe("schedule");
    window.history.replaceState(null, "", "/?view=map");
    expect(readView()).toBe("map");
  });

  it("is kept in the URL next to the Trip", () => {
    rememberTripId("b");
    rememberView("map");
    expect(readView()).toBe("map");
    rememberTripId("c");
    expect(window.location.search).toBe("?trip=c&view=map");
  });
});
