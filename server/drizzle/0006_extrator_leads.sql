CREATE TABLE IF NOT EXISTS "lead_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_by" integer,
	"query" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"max_results" integer DEFAULT 50 NOT NULL,
	"with_email" boolean DEFAULT false NOT NULL,
	"job_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text,
	"phone_raw" text,
	"mobile" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"emails" text DEFAULT '' NOT NULL,
	"rating" text,
	"review_count" integer,
	"link" text DEFAULT '' NOT NULL,
	"imported" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_searches" ADD CONSTRAINT "lead_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_searches" ADD CONSTRAINT "lead_searches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_search_id_lead_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."lead_searches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_searches_tenant_idx" ON "lead_searches" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_searches_status_idx" ON "lead_searches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_search_idx" ON "leads" USING btree ("search_id");