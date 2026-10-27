import net from "node:net";
import { liveMessageSchema, tripSchema, type LiveMessage } from "@travel-planner/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startTestApp } from "../test/test-app";

let app: Awaited<ReturnType<typeof startTestApp>>;
const open: WebSocket[] = [];

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(async () => {
  await app.reset();
});
afterEach(() => {
  for (const socket of open.splice(0)) socket.terminate();
});
afterAll(() => app.stop());

const OWNER = "fake:lena@example.com";
const MEI = "fake:mei@example.com";

function call(method: string, path: string, token: string, body?: unknown, clientId?: string) {
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(clientId ? { "x-client-id": clientId } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// A page's connection: what it was told, and how it ended.
function connect(tripId: string, credentials: { token?: string; guest?: string; share?: string }, clientId = "page-1") {
  const socket = new WebSocket(`${app.baseUrl.replace("http", "ws")}/api/live`);
  open.push(socket);
  const messages: LiveMessage[] = [];
  const waiters: (() => void)[] = [];
  socket.on("message", (data) => {
    messages.push(liveMessageSchema.parse(JSON.parse(data.toString())));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  socket.on("open", () => socket.send(JSON.stringify({ type: "hello", tripId, clientId, ...credentials })));
  return {
    messages,
    closed,
    // Resolves once a message matching `match` has arrived (possibly already).
    async until(match: (m: LiveMessage) => boolean) {
      const deadline = Date.now() + 3000;
      while (!messages.some(match)) {
        if (Date.now() > deadline) throw new Error(`Not told in time: ${JSON.stringify(messages)}`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 100);
        });
      }
    },
  };
}

async function ownerTrip() {
  return tripSchema.parse(await (await call("POST", "/api/trips", OWNER, { title: "Kyoto" })).json());
}

async function withEditor(tripId: string) {
  const invitation = (await (await call("POST", `/api/trips/${tripId}/invitations`, OWNER, { email: "mei@example.com" })).json()) as { token: string };
  expect((await call("POST", `/api/invitations/${invitation.token}/accept`, MEI)).status).toBe(200);
}

const presenceOf = (m: LiveMessage) => (m.type === "presence" ? m.people.map((p) => p.initial).sort() : undefined);

describe("live collaboration", () => {
  it("tells the Editor when the Owner changes the Trip, naming the page that did it", async () => {
    const trip = await ownerTrip();
    await withEditor(trip.id);
    const editor = connect(trip.id, { token: MEI }, "mei-page");
    await editor.until((m) => m.type === "ready");

    expect((await call("POST", `/api/trips/${trip.id}/todos`, OWNER, { text: "Buy ICOCA" }, "lena-page")).status).toBe(201);

    await editor.until((m) => m.type === "changed");
    expect(editor.messages.filter((m) => m.type === "changed")).toEqual([{ type: "changed", origin: "lena-page" }]);
  });

  it("lists who has the Trip open by initial only, and updates when someone leaves", async () => {
    const trip = await ownerTrip();
    await withEditor(trip.id);
    const owner = connect(trip.id, { token: OWNER });
    await owner.until((m) => presenceOf(m)?.join() === "L");
    const editor = connect(trip.id, { token: MEI });
    await owner.until((m) => presenceOf(m)?.join() === "L,M");
    await editor.until((m) => presenceOf(m)?.length === 2);

    open[1]!.close();

    await owner.until((m) => m === owner.messages.at(-1) && presenceOf(m)?.join() === "L");
  });

  it("shows a guest owner as someone without a name", async () => {
    const guest = crypto.randomUUID();
    const trip = tripSchema.parse(await (await fetch(`${app.baseUrl}/api/trips`, { method: "POST", headers: { "x-guest-id": guest, "content-type": "application/json" }, body: JSON.stringify({ title: "Mine" }) })).json());
    const page = connect(trip.id, { guest });
    await page.until((m) => m.type === "presence");
    expect(page.messages.find((m) => m.type === "presence")).toMatchObject({ people: [{ initial: null }] });
  });

  it("refuses someone who cannot edit the Trip, and a bad token", async () => {
    const trip = await ownerTrip();
    expect(await connect(trip.id, { token: MEI }).closed).toBe(4403);
    expect(await connect(trip.id, { token: "not-a-token" }).closed).toBe(4401);
    expect(await connect(trip.id, {}).closed).toBe(4401);
  });

  it("closes a connection whose first message is not a hello", async () => {
    const socket = new WebSocket(`${app.baseUrl.replace("http", "ws")}/api/live`);
    open.push(socket);
    const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
    socket.on("open", () => socket.send("not json"));
    expect(await closed).toBe(4400);
  });

  it("drops an upgrade request whose target is not a valid URL and keeps serving", async () => {
    const { port } = new URL(app.baseUrl);
    const raw = net.connect(Number(port), "127.0.0.1");
    raw.on("error", () => {});
    try {
      raw.write("GET //a:99999/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
      await new Promise<void>((resolve) => raw.on("close", () => resolve()));
    } finally {
      raw.destroy();
    }

    expect((await fetch(`${app.baseUrl}/api/health`, { headers: { "x-no-auth": "1" } })).status).toBe(200);
  });

  it("ends the Editor's connection when they are removed", async () => {
    const trip = await ownerTrip();
    await withEditor(trip.id);
    const sharing = (await (await call("GET", `/api/trips/${trip.id}/sharing`, OWNER)).json()) as { editors: { userId: string }[] };
    const editor = connect(trip.id, { token: MEI });
    await editor.until((m) => m.type === "ready");

    expect((await call("DELETE", `/api/trips/${trip.id}/editors/${sharing.editors[0]!.userId}`, OWNER)).status).toBe(204);

    expect(await editor.closed).toBe(4403);
  });

  it("ends a guest's connection when the guest logs in and their Trips move to the account", async () => {
    const guest = crypto.randomUUID();
    const trip = tripSchema.parse(await (await fetch(`${app.baseUrl}/api/trips`, { method: "POST", headers: { "x-guest-id": guest, "content-type": "application/json" }, body: JSON.stringify({ title: "Mine" }) })).json());
    const page = connect(trip.id, { guest });
    await page.until((m) => m.type === "ready");

    const merged = await fetch(`${app.baseUrl}/api/me/merge-guest`, { method: "POST", headers: { "x-guest-id": guest, authorization: `Bearer ${OWNER}` } });
    expect(await merged.json()).toEqual({ merged: 1 });

    expect(await page.closed).toBe(4403);
    // The account itself, now the Owner, can open the Trip.
    await connect(trip.id, { token: OWNER }).until((m) => m.type === "ready");
  });

  it("ends every connection to a Trip when its Owner deletes it", async () => {
    const trip = await ownerTrip();
    await withEditor(trip.id);
    const owner = connect(trip.id, { token: OWNER });
    const editor = connect(trip.id, { token: MEI });
    await owner.until((m) => m.type === "ready");
    await editor.until((m) => m.type === "ready");

    expect((await call("DELETE", `/api/trips/${trip.id}`, OWNER)).status).toBe(204);

    expect(await owner.closed).toBe(4403);
    expect(await editor.closed).toBe(4403);
  });

  it("lets a Viewer hear about changes without being listed, and cuts them off when the link goes off", async () => {
    const trip = await ownerTrip();
    const { token } = (await (await call("PUT", `/api/trips/${trip.id}/link`, OWNER, { enabled: true })).json()) as { token: string };
    const owner = connect(trip.id, { token: OWNER });
    await owner.until((m) => presenceOf(m)?.join() === "L");
    const viewer = connect(trip.id, { share: token }, "viewer-page");
    await viewer.until((m) => m.type === "ready");

    await call("POST", `/api/trips/${trip.id}/todos`, OWNER, { text: "Buy ICOCA" }, "lena-page");
    await viewer.until((m) => m.type === "changed");
    // Nothing about who is here (user ids) reaches a Viewer.
    expect(viewer.messages.filter((m) => m.type === "presence")).toEqual([]);
    expect(owner.messages.filter((m) => presenceOf(m)?.length !== 1 && m.type === "presence")).toEqual([]);

    await call("PUT", `/api/trips/${trip.id}/link`, OWNER, { enabled: false });
    expect(await viewer.closed).toBe(4403);
    expect(await connect(trip.id, { share: token }).closed).toBe(4403);
    expect(owner.messages.filter((m) => m.type === "changed")).toHaveLength(1);
  });

  it("refuses a share link of another Trip", async () => {
    const trip = await ownerTrip();
    const other = await ownerTrip();
    const { token } = (await (await call("PUT", `/api/trips/${other.id}/link`, OWNER, { enabled: true })).json()) as { token: string };

    expect(await connect(trip.id, { share: token }).closed).toBe(4403);
  });

  it("says nothing about reads, failed changes or sharing", async () => {
    const trip = await ownerTrip();
    const owner = connect(trip.id, { token: OWNER });
    await owner.until((m) => m.type === "ready");

    await call("GET", `/api/trips/${trip.id}/sharing`, OWNER);
    await call("POST", `/api/trips/${trip.id}/invitations`, OWNER, { email: "mei@example.com" });
    expect((await call("POST", `/api/trips/${trip.id}/todos`, OWNER, { text: "" })).status).toBe(400);
    // A change that does count marks the end: anything wrongly sent before it would show first.
    await call("POST", `/api/trips/${trip.id}/todos`, OWNER, { text: "Real" });
    await owner.until((m) => m.type === "changed");

    expect(owner.messages.filter((m) => m.type === "changed")).toHaveLength(1);
  });
});
