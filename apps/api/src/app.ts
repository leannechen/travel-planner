import {
  createDayInputSchema,
  createEventInputSchema,
  createLegInputSchema,
  createNoteInputSchema,
  createTodoInputSchema,
  createTripInputSchema,
  deletedEventSchema,
  restoreNoteInputSchema,
  holdingAreaSchema,
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
import type { HealthResponse, Me } from "@travel-planner/shared";
import express from "express";
import { z, ZodError } from "zod";
import type { Db } from "./db/client";
import { DEV_USER_ID } from "./dev-user";
import { createLeg, deleteLeg, isProviderError, listLegs, setLegMode, syncLegs } from "./legs";
import { fetchOpeningHours, getOpeningHours, getPlaces, PlaceProviderError, placeProviderFromEnv, searchPlaces, type PlaceProvider } from "./places";
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
  findEventPlace,
  insertDay,
  listTrips,
  ownsTrip,
  reorderDays,
  restoreDay,
  restoreEvent,
  restoreNote,
  setOpeningHours,
  updateEvent,
  updateNote,
  updateTodo,
} from "./trips";

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

export function createApp(db: Db, options: { places?: PlaceProvider; routes?: RouteProvider } = {}) {
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

  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
  });

  app.get("/api/me", (_req, res) => {
    const body: Me = { id: DEV_USER_ID };
    res.json(body);
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
  // whose hours could not be fetched, is left out.
  app.get("/api/places/opening-hours", async (req, res) => {
    const { ids } = idsQuerySchema.parse(req.query);
    res.json({ openingHours: Object.fromEntries(await getOpeningHours(db, provider, ids)) });
  });

  app.get("/api/trips", async (_req, res) => {
    res.json(await listTrips(db, DEV_USER_ID));
  });

  app.post("/api/trips", async (req, res) => {
    const input = createTripInputSchema.parse(req.body);
    res.status(201).json(await createTrip(db, DEV_USER_ID, input));
  });

  app.post("/api/trips/:tripId/days/:dayId/events", async (req, res) => {
    const { tripId, dayId } = dayParamsSchema.parse(req.params);
    const input = createEventInputSchema.parse(req.body);
    if (!(await ownsTrip(db, DEV_USER_ID, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (await unknownPlace(input.placeId, input.destinationId)) {
      res.status(400).json({ error: UNKNOWN_PLACE });
      return;
    }
    const event = await addEvent(db, DEV_USER_ID, tripId, dayId, input);
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
    if (!(await ownsTrip(db, DEV_USER_ID, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (await unknownPlace(input.placeId, input.destinationId)) {
      res.status(400).json({ error: UNKNOWN_PLACE });
      return;
    }
    const event = await addHeldEvent(db, DEV_USER_ID, tripId, area, input);
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
    if (!(await ownsTrip(db, DEV_USER_ID, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    if (await unknownPlace(input.placeId, input.destinationId)) {
      res.status(400).json({ error: UNKNOWN_PLACE });
      return;
    }
    const result = await updateEvent(db, DEV_USER_ID, tripId, eventId, input);
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
    const found = await findEventPlace(db, DEV_USER_ID, tripId, eventId);
    if (!found) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (!showsOpeningHours(found.kind) || !found.placeId) {
      res.status(400).json({ error: "Opening hours need an Attraction or Meal with a location" });
      return;
    }
    const hours = await fetchOpeningHours(db, provider, found.placeId);
    const event = await setOpeningHours(db, DEV_USER_ID, tripId, eventId, hours !== undefined, found.placeId);
    res.json({ event, hours: hours ?? null });
  });

  app.delete("/api/trips/:tripId/events/:eventId/opening-hours", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const event = await setOpeningHours(db, DEV_USER_ID, tripId, eventId, false);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(event);
  });

  app.delete("/api/trips/:tripId/events/:eventId", async (req, res) => {
    const { tripId, eventId } = eventIdParamsSchema.parse(req.params);
    const result = await deleteEvent(db, DEV_USER_ID, tripId, eventId);
    if (!result) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    await syncTripLegs(tripId);
    res.json(result);
  });

  app.post("/api/trips/:tripId/events/restore", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = deletedEventSchema.parse(req.body);
    const result = await restoreEvent(db, DEV_USER_ID, tripId, input);
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
    if (!(await ownsTrip(db, DEV_USER_ID, tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(await listLegs(db, tripId));
  });

  app.post("/api/trips/:tripId/legs", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = createLegInputSchema.parse(req.body);
    if (!(await ownsTrip(db, DEV_USER_ID, tripId))) {
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
    if (!(await ownsTrip(db, DEV_USER_ID, tripId))) {
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
    if (!(await ownsTrip(db, DEV_USER_ID, tripId)) || !(await deleteLeg(db, tripId, legId))) {
      res.status(404).json({ error: "Leg not found" });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/trips/:tripId/todos", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = createTodoInputSchema.parse(req.body);
    const result = await addTodo(db, DEV_USER_ID, tripId, input);
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
    const result = await updateTodo(db, DEV_USER_ID, tripId, todoId, input);
    if (!result) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    res.json(result);
  });

  app.delete("/api/trips/:tripId/todos/:todoId", async (req, res) => {
    const { tripId, todoId } = todoParamsSchema.parse(req.params);
    if (!(await deleteTodo(db, DEV_USER_ID, tripId, todoId))) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/trips/:tripId/notes", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = createNoteInputSchema.parse(req.body);
    const result = await addNote(db, DEV_USER_ID, tripId, input);
    if (!result) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.status(201).json(result);
  });

  app.post("/api/trips/:tripId/notes/restore", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const input = restoreNoteInputSchema.parse(req.body);
    const result = await restoreNote(db, DEV_USER_ID, tripId, input);
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
    const result = await updateNote(db, DEV_USER_ID, tripId, noteId, input);
    if (!result) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(result);
  });

  app.delete("/api/trips/:tripId/notes/:noteId", async (req, res) => {
    const { tripId, noteId } = noteParamsSchema.parse(req.params);
    if (!(await deleteNote(db, DEV_USER_ID, tripId, noteId))) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/trips/:tripId/days", async (req, res) => {
    const { tripId } = tripParamsSchema.parse(req.params);
    const { position } = createDayInputSchema.parse(req.body);
    const result = await insertDay(db, DEV_USER_ID, tripId, position);
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
    const result = await reorderDays(db, DEV_USER_ID, tripId, dayIds);
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
    const result = await deleteDay(db, DEV_USER_ID, tripId, dayId);
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
    const result = await restoreDay(db, DEV_USER_ID, tripId, input);
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

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request", issues: err.issues });
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
