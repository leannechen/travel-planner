// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHooks, mergeGuest } from "./apiAuth";
import { AuthProvider, useAuth } from "./AuthProvider";
import { SessionEndedError, type AuthClient, type StartResult } from "./authClient";
import { forgetGuestId, guestId, peekGuestId } from "./guest";
import { PreferencesProvider } from "./preferences";

vi.mock("./apiAuth", async (importOriginal) => ({ ...(await importOriginal<typeof import("./apiAuth")>()), mergeGuest: vi.fn() }));

const lena = { sub: "auth0|lena", email: "lena@example.com" };

function stubClient(start: Partial<StartResult> = {}, over: Partial<AuthClient> = {}): AuthClient {
  return {
    start: async () => ({ returned: false, error: false, ...start }),
    loginRedirect: vi.fn(async () => undefined),
    loginPopup: vi.fn(async () => lena),
    logout: vi.fn(async () => undefined),
    getToken: vi.fn(async () => "token-1"),
    currentSub: vi.fn(async () => lena.sub),
    ...over,
  };
}

function Probe() {
  const auth = useAuth();
  return (
    <p data-testid="state">
      {auth.status}|{auth.email ?? "-"}|{auth.arrival ? `arrived:${auth.arrival.merged}` : "-"}|{auth.loginError ? "error" : "-"}
    </p>
  );
}

const renderProvider = (client: AuthClient) =>
  render(
    <PreferencesProvider>
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>
    </PreferencesProvider>,
  );

const state = () => screen.getByTestId("state").textContent;

beforeEach(() => {
  localStorage.clear();
  forgetGuestId();
  vi.mocked(mergeGuest).mockReset();
});
afterEach(cleanup);

describe("session start", () => {
  it("is loading until the client has answered, then guest without a session", async () => {
    let answer!: (r: StartResult) => void;
    renderProvider(stubClient({}, { start: () => new Promise((resolve) => (answer = resolve)) }));
    expect(state()).toBe("loading|-|-|-");
    await act(async () => answer({ returned: false, error: false }));
    expect(state()).toBe("guest|-|-|-");
  });

  it("is a user with an email when there is a session", async () => {
    renderProvider(stubClient({ user: lena }));
    await waitFor(() => expect(state()).toBe("user|lena@example.com|-|-"));
  });

  it("shows a login error only when the client reports one", async () => {
    const { unmount } = renderProvider(stubClient({ returned: true, error: false }));
    await waitFor(() => expect(state()).toContain("guest"));
    expect(state()).toContain("|-");
    unmount();
    renderProvider(stubClient({ returned: true, error: true }));
    await waitFor(() => expect(state()).toBe("guest|-|-|error"));
  });
});

describe("guest merge on login", () => {
  it("adds the guest's Trips to the account with the account token and the guest id, then forgets the guest", async () => {
    const guest = guestId();
    vi.mocked(mergeGuest).mockResolvedValue(2);
    renderProvider(stubClient({ user: lena, returned: true }));
    await waitFor(() => expect(state()).toBe("user|lena@example.com|arrived:2|-"));
    expect(mergeGuest).toHaveBeenCalledWith("token-1", guest);
    expect(peekGuestId()).toBeUndefined();
  });

  it("has nothing to merge for a visitor who never made a guest session", async () => {
    renderProvider(stubClient({ user: lena, returned: true }));
    await waitFor(() => expect(state()).toBe("user|lena@example.com|arrived:0|-"));
    expect(mergeGuest).not.toHaveBeenCalled();
  });

  it("keeps the guest id when the merge fails, so the next load tries again", async () => {
    const guest = guestId();
    vi.mocked(mergeGuest).mockRejectedValue(new Error("offline"));
    renderProvider(stubClient({ user: lena, returned: true }));
    await waitFor(() => expect(state()).toContain("user"));
    expect(peekGuestId()).toBe(guest);
  });

  it("tries a left-over guest id on a plain load too, without announcing an arrival", async () => {
    guestId();
    vi.mocked(mergeGuest).mockResolvedValue(1);
    renderProvider(stubClient({ user: lena, returned: false }));
    await waitFor(() => expect(state()).toBe("user|lena@example.com|-|-"));
    expect(mergeGuest).toHaveBeenCalledOnce();
  });

  it("does not merge for a guest", async () => {
    guestId();
    renderProvider(stubClient());
    await waitFor(() => expect(state()).toContain("guest"));
    expect(mergeGuest).not.toHaveBeenCalled();
  });
});

