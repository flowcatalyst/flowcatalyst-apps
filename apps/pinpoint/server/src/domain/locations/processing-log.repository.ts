import type { MasterLocationId } from './ids.js';

export interface ProcessingLogEntry {
  readonly id: string;
  readonly masterLocationId: MasterLocationId;
  readonly step: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * Append-only audit log for the matching pipeline. Each step
 * (normalized, matched, created, geocoded, validated, …) appends one
 * row with a JSONB payload.
 *
 * Not transactional with the UoW — failures to log are swallowed at
 * the caller (Rust pattern: pipeline must not fail because logging
 * failed). Callers should `await` but ignore errors.
 */
export interface ProcessingLogRepository {
  append(
    masterLocationId: MasterLocationId,
    step: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void>;

  listByMaster(masterLocationId: MasterLocationId): Promise<readonly ProcessingLogEntry[]>;
}
