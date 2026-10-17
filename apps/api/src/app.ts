import {
  createDayInputSchema,
  createEventInputSchema,
  createTripInputSchema,
  reorderDaysInputSchema,
} from "@travel-planner/shared";
import type { HealthResponse } from "@travel-planner/shared";
import express from "express";
import { z, ZodError } from "zod";
import type { Db } from "./db/client";
import { DEV_USER_ID } from "./dev-user";
import { addEvent, createTrip, deleteDay, insertDay, listTrips, reorderDays } from "./trips";

const tripParamsSchema = z.object({ tripId: z.uuid() });
const dayParamsSchema = z.object({ tripId: z.uuid(), dayId: z.uuid() });

export function createApp(db: Db) {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
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
    const event = await addEvent(db, DEV_USER_ID, tripId, dayId, input);
    if (!event) {
      res.status(404).json({ error: "Day not found" });
      return;
    }
    res.status(201).json(event);
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
    if (result === "not-empty") {
      res.status(409).json({ error: "Only an empty Day can be deleted" });
      return;
    }
    if (result === "last-day") {
      res.status(409).json({ error: "A Trip must keep at least one Day" });
      return;
    }
    res.json(result);
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request", issues: err.issues });
      return;
    }
    next(err);
  });

  return app;
}
