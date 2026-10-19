ALTER TABLE "events" ADD COLUMN "openingHoursOn" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "openingHours" jsonb;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "hoursFetchedAt" timestamp with time zone;