# EPOD Integration Notes — transport provider adapter for fulfil-go

Investigation of the internal transport-execution system ("Epod" / mobility, inside the
Integral TMS monorepo at `/Users/andrewgraaff/Developer/inhance/InhanceMono`) and of the
existing on-demand application that integrates with it via the **claim-trip** interface.
Everything below cites the file it was read from. Nothing in the explored repos was modified.

Repos/packages explored:

- `apps/integral/app/Modules/Tms/Epod/` — earlier in-app module (controllers/requests predating the package split; live code moved to packages)
- `packages_root/packages/epod` — the EPOD execution system (routes, driver API, workflow engine)
- `packages_root/packages/epod-contract` — EPOD wire contracts, models, migrations, event-type factories (note: package is `epod-contract`, not `epod_contract`)
- `packages_root/packages/epod-client` — HTTP client other modules use to push work into EPOD
- `packages_root/packages/ondemand` + `packages_root/packages/ondemand-contract` — the current on-demand TMS (migration to fulfil-go is proposed for a focused on-demand execution experience)
- `packages_root/packages/epod-opsi-haulier-adapter` — an existing third-party adapter over EPOD events (useful precedent)
- `packages_root/packages/integral-contract`, `integral-service-v1`, `integral-service-v2` — the internal CloudEvents bus, subscriptions, connectors, and a FlowCatalyst sync bridge

## 0. System map (how the pieces fit)

The whole thing is one Laravel monolith ("Integral") composed of composer packages, with an
internal **CloudEvents bus**: modules publish `CreateCloudEventV1Dto` events through
`IntegralEventServiceInterface`, and **subscriptions** route them to processors
(`SubscriptionRunnerTypeEnum::INVOKABLE` = in-process class) or to external webhooks
(`WEBHOOK` / `WEBHOOK_CE`)
(`packages/integral-contract/src/Domain/Subscription/Dto/SubscriptionRunnerTypeEnum.php`,
`packages/integral-contract/src/Domain/Subscription/Dto/SubscriptionDto.php`).

The end-to-end on-demand flow today:

```
order picked/packed → od_transport_orders row: status_id=19 (ready),
                      execution_system='EPOD', trip_id NULL
        │
        ▼  driver opens "Claim Trip" in the EPOD driver app (epod_actions row 'ClaimTrip')
POST /api/v1/tms/epod/claimable-trips      (auth:epod-drivers)  ── offer built, 30s TTL
POST /api/v1/tms/epod/claim-trip/{groupId} (auth:epod-drivers)  ── claim
        │  fires CloudEvent  ondemand.trip.claimed  {trip_reference, group_id}
        ▼
OnDemandTripClaimedProcessor  → GenerateUnclaimedTripWorkflow → od trip/route/stops
        │  fires CloudEvent  ondemand.trip.scheduled  (TripScheduledDto)
        ▼
OnDemandTripScheduledProcessor (epod pkg) → OnDemandTripToMobilityMapper
        │  EpodClient::sendRoutePlan → POST /api/v1/tms/epod/routes/plans  (passport client)
        ▼
RoutePlannerService::dispatchEvents → CloudEvent epod.route.update-plan (one per route)
        ▼  route-plan processor materialises EPOD routes/trips/route-points/orders
driver executes trip in EPOD app → workflow events → CloudEvents
  epod.workflow.event-received / EPOD.WORKFLOW.EVENT.CREATED / EPOD.STOP.STATUS.CHANGED /
  epod.stop.around-the-corner / epod.POD.GENERATED ...
        ▼
OnDemandStopStatusProcessor etc. update od stop/TO statuses; trip debrief closes it out
```

Key file anchors for the flow:

- Claim routes: `packages/epod/routes/api.php` (lines ~311–317, inside the
  `auth:epod-drivers` group of prefix `v1/tms/epod`)
- Offer/claim logic: `packages/ondemand-contract/src/Services/TripService.php`,
  `packages/ondemand/src/App/Http/Controller/TripController.php`
- Claimed→scheduled: `packages/ondemand-contract/src/Domain/Processors/OnDemandTripClaimedProcessor.php`
- Scheduled→EPOD: `packages/epod/src/Domain/Processors/OnDemandTripScheduledProcessor.php`,
  `packages/epod/src/Domain/Mappers/OnDemandTripToMobilityMapper.php`
- Route plan intake: `packages/epod/src/App/Http/Controllers/Api/RoutePlanController.php`,
  `packages/epod/src/Domain/Services/RoutePlanner/RoutePlannerService.php` (`dispatchEvents`, line ~250)
- Statuses back into ondemand: `packages/ondemand-contract/src/Domain/Processors/OnDemandStopStatusProcessor.php`
- Execution-system gating: `packages/ondemand/documents/execution_systems.txt`,
  `packages/ondemand-contract/src/Domain/ExecutionSystemEnum.php` (`EPOD`, `ZENO`, `UBER`, `PICUP`)

## 1. Domain model

### 1.1 ondemand (TMS) side — `Inhance\OnDemandContract\Infrastructure\Models\Core\*`

Tables observed in `packages/ondemand-contract/src/Infrastructure/Models/Core/*.php` and the
joins in `packages/ondemand-contract/src/Services/TripService.php`:

| Model            | Table                 | Notes                                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Order`          | `od_orders`           | customer order; has `order_number`, slot                                                                                                                                                                                                                                                 |
| `Part`           | `od_parts`            | fulfilment part of an order; `reference`, `part_number`, `origin_location_id`, `destination_location_id`, `fulfillment_from`, `fulfillment_to`; belongs to order, many-to-many to transport orders via `od_transport_order_parts`                                                        |
| `TransportOrder` | `od_transport_orders` | the unit of transport work; `reference` (`TO…`), `status_id`, `execution_system`, `fulfillment_date`, `trip_id`, `origin_location_id`, `destination_location_id`, `total_weight`, `total_volume`                                                                                         |
| `Trip`           | `od_trips`            | `reference`, `status` (`OnDemandTripStatus`), `route_id`, `sequence`, `planned_kilometers`, `planned_minutes`, `planned_start_at`, `planned_end_at` (`Core/Trip.php`, `$table = 'od_trips'`)                                                                                             |
| `Route`          | `od_routes`           | has `driver_id`; joined `od_routes.id = od_trips.route_id` (`TripService::getDriverCurrentTrip`)                                                                                                                                                                                         |
| `Stop`           | `od_stops`            | `reference`, `trip_id`, `type` (`OnDemandStopType`), `status` (`OnDemandStopStatus`), `planned_sequence`, `planned_arrival`, `planned_departure`, `eta`, `instruction`, `kilometers_from_previous`, `minutes_from_previous`, `driver_id`, `location_id` (`Core/Stop.php`)                |
| `ClaimableTrip`  | `od_claimable_trips`  | the claim offer: `group_id`, `to_number`, `expire_at`, `data` (JSON `{driver, vehicle, depot_name}`) (`Core/ClaimableTrip.php`)                                                                                                                                                          |
| `Status`         | `od_statuses`         | shared status dimension (`name`, `reference`) referenced by `status_id` on `od_items`/`od_parts`/`od_orders`/`od_stops`/`od_transport_orders`/`od_trips` (`database/migrations/create/2024_07_11_000001_create_od_statuses_table.php`, `alter/2024_07_12_000001_alter_all_statuses.php`) |

Master-data mirrors (ondemand reads EPOD's tables directly — same database):
`EpodDepot` (`epod_depots`), `EpodDriver` (`epod_drivers`), `EpodVehicle` (`epod_vehicles`,
`registration_no`, `vehicle_type_id`, `depot_id`, `shared_in_territory`), `EpodVehicleType`
(`epod_vehicle_types`, `max_weight`, `max_volume`), `EpodLocation` (`epod_locations`,
`reference`, `latitude`, `longitude`), territories via `epod_depot_territory` /
`epod_territories` — all visible in the query joins of
`packages/ondemand-contract/src/Services/TripService.php` and the model imports of
`packages/ondemand-contract/src/Domain/Processors/OnDemandTripClaimedProcessor.php`.

**ondemand status enums** (`packages/ondemand-contract/src/Enums/`):

- `OnDemandTransportStatus`: `open, ready, planning, planned, in_progress, completed,
cancelled, closed, dispatched, returnable, returned, around_the_corner`
  (replannable set: `PLANNED, RETURNED, RETURNABLE, CLOSED`)
- `OnDemandTripStatus`: `open, planned, collecting, collected, delivering, published,
executed, not_executed, debriefed`
- `OnDemandStopStatus`: `open, ready, on_route, around_the_corner, suspended, completed,
cancelled, closed`
- `OnDemandStopType`: `pick, drop, depot, return, start, break, depot-end`
- `OnDemandOrderStatus`: `received, unvalidated, rejected, suspended, validated, picking,
picked, packing, packed, ready, planned, dispatched, on_route, around_the_corner,
returned, returnable, delivered, cancelled, closed`
- `OnDemandItemStatus`: `ordered, picked, returned, cancelled, packed, dispatched, delivered`
- `OnDemandRouteStatus`: `open, hold, closed, cancelled`
- `OnDemandFulfillmentType`: `collection, delivery, delivery_asap, self-collect, self-return`
- `ExecutionSystemEnum` (`src/Domain/ExecutionSystemEnum.php`): `EPOD, ZENO, UBER, PICUP`

**Numeric `od_statuses` ids** (insertion order of
`packages/ondemand-contract/database/seeders/OnDemandStatusesSeeder.php`; cross-checked
against hardcoded ids in `TripService.php` — `STATUS_READY = 19`, and the exclusion comment
`whereNotIn('status_id', [1, 34, 11]) // EXCLUDE: statuses open, executed, not_executed`):

