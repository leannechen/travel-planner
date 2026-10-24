import { eventSchema, invitationSchema, legSchema, shareLinkSchema, tripSchema, type Trip } from "@travel-planner/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp } from "../test/test-app";
import { GUEST_HEADER } from "./auth";

// Access control review (plan step 46). Every route under /api/trips/:tripId is tried by people who
// must not get in (nobody logged in, a stranger, a guest, the Owner or an Editor of another Trip),
// and by someone who owns a Trip and puts the ids of another Trip into their own address. None may
// get a 2xx, and the victim's Trip must be exactly as it was.

let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(() => app.reset());
afterAll(() => app.stop());

const ALICE = "fake:alice@example.com";
const BOB = "fake:bob@example.com";
const CAROL = "fake:carol@example.com";
const DAN = "fake:dan@example.com";
const ERIN = "fake:erin@example.com";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const asGuest = () => ({ [GUEST_HEADER]: crypto.randomUUID() });

function send(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response, parse: (v: unknown) => T): Promise<T> => {
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return parse(await res.json());
};

const picture = () => sharp({ create: { width: 8, height: 6, channels: 3, background: "#d33" } }).png().toBuffer();

// Everything a Trip holds, made through the API.
async function makeTrip(token: string, title: string, places: [string, string]) {
  const headers = bearer(token);
  const trip = await json(await send("POST", "/api/trips", headers, { title }), (v) => tripSchema.parse(v));
  const dayId = trip.days[0]!.id;
  const eventBody = (t: string, startMinute: number, placeId: string) => ({ title: t, startMinute, durationMinutes: 60, placeId });
  const first = await json(await send("POST", `/api/trips/${trip.id}/days/${dayId}/events`, headers, eventBody("First", 540, places[0])), (v) => eventSchema.parse(v));
  const second = await json(await send("POST", `/api/trips/${trip.id}/days/${dayId}/events`, headers, eventBody("Second", 720, places[1])), (v) => eventSchema.parse(v));
  const backlog = await json(await send("POST", `/api/trips/${trip.id}/backlog/events`, headers, { title: "Later" }), (v) => eventSchema.parse(v));
  const todo = (await (await send("POST", `/api/trips/${trip.id}/todos`, headers, { text: "Book", eventId: first.id })).json()) as { id: string };
  const note = (await (await send("POST", `/api/trips/${trip.id}/notes`, headers, { body: "Hello" })).json()) as { id: string };
  const leg = await json(await send("POST", `/api/trips/${trip.id}/legs`, headers, { fromEventId: first.id, toEventId: second.id, mode: "walk" }), (v) => legSchema.parse(v));
  const put = await fetch(`${app.baseUrl}/api/trips/${trip.id}/events/${first.id}/image`, { method: "PUT", headers: { ...headers, "content-type": "image/png" }, body: (await picture()) as BodyInit });
  expect(put.status).toBe(200);
  // A second Day, so that deleting or reordering Days is possible.
  expect((await send("POST", `/api/trips/${trip.id}/days`, headers, { position: 2 })).status).toBe(201);
  const full = (await snapshot(token)).find((t) => t.id === trip.id)!;
  return { trip: full, dayId, first, second, backlog, todoId: todo.id, noteId: note.id, legId: leg.id };
}
type Made = Awaited<ReturnType<typeof makeTrip>> & { editorId?: string; invitationId?: string };

// A route to try, built from the ids of the Trip it is aimed at.
type Probe = { name: string; method: string; path: (t: Made) => string; body?: (t: Made) => unknown; raw?: boolean };

