ALTER TABLE "trips" ADD COLUMN "sampleOf" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_sample_unique" UNIQUE("ownerId","sampleOf");