describe("request credentials", () => {
  it("sends the guest id for a guest, and the same one each time", async () => {
    renderProvider(stubClient());
    await waitFor(() => expect(state()).toContain("guest"));
    const first = await authHooks()!.headers();
    const second = await authHooks()!.headers();
    expect(first["x-guest-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual(first);
    expect(first).not.toHaveProperty("authorization");
  });

  it("sends the access token for a user, and never the guest id", async () => {
    renderProvider(stubClient({ user: lena }));
    await waitFor(() => expect(state()).toContain("user"));
    expect(await authHooks()!.headers()).toEqual({ authorization: "Bearer token-1" });
  });

  it("waits for the session to be known before answering", async () => {
    let answer!: (r: StartResult) => void;
    renderProvider(stubClient({}, { start: () => new Promise((resolve) => (answer = resolve)) }));
    let settled = false;
    const headers = authHooks()!.headers().then((h) => ((settled = true), h));
    await Promise.resolve();
    expect(settled).toBe(false);
    await act(async () => answer({ returned: false, error: false, user: lena }));
    expect(await headers).toEqual({ authorization: "Bearer token-1" });
  });
});

describe("session expiry", () => {
  it("becomes expired when the token cannot be renewed, and refuses further requests", async () => {
    const getToken = vi.fn<() => Promise<string>>().mockResolvedValueOnce("token-1").mockRejectedValue(new SessionEndedError());
    renderProvider(stubClient({ user: lena }, { getToken }));
    await waitFor(() => expect(state()).toContain("user"));
    await authHooks()!.headers().catch(() => undefined);
    await act(async () => {
      await expect(authHooks()!.headers()).rejects.toBeInstanceOf(SessionEndedError);
    });
    expect(state()).toBe("expired|lena@example.com|-|-");
    // It does not fall back to the guest id: that would show the wrong Trips.
    await expect(authHooks()!.headers()).rejects.toBeInstanceOf(SessionEndedError);
  });

  it("becomes expired when the API refuses the token", async () => {
    renderProvider(stubClient({ user: lena }));
    await waitFor(() => expect(state()).toContain("user"));
    act(() => authHooks()!.onSessionEnded());
    expect(state()).toContain("expired");
  });

  it("becomes expired when another tab logged in as someone else, instead of sending that token", async () => {
    const currentSub = vi.fn(async () => lena.sub);
    renderProvider(stubClient({ user: lena }, { currentSub }));
    await waitFor(() => expect(state()).toContain("user"));
    currentSub.mockResolvedValue("auth0|mei");
    await act(async () => {
      await expect(authHooks()!.headers()).rejects.toBeInstanceOf(SessionEndedError);
    });
    expect(state()).toContain("expired");
  });

  it("shows the login error strip when the popup login fails for another reason", async () => {
    const loginPopup = vi.fn(async () => {
      throw new Error("access_denied");
    });
    let auth!: ReturnType<typeof useAuth>;
    function Grab() {
      auth = useAuth();
      return null;
    }
    render(
      <PreferencesProvider>
        <AuthProvider client={stubClient({ user: lena }, { loginPopup })}>
          <Probe />
          <Grab />
        </AuthProvider>
      </PreferencesProvider>,
    );
    await waitFor(() => expect(state()).toContain("user"));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await auth.loginInPlace();
    });
    expect(outcome).toBe("closed");
    expect(state()).toContain("error");
  });

  it("a guest is never expired", async () => {
    renderProvider(stubClient());
    await waitFor(() => expect(state()).toContain("guest"));
    act(() => authHooks()!.onSessionEnded());
    expect(state()).toContain("guest");
  });

  it("logging in again in a popup makes the user a user again, with no page change", async () => {
    let call = 0;
    const getToken = vi.fn(async () => {
      if (++call === 2) throw new SessionEndedError();
      return `token-${call}`;
    });
    const client = stubClient({ user: lena }, { getToken });
    let auth!: ReturnType<typeof useAuth>;
    function Grab() {
      auth = useAuth();
      return null;
    }
    render(
      <PreferencesProvider>
        <AuthProvider client={client}>
          <Probe />
          <Grab />
        </AuthProvider>
      </PreferencesProvider>,
    );
    await waitFor(() => expect(state()).toContain("user"));
    await act(async () => void (await authHooks()!.headers().catch(() => undefined)));
    await act(async () => void (await authHooks()!.headers().catch(() => undefined)));
    expect(state()).toContain("expired");

    let outcome: string | undefined;
    await act(async () => {
      outcome = await auth.loginInPlace();
    });
    expect(outcome).toBe("same");
    expect(state()).toBe("user|lena@example.com|-|-");
    expect(client.loginPopup).toHaveBeenCalledWith({ language: "en" });
  });
});