const probes: Probe[] = [
  { name: "read the backup", method: "GET", path: (t) => `/api/trips/${t.trip.id}/backup` },
  { name: "rename the Trip", method: "PATCH", path: (t) => `/api/trips/${t.trip.id}`, body: () => ({ title: "Mine now" }) },
  { name: "delete the Trip", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}` },
  { name: "read the sharing list", method: "GET", path: (t) => `/api/trips/${t.trip.id}/sharing` },
  { name: "turn the link off", method: "PUT", path: (t) => `/api/trips/${t.trip.id}/link`, body: () => ({ enabled: false }) },
  { name: "invite", method: "POST", path: (t) => `/api/trips/${t.trip.id}/invitations`, body: () => ({ email: "spy@example.com" }) },
  { name: "withdraw an invitation", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/invitations/${t.invitationId}` },
  { name: "remove an Editor", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/editors/${t.editorId}` },
  { name: "add an Event to a Day", method: "POST", path: (t) => `/api/trips/${t.trip.id}/days/${t.dayId}/events`, body: () => ({ title: "Injected" }) },
  { name: "add an Event to the Backlog", method: "POST", path: (t) => `/api/trips/${t.trip.id}/backlog/events`, body: () => ({ title: "Injected" }) },
  { name: "change an Event", method: "PATCH", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}`, body: () => ({ title: "Changed" }) },
  { name: "delete an Event", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}` },
  { name: "turn on opening hours", method: "PUT", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}/opening-hours` },
  { name: "turn off opening hours", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}/opening-hours` },
  { name: "read the place photo", method: "GET", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}/place-photo` },
  { name: "read the image", method: "GET", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}/image` },
  { name: "replace the image", method: "PUT", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}/image`, raw: true },
  { name: "remove the image", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/events/${t.first.id}/image` },
  { name: "restore an Event", method: "POST", path: (t) => `/api/trips/${t.trip.id}/events/restore`, body: () => ({ event: { ...t0.event, id: crypto.randomUUID() }, todos: [] }) },
  { name: "list the Legs", method: "GET", path: (t) => `/api/trips/${t.trip.id}/legs` },
  { name: "add a Leg", method: "POST", path: (t) => `/api/trips/${t.trip.id}/legs`, body: (t) => ({ fromEventId: t.second.id, toEventId: t.first.id, mode: "drive" }) },
  { name: "change a Leg", method: "PATCH", path: (t) => `/api/trips/${t.trip.id}/legs/${t.legId}`, body: () => ({ mode: "drive" }) },
  { name: "delete a Leg", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/legs/${t.legId}` },
  { name: "add a Todo", method: "POST", path: (t) => `/api/trips/${t.trip.id}/todos`, body: () => ({ text: "Injected" }) },
  { name: "add an Event Todo", method: "POST", path: (t) => `/api/trips/${t.trip.id}/todos`, body: (t) => ({ text: "Injected", eventId: t.first.id }) },
  { name: "change a Todo", method: "PATCH", path: (t) => `/api/trips/${t.trip.id}/todos/${t.todoId}`, body: () => ({ done: true }) },
  { name: "delete a Todo", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/todos/${t.todoId}` },
  { name: "add a Note", method: "POST", path: (t) => `/api/trips/${t.trip.id}/notes`, body: () => ({ body: "Injected" }) },
  { name: "restore a Note", method: "POST", path: (t) => `/api/trips/${t.trip.id}/notes/restore`, body: () => ({ note: { id: crypto.randomUUID(), body: "Injected", pinned: false, updatedAt: new Date().toISOString() } }) },
  { name: "change a Note", method: "PATCH", path: (t) => `/api/trips/${t.trip.id}/notes/${t.noteId}`, body: () => ({ body: "Changed" }) },
  { name: "delete a Note", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/notes/${t.noteId}` },
  { name: "insert a Day", method: "POST", path: (t) => `/api/trips/${t.trip.id}/days`, body: () => ({ position: 1 }) },
  { name: "reorder the Days", method: "PUT", path: (t) => `/api/trips/${t.trip.id}/days/order`, body: (t) => ({ dayIds: [...t.trip.days.map((d) => d.id)].reverse() }) },
  { name: "delete a Day", method: "DELETE", path: (t) => `/api/trips/${t.trip.id}/days/${t.dayId}` },
  { name: "restore a Day", method: "POST", path: (t) => `/api/trips/${t.trip.id}/days/restore`, body: () => ({ dayId: crypto.randomUUID(), position: 1, placements: [] }) },
];

