CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"access_token" text DEFAULT '' NOT NULL,
	"refresh_token" text,
	"sub" text,
	"name" text,
	"email" text,
	"code_verifier" text,
	"state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
