ALTER TYPE "public"."event_kind" ADD VALUE 'lodging' BEFORE 'transport';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nights" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "checkInMinute" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "checkOutMinute" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_nights_range" CHECK ("events"."nights" is null or "events"."nights" between 1 and 365);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_check_in_range" CHECK ("events"."checkInMinute" is null or "events"."checkInMinute" between 0 and 1439);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_check_out_range" CHECK ("events"."checkOutMinute" is null or "events"."checkOutMinute" between 0 and 1439);