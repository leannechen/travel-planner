import { randomBytes } from "node:crypto";
import { maskEmail, type AcceptedInvitation, type Invitation, type InvitationPreview, type ShareLink, type Sharing } from "@travel-planner/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { tripInvitations, tripMembers, trips, users } from "./db/schema";

// How an invitation reaches its address. Sending real email is not built yet; the fake only logs
// the link, and the Owner can copy the link from the Share dialog.
export type InvitationMailer = {
  send(invitation: { to: string; inviterEmail: string | null; tripTitle: string; link: string }): Promise<void>;
};

export function logInvitationMailer(log: (line: string) => void = console.log): InvitationMailer {
  return {
    async send({ to, tripTitle, link }) {
      // JSON quoting keeps line breaks in a title from forging extra log lines.
      log(`Invitation to edit ${JSON.stringify(tripTitle)} for ${JSON.stringify(to)}: ${link}`);
    },
  };
}

// Asks Auth0 to send the verification email again.
export type IdentityAdmin = {
  resendVerification(sub: string): Promise<void>;
};

export function logIdentityAdmin(log: (line: string) => void = console.log): IdentityAdmin {
  return {
    async resendVerification(sub) {
      log(`Verification email requested again for ${sub}`);
    },
  };
}

export class IdentityAdminError extends Error {}

// Auth0 Management API: a machine-to-machine application with the `update:users` scope (the
// verification email job). The token is asked for again on each call, which is rare enough.
export function auth0IdentityAdmin(
  { domain, clientId, clientSecret }: { domain: string; clientId: string; clientSecret: string },
  fetchFn: typeof fetch = fetch,
): IdentityAdmin {
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const call = async (path: string, body: unknown, token?: string) => {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new IdentityAdminError(`Auth0 could not be reached (${err instanceof Error ? err.message : "unknown error"})`);
    }
    if (!res.ok) throw new IdentityAdminError(`Auth0 refused the request (${res.status})`);
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  };
  return {
    async resendVerification(sub) {
      const granted = await call("/oauth/token", {
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        audience: `${base}/api/v2/`,
      });
      if (typeof granted.access_token !== "string") throw new IdentityAdminError("Auth0 gave no token");
      await call("/api/v2/jobs/verification-email", { user_id: sub }, granted.access_token);
    },
  };
}

export function identityAdminFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityAdmin {
  const domain = env.AUTH0_DOMAIN?.trim();
  const clientId = env.AUTH0_M2M_CLIENT_ID?.trim();
  const clientSecret = env.AUTH0_M2M_CLIENT_SECRET?.trim();
  return domain && clientId && clientSecret ? auth0IdentityAdmin({ domain, clientId, clientSecret }) : logIdentityAdmin();
}

const newToken = () => randomBytes(24).toString("base64url");

// The share link's secret: short enough to read out, long enough to be unguessable (72 bits).
const newLinkToken = () => randomBytes(9).toString("base64url");

// Turns the Trip's read-only link on or off. The secret is made the first time and kept, so turning
// the link on again gives the same address. undefined: not the Owner's Trip.
export async function setShareLink(db: Db, userId: string, tripId: string, enabled: boolean): Promise<ShareLink | undefined> {
  const trip = await ownedTrip(db, userId, tripId);
  if (!trip) return undefined;
  const [row] = await db
    .update(trips)
    .set({ shareEnabled: enabled, shareToken: sql`coalesce(${trips.shareToken}, ${newLinkToken()})` })
    .where(eq(trips.id, tripId))
    .returning({ enabled: trips.shareEnabled, token: trips.shareToken });
  return row;
}

// Whether the Trip is the user's own.
export async function ownsTrip(db: Db, userId: string, tripId: string): Promise<boolean> {
  return Boolean(await ownedTrip(db, userId, tripId));
}

async function ownedTrip(db: Db, userId: string, tripId: string) {
  const [trip] = await db
    .select({ id: trips.id, title: trips.title })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.ownerId, userId)));
  return trip;
}

// Invites an address to edit the Trip. Asking again for the same address gives the same invitation.
// undefined: not the Owner's Trip (or no such Trip). `ownEmail` is the address in the Owner's
// token, verified or not: only verified addresses are kept, but an unverified one is still theirs.
export async function inviteEditor(
  db: Db,
  userId: string,
  tripId: string,
  email: string,
  ownEmail?: string,
): Promise<{ invitation: Invitation; tripTitle: string } | "owner" | "editor" | undefined> {
  const trip = await ownedTrip(db, userId, tripId);
  if (!trip) return undefined;
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (owner?.email === email || ownEmail === email) return "owner";
  const [member] = await db
    .select({ userId: tripMembers.userId })
    .from(tripMembers)
    .innerJoin(users, eq(users.id, tripMembers.userId))
    .where(and(eq(tripMembers.tripId, tripId), eq(users.email, email)));
  if (member) return "editor";
  const [row] = await db
    .insert(tripInvitations)
    .values({ tripId, email, token: newToken(), invitedBy: userId })
    .onConflictDoUpdate({ target: [tripInvitations.tripId, tripInvitations.email], set: { tripId } })
    .returning({ id: tripInvitations.id, email: tripInvitations.email, token: tripInvitations.token, acceptedBy: tripInvitations.acceptedBy });
  // Accepted already (the Editor has since changed their address, so the check above missed it).
  if (row!.acceptedBy) return "editor";
  return { invitation: { id: row!.id, email: row!.email, token: row!.token }, tripTitle: trip.title };
}

