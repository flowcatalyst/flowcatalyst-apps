import type { MasterLocationId } from './ids.js';

export interface ProcessingLogEntry {
  readonly id: string;
  readonly masterLocationId: MasterLocationId;
  readonly step: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface ProcessingLogRepository {
  append(
    masterLocationId: MasterLocationId,
    step: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void>;

  listByMaster(masterLocationId: MasterLocationId): Promise<readonly ProcessingLogEntry[]>;
}

