CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY,
	"client_id" text NOT NULL,
	"fulfilment_id" text,
	"subject_type" varchar(24) NOT NULL,
	"subject_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"category" varchar(40) NOT NULL,
	"source" varchar(16) NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE INDEX "idx_activity_log_fulfilment" ON "activity_log" ("client_id","fulfilment_id","id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_subject" ON "activity_log" ("subject_type","subject_id");