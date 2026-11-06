CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "pre_msg_id" text;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "pre_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD COLUMN "call_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "seguranca" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "wait_reason" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "sends_since_pause" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "pause_every" integer;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "warmup_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "targets_pre_msg_idx" ON "campaign_targets" USING btree ("pre_msg_id");