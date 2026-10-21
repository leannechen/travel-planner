ALTER TABLE "trips" ADD COLUMN "shareToken" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "shareEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shareToken_unique" UNIQUE("shareToken");