CREATE TABLE "usage_counts" (
	"subject" text NOT NULL,
	"bucket" text NOT NULL,
	"windowStart" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "usage_counts_subject_bucket_windowStart_pk" PRIMARY KEY("subject","bucket","windowStart")
);
--> statement-breakpoint
CREATE INDEX "usage_counts_window" ON "usage_counts" USING btree ("windowStart");