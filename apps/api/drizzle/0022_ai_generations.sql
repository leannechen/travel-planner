CREATE TYPE "public"."generation_failure" AS ENUM('unusable', 'failed');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"prompt" text NOT NULL,
	"language" text NOT NULL,
	"status" "generation_status" DEFAULT 'running' NOT NULL,
	"failure" "generation_failure",
	"tripId" uuid,
	"inputTokens" integer,
	"outputTokens" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "place_queries" (
	"provider" text NOT NULL,
	"query" text NOT NULL,
	"placeId" text,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_queries_provider_query_pk" PRIMARY KEY("provider","query")
);
--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_generations_one_running" ON "ai_generations" USING btree ("userId") WHERE "ai_generations"."status" = 'running';--> statement-breakpoint
CREATE INDEX "ai_generations_user_created" ON "ai_generations" USING btree ("userId","createdAt");