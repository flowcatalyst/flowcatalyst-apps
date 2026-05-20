import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Client } from './client.js';
import type { ClientId } from './ids.js';

export interface ClientRepository {
  persist(aggregate: Client, tx?: TransactionContext): Promise<Client>;
  delete(aggregate: Client, tx?: TransactionContext): Promise<boolean>;

  findById(id: ClientId): Promise<Client | null>;
  findByCode(code: string): Promise<Client | null>;
}
