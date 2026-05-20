import type { ClientId } from './ids.js';

export const CLIENT_TYPE = 'Client' as const;

export type ClientStatus = 'ACTIVE' | 'SUSPENDED';

export interface Client {
  readonly id: ClientId;
  readonly name: string;
  readonly code: string;
  readonly status: ClientStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateClientInput {
  readonly id: ClientId;
  readonly name: string;
  readonly code: string;
  readonly now: Date;
}

export const Client = {
  create(input: CreateClientInput): Client {
    return {
      id: input.id,
      name: input.name,
      code: input.code,
      status: 'ACTIVE',
      createdAt: input.now,
      updatedAt: input.now,
    };
  },
} as const;
