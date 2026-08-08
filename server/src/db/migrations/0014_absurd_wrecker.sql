ALTER TABLE "findings" ADD COLUMN "out_of_scope" boolean;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "scope_rationale" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "missing_context" jsonb;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;