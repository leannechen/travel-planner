// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseTrip,
  hasTripInAddress,
  isLandingLocation,
  openLanding,
  openTrip,
  readRememberedTripId,
  readView,
  readWantedTripId,
  rememberTripId,
  rememberView,
  tripIdOfPath,
  tripListAddress,
  tripPath,
  wantsTripList,
} from "./currentTrip";

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

describe("the Trip's address", () => {
  it("is /trip/<id>", () => {
    expect(tripPath("b")).toBe("/trip/b");
    expect(tripIdOfPath("/trip/b")).toBe("b");
    expect(tripIdOfPath("/trip/b/")).toBe("b");
  });

  it("is not read from other addresses", () => {
    expect(tripIdOfPath("/")).toBeUndefined();
    expect(tripIdOfPath("/t/secret")).toBeUndefined();
    expect(tripIdOfPath("/trip/a/b")).toBeUndefined();
    expect(tripIdOfPath("/trip/%E0%A4%A")).toBeUndefined();
  });
});

describe("the remembered Trip", () => {
  it("is kept in the address and the browser", () => {
    rememberTripId("b");
    expect(window.location.pathname).toBe("/trip/b");
    expect(readWantedTripId()).toBe("b");
    window.history.replaceState(null, "", "/");
    expect(readWantedTripId()).toBe("b");
    expect(readRememberedTripId()).toBe("b");
  });

  it("prefers the address to the browser, and the address's Trip to the older ?trip=", () => {
    rememberTripId("b");
    window.history.replaceState(null, "", "/?trip=c");
    expect(readWantedTripId()).toBe("c");
    window.history.replaceState(null, "", "/trip/a?trip=c");
    expect(readWantedTripId()).toBe("a");
  });

  it("moves the older ?trip= into the address", () => {
    window.history.replaceState(null, "", "/?trip=c&view=map");
    rememberTripId("c");
    expect(window.location.pathname + window.location.search).toBe("/trip/c?view=map");
  });

  it("can be forgotten", () => {
    rememberTripId("b");
    rememberTripId(undefined);
    expect(window.location.pathname).toBe("/");
    expect(readWantedTripId()).toBeUndefined();
  });
});

describe("openTrip", () => {
  it("goes to the Trip as a new history entry and remembers it", () => {
    const before = window.history.length;
    window.history.replaceState(null, "", "/?loggedout=1");
    openTrip("b");
    expect(window.location.pathname + window.location.search).toBe("/trip/b");
    expect(window.history.length).toBe(before + 1);
    expect(readRememberedTripId()).toBe("b");
  });
});

describe("openLanding", () => {
  it("goes to the root as a new entry and tells the App with popstate", () => {
    window.history.replaceState(null, "", "/trip/abc?view=map");
    const onPop = vi.fn();
    window.addEventListener("popstate", onPop);
    openLanding();
    window.removeEventListener("popstate", onPop);
    expect(window.location.pathname + window.location.search).toBe("/");
    expect(isLandingLocation()).toBe(true);
    expect(onPop).toHaveBeenCalledTimes(1);
  });
});

describe("the Landing page address", () => {
  const landing = (url: string) => {
    const { pathname, search } = new URL(url, "http://localhost");
    return isLandingLocation({ pathname, search });
  };

  it("is the root, also after logging out", () => {
    expect(landing("/")).toBe(true);
    expect(landing("/?loggedout=1")).toBe(true);
  });

  it("is not a Trip, an invitation, a share link or the login page's answer", () => {
    expect(landing("/trip/a")).toBe(false);
    expect(landing("/?trip=a")).toBe(false);
    expect(landing("/?invite=secret")).toBe(false);
    expect(landing("/t/secret")).toBe(false);
    expect(landing("/?code=x&state=y")).toBe(false);
    expect(landing("/?error=access_denied&state=y")).toBe(false);
    expect(landing("/?trips=1")).toBe(false);
  });

  it("knows whether the address names a Trip, in either form", () => {
    expect(hasTripInAddress()).toBe(false);
    window.history.replaceState(null, "", "/trip/a");
    expect(hasTripInAddress()).toBe(true);
    window.history.replaceState(null, "", "/?trip=a");
    expect(hasTripInAddress()).toBe(true);
  });

  it("asks once for the Trip list: the request is read, and rememberTripId takes it out of the address", () => {
    window.history.replaceState(null, "", tripListAddress);
    expect(wantsTripList()).toBe(true);
    rememberTripId("b");
    expect(wantsTripList()).toBe(false);
    expect(window.location.pathname + window.location.search).toBe("/trip/b");
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
    expect(window.location.pathname + window.location.search).toBe("/trip/c?view=map");
  });
});
