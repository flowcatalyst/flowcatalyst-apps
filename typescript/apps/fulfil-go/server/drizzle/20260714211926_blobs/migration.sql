CREATE TABLE "blobs" (
	"ref" varchar(64) PRIMARY KEY,
	"client_id" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
