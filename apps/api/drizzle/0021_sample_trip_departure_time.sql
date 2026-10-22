ALTER TABLE "trips" ADD COLUMN "sampleOf" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_sample_unique" UNIQUE("ownerId","sampleOf");--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "utcOffsetMinutes" integer;--> statement-breakpoint
ALTER TABLE "route_estimates" ADD COLUMN "departureHour" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "route_estimates" DROP CONSTRAINT "route_estimates_fromPlaceId_toPlaceId_mode_pk";--> statement-breakpoint
ALTER TABLE "route_estimates" ADD CONSTRAINT "route_estimates_fromPlaceId_toPlaceId_mode_departureHour_pk" PRIMARY KEY("fromPlaceId","toPlaceId","mode","departureHour");