// Who can edit the Trip and which invitations are still waiting; undefined when it is not the Owner's.
export async function getSharing(db: Db, userId: string, tripId: string): Promise<Sharing | undefined> {
  if (!(await ownedTrip(db, userId, tripId))) return undefined;
  const [link] = await db.select({ enabled: trips.shareEnabled, token: trips.shareToken }).from(trips).where(eq(trips.id, tripId));
  const editors = await db
    .select({ userId: tripMembers.userId, email: users.email })
    .from(tripMembers)
    .innerJoin(users, eq(users.id, tripMembers.userId))
    .where(eq(tripMembers.tripId, tripId))
    .orderBy(asc(tripMembers.createdAt), asc(tripMembers.userId));
  const waiting = await db
    .select({ id: tripInvitations.id, email: tripInvitations.email, token: tripInvitations.token, acceptedBy: tripInvitations.acceptedBy })
    .from(tripInvitations)
    .where(eq(tripInvitations.tripId, tripId))
    .orderBy(asc(tripInvitations.createdAt), asc(tripInvitations.id));
  return { editors, invitations: waiting.filter((i) => !i.acceptedBy).map((i) => ({ id: i.id, email: i.email, token: i.token })), link: link! };
}

export async function removeEditor(db: Db, userId: string, tripId: string, editorId: string): Promise<true | undefined> {
  if (!(await ownedTrip(db, userId, tripId))) return undefined;
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, editorId)))
      .returning({ userId: tripMembers.userId });
    // Their accepted invitation goes too, so the address can be invited again.
    await tx.delete(tripInvitations).where(and(eq(tripInvitations.tripId, tripId), eq(tripInvitations.acceptedBy, editorId)));
    return removed.length > 0 ? true : undefined;
  });
}

export async function revokeInvitation(db: Db, userId: string, tripId: string, invitationId: string): Promise<true | undefined> {
  if (!(await ownedTrip(db, userId, tripId))) return undefined;
  const removed = await db
    .delete(tripInvitations)
    .where(and(eq(tripInvitations.id, invitationId), eq(tripInvitations.tripId, tripId), isNull(tripInvitations.acceptedBy)))
    .returning({ id: tripInvitations.id });
  return removed.length > 0 ? true : undefined;
}

// What the invitation page shows to whoever holds the link. An accepted invitation is gone for others.
export async function previewInvitation(db: Db, token: string): Promise<InvitationPreview | undefined> {
  const [row] = await db
    .select({ tripTitle: trips.title, invitedEmail: tripInvitations.email, inviterEmail: users.email })
    .from(tripInvitations)
    .innerJoin(trips, eq(trips.id, tripInvitations.tripId))
    .innerJoin(users, eq(users.id, tripInvitations.invitedBy))
    .where(and(eq(tripInvitations.token, token), isNull(tripInvitations.acceptedBy)));
  return row && { ...row, invitedEmail: maskEmail(row.invitedEmail) };
}

export type AcceptFailure = "not-found" | "wrong-account" | "not-verified";

// Accepts the invitation for the account that asks: its email must be the invited one and verified
// (PRD §8). Asking again as the same account gives the same answer.
export async function acceptInvitation(
  db: Db,
  account: { userId: string; email?: string; emailVerified?: boolean },
  token: string,
): Promise<AcceptedInvitation | AcceptFailure> {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select({
        id: tripInvitations.id,
        tripId: tripInvitations.tripId,
        email: tripInvitations.email,
        acceptedBy: tripInvitations.acceptedBy,
        tripTitle: trips.title,
        ownerId: trips.ownerId,
      })
      .from(tripInvitations)
      .innerJoin(trips, eq(trips.id, tripInvitations.tripId))
      .where(eq(tripInvitations.token, token))
      .for("update", { of: tripInvitations });
    if (!invitation) return "not-found";
    const done = { tripId: invitation.tripId, tripTitle: invitation.tripTitle };
    if (invitation.acceptedBy) return invitation.acceptedBy === account.userId ? done : "not-found";
    if (!account.email || account.email !== invitation.email) return "wrong-account";
    if (account.emailVerified !== true) return "not-verified";
    // The Owner opening their own invitation just goes to the Trip.
    if (invitation.ownerId === account.userId) return done;
    await tx.insert(tripMembers).values({ tripId: invitation.tripId, userId: account.userId }).onConflictDoNothing();
    await tx.update(tripInvitations).set({ acceptedBy: account.userId }).where(eq(tripInvitations.id, invitation.id));
    return done;
  });
}
