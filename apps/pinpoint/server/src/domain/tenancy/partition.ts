import type { ClientId, PartitionId } from './ids.js';

export const PARTITION_TYPE = 'Partition' as const;

export interface Partition {
  readonly id: PartitionId;
  readonly clientId: ClientId;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePartitionInput {
  readonly id: PartitionId;
  readonly clientId: ClientId;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly now: Date;
}

export const Partition = {
  create(input: CreatePartitionInput): Partition {
    return {
      id: input.id,
      clientId: input.clientId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },
} as const;
