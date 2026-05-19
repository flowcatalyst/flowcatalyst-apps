import type { PrincipalId } from './ids.js';

export type PrincipalType = 'USER' | 'SERVICE';

export interface Principal {
  readonly id: PrincipalId;
  readonly principalType: PrincipalType;
  readonly name: string;
  readonly email: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PrincipalDraft {
  readonly id: PrincipalId;
  readonly principalType: PrincipalType;
  readonly name: string;
  readonly email?: string | null;
}
