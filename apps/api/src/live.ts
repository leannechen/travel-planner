import type { Server } from "node:http";
import type { Express } from "express";
import { liveHelloSchema, MAX_LIVE_MESSAGE_BYTES, type LiveMessage, type LivePerson } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { resolveCaller, type TokenVerifier } from "./auth";
import type { Db } from "./db/client";
import { users } from "./db/schema";
import { canEditTrip, sharedTripId } from "./trips";

export const LIVE_PATH = "/api/live";
const HELLO_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 30_000;

// WebSocket close codes in the application range.
const CLOSE_NOT_LOGGED_IN = 4401;
const CLOSE_NO_ACCESS = 4403;
const CLOSE_BAD_HELLO = 4400;

type Connection = { tripId: string; socket: WebSocket; userId: string; initial: string | null; viewer: boolean; alive: boolean };

// Who has a Trip open right now, and a way to tell them it changed (ADR 0003: lightweight, last
// write wins; the page asks for the Trip again, so nothing about the change travels here).
export type LiveHub = {
  // Tells everyone with the Trip open that it changed; `origin` is the page that did it.
  publish(tripId: string, origin: string | null): void;
  // The user lost access to the Trip: their connections to it end.
  kick(tripId: string, userId: string): void;
  // The share link was turned off: everyone reading through it is disconnected.
  kickViewers(tripId: string): void;
  // The Trip was deleted: everyone connected to it is disconnected.
  kickAll(tripId: string): void;
  attach(server: Server): void;
  close(): void;
};

export function createLiveHub(db: Db, verifier: TokenVerifier): LiveHub {
  const rooms = new Map<string, Set<Connection>>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_LIVE_MESSAGE_BYTES });

  const send = (socket: WebSocket, message: LiveMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const people = (room: Set<Connection>): LivePerson[] => {
    const seen = new Map<string, LivePerson>();
    for (const c of room) if (!c.viewer && !seen.has(c.userId)) seen.set(c.userId, { id: c.userId, initial: c.initial });
    return [...seen.values()];
  };

  const announcePresence = (room: Set<Connection>) => {
    const message: LiveMessage = { type: "presence", people: people(room) };
    for (const c of room) if (!c.viewer) send(c.socket, message);
  };

  function leave(tripId: string, conn: Connection) {
    const room = rooms.get(tripId);
    if (!room?.delete(conn)) return;
    if (room.size === 0) rooms.delete(tripId);
    else if (!conn.viewer) announcePresence(room);
  }

  async function join(socket: WebSocket, raw: unknown) {
    const hello = liveHelloSchema.safeParse(raw);
    if (!hello.success) return socket.close(CLOSE_BAD_HELLO, "Bad hello");
    const { tripId, token, guest, share } = hello.data;
    // Known before the first wait: a connection that ends while it is being checked never joins.
    let gone = socket.readyState !== WebSocket.OPEN;
    socket.on("close", () => (gone = true));
    // A Viewer: the Trip behind a share link that is on. Not a person who is "here".
    if (share) {
      if ((await sharedTripId(db, share)) !== tripId) return socket.close(CLOSE_NO_ACCESS, "This link is off");
      if (gone) return;
      const viewer: Connection = { tripId, socket, userId: "", initial: null, viewer: true, alive: true };
      const room = rooms.get(tripId) ?? new Set<Connection>();
      rooms.set(tripId, room);
      room.add(viewer);
      socket.on("pong", () => (viewer.alive = true));
      socket.on("close", () => leave(tripId, viewer));
      // The link may have been turned off while this was being checked (the kick found no connection).
      if ((await sharedTripId(db, share)) !== tripId) {
        socket.close(CLOSE_NO_ACCESS, "This link is off");
        return leave(tripId, viewer);
      }
      // A Viewer is told nothing about who is here.
      send(socket, { type: "ready" });
      return;
    }
    const caller = await resolveCaller(db, verifier, token, guest);
    if (!caller.ok) return socket.close(CLOSE_NOT_LOGGED_IN, caller.code);
    if (!(await canEditTrip(db, caller.userId, tripId))) return socket.close(CLOSE_NO_ACCESS, "No access to this Trip");
    let label = caller.emailVerified === true ? (caller.email ?? null) : null;
    if (caller.accountId && !label) {
      const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, caller.userId));
      label = row?.email ?? null;
    }
    if (gone) return;
    const conn: Connection = { tripId, socket, userId: caller.userId, initial: label ? label.charAt(0).toUpperCase() : null, viewer: false, alive: true };
    const room = rooms.get(tripId) ?? new Set<Connection>();
    rooms.set(tripId, room);
    room.add(conn);
    socket.on("pong", () => (conn.alive = true));
    socket.on("close", () => leave(tripId, conn));
    // Access may have been removed while this was being checked (the removal's kick found no connection).
    if (!(await canEditTrip(db, caller.userId, tripId))) {
      socket.close(CLOSE_NO_ACCESS, "No access to this Trip");
      return leave(tripId, conn);
    }
    if (gone) return leave(tripId, conn);
    send(socket, { type: "ready" });
    announcePresence(room);
  }

  wss.on("connection", (socket) => {
    let joined = false;
    const timer = setTimeout(() => socket.close(CLOSE_BAD_HELLO, "No hello"), HELLO_TIMEOUT_MS);
    socket.on("close", () => clearTimeout(timer));
    socket.on("error", () => socket.terminate());
    // Only the first message counts; the pages have nothing else to say.
    socket.on("message", (data) => {
      if (joined) return;
      joined = true;
      clearTimeout(timer);
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return socket.close(CLOSE_BAD_HELLO, "Bad hello");
      }
      join(socket, raw).catch(() => socket.close(1011, "Could not join"));
    });
  });

  // Connections that stopped answering (a closed laptop) are dropped, so the Trip does not show
  // people who left.
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const conn of [...room]) {
        if (!conn.alive) {
          conn.socket.terminate();
          leave(conn.tripId, conn);
          continue;
        }
        conn.alive = false;
        conn.socket.ping();
      }
    }
  }, PING_INTERVAL_MS);
  heartbeat.unref();

  return {
    publish(tripId, origin) {
      const room = rooms.get(tripId);
      if (!room) return;
      for (const c of room) send(c.socket, { type: "changed", origin });
    },
    kick(tripId, userId) {
      for (const c of [...(rooms.get(tripId) ?? [])]) if (c.userId === userId) c.socket.close(CLOSE_NO_ACCESS, "No access to this Trip");
    },
    kickAll(tripId) {
      for (const c of [...(rooms.get(tripId) ?? [])]) c.socket.close(CLOSE_NO_ACCESS, "This Trip was deleted");
    },
    // Call close() before the server's own close(): that waits for open connections.
    kickViewers(tripId) {
      for (const c of [...(rooms.get(tripId) ?? [])]) if (c.viewer) c.socket.close(CLOSE_NO_ACCESS, "This link is off");
    },
    attach(server) {
      server.on("upgrade", (req, socket, head) => {
        // Not new URL(): it throws on targets like "//a:99999/", and a throw here ends the process.
        const path = (req.url ?? "").split("?")[0];
        if (path !== LIVE_PATH) return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      });
    },
    // Call before the server's own close(): that waits for open connections.
    close() {
      clearInterval(heartbeat);
      for (const room of rooms.values()) for (const c of room) c.socket.terminate();
      rooms.clear();
      wss.close();
    },
  };
}

// Starts the app and lets it take WebSocket connections on the same port.
export function listenLive(app: Express, port: number, onListening?: () => void): Server {
  const server = app.listen(port, onListening);
  (app.locals.live as LiveHub).attach(server);
  return server;
}