// `restore an Event` needs a well-formed Event; any valid one will do, as no request may get that far.
let t0: { event: ReturnType<typeof eventSchema.parse> };

const snapshot = async (token: string): Promise<Trip[]> => tripSchema.array().parse(await (await send("GET", "/api/trips", bearer(token))).json());
// Who may edit and which invitations wait, which the Trip list does not carry.
const sharingOf = async (token: string, tripId: string) => (await send("GET", `/api/trips/${tripId}/sharing`, bearer(token))).json();

async function setup() {
  const found = ((await (await send("GET", "/api/places/search?q=kyoto", bearer(ALICE))).json()) as { places: { id: string }[] }).places;
  const places: [string, string] = [found[0]!.id, found[1]!.id];
  const alice = await makeTrip(ALICE, "Alice's Trip", places);
  const bob = await makeTrip(BOB, "Bob's Trip", places);
  t0 = { event: alice.first };
  // Dan is an Editor of Bob's Trip only, and Erin of Alice's; each Trip also has an invitation waiting.
  const editor = async (made: Made, owner: string, editorToken: string, email: string) => {
    const invitation = await json(await send("POST", `/api/trips/${made.trip.id}/invitations`, bearer(owner), { email }), (v) => invitationSchema.parse(v));
    expect((await send("POST", `/api/invitations/${invitation.token}/accept`, bearer(editorToken))).status).toBe(200);
    const waiting = await json(await send("POST", `/api/trips/${made.trip.id}/invitations`, bearer(owner), { email: `waiting-${email}` }), (v) => invitationSchema.parse(v));
    const sharing = (await sharingOf(owner, made.trip.id)) as { editors: { userId: string }[] };
    made.editorId = sharing.editors[0]!.userId;
    made.invitationId = waiting.id;
  };
  await editor(bob, BOB, DAN, "dan@example.com");
  await editor(alice, ALICE, ERIN, "erin@example.com");
  return { alice: alice as Made, bob: bob as Made };
}

async function tryProbe(probe: Probe, victim: Made, headers: Record<string, string>) {
  const path = probe.path(victim);
  if (probe.raw) return fetch(`${app.baseUrl}${path}`, { method: probe.method, headers: { ...headers, "content-type": "image/png" }, body: (await picture()) as BodyInit });
  return send(probe.method, path, headers, probe.body?.(victim));
}

describe("people who must not get into someone else's Trip", () => {
  const attackers = (): { name: string; headers: Record<string, string> }[] => [
    { name: "nobody logged in", headers: { "x-no-auth": "1" } },
    { name: "a stranger with no Trips", headers: bearer(CAROL) },
    { name: "a guest", headers: asGuest() },
    { name: "the Owner of another Trip", headers: bearer(BOB) },
    { name: "an Editor of another Trip", headers: bearer(DAN) },
  ];

  it("gets no access to any route, and changes nothing", async () => {
    const { alice } = await setup();
    const before = await snapshot(ALICE);
    const sharingBefore = await sharingOf(ALICE, alice.trip.id);
    const keys = app.images.keys();
    const failures: string[] = [];
    for (const who of attackers()) {
      for (const probe of probes) {
        const res = await tryProbe(probe, alice, who.headers);
        const allowed = who.name === "nobody logged in" ? [401] : [401, 403, 404];
        if (!allowed.includes(res.status)) failures.push(`${who.name} could ${probe.name}: ${res.status} ${await res.text()}`);
      }
    }
    expect(failures).toEqual([]);
    expect(await snapshot(ALICE)).toEqual(before);
    expect(await sharingOf(ALICE, alice.trip.id)).toEqual(sharingBefore);
    expect(app.images.keys()).toEqual(keys);
  });

  it("does not become the Owner by sending the Owner's user id as a guest id", async () => {
    const { alice } = await setup();
    const me = (await (await send("GET", "/api/me", bearer(ALICE))).json()) as { id: string };
    const res = await send("GET", "/api/trips", { [GUEST_HEADER]: me.id });
    expect(tripSchema.array().parse(await res.json()).map((t) => t.id)).not.toContain(alice.trip.id);
    expect((await send("GET", `/api/trips/${alice.trip.id}/backup`, { [GUEST_HEADER]: me.id })).status).toBe(404);
  });

  it("is told only about its own Trips in the list", async () => {
    const { alice, bob } = await setup();
    expect((await snapshot(BOB)).map((t) => t.id).sort()).toEqual([bob.trip.id].sort());
    expect((await snapshot(DAN)).map((t) => t.id)).toEqual([bob.trip.id]);
    expect((await snapshot(CAROL)).map((t) => t.id)).toEqual([]);
    expect((await snapshot(ALICE)).map((t) => t.id)).toEqual([alice.trip.id]);
  });
});

