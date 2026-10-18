UPDATE "events" SET "durationMinutes" = 1439 WHERE "durationMinutes" > 1439;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_duration_range";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_duration_range" CHECK ("events"."durationMinutes" between 1 and 1439);