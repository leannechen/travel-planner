ALTER TABLE "users" ADD COLUMN "auth0Sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guestToken" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth0Sub_unique" UNIQUE("auth0Sub");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_guestToken_unique" UNIQUE("guestToken");