describe("an Editor of one Trip in another Trip's address", () => {
  it("may not do what only the Owner may, in their own Trip", async () => {
    const { bob } = await setup();
    const before = await snapshot(BOB);
    const sharingBefore = await sharingOf(BOB, bob.trip.id);
    const ownerOnly = probes.filter((p) => ["rename the Trip", "delete the Trip", "read the sharing list", "turn the link off", "invite", "withdraw an invitation", "remove an Editor"].includes(p.name));
    for (const probe of ownerOnly) {
      const res = await tryProbe(probe, bob, bearer(DAN));
      expect([401, 403, 404], `${probe.name}: ${res.status}`).toContain(res.status);
    }
    expect(await snapshot(BOB)).toEqual(before);
    expect(await sharingOf(BOB, bob.trip.id)).toEqual(sharingBefore);
  });
});

describe("someone who owns a Trip, using the ids of another Trip in their own address", () => {
  // Bob's own Trip in the address, Alice's ids in the rest of it.
  const mixed = (alice: Made, bob: Made): Made => ({ ...alice, trip: bob.trip });

  it("reaches nothing of the other Trip, and changes nothing of either", async () => {
    const { alice, bob } = await setup();
    const aliceBefore = await snapshot(ALICE);
    // Routes with an id of the other Trip in the address, and the two whose body carries such ids.
    const withId = /\/(events|legs|todos|notes|days|invitations|editors)\/[0-9a-f-]{36}/;
    const mixedProbes = probes.filter((p) => withId.test(p.path(alice)) || ["add an Event Todo", "add a Leg"].includes(p.name));
    expect(mixedProbes.length).toBeGreaterThan(10);
    const failures: string[] = [];
    for (const probe of mixedProbes) {
      for (const holder of [bearer(BOB), bearer(DAN)]) {
        const res = await tryProbe(probe, mixed(alice, bob), holder);
        // 400 is fine where an id is refused as "not in this Trip"; a 2xx never is.
        if (res.status < 400 || res.status === 409) failures.push(`${probe.name}: ${res.status} ${await res.text()}`);
      }
    }
    expect(failures).toEqual([]);
    expect(await snapshot(ALICE)).toEqual(aliceBefore);
  });

  it("cannot reorder with the other Trip's Days, nor restore an Event onto its Day or over its Todos", async () => {
    const { alice, bob } = await setup();
    const aliceBefore = await snapshot(ALICE);
    const bobBefore = await snapshot(BOB);
    const reorder = await send("PUT", `/api/trips/${bob.trip.id}/days/order`, bearer(BOB), { dayIds: alice.trip.days.map((d) => d.id) });
    expect(reorder.status).toBe(400);

    // The Day is not Bob's, so the Event comes back in the Backlog; Alice's Day is untouched.
    const onto = await send("POST", `/api/trips/${bob.trip.id}/events/restore`, bearer(BOB), { event: { ...bob.first, id: crypto.randomUUID(), dayId: alice.dayId, holding: null }, todos: [] });
    expect(onto.status).toBe(201);
    expect(eventSchema.parse(await onto.json())).toMatchObject({ dayId: null, holding: "backlog" });

    // A Todo id that is Alice's is refused, and no Todo of hers changes.
    const eventId = crypto.randomUUID();
    const clash = await send("POST", `/api/trips/${bob.trip.id}/events/restore`, bearer(BOB), {
      event: { ...bob.first, id: eventId, dayId: null, holding: "backlog" },
      todos: [{ id: alice.todoId, eventId, text: "Taken over", done: false, createdBy: (await sharingOf(BOB, bob.trip.id)).editors[0].userId }],
    });
    expect(clash.status).toBe(400);
    expect(await snapshot(ALICE)).toEqual(aliceBefore);
    // Bob's Trip has only the one restored Event more.
    const bobAfter = (await snapshot(BOB))[0]!;
    expect(bobAfter.backlog.length).toBe(bobBefore[0]!.backlog.length + 1);
  });

  it("cannot move Events of the other Trip by restoring a Day with them", async () => {
    const { alice, bob } = await setup();
    const aliceBefore = await snapshot(ALICE);
    const res = await send("POST", `/api/trips/${bob.trip.id}/days/restore`, bearer(BOB), {
      dayId: crypto.randomUUID(),
      position: 1,
      placements: [{ eventId: alice.first.id, dayId: bob.dayId, nights: null }],
    });
    expect(res.status).toBe(400);
    expect(await snapshot(ALICE)).toEqual(aliceBefore);
  });

  it("cannot put an Event on the other Trip's Day", async () => {
    const { alice, bob } = await setup();
    const into = await send("POST", `/api/trips/${bob.trip.id}/days/${alice.dayId}/events`, bearer(BOB), { title: "Injected" });
    expect(into.status).toBe(404);
    const move = await send("PATCH", `/api/trips/${bob.trip.id}/events/${bob.first.id}`, bearer(BOB), { dayId: alice.dayId });
    expect(move.status).toBe(400);
    const todo = await send("POST", `/api/trips/${bob.trip.id}/todos`, bearer(BOB), { text: "Injected", eventId: alice.first.id });
    expect(todo.status).toBe(404);
    const leg = await send("POST", `/api/trips/${bob.trip.id}/legs`, bearer(BOB), { fromEventId: alice.first.id, toEventId: alice.second.id, mode: "walk" });
    expect(leg.status).toBe(400);
  });
});

