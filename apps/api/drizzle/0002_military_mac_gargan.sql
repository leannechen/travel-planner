ALTER TABLE "events" ADD COLUMN "startMinute" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "durationMinutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_start_minute_range" CHECK ("events"."startMinute" between 0 and 1439);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_duration_range" CHECK ("events"."durationMinutes" between 1 and 1440);