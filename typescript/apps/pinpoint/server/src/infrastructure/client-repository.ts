import { asc, count, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import { asClientId, type ClientId } from '../domain/tenancy/ids.js';
import type { Client, ClientStatus } from '../domain/tenancy/client.js';
import type {
  ClientRepository,
  ListClientsQuery,
  ListClientsResult,
} from '../domain/tenancy/client.repository.js';
import { clients, type ClientRow } from './schema/clients.js';

function toDomain(row: ClientRow): Client {
  return {
    id: asClientId(row.id),
    name: row.name,
    code: row.code,
    status: row.status as ClientStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleClientRepository(db: PostgresJsDatabase): ClientRepository {
  return {
    async persist(aggregate: Client, tx?: TransactionContext): Promise<Client> {
      const client = resolveDb(db, tx);
      const [row] = await client
        .insert(clients)
        .values({
          id: aggregate.id,
          name: aggregate.name,
          code: aggregate.code,
          status: aggregate.status,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
        })
        .onConflictDoUpdate({
          target: clients.id,
          set: {
            name: aggregate.name,
            code: aggregate.code,
            status: aggregate.status,
            updatedAt: aggregate.updatedAt,
          },
        })
        .returning();

      if (!row) throw new Error(`Client persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Client, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(clients).where(eq(clients.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(id: ClientId): Promise<Client | null> {
      const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
      return row ? toDomain(row) : null;
    },

    async findByCode(code: string): Promise<Client | null> {
      const [row] = await db.select().from(clients).where(eq(clients.code, code)).limit(1);
      return row ? toDomain(row) : null;
    },

    async listAll(query: ListClientsQuery): Promise<ListClientsResult> {
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(clients)
          .orderBy(asc(clients.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(clients),
      ]);
      return {
        clients: rows.map(toDomain),
        total: Number(totalRow[0]?.value ?? 0),
      };
    },

    async count(): Promise<number> {
      const [row] = await db.select({ value: count() }).from(clients);
      return Number(row?.value ?? 0);
    },
  };
}