`1 open, 2 received, 3 ordered, 4 active, 5 inactive, 6 allocated, 7 unallocated,
8 unvalidated, 9 rejected, 10 error, 11 not_executed, 12 cancelled, 13 suspended,
14 validated, 15 picking, 16 picked, 17 packing, 18 packed, 19 ready, 20 planned,
21 dispatched, 22 collecting, 23 collected, 24 delivering, 25 on_the_way, 26 on_route,
27 around_the_corner, 28 in_progress, 29 on_time, 30 early, 31 late, 32 hold,
33 published, 34 executed, 35 returned, 36 delivered, 37 completed, 38 closed,
39 returnable, 40 planning`

(Ids are per-tenant-database insertion order — treat as convention, not contract.)

### 1.2 EPOD (execution) side — `Inhance\EpodContract\Domain\Models\*`

All models live in `packages/epod-contract/src/Domain/Models/`; a `WithTablePrefix` trait
prepends `epod_` to table names. There is **no Consignment model** — the closest concepts
are `Order`/`SubOrder` and `ConsolidatedTrip`.

| Model                               | Table                                                  | Key fields / relations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Trip`                              | `epod_trips`                                           | FKs `company_id, driver_id, route_id, trip_type_id, order_class_id, trip_status_id`; fields `name, reference, service_date, start_at, end_at, trip_km, trip_minutes, sequence, trip_agent, trip_terms, notification_type, processing_until, odometer_start/current, last_imported_at`; relations `route`, `routePoints` (HasMany), `tripStatus`, `tripEvents`, `orders`, `plannedTrip`, `tripWaypoint`; helpers `isBlocked/isCancelled/isStarted/hasActiveRoutePoints/cancel()`                                                                                                                                                                                                                                                                                        |
| `Route`                             | `epod_routes`                                          | FKs `company/transporter/depot/territory/vehicle/vehicle_type`; `trips` (HasMany), `plannedRoute` (HasOne), `trailers` (BelongsToMany via `epod_route_trailer`), `routePoints`; **no status column** — route status handled separately (`RouteStatusEnum`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `RoutePoint` (= the stop)           | `epod_route_points` (SoftDeletes)                      | FKs `parent_id, route_id, trip_id, location_id, route_point_status_id, route_point_type_id, driver_id, planned_driver_id, telemetry_id, lateness_status_id`; fields `reference, sequence, actual_sequence`, planned/actual arrival+departure, `is_*` overrides, `is_blocked, is_around_the_corner, diversion_block, qr_code`, weights, odometer; model events `StopUpdatedEvent`/`StopCreatedEvent`; relations `orders` (BelongsToMany via `epod_order_route_point`), `subOrders` (HasManyThrough), `workflowLogs`, `deliveryReceipts`, `suspension`, `diversionRequest`, `consolidateTripStop` (via `stop_reference`); state helpers `isReady/isEnRoute/hasArrived/hasDeparted/hasCompleted/isConcluded/isSuspended/isCancelled/isClosed/isClosable/isDriverEditable` |
| `Order`                             | `epod_orders` (SoftDeletes)                            | FKs company, source/destination/billing location, `trip_id`, order type, division, `order_planning_status_id`, `status_id`, `lateness_status_id`; fields `order_no, customer_reference_no, service_date/start/end, diverted_from, display_number`; relations `products` (via `epod_order_product`), `routePoints` (BelongsToMany), `subOrders`, `orderItems`; helpers `isDiverted/isClosed/cancel/close`                                                                                                                                                                                                                                                                                                                                                               |
| `ConsolidatedTrip`                  | `epod_consolidated_trips`                              | `$guarded=[]`, no timestamps; `controller_allocation` + `pod_status` columns (2026 migrations); linked from `RoutePoint.stop_reference`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Driver`                            | `epod_drivers` (Authenticatable, SoftDeletes)          | `reference, name, surname, identity_no, personal_identifier` (hashed PIN), `token, status`; depot/transporter/company BelongsTo; `device` HasOne; `trips`/`shifts` HasMany                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Vehicle`                           | `epod_vehicles`                                        | `registration_no, fleet_no`, tracking refs, last lat/lng, `status`, `allocation_status`, `current_trip_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Location`                          | `epod_locations`                                       | address fields + `latitude/longitude`; `locationPolygon` HasOne                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Depot` / `Company` / `Transporter` | `epod_depots` / `epod_companies` / `epod_transporters` | reference entities; depot has `turnaround_time`; `Company` = intra-tenant grouping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Workflow`                          | `epod_workflows` (SoftDeletes)                         | self-referential tree `parent_id → children` ordered by `sequence`; FKs `workflow_category_id` (workflow_group → workflow → sub_workflow → task), `workflow_type_id` (start-of-day, attendance), `workflow_account_type_id` (driver, receiver), `action_id`, `route_point_status_id` (**the stop status that triggers the step**), `company_id`, `order_class_id`; fields `name, code, sequence, arguments (json), is_executable`                                                                                                                                                                                                                                                                                                                                      |
| `WorkflowLog`                       | `epod_workflow_logs`                                   | `workflow_id, trip_id, route_point_id, telemetry_id, driver_id, suspension_id, values (json), unique_identifier, is_editable`; `attachments` HasMany                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `WorkflowProcessToken`              | `epod_workflow_process_tokens`                         | `driver_id, workflow_id, workflow_account_type_id, route_point_id, trip_id, token, expire_at, is_restricted` — the driver-session token store behind `auth:epod-drivers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Action`                            | `epod_actions`                                         | `id, name, reference, arguments (json), depot_id` — catalog of mobile workflow UI components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Pivot tables: `epod_order_route_point`, `epod_order_product`, `epod_route_trailer`.

**Status machines** (`packages/epod-contract/src/Domain/Enums/`):

- `TripStatusEnum`: `ready, started, collecting, collected, en-route, delivering,
delivered, returning, returned, completed, cancelled, suspended, break, closed`.
  Groups: blocked = `[completed, cancelled, suspended]`; terminal = `[completed, cancelled,
closed, suspended]`; inProgress = `[started, collecting, collected, en-route, delivering,
delivered, returning, returned, break]`. The seed migration `2022_05_16_194936` maps each
  trip status to a `(route_point_type, route_point_status)` pair with sequence 0–12 — the
  trip status is **derived** from stop progress.
- `RoutePointStatusEnum`: `ready, en-route, arrived, started, ended, departed, completed,
suspended, cancelled, closed`, with **hard-coded ids** in `RoutePointStatusIdsEnum`:
  `EnRoute=1, Arrived=2, Started=3, Ended=4, Departed=5, Ready=6, Completed=7, Suspended=8,
Cancelled=9, Closed=10`. Operational groups: concluded = `[departed, completed, cancelled,
closed, suspended]`; diversionAllowed = `[en-route, arrived, started, ready]`;
  driverEditable = `[ready, en-route]`.
- `RoutePointTypeEnum`: `PICK, DROP, RETURN, REFUEL, BREAK, DEPOT-START, DEPOT-END,
UNPLANNED` (abbrev `PU/DO/RE/RF/BR/DS/DE/UP`).
- `RouteStatusEnum`: `open, hold, closed, cancelled`. `OrderPlanningStatusEnum`: `ready,
cancelled, diverted, closed, haulier-confirmed`. Vehicle statuses: `at_depot,
returning_to_depot, delivering, booked_out` (allocation_status e.g. `ALLOCATED`).

**Transition logic**: `RoutePointRepository::updateStatus` (~line 195) writes stop status
guarded by `verifySequence()` (only forward/higher-sequence transitions allowed; `CANCELLED`
sets `actual_sequence = 99999`); `afterStatusUpdated` (~line 313) dispatches
`RoutePointStatusChanged` and a `TripStatusChanged` cascade whose `getTripStatus()` resolves:
all stops cancelled → `cancelled`; any suspended → `suspended`; all DROP/DEPOT-END closed →
`closed`; every PICK/DROP/DEPOT-END in `{completed, cancelled, closed}` → `completed`;
otherwise a lookup in `epod_trip_statuses` by `(route_point_status, route_point_type)`.
A cancelled trip is terminal. Route status is recomputed by `RouteStatusUpdateService`.
Per-status queued listeners live in `Domain/Listeners/RoutePointStatuses/` and are wired in
the host app (`apps/integral/app/Providers/EpodServiceProvider.php`).

**Driver-app workflow actions** (`epod_actions.reference` values seeded by migrations):
`ClaimTrip` (`name='Claim Trip'`,
`arguments={"linked":"true","redirect":"claim-trips","component":"ClaimTrip"}`, seeded by
`packages/epod-contract/database/migrations/alter/2024_07_22_131409_epod_add_claim_trip_into_actions_table.php`),
plus `RouteTripList, CollectionBag, StepperList, ChoiceGroup, TimelineList, ScanWorkflow,
TextInput, OrderConfirmation, SignaturePad, UserAgreement, ScanVehicleLicenseDisk, Camera,
RoutePointEvents, DeliveryBag, TaskComplete, Form, SupportingDocuments, OrderView,
YardAccessCode, CollectionBulk, DeliveryBulk, ReportRecipients, Seals, DispatchValidation,
PackingUnitCapture, PackingUnitScan, DataList, DriverAttendance, InvoiceCapture,
Instruction, RoutePoint, Routes, StoreValidation, 'Driver Tips'` — note `SignaturePad`,
`Camera`, `InvoiceCapture`, `Seals`, `YardAccessCode` are the POD-capture building blocks.

## 2. The claim interface (what our adapter must speak)

### 2.1 Endpoints

Registered in `packages/epod/routes/api.php` under `Route::prefix('v1/tms/epod/')`, inside
the group `Route::middleware(['auth:epod-drivers', GzipEncodeResponse::class])` — i.e. the
**EPOD driver mobile app** calls them, authenticated as a driver; the implementation lives in
the **ondemand** module (`Inhance\OnDemand\App\Http\Controller\TripController`):

```php
Route::post('/claimable-trips', [TripController::class, 'getClaimableTrips'])
    ->name('ondemand.trip.claimableTrips');
