import { createEventInputSchema, createTripInputSchema } from "@travel-planner/shared";
import type { HealthResponse } from "@travel-planner/shared";
import express from "express";
import { z, ZodError } from "zod";
import type { Db } from "./db/client";
import { DEV_USER_ID } from "./dev-user";
import { addEvent, createTrip, listTrips } from "./trips";

const eventParamsSchema = z.object({ tripId: z.uuid(), dayId: z.uuid() });

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
    const { tripId, dayId } = eventParamsSchema.parse(req.params);
    const input = createEventInputSchema.parse(req.body);
    const event = await addEvent(db, DEV_USER_ID, tripId, dayId, input);
    if (!event) {
      res.status(404).json({ error: "Day not found" });
      return;
    }
    res.status(201).json(event);
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
