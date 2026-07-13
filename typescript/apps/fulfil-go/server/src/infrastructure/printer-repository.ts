import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import { brandedTsid } from '@fulfil-go/framework';
import { printers, type PrinterRow } from './schema/printers.js';

/**
 * Command-side repository for the store-bound printer registry — reference
 * data like stores/store-profiles: plain writes, no version column
 * (docs/bag-label-printing.md).
 */
export interface PrinterRepository {
  create(input: {
    clientId: string;
    storeRef: string;
    name: string;
    host: string;
    port: number;
    dpi: number;
    labelWidthMm: number;
    labelHeightMm: number;
    active: boolean;
  }): Promise<PrinterRow>;
  update(
    clientId: string,
    printerId: string,
    patch: Partial<{
      name: string;
      host: string;
      port: number;
      dpi: number;
      labelWidthMm: number;
      labelHeightMm: number;
      active: boolean;
    }>,
  ): Promise<PrinterRow | null>;
  delete(clientId: string, printerId: string): Promise<boolean>;
  findById(clientId: string, printerId: string): Promise<PrinterRow | null>;
  listByClient(clientId: string, storeRef?: string): Promise<readonly PrinterRow[]>;
}

export function createDrizzlePrinterRepository(db: PostgresJsDatabase): PrinterRepository {
  const current = () => resolveDb(db, TransactionStore.get());
  return {
    async create(input) {
      const [row] = await current()
        .insert(printers)
        .values({ id: brandedTsid('prt'), ...input })
        .returning();
      if (!row) throw new Error('Printer insert returned no row.');
      return row;
    },

    async update(clientId, printerId, patch) {
      const [row] = await current()
        .update(printers)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(printers.clientId, clientId), eq(printers.id, printerId)))
        .returning();
      return row ?? null;
    },

    async delete(clientId, printerId) {
      const rows = await current()
        .delete(printers)
        .where(and(eq(printers.clientId, clientId), eq(printers.id, printerId)))
        .returning({ id: printers.id });
      return rows.length > 0;
    },

    async findById(clientId, printerId) {
      const [row] = await current()
        .select()
        .from(printers)
        .where(and(eq(printers.clientId, clientId), eq(printers.id, printerId)))
        .limit(1);
      return row ?? null;
    },

    async listByClient(clientId, storeRef) {
      const conditions = [eq(printers.clientId, clientId)];
      if (storeRef) conditions.push(eq(printers.storeRef, storeRef));
      return current()
        .select()
        .from(printers)
        .where(and(...conditions))
        .orderBy(asc(printers.storeRef), asc(printers.name));
    },
  };
}
