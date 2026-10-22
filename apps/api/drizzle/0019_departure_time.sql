ALTER TABLE "places" ADD COLUMN "utcOffsetMinutes" integer;--> statement-breakpoint
ALTER TABLE "route_estimates" ADD COLUMN "departureHour" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "route_estimates" DROP CONSTRAINT "route_estimates_fromPlaceId_toPlaceId_mode_pk";--> statement-breakpoint
ALTER TABLE "route_estimates" ADD CONSTRAINT "route_estimates_fromPlaceId_toPlaceId_mode_departureHour_pk" PRIMARY KEY("fromPlaceId","toPlaceId","mode","departureHour");
