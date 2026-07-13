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
 * Route-plan container (their `RouteContainerDto`) for the SYNCHRONOUS
 * intake `POST /api/v1/tms/epod/fulfilgo/routes/plans` — field names and
 * required-ness mirror InhanceMono's `FulfilGoRoutePlansSyncTest` payload
 * (the contract test on their `feature/fulfilgo-epod-integration` branch).
 * camelCase on the wire; latitude/longitude ride as STRINGS; datetimes are
 * RFC 3339. Top-level `depot`/`territory` references must PRE-EXIST in
 * EPOD (manually maintained topology); transporter/vehicleType/vehicle/
 * locations/products self-provision from the embedded masterdata.
 */
export interface EpodPlanReference {
  readonly reference: string;
}

export interface EpodPlanLocation {
  readonly reference: string;
  readonly name: string;
  readonly locationTypeReference: string;
  readonly buildingNumber: string | null;
  readonly buildingName: string | null;
  readonly address1: string;
  readonly address2: string;
  readonly address3: string;
  readonly suburb: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly province: string;
  readonly country: string;
  readonly countryCode: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly contact: string | null;
  readonly email: string | null;
}

export interface EpodPlanStop {
  readonly reference: string;
  readonly sequence: number;
  readonly stopType: 'Pick' | 'Drop';
  readonly diversionBlock: boolean;
  readonly qrCode: string;
  readonly arrivalAt: string;
  readonly departureAt: string;
  readonly distanceFromPrevious: number;
  readonly minutesFromPrevious: number;
  readonly instruction: string | null;
  readonly locationReference: string;
  readonly workflowType: string | null;
  readonly driver?: EpodPlanReference;
  readonly orders: readonly { readonly orderNumber: string }[];
}

export interface EpodPlanTrip {
  readonly reference: string;
  readonly name: string;
  readonly tripType: string;
  readonly terms: string;
  readonly agent: string;
  readonly sequence: number;
  readonly startAt: string;
  readonly endAt: string;
  readonly distance: number;
  readonly minutes: number;
  readonly notificationLevel: string;
  readonly orderType: string;
  readonly planningStatus: string;
  readonly stops: readonly EpodPlanStop[];
}

export interface EpodPlanOrderItem {
  readonly itemNumber: string;
  readonly reference: string;
  readonly packingUnitFlag: boolean;
  readonly plannedItemQuantity: number;
  readonly plannedItemUom: string;
}

export interface EpodPlanOrder {
  readonly orderNumber: string;
  readonly displayNumber?: string;
  readonly createdAt: string;
  readonly sourceLocationReference: string;
  readonly destinationLocationReference: string;
  readonly serviceDate: string;
  readonly plannedWeight: number;
  readonly plannedWeightUom: string;
  readonly actualWeight: number;
  readonly actualWeightUom: string;
  readonly planningStatus: string;
  readonly items: readonly EpodPlanOrderItem[];
  readonly subOrders: readonly unknown[];
}

export interface EpodPlanMasterdata {
  readonly company: readonly { readonly reference: string; readonly name: string }[];
  readonly drivers: null;
  readonly vehicles: readonly {
    readonly registrationNumber: string;
    readonly fleetNumber: string;
    readonly vehicleTypeReference: string;
  }[];
  readonly vehicleTypes: readonly {
    readonly reference: string;
    readonly name: string;
    readonly maxWeight: number;
    readonly maxWeightUom: string;
  }[];
  readonly transporters: readonly { readonly reference: string; readonly name: string }[];
  readonly locations: readonly EpodPlanLocation[];
  readonly products: readonly {
    readonly reference: string;
    readonly name: string;
    readonly unitMass?: number;
    readonly unitWeightUom?: string;
  }[];
}

export interface EpodPlanRoute {
  readonly reference: string;
  readonly name: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly distance: number;
  readonly minutes: number;
  readonly depot: EpodPlanReference;
  readonly territory: EpodPlanReference;
  readonly transporter: EpodPlanReference;
  readonly vehicle: { readonly registrationNumber: string };
  readonly vehicleType: EpodPlanReference;
  readonly trips: readonly EpodPlanTrip[];
  readonly orders: readonly EpodPlanOrder[];
  readonly masterdata: EpodPlanMasterdata;
}

export interface EpodRoutePlan {
  readonly company: {
    readonly reference: string;
    readonly name: string;
    readonly routes: readonly EpodPlanRoute[];
  };
}

/**
 * Synchronous intake response: 201 route "applied", 200 "already_applied"
 * (idempotent re-POST), 409 concurrent processing (retry), 422 structured
 * validation/apply failure.
 */
export interface EpodRoutePlanResponse {
  readonly success: boolean;
  readonly results?: readonly { readonly reference: string; readonly status: string }[];
  readonly [key: string]: unknown;
}
