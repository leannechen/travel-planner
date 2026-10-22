import {
  CLIENT_ID_HEADER,
  createDayInputSchema,
  createEventInputSchema,
  createLegInputSchema,
  createNoteInputSchema,
  createTodoInputSchema,
  createTripInputSchema,
  updateTripInputSchema,
  deletedEventSchema,
  restoreNoteInputSchema,
  setShareLinkInputSchema,
  holdingAreaSchema,
  inviteEditorInputSchema,
  MAX_IMAGE_BYTES,
  MAX_PLACE_IDS,
  MAX_PLACE_QUERY_LENGTH,
  placeIdSchema,
  showsOpeningHours,
  reorderDaysInputSchema,
  restoreDayInputSchema,
  updateEventInputSchema,
  updateLegInputSchema,
  updateNoteInputSchema,
  updateTodoInputSchema,
} from "@travel-planner/shared";
import type { HealthResponse, Me, SampleTripResponse } from "@travel-planner/shared";
import { eq } from "drizzle-orm";
import express from "express";
import { z, ZodError } from "zod";
import type { Db } from "./db/client";
import { users } from "./db/schema";
import { acceptInvitation, getSharing, identityAdminFromEnv, IdentityAdminError, inviteEditor, logInvitationMailer, previewInvitation, removeEditor, revokeInvitation, setShareLink, type IdentityAdmin, type InvitationMailer } from "./sharing";
import { authenticate, GUEST_HEADER, mergeGuest, verifierFromEnv, type TokenVerifier } from "./auth";
import { createLiveHub } from "./live";
import { createLeg, deleteLeg, isProviderError, listLegs, setLegMode, syncLegs } from "./legs";
import { openSampleTrip } from "./sample-trip";
import { fetchOpeningHours, getOpeningHours, getPlacePhoto, getPlaces, PlaceProviderError, placeProviderFromEnv, searchPlaces, type PlaceProvider } from "./places";
import { imageStoreFromEnv, prepareImage, type ImageStore } from "./images";
import { routeProviderFromEnv, type RouteProvider } from "./routes";
import {
  addEvent,
  addHeldEvent,
  addNote,
  addTodo,
  createTrip,
  deleteDay,
  deleteEvent,
  deleteNote,
  deleteTodo,
  findEventImage,
  findEventPlace,
  findSharedEventImage,
  findSharedEventPlace,
  removeEventImage,
  setEventImage,
  getSharedTrip,
  sharedPlaceIds,
  insertDay,
  listTrips,
  ownPlaceIds,
  canEditTrip,
  reorderDays,
  restoreDay,
  restoreEvent,
  restoreNote,
  setOpeningHours,
  updateEvent,
  updateNote,
  updateTrip,
  updateTodo,
} from "./trips";

const invitationParamsSchema = z.object({ token: z.string().min(1).max(200) });
const editorParamsSchema = z.object({ tripId: z.uuid(), editorId: z.uuid() });
const invitationIdParamsSchema = z.object({ tripId: z.uuid(), invitationId: z.uuid() });
const tripParamsSchema = z.object({ tripId: z.uuid() });
const eventIdParamsSchema = z.object({ tripId: z.uuid(), eventId: z.uuid() });
const dayParamsSchema = z.object({ tripId: z.uuid(), dayId: z.uuid() });
const todoParamsSchema = z.object({ tripId: z.uuid(), todoId: z.uuid() });
const legParamsSchema = z.object({ tripId: z.uuid(), legId: z.uuid() });
const noteParamsSchema = z.object({ tripId: z.uuid(), noteId: z.uuid() });
const areaParamsSchema = z.object({ tripId: z.uuid(), area: holdingAreaSchema });

const UNKNOWN_PLACE = "That place is not known";
const LODGING_ERROR = "A Lodging needs at least one night, and every night must fall on a Day of the Trip";

const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(MAX_PLACE_QUERY_LENGTH) });
const idsQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(placeIdSchema).max(MAX_PLACE_IDS)),
});