describe("a Viewer link", () => {
  it("opens only its own Trip, and nothing once it is off", async () => {
    const { alice, bob } = await setup();
    const link = await json(await send("PUT", `/api/trips/${alice.trip.id}/link`, bearer(ALICE), { enabled: true }), (v) => shareLinkSchema.parse(v));
    const token = link.token!;
    const viewer = { "x-no-auth": "1" };

    expect((await send("GET", `/api/shared/${token}`, viewer)).status).toBe(200);
    // Another Trip's Event through this link.
    expect((await send("GET", `/api/shared/${token}/events/${bob.first.id}/image`, viewer)).status).toBe(404);
    expect((await send("GET", `/api/shared/${token}/events/${bob.first.id}/place-photo`, viewer)).status).toBe(404);
    expect((await send("GET", `/api/shared/${token}/events/${alice.first.id}/image`, viewer)).status).toBe(200);

    // The link's secret is not a login either: not as a bearer token, not as a guest id.
    for (const probe of probes) {
      for (const headers of [{ authorization: `Bearer ${token}` }, { [GUEST_HEADER]: token }] as Record<string, string>[]) {
        const res = await tryProbe(probe, alice, headers);
        expect([401, 403, 404], `${probe.name} with the link as ${Object.keys(headers)[0]}`).toContain(res.status);
      }
    }
    expect((await send("GET", `/api/trips/${alice.trip.id}/backup`, { authorization: `Bearer ${token}` })).status).toBe(401);

    expect((await send("PUT", `/api/trips/${alice.trip.id}/link`, bearer(ALICE), { enabled: false })).status).toBe(200);
    expect((await send("GET", `/api/shared/${token}`, viewer)).status).toBe(404);
    expect((await send("GET", `/api/shared/${token}/events/${alice.first.id}/image`, viewer)).status).toBe(404);
  });
});

