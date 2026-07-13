/**
 * Wire types for the EPOD (Integral TMS) fulfil-go integration endpoints —
 * `POST {base}/api/v1/tms/epod/fulfilgo/*` (their side; built 2026-07 for
 * this integration, see docs/epod-integration-notes.md). Field names are
 * snake_case on the wire (Laravel conventions).
 */

/** One destination location to upsert into `epod_locations` (keyed on `reference`). */
export interface EpodLocationUpsert {
  readonly reference: string;
  readonly name: string;
  readonly address_1?: string;
  readonly city?: string;
  readonly province?: string;
  readonly postal_code?: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Contact phone/name string, as their masterdata location carries it. */
  readonly contact?: string;
  readonly email_address?: string;
}

/** One product to upsert (keyed on `reference` = our sku). */
export interface EpodProductUpsert {
  readonly reference: string;
  readonly name: string;
  readonly description?: string;
}

/** Per-item failure detail — shape is theirs, keep it loose. */
export interface EpodUpsertFailure {
  readonly reference?: string;
  readonly message?: string;
  readonly [key: string]: unknown;
}

/** Shared response envelope of both upsert endpoints. */
export interface EpodUpsertResponse {
  readonly success: boolean;
  readonly created_count: number;
  readonly updated_count: number;
  readonly restored_count: number;
  readonly failed_count: number;
  readonly failed: readonly EpodUpsertFailure[];
  readonly results: readonly unknown[];
}

/**
 * Route-plan container (their `RouteContainerDto` — same shape as the
 * existing `routes/plans` intake, see epod-integration-notes.md §2.5).
 * TODO(transport-planning): type this properly when the claim flow lands —
 * the planning context builds it from a Trip; provisioning never sends it.
 */
export type EpodRoutePlan = unknown;

export interface EpodRoutePlanResponse {
  readonly success: boolean;
  readonly [key: string]: unknown;
}
