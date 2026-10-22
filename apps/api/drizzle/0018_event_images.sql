CREATE TABLE "event_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eventId" uuid NOT NULL,
	"storageKey" text NOT NULL,
	"contentType" text NOT NULL,
	"byteSize" integer NOT NULL,
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_images_eventId_unique" UNIQUE("eventId")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "imageId" uuid;--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_eventId_events_id_fk" FOREIGN KEY ("eventId") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_imageId_event_images_id_fk" FOREIGN KEY ("imageId") REFERENCES "public"."event_images"("id") ON DELETE set null ON UPDATE no action;