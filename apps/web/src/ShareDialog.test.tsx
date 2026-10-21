// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getSharing, inviteEditor, removeEditor, revokeInvitation, setShareLink } from "./api";
import { PreferencesProvider } from "./preferences";
import { ShareDialog } from "./ShareDialog";

vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), getSharing: vi.fn(), inviteEditor: vi.fn(), removeEditor: vi.fn(), revokeInvitation: vi.fn(), setShareLink: vi.fn() }));

const mei = { userId: "11111111-1111-4111-8111-111111111111", email: "mei@example.com" };
const ken = { id: "22222222-2222-4222-8222-222222222222", email: "ken@example.com", token: "ken-token" };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  vi.mocked(getSharing).mockResolvedValue({ editors: [mei], invitations: [ken], link: { enabled: false, token: null } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const open = () =>
  render(
    <PreferencesProvider>
      <ShareDialog tripId="trip-1" tripTitle="Kyoto & Osaka" ownerEmail="lena@example.com" onClose={() => undefined} />
    </PreferencesProvider>,
  );

describe("ShareDialog", () => {
  it("lists the Owner, the Editors and the invitations that wait", async () => {
    open();
    expect(await screen.findByText("mei@example.com")).toBeTruthy();
    expect(screen.getByText("lena@example.com")).toBeTruthy();
    expect(screen.getByText("ken@example.com")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Invited")).toBeTruthy();
  });

  it("invites an address and shows the list again", async () => {
    vi.mocked(inviteEditor).mockResolvedValue(ken);
    open();
    await screen.findByText("mei@example.com");

    await userEvent.type(screen.getByPlaceholderText("Invite by email"), " Ana@Example.com ");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(inviteEditor).toHaveBeenCalledWith("trip-1", "ana@example.com");
    await waitFor(() => expect(getSharing).toHaveBeenCalledTimes(2));
    expect((screen.getByPlaceholderText("Invite by email") as HTMLInputElement).value).toBe("");
  });

  it("does not send an address that is not an email", async () => {
    open();
    await screen.findByText("mei@example.com");
    await userEvent.type(screen.getByPlaceholderText("Invite by email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(inviteEditor).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Enter a valid email address.");
  });

  it("shows the server's reason when an invitation is refused", async () => {
    vi.mocked(inviteEditor).mockRejectedValue(new ApiError("That person can already edit this Trip", "already_editor"));
    open();
    await screen.findByText("mei@example.com");
    await userEvent.type(screen.getByPlaceholderText("Invite by email"), "mei@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That person can already edit this Trip.");
    // What was typed stays, so it can be corrected.
    expect((screen.getByPlaceholderText("Invite by email") as HTMLInputElement).value).toBe("mei@example.com");
  });

  it("removes an Editor and withdraws an invitation", async () => {
    vi.mocked(removeEditor).mockResolvedValue();
    vi.mocked(revokeInvitation).mockResolvedValue();
    open();
    await screen.findByText("mei@example.com");

    await userEvent.click(screen.getByRole("button", { name: "Remove mei@example.com" }));
    expect(removeEditor).toHaveBeenCalledWith("trip-1", mei.userId);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw invitation to ken@example.com" }));
    expect(revokeInvitation).toHaveBeenCalledWith("trip-1", ken.id);
  });

  it("copies the invitation link", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    open();
    await screen.findByText("ken@example.com");

    await userEvent.click(screen.getByRole("button", { name: "Copy invitation link" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?invite=ken-token`);
    vi.unstubAllGlobals();
  });
});

describe("ShareDialog link sharing", () => {
  it("turns the read-only link on and shows it with a Copy link button", async () => {
    vi.mocked(getSharing).mockResolvedValueOnce({ editors: [], invitations: [], link: { enabled: false, token: "k7Qx2mAbCdEf" } });
    vi.mocked(setShareLink).mockResolvedValue({ enabled: true, token: "k7Qx2mAbCdEf" });
    vi.mocked(getSharing).mockResolvedValueOnce({ editors: [], invitations: [], link: { enabled: true, token: "k7Qx2mAbCdEf" } });
    open();
    const toggle = await screen.findByRole("switch", { name: "Link sharing" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(toggle);

    expect(setShareLink).toHaveBeenCalledWith("trip-1", true);
    await waitFor(() => expect((screen.getByRole("switch", { name: "Link sharing" }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole("textbox", { name: "Link sharing" }) as HTMLInputElement).value).toBe(`${window.location.origin}/t/k7Qx2mAbCdEf`);
    expect((screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reacts only to the switch itself, not to its text", async () => {
    vi.mocked(getSharing).mockResolvedValue({ editors: [], invitations: [], link: { enabled: false, token: null } });
    open();
    await screen.findByRole("switch", { name: "Link sharing" });

    await userEvent.click(screen.getByText("Link sharing"));

    expect(setShareLink).not.toHaveBeenCalled();
  });

  it("says what turning the link off does, and turns it off", async () => {
    vi.mocked(getSharing).mockResolvedValueOnce({ editors: [], invitations: [], link: { enabled: true, token: "k7Qx2mAbCdEf" } });
    vi.mocked(getSharing).mockResolvedValueOnce({ editors: [], invitations: [], link: { enabled: false, token: "k7Qx2mAbCdEf" } });
    vi.mocked(setShareLink).mockResolvedValue({ enabled: false, token: "k7Qx2mAbCdEf" });
    open();
    await userEvent.click(await screen.findByRole("switch", { name: "Link sharing" }));

    expect(setShareLink).toHaveBeenCalledWith("trip-1", false);
    expect(await screen.findByText(/People who open the old link see a notice/)).toBeTruthy();
  });

  it("shows an error when the link could not be changed", async () => {
    vi.mocked(getSharing).mockResolvedValue({ editors: [], invitations: [], link: { enabled: false, token: null } });
    vi.mocked(setShareLink).mockRejectedValue(new Error("boom"));
    open();
    await userEvent.click(await screen.findByRole("switch", { name: "Link sharing" }));

    expect(await screen.findByText("The link could not be changed.")).toBeTruthy();
  });
});
