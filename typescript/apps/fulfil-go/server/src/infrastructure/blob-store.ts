import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { parseBlobStoreConfig, type BlobStore } from '@fulfil-go/framework';
import { blobs } from './schema/blobs.js';

/**
 * BlobStore drivers behind the framework port (Andrew, 2026-07-14: driver
 * comes from CONFIG — db for local/dev, S3 for deployed environments).
 *
 *   FULFILGO_BLOB_STORE=db                  → the `blobs` table (default)
 *   FULFILGO_BLOB_STORE=s3://bucket/prefix  → S3 (lazy @aws-sdk import so
 *                                             dev installs never load it)
 *
 * Blobs are client-scoped: the factory binds a clientId so a tenant can
 * never read another tenant's refs (S3 keys prefix the clientId too).
 */
export type ScopedBlobStore = (clientId: string) => BlobStore;

export function createDbBlobStore(db: PostgresJsDatabase): ScopedBlobStore {
  return (clientId) => ({
    async put(ref, bytes, contentType) {
      await db
        .insert(blobs)
        .values({ ref, clientId, contentType, bytes })
        .onConflictDoUpdate({ target: blobs.ref, set: { contentType, bytes } });
      return ref;
    },
    async get(ref) {
      const [row] = await db.select().from(blobs).where(eq(blobs.ref, ref)).limit(1);
      if (!row || row.clientId !== clientId) return null;
      return { bytes: row.bytes, contentType: row.contentType };
    },
    async delete(ref) {
      const rows = await db.delete(blobs).where(eq(blobs.ref, ref)).returning({ ref: blobs.ref });
      return rows.length > 0;
    },
  });
}

export function createS3BlobStore(bucket: string, prefix: string): ScopedBlobStore {
  // Lazy client: the SDK loads on first use only (deployed environments).
  let clientPromise: Promise<import('@aws-sdk/client-s3').S3Client> | null = null;
  const s3 = () =>
    (clientPromise ??= import('@aws-sdk/client-s3').then((m) => new m.S3Client({})));
  const key = (clientId: string, ref: string) =>
    [prefix, clientId, ref].filter(Boolean).join('/');

  return (clientId) => ({
    async put(ref, bytes, contentType) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await (await s3()).send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key(clientId, ref),
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return ref;
    },
    async get(ref) {
      const { GetObjectCommand, NoSuchKey } = await import('@aws-sdk/client-s3');
      try {
        const res = await (await s3()).send(
          new GetObjectCommand({ Bucket: bucket, Key: key(clientId, ref) }),
        );
        const bytes = await res.Body?.transformToByteArray();
        if (!bytes) return null;
        return { bytes, contentType: res.ContentType ?? 'application/octet-stream' };
      } catch (err) {
        if (err instanceof NoSuchKey) return null;
        throw err;
      }
    },
    async delete(ref) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await (await s3()).send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key(clientId, ref) }),
      );
      return true;
    },
  });
}

/** Config-selected driver (the port's whole point). */
export function createBlobStore(db: PostgresJsDatabase, url: string | undefined): ScopedBlobStore {
  const config = parseBlobStoreConfig(url);
  return config.kind === 'db'
    ? createDbBlobStore(db)
    : createS3BlobStore(config.bucket, config.prefix);
}
