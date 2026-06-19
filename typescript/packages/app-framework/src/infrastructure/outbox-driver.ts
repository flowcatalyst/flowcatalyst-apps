import type { OutboxDriver, OutboxMessage } from '@flowcatalyst/sdk';
import { sql } from 'drizzle-orm';
import { TransactionStore } from './transaction-store.js';

/**
 * Drizzle-backed OutboxDriver that participates in the current transaction.
 *
 * Reads the active tx from `TransactionStore` (AsyncLocalStorage). Must be
 * invoked inside `AppContext.runWrite(...)` (or any `TransactionStore.run`
 * wrapper) — otherwise `TransactionStore.require()` throws.
 *
 * Stateless and reusable: one instance is built once at composition root,
 * baked into the `OutboxManager` that backs the Effect `UnitOfWork` layer.
 */
export class DrizzleOutboxDriver implements OutboxDriver {
  async insert(message: OutboxMessage): Promise<void> {
    const tx = TransactionStore.require();
    await tx.db.execute(sql`
      INSERT INTO outbox_messages
        (id, type, message_group, payload, payload_size, status, created_at, updated_at, client_id, headers)
      VALUES ${rowValues(message)}
    `);
  }

  async insertBatch(messages: OutboxMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const tx = TransactionStore.require();
    const values = sql.join(
      messages.map((m) => rowValues(m)),
      sql`, `,
    );
    await tx.db.execute(sql`
      INSERT INTO outbox_messages
        (id, type, message_group, payload, payload_size, status, created_at, updated_at, client_id, headers)
      VALUES ${values}
    `);
  }
}

function rowValues(m: OutboxMessage) {
  return sql`(${m.id}, ${m.type}, ${m.message_group}, ${m.payload}, ${m.payload_size}, ${m.status}, ${m.created_at}, ${m.updated_at}, ${m.client_id}, ${m.headers ? JSON.stringify(m.headers) : null})`;
}
