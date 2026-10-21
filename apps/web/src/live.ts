import { liveMessageSchema, type LiveHello, type LivePerson } from "@travel-planner/shared";
import { authHooks } from "./apiAuth";
import { clientId } from "./api";
import { SessionEndedError } from "./authClient";

export type LiveHandlers = {
  // The connection is up (also after a reconnect): the Trip may have changed meanwhile.
  onReady: () => void;
  // Someone else changed the Trip.
  onChanged: () => void;
  onPresence: (people: LivePerson[]) => void;
  // The server refuses this page the Trip (no longer an Editor, or not logged in); it does not retry.
  onDenied: () => void;
};

type SocketLike = Pick<WebSocket, "send" | "close" | "onopen" | "onmessage" | "onclose" | "onerror">;
type SocketFactory = (url: string) => SocketLike;

// Tests have no server to talk to: they leave live updates off unless they bring their own socket.
let makeSocket: SocketFactory | undefined = import.meta.env.MODE === "test" ? undefined : (url) => new WebSocket(url);
export function setLiveSocketFactory(factory: SocketFactory | undefined) {
  makeSocket = factory;
}

// The close codes the API uses for "log in first" and "no access to this Trip".
const DENIED_CODES = new Set([4401, 4403]);
const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

// Keeps a connection to the API for the open Trip until the returned function is called, reconnecting
// after a break (the network, a deploy). It carries no data: only "something changed" and who is here.
export function openLive(tripId: string, handlers: LiveHandlers): () => void {
  let stopped = false;
  let socket: SocketLike | undefined;
  let retry = MIN_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleRetry() {
    timer = setTimeout(() => void connect(), retry);
    retry = Math.min(retry * 2, MAX_RETRY_MS);
  }

  async function connect() {
    if (stopped || !makeSocket) return;
    let credentials: Pick<LiveHello, "token" | "guest">;
    try {
      const headers = (await authHooks()?.headers()) ?? {};
      const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? "")?.[1];
      credentials = bearer ? { token: bearer } : headers["x-guest-id"] ? { guest: headers["x-guest-id"] } : {};
    } catch (err) {
      if (err instanceof SessionEndedError) return; // The page says so itself.
      scheduleRetry(); // Perhaps offline: the token could not be refreshed.
      return;
    }
    if (stopped) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`;
    const ws = makeSocket(url);
    socket = ws;
    ws.onopen = () => {
      const hello: LiveHello = { type: "hello", tripId, clientId, ...credentials };
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = liveMessageSchema.parse(JSON.parse(String(event.data)));
      } catch {
        return;
      }
      if (message.type === "ready") {
        retry = MIN_RETRY_MS;
        handlers.onReady();
      } else if (message.type === "changed") {
        if (message.origin !== clientId) handlers.onChanged();
      } else {
        handlers.onPresence(message.people);
      }
    };
    ws.onclose = (event) => {
      if (socket === ws) socket = undefined;
      handlers.onPresence([]);
      if (stopped) return;
      if (DENIED_CODES.has(event.code)) {
        handlers.onDenied();
        return;
      }
      scheduleRetry();
    };
    ws.onerror = () => undefined; // onclose follows
  }

  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
