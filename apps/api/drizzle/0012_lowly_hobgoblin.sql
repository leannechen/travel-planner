CREATE TYPE "public"."travel_mode" AS ENUM('drive', 'transit', 'walk');--> statement-breakpoint
CREATE TABLE "legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tripId" uuid NOT NULL,
	"dayId" uuid NOT NULL,
	"fromEventId" uuid NOT NULL,
	"toEventId" uuid NOT NULL,
	"mode" "travel_mode" NOT NULL,
	"durationMinutes" integer,
	"distanceMeters" integer,
	"fromPlaceId" text,
	"toPlaceId" text,
	CONSTRAINT "legs_events_unique" UNIQUE("fromEventId","toEventId"),
	CONSTRAINT "legs_duration_range" CHECK ("legs"."durationMinutes" is null or "legs"."durationMinutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "route_estimates" (
	"fromPlaceId" text NOT NULL,
	"toPlaceId" text NOT NULL,
	"mode" "travel_mode" NOT NULL,
	"durationMinutes" integer,
	"distanceMeters" integer,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_estimates_fromPlaceId_toPlaceId_mode_pk" PRIMARY KEY("fromPlaceId","toPlaceId","mode")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "travelMode" "travel_mode" DEFAULT 'transit' NOT NULL;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_dayId_days_id_fk" FOREIGN KEY ("dayId") REFERENCES "public"."days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_fromEventId_events_id_fk" FOREIGN KEY ("fromEventId") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_toEventId_events_id_fk" FOREIGN KEY ("toEventId") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;