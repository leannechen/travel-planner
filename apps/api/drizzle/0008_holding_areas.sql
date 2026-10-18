CREATE TYPE "public"."holding_area" AS ENUM('backlog', 'archive');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "dayId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "tripId" uuid;--> statement-breakpoint
UPDATE "events" SET "tripId" = "days"."tripId" FROM "days" WHERE "days"."id" = "events"."dayId";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "tripId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "holding" "holding_area";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_one_place" CHECK (("events"."dayId" is not null) <> ("events"."holding" is not null));