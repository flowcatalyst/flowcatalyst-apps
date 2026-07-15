import { customType, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * DB driver for the framework BlobStore port (docs/handover-verification.md
 * — first consumer: proof-of-delivery photos). LOCAL/DEV storage; deployed
 * environments configure the S3 driver instead (`FULFILGO_BLOB_STORE`).
 * Refs are caller-generated (offline-first: evidence can reference a blob
 * before its upload drains), client-scoped for tenancy checks.
 */
export const blobs = pgTable('blobs', {
  ref: varchar('ref', { length: 64 }).primaryKey(),
  clientId: text('client_id').notNull(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  bytes: bytea('bytes').notNull(),
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
});

export type BlobRow = typeof blobs.$inferSelect;
