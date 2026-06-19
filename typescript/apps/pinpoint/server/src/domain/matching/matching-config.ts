import type { ClientId } from '../tenancy/ids.js';
import type { PartitionId } from '../tenancy/ids.js';
import type { MatchingConfigId } from './ids.js';

export const MATCHING_CONFIG_TYPE = 'MatchingConfig' as const;

/**
 * Per-scope fuzzy / spatial / textual thresholds. Mirror of the Rust
 * `MatchingConfig` entity (pinpoint-domain/entities/matching_config.rs).
 *
 * Resolution precedence: (client, partition) → (client, NULL) →
 * (NULL, NULL = global default). The global default is seeded with
 * id `mcf_GLOBAL_DEFAULT` and both scope ids NULL.
 */
export interface MatchingConfig {
  readonly id: MatchingConfigId;
  readonly clientId: ClientId | null;
  readonly partitionId: PartitionId | null;
  readonly streetThreshold: number;
  readonly houseNumberThreshold: number;
  readonly postalCodeThreshold: number;
  readonly stateThreshold: number;
  readonly addressNameThreshold: number;
  readonly overallThreshold: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const MATCHING_CONFIG_DEFAULTS = {
  streetThreshold: 0.85,
  houseNumberThreshold: 1.0,
  postalCodeThreshold: 0.95,
  stateThreshold: 0.9,
  addressNameThreshold: 0.8,
  overallThreshold: 0.85,
} as const;

export interface MatchingConfigThresholdUpdate {
  readonly streetThreshold?: number | undefined;
  readonly houseNumberThreshold?: number | undefined;
  readonly postalCodeThreshold?: number | undefined;
  readonly stateThreshold?: number | undefined;
  readonly addressNameThreshold?: number | undefined;
  readonly overallThreshold?: number | undefined;
}

export interface CreateMatchingConfigInput {
  readonly id: MatchingConfigId;
  readonly clientId: ClientId | null;
  readonly partitionId: PartitionId | null;
  readonly thresholds: MatchingConfigThresholdUpdate;
  readonly now: Date;
}

export const MatchingConfig = {
  /**
   * Create a new (client, partition)-scoped config, starting from the
   * global defaults and applying any provided threshold overrides. Used
   * when `resolve` falls back to the global default and a write arrives.
   */
  create(input: CreateMatchingConfigInput): MatchingConfig {
    return {
      id: input.id,
      clientId: input.clientId,
      partitionId: input.partitionId,
      streetThreshold: input.thresholds.streetThreshold ?? MATCHING_CONFIG_DEFAULTS.streetThreshold,
      houseNumberThreshold:
        input.thresholds.houseNumberThreshold ?? MATCHING_CONFIG_DEFAULTS.houseNumberThreshold,
      postalCodeThreshold:
        input.thresholds.postalCodeThreshold ?? MATCHING_CONFIG_DEFAULTS.postalCodeThreshold,
      stateThreshold: input.thresholds.stateThreshold ?? MATCHING_CONFIG_DEFAULTS.stateThreshold,
      addressNameThreshold:
        input.thresholds.addressNameThreshold ?? MATCHING_CONFIG_DEFAULTS.addressNameThreshold,
      overallThreshold:
        input.thresholds.overallThreshold ?? MATCHING_CONFIG_DEFAULTS.overallThreshold,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /**
   * Partial update — only thresholds present on the update are applied;
   * scope (clientId / partitionId) and id are immutable.
   */
  update(prior: MatchingConfig, update: MatchingConfigThresholdUpdate, now: Date): MatchingConfig {
    return {
      ...prior,
      streetThreshold: update.streetThreshold ?? prior.streetThreshold,
      houseNumberThreshold: update.houseNumberThreshold ?? prior.houseNumberThreshold,
      postalCodeThreshold: update.postalCodeThreshold ?? prior.postalCodeThreshold,
      stateThreshold: update.stateThreshold ?? prior.stateThreshold,
      addressNameThreshold: update.addressNameThreshold ?? prior.addressNameThreshold,
      overallThreshold: update.overallThreshold ?? prior.overallThreshold,
      updatedAt: now,
    };
  },
} as const;
