/**
 * BLOB STORE PORT (Andrew, 2026-07-14): binary assets (first consumer:
 * proof-of-delivery photos) behind a driver-config seam — the Laravel-style
 * driver pattern this workspace already uses for caches. The DRIVER comes
 * from configuration: a db-backed table for local/dev, S3 for deployed
 * environments (`FULFILGO_BLOB_STORE=db` | `s3://bucket/prefix`). Drivers
 * live with the app's infrastructure; this port keeps callers ignorant.
 *
 * Refs are CALLER-supplied (client-generated TSIDs) so offline-first flows
 * can reference a blob BEFORE its upload drains from the outbox — `put` is
 * an idempotent upsert on ref.
 */
export interface BlobStore {
  /** Idempotent upsert by ref. Returns the ref for chaining. */
  put(ref: string, bytes: Uint8Array, contentType: string): Promise<string>;
  get(ref: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(ref: string): Promise<boolean>;
}

export interface BlobStoreConfig {
  /** 'db' (default) or 's3://bucket[/prefix]'. */
  readonly url: string;
}

export type BlobStoreKind = { kind: 'db' } | { kind: 's3'; bucket: string; prefix: string };

/** Parse the configured driver URL — throws on unrecognized schemes. */
export function parseBlobStoreConfig(url: string | undefined): BlobStoreKind {
  const value = (url ?? 'db').trim();
  if (value === '' || value === 'db') return { kind: 'db' };
  if (value.startsWith('s3://')) {
    const rest = value.slice('s3://'.length);
    const slash = rest.indexOf('/');
    const bucket = slash === -1 ? rest : rest.slice(0, slash);
    const prefix = slash === -1 ? '' : rest.slice(slash + 1).replace(/\/$/, '');
    if (!bucket) throw new Error(`blob store url '${url}' has no bucket`);
    return { kind: 's3', bucket, prefix };
  }
  throw new Error(`unrecognized blob store url '${url}' — use 'db' or 's3://bucket/prefix'`);
}
