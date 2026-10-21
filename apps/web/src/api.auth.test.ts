import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "./apiAuth";
import { listTrips } from "./api";
import { SessionEndedError } from "./authClient";

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  configureApi(undefined);
  vi.unstubAllGlobals();
});

describe("API requests", () => {
  it("carry the credentials the session gives", async () => {
    configureApi({ headers: async () => ({ authorization: "Bearer abc" }), onSessionEnded: vi.fn() });
    fetchMock.mockResolvedValue(answer(200, []));
    await listTrips();
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ authorization: "Bearer abc" });
  });

  it("treat a refused token as the end of the session", async () => {
    const onSessionEnded = vi.fn();
    configureApi({ headers: async () => ({ authorization: "Bearer old" }), onSessionEnded });
    fetchMock.mockResolvedValue(answer(401, { error: "Your session is not valid", code: "invalid_token" }));
    await expect(listTrips()).rejects.toBeInstanceOf(SessionEndedError);
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it("do not treat other refusals as the end of the session", async () => {
    const onSessionEnded = vi.fn();
    configureApi({ headers: async () => ({}), onSessionEnded });
    fetchMock.mockResolvedValue(answer(401, { error: "Log in or start a guest session first", code: "no_session" }));
    await expect(listTrips()).rejects.toThrow("Log in or start a guest session first");
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("send nothing when the session has ended", async () => {
    configureApi({
      headers: async () => {
        throw new SessionEndedError();
      },
      onSessionEnded: vi.fn(),
    });
    await expect(listTrips()).rejects.toBeInstanceOf(SessionEndedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
