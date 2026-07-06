import type { MasterLocationId } from './ids.js';

/**
 * Well-known processing-log step names. The write side is constrained to
 * these; the read side stays `string` because rows written by the Rust
 * pinpoint may carry steps this port doesn't emit (yet).
 *
 * The SPA's timeline (`MasterLocationDetailPage.vue` `stepLabel`/`stepIcon`)
 * switches on these exact values — keep the two in sync.
 */
export const ProcessingStep = {
  Normalized: 'normalized',
  Matched: 'matched',
  Created: 'created',
  LlmVerified: 'llm_verified',
  Validated: 'validated',
  Geocoded: 'geocoded',
  ReverseGeocoded: 'reverse_geocoded',
  SpatialMatched: 'spatial_matched',
  Edited: 'edited',
  ConfirmGeocode: 'confirm-geocode',
} as const;

export type ProcessingStep = (typeof ProcessingStep)[keyof typeof ProcessingStep];

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
    step: ProcessingStep,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void>;

  listByMaster(masterLocationId: MasterLocationId): Promise<readonly ProcessingLogEntry[]>;
}