Route::post('/claim-trip/{groupId}', [TripController::class, 'claimTrip'])
    ->name('ondemand.trip.claimTrip');
Route::get('claimable-trips/trips', [WorkflowTripsController::class, 'index']);
Route::get('/test-claimable-trips', [TripController::class, 'testGetClaimableTrips']); // unauthenticated test route
```

Full paths (routes file is mounted under `/api`, per the inline comment
`https://<domain>/api/v1/tms/epod/routes/plans` in the same file):

- `POST /api/v1/tms/epod/claimable-trips`
- `POST /api/v1/tms/epod/claim-trip/{groupId}`

### 2.2 Step 1 — build an offer: `TripService::getClaimableTrips`

`packages/ondemand-contract/src/Services/TripService.php` (invoked from
`TripController::getClaimableTrips`, `packages/ondemand/src/App/Http/Controller/TripController.php`).

Request fields (all read via `$request->get(...)`; example values from
`TripController::testGetClaimableTrips`):

| Field                 | Meaning                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `driverReference`     | EPOD driver `reference` (e.g. `"CS001"`); driver must not already be on an open trip (`DriverOnTripException`)                                      |
| `vehicleRegistration` | `epod_vehicles.registration_no` (e.g. `"FS74GFGP"`); vehicle-type limits (`max_weight`/`max_volume`) constrain the offer                            |
| `depotReference`      | `epod_depots.reference` (e.g. a UUID); resolves the store the driver collects at; territory expansion when `epod_vehicles.shared_in_territory == 1` |
| `territoryReference`  | `epod_territories.name` fallback when no single depot                                                                                               |
| `orderReference`      | optional: restrict the offer to one `od_parts.reference`                                                                                            |
| `groupId`             | optional: continue an existing offer group, excluding its TOs (`GroupIdExpiredException` if expired)                                                |
| `weight`, `volume`    | optional caps overriding the vehicle-type limits                                                                                                    |

Selection rules (all in `TripService::fetchTransportOrders`):

- `od_transport_orders.status_id = 19` (ready), `execution_system = 'EPOD'`,
  `trip_id IS NULL`, `fulfillment_date` = today; max `MAX_TRANSPORT_ORDERS = 20` candidates
- ordered by road distance from the collection store via distance matrix
  (`MatrixProviderEnum::ROUTER` → `RouterEtaService::distanceKmFromOrigin`, else an earlier
  matrix lambda), filtered to drops within 4 km of the anchor drop
  (`filterTransportOrdersWithin4km`) and 5 km haversine of the anchor
  (`MAX_LOCATION_RADIUS_KM = 5`, `isLocationWithinRadius`)
- co-optional TOs added up to `1 + config('ondemand','MAX_TO_STOPS')` stops
- each candidate is soft-locked: `LockService->add(name: "tms-claim-{TO reference}", seconds: 30)`
- gating: `verifySolver()` throws `403 'Trip claim blocked by solver, not available'` when
  the active `on_demand/planning` setting has `tripCreation.solver.code` of `basic` or `secondary`

Offer persistence (`TripService::createClaimableTrips`): one `od_claimable_trips` row **per
transport order**, sharing `group_id = Uuid::v7()->toBase32()`,
`expire_at = now(depot tz) + CLAIM_EXPIRY_SECONDS (30)`, and
`data = {"driver": driverReference, "vehicle": vehicleRegistration, "depot_name": ...}` —
**the driver/vehicle are bound at offer time, not claim time**.

Success response (JSON body = `$tripData`):

```json
{
  "depot_names": ["..."],
  "part_references": ["..."],
  "to_references": ["TO4916569", "..."],
  "group_id": "<uuidv7-base32>",
  "expiry_at": "YYYY-MM-DD HH:MM:SS"
}
```

Error behaviour: `NoOrdersFoundException` / `GroupIdExpiredException` /
`DepotNotFoundException` return **HTTP 200** with `{"error": "...", "data": []}`;
`DriverOnTripException` returns the driver's current trip as
`{"error": ..., "data": {"trip_ref": "..."}}` (`TripService::handleError`).

### 2.3 Step 2 — claim: `TripController::claimTrip(string $groupId)`

`packages/ondemand/src/App/Http/Controller/TripController.php`:

1. Load all `ClaimableTrip` rows for `group_id`; reject if none
   (`"No claimable trips found with current group id."`) or expired
   (`"Claimable trips has expired with current group id."`) — both HTTP 200 with `error`.
2. Double-claim guard: `LockService->add(name: "tms-claimed-{to_number}", seconds: 60)`;
   if the lock is already held → `{"error": "Trip has already been claimed."}`.
3. Create an ondemand `Trip` with `reference = ReferenceNumberHelper::tripReference()` and
   `status = OnDemandTripStatus::OPEN`.
4. Fire CloudEvent via `EventHelper::triggerEvent(OnDemandTripClaimedEventTypeFactory::class,
json_encode({trip_reference, group_id}), 'tms.trip.claimed.'.$trip->reference, ...)`.
5. Respond synchronously:

```json
{ "data": { "trip_reference": "TR…", "order_references": ["TO…", "TO…"] } }
```

