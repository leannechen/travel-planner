CREATE TYPE "public"."event_kind" AS ENUM('attraction', 'meal', 'transport');--> statement-breakpoint
CREATE TYPE "public"."transport_label" AS ENUM('flight', 'train', 'ferry', 'bus', 'other');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "kind" "event_kind" DEFAULT 'attraction' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "transportLabel" "transport_label";