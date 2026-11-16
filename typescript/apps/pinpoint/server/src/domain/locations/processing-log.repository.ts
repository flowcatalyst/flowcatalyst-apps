import type { LocationId, MasterLocationId } from './ids.js';

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
  Approved: 'approved',
  Rejected: 'rejected',
  GeocodeRefreshed: 'geocode_refreshed',
  GeocodeExpired: 'geocode_expired',
  Captured: 'captured',
  CaptureDisagrees: 'capture_disagrees',
  MasterCreated: 'master_created',
  Completed: 'completed',
} as const;

export type ProcessingStep = (typeof ProcessingStep)[keyof typeof ProcessingStep];

/** Whose trail an entry belongs to: a master location or a location. */
export type ProcessingLogSubject =
  | { readonly masterLocationId: MasterLocationId }
  | { readonly locationId: LocationId };

export interface ProcessingLogEntry {
  readonly id: string;
  readonly masterLocationId: MasterLocationId | null;
  readonly locationId: LocationId | null;
  readonly step: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface ProcessingLogRepository {
  append(
    subject: ProcessingLogSubject,
    step: ProcessingStep,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void>;

  list(subject: ProcessingLogSubject): Promise<readonly ProcessingLogEntry[]>;
}