describe("a Viewer link's places", () => {
  it("hands out only the places of its own Trip", async () => {
    const { alice } = await setup();
    const link = await json(await send("PUT", `/api/trips/${alice.trip.id}/link`, bearer(ALICE), { enabled: true }), (v) => shareLinkSchema.parse(v));
    const unrelated = "ChIJ-not-one-of-ours";
    const res = await send("GET", `/api/shared/${link.token}/places?ids=${unrelated}`, { "x-no-auth": "1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ places: [] });
  });
});

describe("restoring from a snapshot the browser sends", () => {
  it("does not believe an author who is not in the Trip, nor a place the provider does not know", async () => {
    const { alice } = await setup();
    const aliceId = ((await (await send("GET", "/api/me", bearer(ALICE))).json()) as { id: string }).id;
    const dan = ((await (await send("GET", "/api/me", bearer(DAN))).json()) as { id: string }).id;
    const deleted = {
      event: { ...alice.second, id: crypto.randomUUID() },
      todos: [{ id: crypto.randomUUID(), eventId: "", text: "Pretending", done: false, createdBy: dan }],
    };
    deleted.todos[0]!.eventId = deleted.event.id;
    // Dan has no part in Alice's Trip, so the Todo is Alice's own once she restores it.
    expect((await send("POST", `/api/trips/${alice.trip.id}/events/restore`, bearer(ALICE), deleted)).status).toBe(201);
    const trip = (await snapshot(ALICE))[0]!;
    expect(trip.todos.find((t) => t.text === "Pretending")?.createdBy).toBe(aliceId);

    const madeUp = { event: { ...alice.second, id: crypto.randomUUID(), placeId: "made-up-place" }, todos: [] };
    expect((await send("POST", `/api/trips/${alice.trip.id}/events/restore`, bearer(ALICE), madeUp)).status).toBe(400);
  });

  it("keeps the authors who are in the Trip, whoever restores", async () => {
    const { bob } = await setup();
    const ids = {
      bob: ((await (await send("GET", "/api/me", bearer(BOB))).json()) as { id: string }).id,
      dan: ((await (await send("GET", "/api/me", bearer(DAN))).json()) as { id: string }).id,
    };
    const todoBy = async (token: string, text: string) => {
      const res = await send("POST", `/api/trips/${bob.trip.id}/todos`, bearer(token), { text, eventId: bob.first.id });
      expect(res.status).toBe(201);
    };
    await todoBy(DAN, "Dan's");
    await todoBy(BOB, "Bob's");
    const authorsOf = async () => Object.fromEntries((await snapshot(BOB))[0]!.todos.filter((t) => t.eventId === bob.first.id).map((t) => [t.text, t.createdBy]));

    // Bob deletes the Event and puts it back, then Dan does the same.
    for (const who of [BOB, DAN]) {
      const gone = await send("DELETE", `/api/trips/${bob.trip.id}/events/${bob.first.id}`, bearer(who));
      expect(gone.status).toBe(200);
      const restored = await send("POST", `/api/trips/${bob.trip.id}/events/restore`, bearer(who), await gone.json());
      expect(restored.status).toBe(201);
      expect(await authorsOf()).toMatchObject({ "Dan's": ids.dan, "Bob's": ids.bob });
    }
  });
});
