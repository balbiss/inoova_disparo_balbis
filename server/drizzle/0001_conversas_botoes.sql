CREATE TABLE IF NOT EXISTS "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"connection_id" integer NOT NULL,
	"contact_id" integer,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"last_campaign_id" integer,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_preview" text DEFAULT '' NOT NULL,
	"last_from_me" boolean DEFAULT true NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"unread" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"wa_id" text,
	"from_me" boolean NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"media_name" text,
	"media_mime" text,
	"media_path" text,
	"status" text,
	"campaign_id" integer,
	"sent_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "reply" text;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "opted_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "text_variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "buttons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "opt_out_button" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "footer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "poll_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "poll_multi" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "typing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "restriction_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "restriction_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "capping_status" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "capping_remaining" integer;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "capping_total" integer;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "health_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_checked_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_campaign_id_campaigns_id_fk" FOREIGN KEY ("last_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_conn_phone_uq" ON "conversations" USING btree ("connection_id","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_idx" ON "conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_conv_wa_uq" ON "messages" USING btree ("conversation_id","wa_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_wa_idx" ON "messages" USING btree ("wa_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conv_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "targets_astra_ref_idx" ON "campaign_targets" USING btree ("astra_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "targets_phone_idx" ON "campaign_targets" USING btree ("phone");