**Who claims:** the driver (through the EPOD app's `ClaimTrip` component). The claim call
itself carries no driver identity — driver + vehicle come from the offer rows created in
step 1.

**What happens on claim:** only the shell `od_trips` row + the `ondemand.trip.claimed`
CloudEvent. Everything else is asynchronous:
`OnDemandTripClaimedProcessor` (`packages/ondemand-contract/src/Domain/Processors/OnDemandTripClaimedProcessor.php`,
registered by `OnDemandTripClaimedSubscriptionFactory` with code `ondemand-trip-claimed`)
re-reads the `ClaimableTrip` group, bails out idempotently if any TO already has a `trip_id`
(`'Transport order is already claimed as there is already a trip for it'`), then runs
`GenerateUnclaimedTripWorkflow` (steps, in order: `CompileLocations`,
`ProcessClaimTripMatrix`, `ProcessRoute`, `ProcessClaimTripTrip`, `ProcessClaimTripStops`,
`ProcessClaimTripTransportOrder`, `PrepareForTripScheduled`, `MapClaimedTripScheduled`,
`ProcessClaimTripPart` — `packages/ondemand-contract/src/Domain/Workflow/Workflows/GenerateUnclaimedTripWorkflow.php`),
sets the trip to `OnDemandTripStatus::PLANNED`, and fires `ondemand.trip.scheduled`
(`TripScheduledDto`) with subject `tms.trip.created.{tripId}`.

**Unclaim / timeout:** there is **no unclaim endpoint**. Offers die by `expire_at`
(30 s) plus lock expiry (`tms-claim-*` 30 s at offer, `tms-claimed-*` 60 s at claim);
`releaseTransportOrderLock` frees candidates that get filtered out of an offer. A driver who
walks away simply lets the offer lapse.

### 2.4 Step 3 — work lands in EPOD

`ondemand.trip.scheduled` is consumed by
`packages/epod-contract/src/Domain/Factories/Subscriptions/EpodOnDemandTripScheduledSubscriberFactory.php`
→ `packages/epod/src/Domain/Processors/OnDemandTripScheduledProcessor.php`, which maps the
`TripScheduledDto` through `OnDemandTripToMobilityMapper` into a **route plan**
(`RouteContainerDto`) and posts it with `EpodClient::sendRoutePlan(...)`. That HTTP POST hits
`POST /api/v1/tms/epod/routes/plans` (route name `epod-route-plan`,
middleware `['client', 'passport.app.identity']` in `packages/epod/routes/api.php`).
`RoutePlanController::store` validates and then just emits one CloudEvent
`epod.route.update-plan` per route (`RoutePlannerFactory`,
`packages/epod-contract/src/Domain/Factories/RoutePlannerFactory.php`) and returns
`{"success": true}` — ingestion is asynchronous
(`packages/epod/src/Domain/Services/RoutePlanner/RoutePlannerService.php::dispatchEvents`).

Note: the same file also registers `Route::match(['post','put'], 'route-plans', ...)`
(hyphenated) **outside any auth middleware** — an unauthenticated duplicate intake route —
and `EpodClient::sendRoutePlan` actually targets that hyphenated `/route-plans` path (with
header `x-integral-measure: 1`), not the passport-guarded `routes/plans`
(`packages/epod-client/src/Application/EpodClient.php`).

**`EpodClient` — the canonical system-to-system wrapper**
(`packages/epod-client/src/Application/EpodClient.php`; base = config
`EPOD_CONFIG`/`HOST`, fallback `https://` + `Tenant::current()->domain`, all under
`/api/v1/tms/epod`):

| Method                                          | Call                                                                                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendRoutePlan($data, 'post')`                  | POST/PUT `/route-plans` (header `x-integral-measure: 1`)                                                                                                                                                  |
| `getPlannedRoute($ref)`                         | GET `/routes/plans/{ref}` → `EpodRouteContainerDto`                                                                                                                                                       |
| `getActualRoute($ref)`                          | GET `/routes/actuals/{ref}` → `MontegoRouteContainerDto`                                                                                                                                                  |
| `upsertVehicles($vehicles)`                     | POST `/vehicles/upsert` body `{"vehicles":[...]}` → `UpsertVehiclesResultDto` (400/422 returned as structured DTO)                                                                                        |
| `sendDiversionRequest($orderNo, $data, 'post')` | POST `/orders/{orderNo}/diversion-requests`                                                                                                                                                               |
| `getPassportBearerToken()`                      | POST `/oauth/token` `grant_type=client_credentials`; creds from encrypted config `Integral_Epod_Config`/`Integral_User_Credential` = `{client_id, client_secret}`; cached under key `epod_iap_auth_token` |

### 2.5 Route-plan payload (the "create work" wire shape)

Built from `Inhance\EpodContract\Domain\Route\Dtos\*`
(`packages/epod-contract/src/Domain/Route/Dtos/`), assembled in
`OnDemandTripToMobilityMapper`; a full JSON example lives at
`packages/ondemand-contract/example_payloads/trip_scheduled.json`:

```
RouteContainerDto { company: RouteCompanyDto }
RouteCompanyDto   { reference, name, routes: RouteDto[] }        // company from config TENANT/DETAILS
RouteDto          { reference, name, startAt, endAt, distance, minutes,
                    depot/territory/transporter/vehicleType: RouteReferenceDto{reference},
                    vehicle: RouteVehicleDto{registrationNumber}, trailers,
                    trips: RouteTripDto[], orders: RouteOrderDto[],
                    masterData: RouteMasterdataDto }
RouteTripDto      { planningStatus, reference, name, tripType ('Last Mile'), orderType,
                    terms, agent, sequence, startAt, endAt, distance, minutes, seals,
                    stops: RouteTripStopDto[], additionalData, deleteMissingTrips,
                    notificationLevel }
RouteTripStopDto  { sequence, reference, stopType ('Pick'|'Drop'|'Depot-End'|...),
                    diversionBlock, divertedFromReference, qrCode, arrivalAt, departureAt,
                    distanceFromPrevious, minutesFromPrevious, instruction,
                    locationReference, axle/gross/tare/nett weights, timeIn, timeOut,
                    driver: RouteReferenceDto|null, orders: RouteTripStopOrderDto[{orderNumber, subOrders}] }
RouteOrderDto     { orderNumber, createdAt, sourceLocationReference,
                    destinationLocationReference, serviceDate, serviceStart, serviceEnd,
                    plannedWeight/Uom, plannedVolume/Uom, actualWeight/Uom, actualVolume/Uom,
                    planningStatus ('Ready'), items: RouteOrderItemDto[],
                    subOrders: RouteOrderSubOrderDto[], reportRecipients, displayNumber, ... }
RouteOrderItemDto { itemNumber, reference, packingUnitFlag, plannedItemQuantity,
                    plannedItemUom, additionalData }
RouteOrderSubOrderDto { subOrderNumber, createdAt, finalisedBy, pod,
                        subOrderItems: RouteOrderSubOrderItemDto[] }
RouteMasterdataDto { company, divisions, drivers, vehicles, vehicleTypes, transporters,
                     locations (RouteMasterDataLocationDto: reference, name,
                     locationTypeReference, address fields, latitude, longitude, contact,
                     email), billingLocations, products }
```

The plan embeds its own master data, so EPOD upserts locations/vehicles/products from the
payload — but the top-level `depot`, `territory`, `transporter`, `vehicleType` references
must already exist in EPOD.

## 3. The contract packages (wire shapes)

### 3.1 `ondemand-contract` (`Inhance\OnDemandContract\…`)

**Event-type factories** (`src/Domain/Factories/Events/`; all produce CloudEvent `type` =
`ondemand.<event>` via `OnDemandBaseEventTypeFactory::makeOnDemand` with
`OnDemandModuleSpecificationFactory::$moduleCode = 'ondemand'`):

| Factory                                                                                                                          | event                                                         | payload class                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `OnDemandTripClaimedEventTypeFactory`                                                                                            | `trip.claimed`                                                | declared `TripScheduledDto` but actual publish body is `{trip_reference, group_id}` (see `TripController::claimTrip`) |
| `OnDemandTripScheduledEventTypeFactory`                                                                                          | `trip.scheduled`                                              | `TripScheduledDto`                                                                                                    |
| `OnDemandTripDebriefedEventTypeFactory`                                                                                          | `trip.debriefed`                                              | `TripDebriefedDto {tripReference, transportOrders: TripDebriefedTransportOrderDto[]}`                                 |
| `OnDemandTransportOrderReadyEventTypeFactory`                                                                                    | `transport_order.status_ready`                                | —                                                                                                                     |
| `OnDemandTransportOrderOpenedEventTypeFactory`                                                                                   | `transport_order.opened`                                      | —                                                                                                                     |
| `OnDemandTransportOrderStatusChangedEventTypeFactory`                                                                            | `transport_order.status_changed`                              | —                                                                                                                     |
| `OnDemandOrderCreatedEventTypeFactory` / `OnDemandOrderCancelledEventTypeFactory` / `OnDemandOrderStatusChangedEventTypeFactory` | `order.created`? / `order.cancelled` / `order.status_changed` | —                                                                                                                     |
| `OnDemandItemPickedEventTypeFactory`                                                                                             | `order.item_picked`                                           | —                                                                                                                     |
| `OnDemandPickingSessionStartedEventTypeFactory` / `…EndedEventTypeFactory`                                                       | `order.picking_started` / `order.picking_ended`               | —                                                                                                                     |
| `OnDemandPartReplanEventTypeFactory` / `OnDemandPartReplannedEventTypeFactory`                                                   | `part.replan` / `part.replanned`                              | —                                                                                                                     |
| `OnDemandRouteUpdatedEventTypeFactory`                                                                                           | `route_updated`                                               | —                                                                                                                     |
| `OnDemandRepackEventTypeFactory`                                                                                                 | `packing_unit_repacked`                                       | —                                                                                                                     |
| `OnDemandStatusChangedEventTypeFactory`                                                                                          | `model.status_changed`                                        | —                                                                                                                     |
| `OnDemandTimefoldSolveRequestedEventTypeFactory`                                                                                 | `timefold.solve.requested`                                    | —                                                                                                                     |

**Subscriptions** (`src/Domain/Factories/Subscriptions/`): `OnDemandTripClaimedSubscriptionFactory`
(code `ondemand-trip-claimed` → `OnDemandTripClaimedProcessor`),
`OnDemandStopStatusSubscriptionFactory` (code `ondemand-stop-status-changed-event`,
consumes `EpodOpsiStopStatusChangeFactory` + `AroundTheCornerEventTypeFactory` →
`OnDemandStopStatusProcessor`), plus `OnDemandTransportOrderReadySubscriptionFactory`,
`OnDemandDriver/Vehicle(De)AllocationSubscriptionFactory`, `OnDemandPartReturnedSubscriptionFactory`,
`OnDemandPartDeliveredUpdateUberSubscriptionFactory`, `OnDemandSolveCompletedSubscriptionFactory`,
`OnDemandShiftCreatedSubscriptionFactory`, `OnDemandWorkflowCreatedSubscriptionFactory`,
`OnDemandUberDeliverySubscriptionFactory`, `OnDemandPartReplanSubscriptionFactory`,
`OnDemandCheckReadySubscriptionFactory`.

**Core DTOs** (`src/Domain/Dtos/Core/TransportOrderDto.php` — snake_case on the wire via
`MapOutputName(SnakeCaseMapper::class)`):

`TransportOrderDto { id, tripId, stopId, slotId, statusId, originLocationId,
destinationLocationId, routeSolveId, solveId, reference, fulfillmentDate (Y-m-d),
totalWeight, totalVolume, totalPallets, createdAt, updatedAt, deletedAt, trip: TripDto,
stop: StopDto, slot: SlotDto, originLocation/destinationLocation: EpodLocationDto,
routeSolve: RouteSolveDto, parts: PartDto[], claimable, status: OnDemandTransportStatus }`

**Trip-scheduled DTO tree** (`src/Domain/Dtos/Trip/`): `TripScheduledDto {tripId, routes:
TripRouteDto[]}` with `TripRouteDto → TripTripDto → TripStopDto → TripStopPartDto`,
`TripPartDto/TripPartItemDto`, `TripSubOrderDto/TripSubOrderItemDto`,
`TripLocationDto`, `TripVehicleDto/TripVehicleTypeDto`, `TripTransporterDto`,
`TripMasterDataDto` etc. Serialized example: `example_payloads/trip_scheduled.json`.

**CloudEvent envelope** (`src/Domain/Helpers/EventHelper.php` →
`Inhance\IntegralContract\Domain\Event\Dto\Action\CreateCloudEventV1Dto`):
`{specVersion, type, source ('ONDEMAND'), subject, id (Ulid), time, data (JSON string),
deduplicationId (fresh Ulid), messageGroup, shortContext, contextData}`.

### 3.2 `epod-contract` (`Inhance\EpodContract\…`)

- **Route plan DTOs**: `src/Domain/Route/Dtos/*` (full list in §2.5).
- **Workflow event DTOs**:
  - `src/Domain/Dto/Workflow/EpodWorkflowEventCreatedDto.php` —
    `{eventCode, time, completedBy, eventReference: WorkFlowEventCreatedEventReferenceDto,
status (stopStatus + tripStatus), eventData}`;
    `WorkFlowEventCreatedEventReferenceDto {driverReference, routeReference, tripReference,
plannedStopSequence, orderReferences: WorkflowOrderReferenceDto[{orderNumber}]}`.
    The docblock carries a real sample (eventCode `secondary-delivery-end-documents-task`,
    `status: {"stopStatus":"started","tripStatus":"delivering"}`, `eventData.files[]` with
    attachment URLs of the form
    `/api/v1/tms/epod/workflows/{uuid}/attachments/{id}`).
  - `src/Domain/Dto/WorkflowLog/EventReceived/EventReceivedData.php` (snake_case) —
    `{driver_id, created_at, values, workflow_id?, trip_id?, route_point_id?,
route_point_status_id?, suspension_id?, latitude?, longitude?, item_codes?,
is_editable, trip_reference?, route_point_reference?,
route_point_status_reference?, workflow_reference?}` — real payload examples (working
    and broken) in `packages/epod/docs/investigate/869cqpgv0-epod-workflow/requirements.md`.
- **Event-type factories**: see §4 table.
- **`epod_actions`** seeding incl. `ClaimTrip` (§1.2).
- Misc: `src/Domain/Enums/BroadcastModelEnum.php`, `src/Domain/Repositories/TripAutoComplete.php`
  (also emits workflow events), `src/Domain/Services/GeofencingSettingsService.php`.

### 3.3 `epod-opsi-haulier-adapter` — precedent for a status adapter

`packages/epod-opsi-haulier-adapter/src/Domain/Dto/`:
`StopStatusEventDto {routePointId, time, status: StatusDto, eventReference: EventReferenceDto}`;
`StatusDto {routePointStatusId, routePointStatus, tripStatus}`;
`EventReferenceDto {routeReference, tripReference, driverReference, stopSequence, subOrderNumber}`.
`EpodOpsiStopStatusChangeFactory` binds this DTO to the EPOD `STOP_STATUS_CHANGED` event
type. This is exactly the normalized stop-status feed `OnDemandStopStatusProcessor` consumes
— and the shape our adapter should expect from a stop-status webhook.

## 4. Workflow events

### 4.1 Event catalog (exact CloudEvent `type` strings)

EPOD event types are built by `EpodBaseEventTypeFactory`
(`packages/epod-contract/src/Domain/Factories/EpodBaseEventTypeFactory.php`): `makeEpod()`
prefixes `EpodModuleSpecificationFactory::$moduleCode = 'epod'`
(`packages/epod-contract/src/EpodModuleSpecificationFactory.php`), an earlier variant prefixes
literal `'EPOD.'` — hence the mixed casing below.

| Factory (`packages/epod-contract/src/Domain/Factories/…`)                                                                                                                                                                                                                    | type                                                                          | payload class                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `WorkflowEventTypeFactory`                                                                                                                                                                                                                                                   | `epod.workflow.event-received`                                                | `EventReceivedData`           |
| `EpodWorkflowEventCreatedEventTypeFactory`                                                                                                                                                                                                                                   | `EPOD.WORKFLOW.EVENT.CREATED` (via the earlier prefix)                        | `EpodWorkflowEventCreatedDto` |
| `EpodStopStatusChangedEventTypeFactory::makeEpodStopStatus`                                                                                                                                                                                                                  | `epod.STOP_STATUS_CHANGED` (earlier const `STOP.STATUS.CHANGED` also present) | `StopStatusEventDto`          |
| `AroundTheCornerEventTypeFactory`                                                                                                                                                                                                                                            | `epod.stop.around-the-corner`                                                 | `AroundTheCornerEventData`    |
| `RoutePlannerFactory`                                                                                                                                                                                                                                                        | `epod.route.update-plan`                                                      | `RouteData`                   |
| `RoutePlannerUpdatedFactory`                                                                                                                                                                                                                                                 | `epod.route.plan-updated`                                                     | `RouteData`                   |
| `EpodConsolidatedTripUpdateEventTypeFactory`                                                                                                                                                                                                                                 | `epod.trip.consolidated-trip-update`                                          | `ConsolidatedTripUpdateDto`   |
| `TripEstimationsEventTypeFactory`                                                                                                                                                                                                                                            | `epod.trip.estimations`                                                       | `TripEstimationsEventData`    |
| `GeneratePodEventTypeFactory`                                                                                                                                                                                                                                                | `epod.stop.generate-pod`                                                      | `PodReceivedData`             |
| `PodCreatedFactory`                                                                                                                                                                                                                                                          | `epod.POD.GENERATED`                                                          | `PodCreatedData`              |
| `EpodDriverAllocationEventTypeFactory` / `EpodDriverDeallocationEventTypeFactory`                                                                                                                                                                                            | driver (de)allocation                                                         | —                             |
| `EpodVehicleAllocationEventTypeFactory` / `EpodVehicleDeallocationEventTypeFactory`                                                                                                                                                                                          | vehicle (de)allocation                                                        | —                             |
| `EpodTransporterAllocationEventTypeFactory`                                                                                                                                                                                                                                  | transporter allocation                                                        | —                             |
| `EpodTripTelemetryCreatedEventTypeFactory`                                                                                                                                                                                                                                   | trip telemetry                                                                | —                             |
| `EpodStopExceptionCreatedEventTypeFactory`                                                                                                                                                                                                                                   | stop exception (lateness)                                                     | —                             |
| `EpodDiversionRequestEventTypeFactory`                                                                                                                                                                                                                                       | diversion request                                                             | —                             |
| `EpodAttendanceEventTypeFactory`, `EpodShiftRouteAllocatedEventTypeFactory`, `EpodShiftVehicleChangeEventTypeFactory`, `DriverTripNotificationEventTypeFactory`, `TripPushNotificationEventTypeFactory`, `PodEmailNotificationEventTypeFactory`, `ReportLogEventTypeFactory` | internal/notification events                                                  | —                             |

Additional event types confirmed from factory/dispatch-site inspection
(`packages/epod-contract/src/Domain/Factories/`, dispatch sites in
`packages/epod-contract/src/Domain/Repositories/` and services):
`EPOD.SHIFT.EVENT_CREATED`, `EPOD.SHIFT.ROUTE_ALLOCATED`, `EPOD.SHIFT.VEHICLE_ALLOCATED`,
`EPOD.DRIVER.ALLOCATED` / `EPOD.DRIVER.DEALLOCATED`, `EPOD.VEHICLE.ALLOCATED` /
`EPOD.VEHICLE.DEALLOCATED`, `EPOD.TRANSPORTER.ALLOCATED` (payload `AllocationDto`),
`EPOD.STOP.EXCEPTION.CREATED` (lateness; dispatched from `LatenessService.php` ~line 726),
`EPOD.TRIP.TELEMETRY_CREATED` (`TelemetryDto`), `epod.diversion-requested`,
`epod.pod.email-notification`, `epod.trip.push-notification`, `trip.driver-notification`,
`trip.driver-interval-notification`.

### 4.1a Where the pipeline fires (dispatch sites)

- Driver app POSTs land in `RoutePointEventsController::store` →
  `RoutePointEventService::createEvent` and `WorkflowLogsController::store` →
  `WorkflowLogRepository::createLogEntry` (which also calls `createEvent`).
- `RoutePointEventRepository::createEvent`
  (`packages/epod-contract/src/Domain/Repositories/RoutePointEventRepository.php` ~line 35)
  writes an `epod_route_point_events` row then calls `RoutePointRepository::updateStatus`.
- `RoutePointRepository::afterStatusUpdated` (`RoutePointRepository.php` ~lines 313–342)
  fans out: Laravel `RoutePointStatusChanged`, `TripStatusChanged` (re-derives trip status +
  writes an `epod_trip_events` row), `registerUpdateStatusEvent` (~line 458 — the external
  `STOP_STATUS_CHANGED` CloudEvent, payload `UpdateRoutePointEventResource`, source
  `'Driver: {name}'`, eventGroup `EPOD_TRIP_{tripId}`), and `processTripActualsEvent`.
- Queued per-status listeners (`packages/epod-contract/src/Domain/Listeners/RoutePointStatuses/`:
  `EnRoute/Arrived/Started/Ended/Completed/Closed` StatusListeners +
  `NotifyNextStopDriverOnStopCompletedListener`) are **wired in the host app**
  (`apps/integral/app/Providers/EpodServiceProvider.php`), not in the packages.
  `CompletedStatusListener` (on DEPARTED + COMPLETED) fires `RoutePointCompleted` → for
  DROP stops with no receipt and not diversion-blocked, publishes `epod.stop.generate-pod`
  (subject `epod-generate-pod`, messageGroup `generate-pod-{tripReference}`).
- UI push is separate Laravel broadcasting (`ShouldBroadcastNow`, private channels):
  `MobilityEvent` on `mobility.{tenant}.{driverId}`, `VehicleTripEventUpdated` /
  `VehicleEventUpdated` (`InMotionEvent`) on `{tenantCode}-inmotion-vehicle-trip-event-{userId}`;
  `BroadcastModelEnum` values: `trips, claimableTrips, subOrderItemQuantities,
workflowTransfer` (`packages/epod-contract/src/Domain/Enums/BroadcastModelEnum.php`).
- Pollers (CarTrack/Ctrack GPS, `MobilityVehicleTripEvents`, `TripEstimation`,
  `PerformanceTracker`, `ConsolidatedTrips`, `AttendanceLog`, `TripEventsPurger`) feed
  telemetry/estimation events.

### 4.2 When they fire (driver-app surface)

The driver app drives everything through the `auth:epod-drivers` workflow API
(`packages/epod/routes/api.php`): `GET workflows`, `GET workflows/trips`,
`GET/PUT workflows/route-points/{routePoint}`, `POST route-points/{routePoint}/events`
(`RoutePointEventsController::store`), `POST workflows/logs`
(`WorkflowLogsController::store` — confirmed source of `epod.workflow.event-received`, see
`packages/epod/docs/investigate/869cqpgv0-epod-workflow/requirements.md` "Two call sites for
`createWorkflowReceivedEvent`: WorkflowLogsController::store (mobile app API) and
TripAutoComplete"), `POST workflows/route-points/{routePoint}/around-the-corner`
(`WorkflowRoutePointsController::createAroundTheCornerEvent`), `POST workflows/delays`,
`POST workflows/suspensions` and `POST workflows/trips/{trip}/trip-failures`
(`WorkflowSuspensionsController::store` / `tripFailure`),
`POST workflows/route-points/{routePoint}/collectionfailures`
(`WorkflowCollectionFailuresController::store`),
`POST workflows/route-points/{routePoint}/returns` (`WorkflowReturnsController::store`),
`POST workflows/telemetries` (`WorkflowTelemetriesController::store`),
`PUT workflows/orders/items` (`WorkflowOrderItemsController`).

### 4.3 How events are published today, and the outbound-webhook path

- **Bus**: everything is a CloudEvent row processed by the Integral subscription engine;
  internal consumers are `INVOKABLE` processor classes
  (`SubscriptionDto.runnerType/runnerExecuteUri`,
  `packages/integral-contract/src/Domain/Subscription/Dto/SubscriptionDto.php`).
  EPOD's own internal subscriptions
  (`packages/epod-contract/src/Domain/Factories/Subscriptions/`) include
  `GeneratePodSubscriptionFactory` (code `epod-generate-pod` → `GeneratePodEventProcessor`),
  `WorkflowEventSubscriptionFactory` (→ `WorkflowEventProcessor`),
  `TripBroadcastSubscriptionFactory`, allocation/notification factories, and inbound
  third-party bridges (`Tower/TowerToEpodTripCancelled`, `LogisticsPortal/Lp*`,
  `FromWms/RoutePlanner`, `OnDemand*`).
- **Existing external HTTP push ("Actuals" pattern)**: the
  `ActualsClientProcess` subscription factories (`EpodActualsStopStatusChanged`,
  `EpodActualsPodGenerated` — code `epod-client-pod-generated`, shipped `INACTIVE`,
  `EpodActualsWorkflowEventCreated`, `EpodActualsVehicle/DriverAllocated+DeAllocated`,
  `EpodActualsTransporterAllocated`, `EpodActualsStopExceptionCreated`) all route to
  `ActualsClientPayloadEventProcessor` → `EpodWorkflowEventProcess::processEvent` →
  `EpodSapEventDataAdapter` (payload mapping keyed by subscription code) →
  `ActualsSapClient.send()`: `Http::timeout(20)` **Basic-auth POST** to the endpoint stored
  in encrypted config `CLIENT_CONFIG`/`EPOD_ACTUALS`. This is the concrete, already-shipping
  outbound-webhook seam — pointing that endpoint at fulfil-go (or cloning the subscription
  set) delivers exactly the enriched workflow events described above.
- **External webhooks exist as first-class citizens**: `SubscriptionRunnerTypeEnum::{WEBHOOK, INVOKABLE, WEBHOOK_CE}`.
  The **Connector** feature (`packages/integral-service-v2/src/Connector/Domain/`) lets an
  external system register: `ConnectorEntity` holds `webhookUrl`, `webhookSecret`,
  `webhookToken`, plus an OAuth passport client (`clientId`/`clientSecret` via an
  application identity). Each `ConnectionEntity` (connector × event type × rate ×
  optional `transformer`) is persisted by `ConnectionRepository::save` as a subscription
  with `runnerType: SubscriptionRunnerTypeEnum::WEBHOOK_CE` and
  `runnerExecuteUri: $connector->getWebhookUrl()`, throttled by a rate-limited process pool.
- **The menu of externally exposable EPOD events** is curated by
  `packages/epod-contract/src/Domain/Services/ConnectorDetailService.php::getConnectionLists()`:
  POD generated, stop status, lateness (stop exception), workflow event, driver
  allocation/deallocation, vehicle allocation/deallocation, transporter allocation,
  telemetry, around-the-corner, diversion request, route plan updated.
- **A FlowCatalyst bridge already exists**:
  `packages/integral-service-v1/src/Legacy/Services/FlowCatalystSyncService.php` syncs
  module event types (as client-scoped `EventTypeDefinition::fromDotCode`) and
  subscriptions (`SubscriptionDefinition`, WEBHOOK/WEBHOOK_CE target = `runnerExecuteUri`)
  into FlowCatalyst via `FlowCatalyst\Client\FlowCatalystClient`, gated by
  `config('integral-service.flowcatalyst.enabled')` and
  `integral-service.flowcatalyst.invokable-endpoint` / `create-applications`.

**What a webhook delivery carries**: the CloudEvent envelope (`CreateCloudEventV1Dto`
fields: `specVersion, type, source, subject, id, time, data, deduplicationId,
messageGroup, shortContext`) with `data` = the payload DTO JSON from the tables above.
`messageGroup` is per-aggregate (e.g. `tms.trip.claimed.{tripReference}`,
`route-update-plan-{routeReference}`), which is the only ordering hint.

## 5. Proof of delivery

Retrieval endpoints (passport `['client', 'passport.app.identity']` group in
`packages/epod/routes/api.php`):

- `GET /api/v1/tms/epod/workflows/{uniqueIdentifier}/attachments/{attachmentId}`
  (`WorkflowAttachmentsController::show`, route `epod-workflow-attachment`) — the same URL
  shape that appears in `EpodWorkflowEventCreatedDto.eventData.files[].url`
- `GET /api/v1/tms/epod/route-points/{routePointId}/receipts/{receiptIdentifier}`
  (`DeliveryReceiptsController::getByRoutePoint`, route `epod-delivery-receipt`)
- `GET /api/v1/tms/epod/route-points/{routePointId}/sub-orders/{subOrderId}/receipts/{receiptIdentifier}`
  (`DeliveryReceiptsController::getBySubOrder`, route `epod-sub-order-delivery-receipt`)
- `GET /api/v1/tms/epod/trips/{trip:reference}/workflows/{workflowReference}`
  (`WorkflowActualsController::getByTrip`, route `epod-workflow-actuals-trip`) — execution actuals
- `GET /api/v1/tms/epod/routes/actuals/{route:reference}` (`RouteActualsController::show`)

**Artifacts and storage:**

- `epod_delivery_receipts` (`DeliveryReceipt.php`; migration `2022_05_12_101020`):
  `route_point_id, sub_order_id, file_path, unique_identifier` (ordered UUID via
  `DeliveryReceiptObserver`) — the generated POD PDF; `receipt_url` resolves to the named
  routes `epod-delivery-receipt` / `epod-sub-order-delivery-receipt`.
- `epod_workflow_logs.values` (JSON) holds the raw captures: signature, OTP, recipient
  name, quantities, free text, plus inline attachments (`is_attachment=true` with base64
  contents on ingest).
- `epod_workflow_log_attachments`: `workflow_log_id, order_id, name, path, ocr_text` —
  photos, signature images, documents.
- Ingest path: `WorkflowLogRepository::createLogEntry` (~line 193) → `getAttachments`
  (~line 309) → `WorkflowLogAttachmentRepository::storeAttachment` (~line 149), writing to
  `{config.storage.path}/trips/trip-{tripId}|driver-{driverId}/{uuid}{ext}` via
  `Storage::put(base64_decode(...))`.
- PDF pipeline: `GeneratePodEventProcessor` consumes `epod.stop.generate-pod` →
  `PodReportInterface::createPdf` → `DeliveryReceiptRepository::createReceipt` (~line 57),
  path `{config.storage.path}/pod/{Y-m-d}/{uuid}.pdf` (DomPDF bundling of PDF + images,
  EXIF auto-orient, OCR text under images); then `PodEmailNotificationService::publish` and
  `PodCreatedService::process` publishes the `epod.POD.GENERATED` CloudEvent
  (`PodCreatedFactory`, payload `PodCreatedData`, source `SYSTEM`, subject `POD_CREATED`,
  messageGroup `POD_CREATED_{stopReference}`).
- Storage disk is config-driven (Integral config `EPOD`/`WORKFLOWS`) with one hard-coded
  `Storage::disk('s3')` in `DeliveryReceiptRepository::getFileContents` (~line 824) — the
  deployed disk is S3. Downloads are **signed URLs** (`temporaryUrl`, now + 20 min); the
  retrieval endpoints return `{url: <temporaryUrl>, updatedAt}` (sub-order variant supports
  `?redirect=true` → 307 to the signed URL).

Receipt PDF assembly incl. the image/OCR pipeline lives in
`Inhance\EpodContract\Domain\Repositories\DeliveryReceiptRepository` (see the
`driver/test-ocr-pdf` test route in `packages/epod/routes/api.php` calling
`DeliveryReceiptRepository::generateTestPdf`). Access-code / OTP-style verification exists:
`POST /api/v1/tms/epod/capture-access-code` (`CaptureAccessCodeToStopController::capture`)
and `GET workflows/route-points/qr-code/{routePoint}`
(`WorkflowRoutePointsController::getAccessCode`); capture UI components are the
`SignaturePad`, `Camera`, `InvoiceCapture`, `Seals`, `YardAccessCode` actions in
`epod_actions` (§1.2). The `epod-opsi-haulier-adapter` shows outbound POD relay:
`UploadPodAdapter` / `PodMapper` / `UploadPodInvokable` push generated PODs to a third party
(`packages/epod-opsi-haulier-adapter/src/`).

## 6. Auth & tenancy

Host app is `apps/integral`; middleware aliases in `apps/integral/app/Http/Kernel.php`
(`client` = Passport `EnsureClientIsResourceOwner`, `epod.permission` =
`CheckEpodPermission`, `verified` = `EnsureEmailIsVerified`) and
`packages/integral-service-v2/src/IntegralServiceV2Provider.php` (line ~273:
`passport.app.identity` = `PassportClientUserLogin`).

**Four distinct auth models:**

1. **Machine-to-machine (what our adapter uses)** — `['client', 'passport.app.identity']`.
   `client` validates an OAuth2 bearer from `POST /oauth/token` with
   `grant_type=client_credentials` `{client_id, client_secret}`;
   `PassportClientUserLogin`
   (`packages/integral-service-v2/src/Passport/Application/PassportClientUserLogin.php`)
   decodes the JWT, takes the `aud` claim as the Passport `Client` (application) id, logs in
   the `User` at `client->user_id`, and injects `applicationId`. Each integration gets its
   own Passport client credentials — "application identity" == a Passport OAuth client.
2. **Driver mobile** — guard `auth:epod-drivers`, defined via `Auth::viaRequest` in
   `apps/integral/app/Providers/EpodServiceProvider.php` (~462–475; `config/auth.php:50`),
   resolving `WorkflowAuthService@authenticateFromRequest`; logic in
   `packages/epod-contract/src/Domain/Repositories/WorkflowAuthRepository.php` (~38):
   bearer token matched against `WorkflowProcessToken` (`token`, `expire_at >= now()`), OR
   body `{pin, reference}` checked with `Hash::check($pin, $driver->personal_identifier)`.
   Tokens are minted/rotated via `WorkflowProcessTokensController` (`POST workflows/token`)
   and `WorkflowDriversController::rotateToken` (`POST workflows/session/settings`), and can
   ride as `?token=` in workflow/QR URLs.
3. **Back-office console** — `auth:sanctum` + `verified` + `web` session, plus
   `epod.permission` (`packages/epod/src/App/Http/Middleware/CheckEpodPermission.php`
   mapping route names to spatie/laravel-permission permissions) on the BFFE routes
   (`packages/epod/routes/bffe.php`, group prefix `tms/epod/in-motion`).
4. **`laravel-simple-token-auth`** — a separate OIDC/JWT validator (NOTE — decision
   2026-07-12: do NOT use this for the new fulfil-go-facing endpoints. The monorepo
   already integrates FlowCatalyst; protect new endpoints with FlowCatalyst access
   tokens via the existing middleware alias `fc.or-passport` =
   `\FlowCatalyst\Auth\Http\Middleware\AuthenticateServiceTokenOrFallback`,
   which accepts a FlowCatalyst service token or falls back to a Passport token.)
   (`SimpleTokenMiddleware` → `TokenValidator` against a JWKS URL; envs
   `LARAVEL_SIMPLE_TOKEN_AUTH_SERVER_JWKS_URL`, `LARAVEL_SIMPLE_TOKEN_ISSUER`, etc.). **Not
   wired into epod/ondemand** — its only consumer is `packages/shortener/routes/api.php`.

`TripDebriefController::debrief` additionally checks
`hasPermissionTo(OnDemandTripDebriefPermissionFactory::make())`
(`packages/ondemand-contract/src/Trip/Controllers/TripDebriefController.php`).

**Multi-tenancy = database-per-tenant** via spatie/laravel-multitenancy — not client_id
columns:

- `apps/integral/config/multitenancy.php`: `tenant_finder =
Inhance\TenantSpatie\Application\InhanceTenantFinder`, switch tasks
  `InhancePrefixCacheTask` + `InhanceSwitchTenantTask`, connections `tenant`/`landlord`,
  `queues_are_tenant_aware_by_default = true`.
- Tenant resolution (`packages/tenant-spatie/src/Application/InhanceTenantFinder.php`):
  header **`X-INHANCE-TENANT`** (`Tenant::where('code', ...)`), else Spatie
  `DomainTenantFinder` by hostname — hence per-tenant hosts like
  `dev-twinsaver.inhanceapps.com` (sample URLs in
  `packages/epod/docs/investigate/869cqpgv0-epod-workflow/requirements.md`).
- **Company** is an intra-tenant grouping, not the tenant boundary:
  `Inhance\EpodContract\Domain\Models\Company`
  (`packages/epod-contract/src/Domain/Models/Company.php`, `epod_` table prefix); the epod
  `Application` middleware (`packages/epod/src/App/Http/Middleware/Application.php`) sets
  the current company per authenticated user/driver via
  `CompanyFacade::setCurrentByUserId(...)` — applied explicitly on only one route
  (`packages/epod/routes/api.php` ~241).
- Tenant identity for outbound payloads (company reference/name) comes from config
  `TENANT`/`DETAILS` (`OnDemandTripToMobilityMapper::setTenantData`).
- **Connectors**: each external connector gets a Passport application identity
  (`oauth_client_id`/`oauth_client_secret`) and webhook credentials (`webhookUrl`,
  `webhookSecret`, `webhookToken`) —
  `packages/integral-service-v2/src/Connector/Domain/ConnectorEntity.php`. Event types are
  synced to FlowCatalyst as `clientScoped: true` (`FlowCatalystSyncService::mapEventTypes`).

**Header/config cheat-sheet for the adapter**: tenant header `X-INHANCE-TENANT` (or rely on
per-tenant hostname); M2M `Authorization: Bearer <passport JWT>` from `POST /oauth/token`;
epod-client extra header `x-integral-measure: 1`; driver `Authorization: Bearer
<workflow token>` or `{pin, reference}`; config keys `EPOD_CONFIG`/`HOST` and encrypted
`Integral_Epod_Config`/`Integral_User_Credential`; token cache key `epod_iap_auth_token`.

## 7. Lifecycle mapping → fulfil-go TransportOrder machine

Target machine (docs/transport-context.md): `requested → booked → assigned → collected →
delivered | failed | cancelled`.

| fulfil-go status                  | ondemand signal                                                                                                                          | EPOD signal (`TripStatusEnum` / `RoutePointStatusEnum`)                                                                                                                                                                                 | Notes                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requested`                       | `od_transport_orders.status_id=19 (ready)` + `execution_system='EPOD'`; event `ondemand.transport_order.status_ready`                    | route plan accepted (`epod.route.update-plan` emitted); trip `ready`                                                                                                                                                                    | "requested" = work is offerable/claimable                                                                                                                |
| `booked`                          | `POST /claim-trip/{groupId}` success; event `ondemand.trip.claimed`; od trip `open` → `planned`                                          | trip created from route plan (`ready`)                                                                                                                                                                                                  | claim ≈ booking commitment                                                                                                                               |
| `assigned`                        | driver+vehicle bound in the **offer** (`od_claimable_trips.data`), confirmed by `ondemand.trip.scheduled` (route carries driver/vehicle) | `EPOD.DRIVER.ALLOCATED`; `RouteTripStopDto.driver`; trip `started`                                                                                                                                                                      | in the claim flow, booked and assigned collapse into one instant — the claimer is the assignee                                                           |
| `collected`                       | trip `collecting → collected`; stop type `pick` reaching `completed`                                                                     | trip `collecting → collected`; PICK route point `completed`/`departed` (`STOP_STATUS_CHANGED` with `status.tripStatus`)                                                                                                                 | derive from stop-status events (`StatusDto.routePointStatus`/`tripStatus`)                                                                               |
| (in transit — no fulfil-go state) | stop `on_route`, `around_the_corner` (`epod.stop.around-the-corner`); trip `delivering`                                                  | trip `en-route`/`delivering`; route point `en-route`/`arrived`/`started`/`ended`; `is_around_the_corner`                                                                                                                                | fold into `collected`; ATC is a progress signal, not a state. Note EPOD's `en-route` is remapped to ondemand `on_route` in `OnDemandStopStatusProcessor` |
| `delivered`                       | DROP stop `completed`; TO → `completed/delivered`; then trip `executed` → `debriefed` (`ondemand.trip.debriefed`)                        | DROP route point `completed` → trip `delivered` → `completed`; `epod.POD.GENERATED`                                                                                                                                                     | recommend: `delivered` on drop-stop completion; treat POD arrival as artifact, debrief as reconciliation                                                 |
| `failed`                          | trip `not_executed` (status_id 11); stop `suspended`; TO `returnable/returned`                                                           | trip `suspended` (any stop suspended); `returning`/`returned`; `EPOD.STOP.EXCEPTION.CREATED`; `WorkflowSuspensionsController::tripFailure` / `store`; `WorkflowCollectionFailuresController::store`; `WorkflowReturnsController::store` | multiple signals — see below                                                                                                                             |
| `cancelled`                       | TO/stop/order `cancelled` (`ondemand.order.cancelled`, `/api/tms/transport/parts/cancel`)                                                | trip `cancelled` (all stops cancelled; terminal); trip removal via re-plan (`deleteMissingTrips`); inbound `TowerToEpodTripCancelled` bridge exists                                                                                     | no explicit EPOD trip-cancel API in the claim flow                                                                                                       |

Things that do **not** map cleanly:

1. **`suspended` is not terminal** (`OnDemandStopStatus::SUSPENDED`): a suspension/delay can
   resume; only `not_executed` / debrief outcome decides failure. An adapter must hold
   suspensions as "at-risk", not `failed`.
2. **Returns**: failed delivery becomes `returnable → returned` on the TO (statuses 39/35)
   with a `return`/`depot-end` stop — fulfil-go's machine has no return leg; map to `failed`
   with a reason, but expect post-`failed` events.
3. **`executed` vs `debriefed`**: EPOD execution ends at `executed`, but commercial truth is
   settled at debrief (`ondemand.trip.debriefed`, `POST /api/tms/transport/trips/debrief`,
   `TripDebriefCommand`). Quantities can change at debrief (short delivery). If fulfil-go
   marks `delivered` at drop completion, debrief corrections arrive later.
4. **Two status vocabularies**: numeric `status_id` (per-tenant `od_statuses` insertion
   order) travels next to string enums, and EPOD's `routePointStatus` uses different tokens
   (`'en-route'` vs ondemand `on_route` — explicitly remapped in
   `OnDemandStopStatusProcessor::process`). Normalize on strings, never ids.
5. **`around_the_corner`** and lateness statuses (`on_time/early/late`) are progress/SLA
   flags interleaved with lifecycle statuses in the same `od_statuses` table.

## 8. Adapter risk list

1. **The claim interface is not an API between systems — it's a driver-app endpoint inside
   the monolith.** `/claimable-trips` + `/claim-trip` are served by the ondemand module,
   mounted inside EPOD's route file, authenticated by EPOD's driver guard, and reading
   EPOD's `epod_*` tables directly in SQL joins
   (`packages/epod/routes/api.php`, `packages/ondemand-contract/src/Services/TripService.php`).
   For fulfil-go, either (a) our adapter re-implements these two endpoints and EPOD's app is
   pointed at us (then we must validate `epod-drivers` tokens or front them), or (b) we skip
   claiming entirely and push route plans; the claim UX then has to be rebuilt on our side.
2. **Shared-database coupling / FK-everywhere.** Offers are only buildable because ondemand
   can join `od_transport_orders` to `epod_locations/epod_depots/epod_territories` in one
   query. A route plan needs pre-existing `depot`, `territory`, `transporter`,
   `vehicleType` references and a company reference from tenant config
   (`OnDemandTripToMobilityMapper`); master data (locations, vehicles, products) rides in
   the payload, but referential misses fail ingestion ("mobility complaining even though
   it's not specified" comment in the mapper). The adapter needs a master-data sync/upsert
   step (`POST vehicles/upsert`, plan-embedded `masterData`) before any work can be offered.
3. **Weak idempotency and async acceptance.** `deduplicationId` is a fresh
   `Ulid::generate()` per publish (`EventHelper::trigger`,
   `RoutePlannerService::dispatchEvents`) — retries create duplicate events.
   `POST routes/plans` returns `{"success": true}` when the CloudEvent is queued, not when
   the plan is materialized; there is no sync confirmation and no plan-level idempotency
   key (re-posting re-processes; upsert semantics by `reference` only).
4. **Claim race protection is cache-lock based and time-boxed.** `LockService` locks
   (`tms-claim-*` 30 s, `tms-claimed-*` 60 s) plus a 30-second `od_claimable_trips.expire_at`
   are the only concurrency control; the definitive guard is the late `trip_id IS NOT NULL`
   check inside the async `OnDemandTripClaimedProcessor`. Under webhook/event lag a driver
   can get a success response for a claim whose trip generation later fails (workflow error
   → rollback → `returnErrorResponse`), with no compensating event back to the driver.
5. **Events lack stable per-event ids at the payload level.** Payload DTOs
   (`StopStatusEventDto`, `EventReceivedData`, `EpodWorkflowEventCreatedDto`) carry
   references + timestamps but no event id; only the CloudEvent envelope `id` (Ulid) is
   unique. A webhook consumer must dedupe on envelope `id` and tolerate replays and
   out-of-order delivery (ordering only per `messageGroup`).
6. **Sparse/partial payloads are normal.** Production `epod.workflow.event-received`
   payloads with `workflow_id: null` and missing required fields crash the internal
   processor today (`packages/epod/docs/investigate/869cqpgv0-epod-workflow/requirements.md`,
   14 errors across 5 tenants) — the adapter must treat every field except
   `driver_id`/references as optional.
7. **Mixed event-type casing and duplicated factories** (`epod.workflow.event-received` vs
   `EPOD.WORKFLOW.EVENT.CREATED`, `epod.STOP_STATUS_CHANGED` vs the earlier `STOP.STATUS.CHANGED`)
   mean the event-type whitelist must be exact-string, per-tenant verified.
8. **Tenancy is deployment-level.** Per-tenant hosts and per-tenant DBs (tenant config
   `TENANT`/`DETAILS`; sample URLs `dev-twinsaver.inhanceapps.com`); the adapter needs
   per-tenant base URLs + credentials, and `od_statuses` numeric ids may differ per tenant.
9. **Hardcoded regional assumptions**: `Africa/Johannesburg` default timezone
   (`TripService::DEFAULT_TIMEZONE`, `OnDemandTripToMobilityMapper` sub-order timestamps),
   `countryCode ?? 'ZA'`; claimability is hard-limited to **today's** `fulfillment_date`
   (`fetchTransportOrders`).
10. **Security drift to verify before integrating**: unauthenticated
    `POST|PUT route-plans` and `GET /test-claimable-trips` routes sit next to the authed
    ones in `packages/epod/routes/api.php`.
11. **Solver coupling**: claiming is globally disabled whenever the planning setting's
    `tripCreation.solver.code` is `basic`/`secondary` (`TripService::verifySolver`) — an
    external adapter inherits that tenant-side kill switch.
12. **Numeric ids leak into wire payloads.** `RoutePointStatusIdsEnum` hard-codes
    `EnRoute=1 … Closed=10` and `StatusDto.routePointStatusId` carries them; `od_statuses`
    ids are per-tenant. Key everything on the string references
    (`route_point_status_reference`, `routePointStatus`, `tripStatus`), never ids.
13. **Event wiring lives in the host app, and key subscriptions ship disabled.** The
    per-status listeners are registered in `apps/integral/app/Providers/EpodServiceProvider.php`
    (not the packages), and `EpodActualsPodGenerated` (code `epod-client-pod-generated`) is
    seeded `INACTIVE` — the outbound event set actually firing in a given tenant must be
    verified in that tenant's deployment, and the POD-generated push may need activating.
14. **Only one concrete external wire protocol exists in-package**: the Actuals path is a
    Basic-auth JSON POST per event (`ActualsSapClient`, endpoint from encrypted config
    `CLIENT_CONFIG`/`EPOD_ACTUALS`), and Connector webhooks are `WEBHOOK_CE` CloudEvents.
    fulfil-go's webhook receiver should accept both envelopes (raw adapter payload vs
    CloudEvent-wrapped) until the delivery mechanism is pinned down with the Integral team.

## Appendix A — claim interface quick reference

```
# 1) Build offer (driver context)
POST /api/v1/tms/epod/claimable-trips          Authorization: epod-drivers token
{ "driverReference": "CS001", "vehicleRegistration": "FS74GFGP",
  "depotReference": "<epod_depots.reference>", "territoryReference": "<territory name>",
  "orderReference": null, "groupId": null, "weight": null, "volume": null }
→ 200 { "depot_names": [...], "part_references": [...], "to_references": [...],
        "group_id": "<uuid7-base32>", "expiry_at": "<ts>" }        # 30s TTL
→ 200 { "error": "...", "data": [] }                               # soft errors

# 2) Claim (within 30s)
POST /api/v1/tms/epod/claim-trip/{groupId}     Authorization: epod-drivers token
→ 200 { "data": { "trip_reference": "TR…", "order_references": ["TO…"] } }
→ 200 { "error": "Trip has already been claimed." } | "…expired…" | "No claimable trips…"

# 3) Async: ondemand.trip.claimed → trip build → ondemand.trip.scheduled
#    → EpodClient::sendRoutePlan → POST /api/v1/tms/epod/routes/plans (passport client)
#    → {"success": true} → CloudEvent epod.route.update-plan → EPOD materializes trip
```
