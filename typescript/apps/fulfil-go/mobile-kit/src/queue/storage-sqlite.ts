import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { QueueCounts, QueueItem, QueueStorage } from './queue-storage.js';

const DB_NAME = 'fulfilgo-queue';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS work_queue (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  body TEXT,
  idempotency_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_queue_due ON work_queue (status, next_attempt_at);
`;

interface Row {
  id: string;
  endpoint: string;
  method: string;
  body: string | null;
  idempotency_key: string;
  attempts: number;
  next_attempt_at: number;
  status: string;
  last_error: string | null;
  created_at: number;
}

function toItem(row: Row): QueueItem {
  return {
    id: row.id,
    endpoint: row.endpoint,
    method: row.method,
    body: row.body,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    status: row.status as QueueItem['status'],
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/**
 * On-device queue storage on @capacitor-community/sqlite. The work queue
 * must survive app restarts AND WebView storage eviction — SQLite is the
 * only Capacitor storage with that durability on both platforms.
 */
export async function createSqliteQueueStorage(): Promise<QueueStorage> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  await db.open();
  await db.execute(SCHEMA);

  return {
    async insert(item): Promise<void> {
      await db.run(
        `INSERT INTO work_queue (id, endpoint, method, body, idempotency_key, attempts, next_attempt_at, status, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.endpoint,
          item.method,
          item.body,
          item.idempotencyKey,
          item.attempts,
          item.nextAttemptAt,
          item.status,
          item.lastError,
          item.createdAt,
        ],
      );
    },
    async update(item): Promise<void> {
      await db.run(
        `UPDATE work_queue SET attempts = ?, next_attempt_at = ?, status = ?, last_error = ? WHERE id = ?`,
        [item.attempts, item.nextAttemptAt, item.status, item.lastError, item.id],
      );
    },
    async remove(id): Promise<void> {
      await db.run(`DELETE FROM work_queue WHERE id = ?`, [id]);
    },
    async listDue(now, limit): Promise<readonly QueueItem[]> {
      const res = await db.query(
        `SELECT * FROM work_queue WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?`,
        [now, limit],
      );
      return ((res.values ?? []) as Row[]).map(toItem);
    },
    async listDead(): Promise<readonly QueueItem[]> {
      const res = await db.query(
        `SELECT * FROM work_queue WHERE status = 'dead' ORDER BY created_at ASC`,
      );
      return ((res.values ?? []) as Row[]).map(toItem);
    },
    async counts(): Promise<QueueCounts> {
      const res = await db.query(`SELECT status, count(*) AS n FROM work_queue GROUP BY status`);
      const rows = (res.values ?? []) as { status: string; n: number }[];
      return {
        pending: rows.find((r) => r.status === 'pending')?.n ?? 0,
        dead: rows.find((r) => r.status === 'dead')?.n ?? 0,
      };
    },
  };
}
