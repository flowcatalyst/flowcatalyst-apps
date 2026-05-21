import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Client } from './client.js';
import type { ClientId } from './ids.js';

export interface ListClientsQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface ListClientsResult {
  readonly clients: readonly Client[];
  readonly total: number;
}

export interface ClientRepository {
  persist(aggregate: Client, tx?: TransactionContext): Promise<Client>;
  delete(aggregate: Client, tx?: TransactionContext): Promise<boolean>;

  findById(id: ClientId): Promise<Client | null>;
  findByCode(code: string): Promise<Client | null>;
  listAll(query: ListClientsQuery): Promise<ListClientsResult>;
}