export function createApp(db: Db, options: { places?: PlaceProvider; routes?: RouteProvider; auth?: TokenVerifier; mailer?: InvitationMailer; identityAdmin?: IdentityAdmin; appOrigin?: string; images?: ImageStore } = {}) {
  const images = options.images ?? imageStoreFromEnv();
  const mailer = options.mailer ?? logInvitationMailer();
  const identityAdmin = options.identityAdmin ?? identityAdminFromEnv();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN ?? "http://localhost:5173";
  const provider = options.places ?? placeProviderFromEnv();
  const legDeps = { places: provider, routes: options.routes ?? routeProviderFromEnv() };
  // After Events or Days change: Legs between Events that are no longer adjacent go, and Legs whose
  // places changed are calculated again.
  const syncTripLegs = (tripId: string) => syncLegs(db, legDeps, tripId);
  // The ids an Event refers to must be places the provider knows.
  const unknownPlace = async (...ids: (string | null | undefined)[]) => {
    const wanted = ids.filter((id): id is string => Boolean(id));
    return wanted.length > 0 && (await getPlaces(db, provider, wanted)).length !== new Set(wanted).size;
  };
  const app = express();
  app.use(express.json());
  const verifier = options.auth ?? verifierFromEnv();
  const live = createLiveHub(db, verifier);
  app.locals.live = live;

  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
  });

  // The invitation page is shown before login, to whoever holds the link (its token is the secret).
  app.get("/api/invitations/:token", async (req, res) => {
    const { token } = invitationParamsSchema.parse(req.params);
    const preview = await previewInvitation(db, token);
    if (!preview) {
      res.status(404).json({ error: "This invitation is not valid any more", code: "invitation_not_found" });
      return;
    }
    res.json(preview);
  });

  // Sends a stored image, or 404. The browser keeps it only while the server says it is still the
  // same one (the ETag), so a replaced or removed image, or a link turned off, is never shown stale.
  const sendImage = async (res: express.Response, found: { key: string; contentType: string } | undefined) => {
    const bytes = found && (await images.get(found.key));
    if (!found || !bytes) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
    res.set({ "Content-Type": found.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache" });
    res.send(bytes);
  };

  // Everything below is for an account or a guest session.
  // What a Viewer opens (PRD §8): no login, only the Trip behind a share link that is on.
  const shareParamsSchema = z.object({ token: z.string().min(1).max(200) });
  app.get("/api/shared/:token", async (req, res) => {
    const { token } = shareParamsSchema.parse(req.params);
    const trip = await getSharedTrip(db, token);
    if (trip === "off") {
      res.status(404).json({ error: "This link is turned off", code: "link_off" });
    } else if (!trip) {
      res.status(404).json({ error: "This link does not lead to a Trip", code: "link_not_found" });
    } else {
      res.json(trip);
    }
  });

  app.get("/api/shared/:token/places", async (req, res) => {
    const { token } = shareParamsSchema.parse(req.params);
    const { ids } = idsQuerySchema.parse(req.query);
    res.json({ places: await getPlaces(db, provider, await sharedPlaceIds(db, token, ids)) });
  });

  app.get("/api/shared/:token/opening-hours", async (req, res) => {
    const { token } = shareParamsSchema.parse(req.params);
    const { ids } = idsQuerySchema.parse(req.query);
    res.json({ openingHours: Object.fromEntries(await getOpeningHours(db, provider, await sharedPlaceIds(db, token, ids))) });
  });

  app.get("/api/shared/:token/events/:eventId/image", async (req, res) => {
    const { token } = shareParamsSchema.parse(req.params);
    const { eventId } = z.object({ eventId: z.uuid() }).parse(req.params);
    await sendImage(res, await findSharedEventImage(db, token, eventId));
  });

  // Answers with the place's Google photo, or 404 when there is nothing to show. Only the Event's own
  // place is asked about, so the key cannot be used to look up any place. The address is short-lived.
  // The photo is the default only: an upload comes first and taking the image off hides it, so neither
  // is looked up (which would also cost a Google request for nothing).
  const sendPlacePhoto = async (res: express.Response, found: { placeId: string | null; imageId: string | null; placePhotoHidden: boolean } | undefined) => {
    const photo = found?.placeId && !found.imageId && !found.placePhotoHidden ? await getPlacePhoto(db, provider, found.placeId) : undefined;
    if (!photo) {
      res.status(404).json({ error: "No place photo", code: "no_place_photo" });
      return;
    }
    res.set("Cache-Control", "private, no-store");
    res.json(photo);
  };

  app.get("/api/shared/:token/events/:eventId/place-photo", async (req, res) => {
    const { token } = shareParamsSchema.parse(req.params);
    const { eventId } = z.object({ eventId: z.uuid() }).parse(req.params);
    await sendPlacePhoto(res, await findSharedEventPlace(db, token, eventId));
  });

  app.use("/api", authenticate(db, verifier));

  // Anyone with the Trip open is told when a request changed it (a Trip is changed by what happens
  // under its address). Sharing is not part of the Trip's content.
  app.use("/api/trips/:tripId", (req, res, next) => {
    const { tripId } = req.params;
    const changes = req.method !== "GET" && !/^\/(invitations|editors|sharing|link)(\/|$)/.test(req.path) && z.uuid().safeParse(tripId).success;
    if (changes) {
      res.on("finish", () => {
        if (res.statusCode < 400) live.publish(String(tripId), req.header(CLIENT_ID_HEADER) ?? null);
      });
    }
    next();
  });

  app.get("/api/me", (_req, res) => {
    const body: Me = { id: res.locals.userId, guest: !res.locals.accountId };
    res.json(body);
  });

  // After login: the guest session's Trips are added to the account (nothing is overwritten). The
  // request carries the account token and the guest id the browser kept; asking again does nothing.
  app.post("/api/me/merge-guest", async (req, res) => {
    if (!res.locals.accountId) {
      res.status(401).json({ error: "Log in first", code: "no_session" });
      return;
    }
    const guestToken = z.uuid().safeParse(req.header(GUEST_HEADER));
    const merged = guestToken.success ? await mergeGuest(db, res.locals.accountId, guestToken.data) : 0;
    res.json({ merged });
  });

  app.post("/api/me/resend-verification", async (_req, res) => {
    if (!res.locals.sub) {
      res.status(401).json({ error: "Log in first", code: "no_session" });
      return;
    }
    try {
      await identityAdmin.resendVerification(res.locals.sub);
    } catch (err) {
      if (!(err instanceof IdentityAdminError)) throw err;
      res.status(502).json({ error: "The verification email could not be sent. Try again in a moment." });
      return;
    }
    res.status(204).end();
  });

  // Accepting an invitation needs an account whose verified email is the invited one.
  app.post("/api/invitations/:token/accept", async (req, res) => {
    const { token } = invitationParamsSchema.parse(req.params);
    if (!res.locals.accountId) {
      res.status(401).json({ error: "Log in first", code: "no_session" });
      return;
    }
    const result = await acceptInvitation(
      db,
      { userId: res.locals.userId, email: res.locals.email, emailVerified: res.locals.emailVerified },
      token,
    );
    if (typeof result === "object") {
      res.json(result);
    } else if (result === "not-found") {
      res.status(404).json({ error: "This invitation is not valid any more", code: "invitation_not_found" });
    } else if (result === "wrong-account") {
      res.status(403).json({ error: "This invitation is for another account", code: "wrong_account" });
    } else {
      res.status(403).json({ error: "Verify your email address first", code: "email_not_verified" });
    }
  });

  app.get("/api/places/search", async (req, res) => {
    const { q } = searchQuerySchema.parse(req.query);
    res.json({ places: await searchPlaces(db, provider, q) });
  });

  app.get("/api/places", async (req, res) => {
    const { ids } = idsQuerySchema.parse(req.query);
    res.json({ places: await getPlaces(db, provider, ids) });
  });

  // The opening hours for these places, for the Events that have them on. A place without hours, or
  // whose hours could not be fetched, is left out, and so is one none of the user's Events uses.
  app.get("/api/places/opening-hours", async (req, res) => {
    const { ids } = idsQuerySchema.parse(req.query);
    const own = await ownPlaceIds(db, res.locals.userId, ids);
    res.json({ openingHours: Object.fromEntries(await getOpeningHours(db, provider, own)) });
  });

  app.get("/api/trips", async (_req, res) => {
    res.json(await listTrips(db, res.locals.userId));
  });

  app.post("/api/trips", async (req, res) => {
    const input = createTripInputSchema.parse(req.body);
    res.status(201).json(await createTrip(db, res.locals.userId, input));
  });

  // The user's copy of the sample Trip, made on the first request and opened after that (PRD §1).
  // Guests too: this is how a new visitor gets a first Trip.
  app.post("/api/sample-trip", async (_req, res) => {
    const opened: SampleTripResponse = await openSampleTrip(db, legDeps, res.locals.userId);
    res.status(opened.created ? 201 : 200).json(opened);
  });

  app.patch("/api/trips/:tripId", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = updateTripInputSchema.parse(req.body);
    const trip = await updateTrip(db, res.locals.userId, tripId, input);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(trip);
  });

  // Sharing is for accounts (a guest logs in first, PRD §8) and the Owner's: an Editor's Trip
  // answers 404 as if it were not theirs.
  const accountOnly: express.RequestHandler = (_req, res, next) => {
    if (res.locals.accountId) next();
    else res.status(401).json({ error: "Log in first", code: "no_session" });
  };
  app.use("/api/trips/:tripId/sharing", accountOnly);
  app.use("/api/trips/:tripId/link", accountOnly);
  app.use("/api/trips/:tripId/invitations", accountOnly);
  app.use("/api/trips/:tripId/editors", accountOnly);
  app.get("/api/trips/:tripId/sharing", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const sharing = await getSharing(db, res.locals.userId, tripId);
    if (!sharing) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(sharing);
  });

  app.put("/api/trips/:tripId/link", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const { enabled } = setShareLinkInputSchema.parse(req.body);
    const link = await setShareLink(db, res.locals.userId, tripId, enabled);
    if (!link) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    // Viewers already reading the Trip are cut off.
    if (!enabled) live.kickViewers(tripId);
    res.json(link);
  });

  app.post("/api/trips/:tripId/invitations", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const { email } = inviteEditorInputSchema.parse(req.body);
    const result = await inviteEditor(db, res.locals.userId, tripId, email, res.locals.email);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
    } else if (result === "owner") {
      res.status(409).json({ error: "That is your own address", code: "own_address" });
    } else if (result === "editor") {
      res.status(409).json({ error: "That person can already edit this Trip", code: "already_editor" });
    } else {
      const [inviter] = await db.select({ email: users.email }).from(users).where(eq(users.id, res.locals.userId));
      await mailer.send({
        to: result.invitation.email,
        inviterEmail: inviter?.email ?? null,
        tripTitle: result.tripTitle,
        link: `${appOrigin}/?invite=${result.invitation.token}`,
      });
      res.status(201).json(result.invitation);
    }
  });

  app.delete("/api/trips/:tripId/invitations/:invitationId", async (req, res) => {
    const { tripId, invitationId } = invitationIdParamsSchema.parse(req.params);
    if (!(await revokeInvitation(db, res.locals.userId, tripId, invitationId))) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    res.status(204).end();
  });

  app.delete("/api/trips/:tripId/editors/:editorId", async (req, res) => {
    const { tripId, editorId } = editorParamsSchema.parse(req.params);
    if (!(await removeEditor(db, res.locals.userId, tripId, editorId))) {
      res.status(404).json({ error: "Editor not found" });
      return;
    }
    live.kick(tripId, editorId);
    res.status(204).end();
  });

  app.post("/api/trips/:tripId/days/:dayId/events", async (req, res) => {
    const { tripId, dayId } = dayParamsSchema.parse(req.params);
    const input = createEventInputSchema.parse(req.body);
    if (!(await canEditTrip(db, res.locals.userId, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (await unknownPlace(input.placeId, input.destinationId)) {
      res.status(400).json({ error: UNKNOWN_PLACE });
      return;
    }
    const event = await addEvent(db, res.locals.userId, tripId, dayId, input);
    if (!event) {
      res.status(404).json({ error: "Day not found" });
      return;
    }
    if (event === "invalid-lodging") {
      res.status(400).json({ error: LODGING_ERROR });
      return;
    }
    await syncTripLegs(tripId);
    res.status(201).json(event);
  });

  app.post("/api/trips/:tripId/:area/events", async (req, res) => {
    const { tripId, area } = areaParamsSchema.parse(req.params);
    const input = createEventInputSchema.parse(req.body);
    if (!(await canEditTrip(db, res.locals.userId, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (await unknownPlace(input.placeId, input.destinationId)) {
      res.status(400).json({ error: UNKNOWN_PLACE });
      return;
    }
    const event = await addHeldEvent(db, res.locals.userId, tripId, area, input);
    if (!event) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (event === "invalid-lodging") {
      res.status(400).json({ error: "A Lodging needs at least one night" });
      return;
    }
    res.status(201).json(event);
  });

  app.patch("/api/trips/:tripId/events/:eventId", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const input = updateEventInputSchema.parse(req.body);
    if (!(await canEditTrip(db, res.locals.userId, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (await unknownPlace(input.placeId, input.destinationId)) {
      res.status(400).json({ error: UNKNOWN_PLACE });
      return;
    }
    const result = await updateEvent(db, res.locals.userId, tripId, eventId, input);
    if (!result) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (result === "invalid-day") {
      res.status(400).json({ error: "The Day is not in this Trip" });
      return;
    }
    if (result === "invalid-lodging") {
      res.status(400).json({ error: LODGING_ERROR });
      return;
    }
    await syncTripLegs(tripId);
    res.json(result);
  });

  // Turns opening hours on: fetches the hours of the Event's place and keeps the choice on the Event.
  // `hours` is null when the provider has none, and the choice stays off.
  app.put("/api/trips/:tripId/events/:eventId/opening-hours", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const found = await findEventPlace(db, res.locals.userId, tripId, eventId);
    if (!found) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (!showsOpeningHours(found.kind) || !found.placeId) {
      res.status(400).json({ error: "Opening hours need an Attraction or Meal with a location" });
      return;
    }
    const hours = await fetchOpeningHours(db, provider, found.placeId);
    const event = await setOpeningHours(db, res.locals.userId, tripId, eventId, hours !== undefined, found.placeId);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    // The hours are for the place asked about; if the place changed meanwhile the choice stayed off.
    res.json({ event, hours: event.openingHoursOn ? (hours ?? null) : null });
  });

  app.delete("/api/trips/:tripId/events/:eventId/opening-hours", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const event = await setOpeningHours(db, res.locals.userId, tripId, eventId, false);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(event);
  });

  app.get("/api/trips/:tripId/events/:eventId/place-photo", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const found = await findEventPlace(db, res.locals.userId, tripId, eventId);
    if (!found) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    await sendPlacePhoto(res, found);
  });

  app.get("/api/trips/:tripId/events/:eventId/image", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    await sendImage(res, await findEventImage(db, res.locals.userId, tripId, eventId));
  });

  // The body is the file itself, whatever type the sender says: what it really is is checked.
  app.put("/api/trips/:tripId/events/:eventId/image", express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    if (!(await findEventPlace(db, res.locals.userId, tripId, eventId))) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const image = Buffer.isBuffer(req.body) && req.body.length > 0 ? await prepareImage(req.body) : undefined;
    if (!image) {
      res.status(415).json({ error: "Choose a JPEG, PNG or WebP picture", code: "image_type" });
      return;
    }
    const event = await setEventImage(db, images, res.locals.userId, tripId, eventId, image);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(event);
  });

  app.delete("/api/trips/:tripId/events/:eventId/image", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const event = await removeEventImage(db, images, res.locals.userId, tripId, eventId);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(event);
  });

  app.delete("/api/trips/:tripId/events/:eventId", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const gone: { imageKey?: string } = {};
    const result = await deleteEvent(db, res.locals.userId, tripId, eventId, gone);
    if (!result) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    // The file goes with the Event; undo brings the Event back without it.
    if (gone.imageKey) await images.delete(gone.imageKey);
    await syncTripLegs(tripId);
    res.json(result);
  });

  app.post("/api/trips/:tripId/events/restore", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = deletedEventSchema.parse(req.body);
    const result = await restoreEvent(db, res.locals.userId, tripId, input);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (result === "exists") {
      res.status(409).json({ error: "That Event already exists" });
      return;
    }
    if (result === "invalid") {
      res.status(400).json({ error: "The Event cannot be restored with these Todos" });
      return;
    }
    await syncTripLegs(tripId);
    res.status(201).json(result);
  });

  app.get("/api/trips/:tripId/legs", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    if (!(await canEditTrip(db, res.locals.userId, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(await listLegs(db, tripId));
  });

  app.post("/api/trips/:tripId/legs", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = createLegInputSchema.parse(req.body);
    if (!(await canEditTrip(db, res.locals.userId, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    const result = await createLeg(db, legDeps, tripId, input);
    if (result === "not-adjacent") {
      res.status(400).json({ error: "The two Events are not next to each other in a Day" });
      return;
    }
    if (result === "no-location") {
      res.status(400).json({ error: "Both Events need a location" });
      return;
    }
    if (result === "exists") {
      res.status(409).json({ error: "These Events already have a Leg" });
      return;
    }
    res.status(201).json(result);
  });

  app.patch("/api/trips/:tripId/legs/:legId", async (req, res) => {
    const { tripId, legId } = legParamsSchema.parse(req.params);
    const { mode } = updateLegInputSchema.parse(req.body);
    if (!(await canEditTrip(db, res.locals.userId, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    const result = await setLegMode(db, legDeps, tripId, legId, mode);
    if (!result) {
      res.status(404).json({ error: "Leg not found" });
      return;
    }
    res.json(result);
  });

  app.delete("/api/trips/:tripId/legs/:legId", async (req, res) => {
    const { tripId, legId } = legParamsSchema.parse(req.params);
    if (!(await canEditTrip(db, res.locals.userId, tripId)) || !(await deleteLeg(db, tripId, legId))) {
      res.status(404).json({ error: "Leg not found" });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/trips/:tripId/todos", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = createTodoInputSchema.parse(req.body);
    const result = await addTodo(db, res.locals.userId, tripId, input);
    if (!result) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (result === "archived") {
      res.status(409).json({ error: "An archived Event has no Todos" });
      return;
    }
    res.status(201).json(result);
  });

  app.patch("/api/trips/:tripId/todos/:todoId", async (req, res) => {
    const { tripId, todoId } = todoParamsSchema.parse(req.params);
    const input = updateTodoInputSchema.parse(req.body);
    const result = await updateTodo(db, res.locals.userId, tripId, todoId, input);
    if (!result) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    res.json(result);
  });

  app.delete("/api/trips/:tripId/todos/:todoId", async (req, res) => {
    const { tripId, todoId } = todoParamsSchema.parse(req.params);
    if (!(await deleteTodo(db, res.locals.userId, tripId, todoId))) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/trips/:tripId/notes", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = createNoteInputSchema.parse(req.body);
    const result = await addNote(db, res.locals.userId, tripId, input);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.status(201).json(result);
  });

  app.post("/api/trips/:tripId/notes/restore", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = restoreNoteInputSchema.parse(req.body);
    const result = await restoreNote(db, res.locals.userId, tripId, input);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (result === "exists") {
      res.status(409).json({ error: "That Note already exists" });
      return;
    }
    res.status(201).json(result);
  });

  app.patch("/api/trips/:tripId/notes/:noteId", async (req, res) => {
    const { tripId, noteId } = noteParamsSchema.parse(req.params);
    const input = updateNoteInputSchema.parse(req.body);
    const result = await updateNote(db, res.locals.userId, tripId, noteId, input);
    if (!result) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(result);
  });

  app.delete("/api/trips/:tripId/notes/:noteId", async (req, res) => {
    const { tripId, noteId } = noteParamsSchema.parse(req.params);
    if (!(await deleteNote(db, res.locals.userId, tripId, noteId))) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/trips/:tripId/days", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const { position } = createDayInputSchema.parse(req.body);
    const result = await insertDay(db, res.locals.userId, tripId, position);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (result === "invalid-position") {
      res.status(400).json({ error: "Position is past the end of the Trip" });
      return;
    }
    res.status(201).json(result);
  });

  app.put("/api/trips/:tripId/days/order", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const { dayIds } = reorderDaysInputSchema.parse(req.body);
    const result = await reorderDays(db, res.locals.userId, tripId, dayIds);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (result === "invalid-order") {
      res.status(400).json({ error: "dayIds must list every Day of the Trip exactly once" });
      return;
    }
    res.json(result);
  });

  app.delete("/api/trips/:tripId/days/:dayId", async (req, res) => {
    const { tripId, dayId } = dayParamsSchema.parse(req.params);
    const result = await deleteDay(db, res.locals.userId, tripId, dayId);
    if (!result) {
      res.status(404).json({ error: "Day not found" });
      return;
    }
    if (result === "last-day") {
      res.status(409).json({ error: "A Trip must keep at least one Day" });
      return;
    }
    await syncTripLegs(tripId);
    res.json(result);
  });

  app.post("/api/trips/:tripId/days/restore", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = restoreDayInputSchema.parse(req.body);
    const result = await restoreDay(db, res.locals.userId, tripId, input);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (result === "exists") {
      res.status(409).json({ error: "That Day already exists" });
      return;
    }
    if (result === "invalid") {
      res.status(400).json({ error: "The Day cannot be restored with these Events" });
      return;
    }
    await syncTripLegs(tripId);
    res.status(201).json(result);
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request", issues: err.issues });
      return;
    }
    if ((err as { type?: string }).type === "entity.too.large" && req.path.endsWith("/image")) {
      res.status(413).json({ error: `The picture is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, code: "image_too_large" });
      return;
    }
    // The place provider could not be reached or refused the request.
    if (isProviderError(err)) {
      res.status(502).json({ error: err instanceof PlaceProviderError ? "Places are not available right now" : "Travel times are not available right now" });
      return;
    }
    next(err);
  });

  return app;
}
