ALTER TABLE "events" ADD COLUMN "placePhotoHidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "photo" jsonb;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "photoFetchedAt" timestamp with time zone;