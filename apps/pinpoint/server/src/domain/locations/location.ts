import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { LocationId, MasterLocationId } from './ids.js';

export const LOCATION_TYPE = 'Location' as const;

export type LocationStatus = 'PENDING' | 'MATCHED' | 'VALIDATED';

export type MatchMethod = 'EXACT_HASH' | 'FUZZY' | 'MANUAL';

/**
 * Flat shape mirroring the Rust `Location` struct + Drizzle row. Nesting
 * raw/normalized into sub-objects was considered but rejected: it adds a
 * mapping step in every repository call without simplifying consumer code,
 * since downstream uses (matching, normalization, validation) want field-
 * level access.
 */
export interface Location {
  readonly id: LocationId;
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  readonly masterLocationId: MasterLocationId | null;
  readonly externalId: string | null;
  readonly name: string | null;

  readonly rawAddressLine1: string;
  readonly rawAddressLine2: string | null;
  readonly rawSuburb: string | null;
  readonly rawCity: string;
  readonly rawState: string | null;
  readonly rawPostalCode: string | null;
  readonly rawCountry: string;

  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string | null;
  readonly normalizedState: string | null;
  readonly normalizedPostalCode: string | null;
  readonly normalizedCountry: string | null;
  readonly addressHash: string | null;

  readonly matchConfidence: number | null;
  readonly matchMethod: MatchMethod | null;

  readonly status: LocationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateLocationInput {
  readonly id: LocationId;
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  readonly externalId: string | null;
  readonly name: string | null;
  readonly rawAddressLine1: string;
  readonly rawAddressLine2: string | null;
  readonly rawSuburb: string | null;
  readonly rawCity: string;
  readonly rawState: string | null;
  readonly rawPostalCode: string | null;
  readonly rawCountry: string;
  readonly now: Date;
}

export const Location = {
  /**
   * Minimal-create factory: persists raw address fields with status='PENDING'
   * and no matching/normalization yet. The matching pipeline (slices 5-8)
   * fills in normalized fields, masterLocationId, match info, and transitions
   * the status forward via separate use cases.
   */
  create(input: CreateLocationInput): Location {
    return {
      id: input.id,
      clientId: input.clientId,
      partitionId: input.partitionId,
      masterLocationId: null,
      externalId: input.externalId,
      name: input.name,
      rawAddressLine1: input.rawAddressLine1,
      rawAddressLine2: input.rawAddressLine2,
      rawSuburb: input.rawSuburb,
      rawCity: input.rawCity,
      rawState: input.rawState,
      rawPostalCode: input.rawPostalCode,
      rawCountry: input.rawCountry,
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: null,
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: null,
      addressHash: null,
      matchConfidence: null,
      matchMethod: null,
      status: 'PENDING',
      createdAt: input.now,
      updatedAt: input.now,
    };
  },
} as const;
