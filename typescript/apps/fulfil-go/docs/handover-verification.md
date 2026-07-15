# Handover verification — collection scanning, pickup/delivery PINs, age checks

Status: BUILT 2026-07-14 (designed with Andrew 2026-07-13; decisions locked
below). Smoke-verified end-to-end on :3299 — 27 checks: pins on create,
audited reveal + pin-viewed entry, requirements captured on the transport
order (no pin values), driver offer/claim, my-trips carrying parcels +
requirements, interactive verify-pin (wrong→right), per-stop scan
collection + replay ACK, delivered with wrong pin + missing age check
ACCEPTED and stamped mismatch, trip auto-complete, flightboard
`delivery_verification_mismatch`, verification activity entries.
Owner contexts: fulfilment (secrets + policy stamps), transport (requirements
+ evidence), execution app (driver flows), management (audited reveal).
NOT yet device-verified: camera scanning on real Android hardware.

## Locked decisions (Andrew, 2026-07-13 — don't relitigate)

- **Delivery PIN scope: per FULFILMENT** (one code per customer order; every
  drop of a multi-part fulfilment verifies the same code). For collect-type
  it is the collection-point handover code.
- **Pickup PIN scope: per PART** (= per transport order — "a pin for each
  order"); always randomly generated. Delivery PIN source configurable:
  `random` (default) | `phone-last4` (falls back to random —
  `destination.contact.phone` is optional; last-4 is the weaker option and
  stays opt-in).
- **PIN comms: upstream pulls via API.** Pins returned in the
  create-fulfilment response + an audited GET; the client's commerce system
  messages the customer. Pins NEVER ride platform event payloads
  (msg_events/dispatch jobs are stored + logged platform-side) and NEVER
  ship to our driver app (server-side verification only).
- **Age-check evidence: ATTESTATION ONLY** (driver confirms "ID checked,
  DOB ≥ min age" + doc type; no image stored — POPIA; photo capture is a
  possible later add, needs blob storage + retention first).
- **Provider gating: the resolver EXCLUDES providers that can't perform a
  required verification** (capability flags join the resolver exactly like
  requiresCarOrLarger; restricted orders fall through the candidate chain).
- **OFFLINE-FIRST DELIVERY (Andrew, 2026-07-14): a claimed trip must be
  completable with no connectivity; reports queue and push on reconnect.**
  Therefore delivery-PIN verification is DEFERRED, not blocking: the server
  verifies whenever the report reaches it and stamps the outcome — it never
  rejects the report (the physical handover already happened). The secret
  STILL never ships to the driver device: a hash-on-device variant was
  considered and rejected — any digest of a 4-digit code is brute-forced
  instantly on a rooted phone, which would gut the pin entirely.

## Ownership map

| Attribute | Owner | Notes |
| --- | --- | --- |
| Config: pin enablement, delivery-pin source, age-check mode, visual-override permission | `client_settings` → new `fulfilment` section (registry-validated, like processDefinition/vehicleClasses) | Resolved + STAMPED at creation; in-flight fulfilments keep their stamp |
| `deliveryPin` | Fulfilment ROOT | Generated at creation; plaintext (one-shot handover code, not a credential — must be retrievable/verifiable) |
| `pickupPin` | Fulfilment PART | Generated at creation (parts immutable) |
| `maxRestrictedAge` | Fulfilment ROOT, computed at creation | From NEW first-class `restrictedMinAge` on FulfilmentLine — `attributes` is explicitly not process input |
| Verification REQUIREMENTS `{pinRequired flags, agePolicy {minAge, mode, overrideAllowed}}` | TransportOrder, captured at request time | Captured-value-object pattern; requirements, never secrets |
| Verification EVIDENCE (scanned refs, pin-used, attestation, override) | TransportOrder (collected/delivered payloads) + activity log | |
| Provider capabilities `supportsDeliveryPin` / `supportsAgeCheck` | Provider registry/port | Uber Direct natively supports pincode + identification requirements; EPOD TBD |

PIN values live in EXACTLY ONE place — the fulfilment aggregate. Pick and
transport never store them; reveal endpoints and provider adapters read the
fulfilment tables in-process (modular monolith), and third-party systems
receive pins only in SYNCHRONOUS pushes (EPOD route plan, Uber booking).

## Flows

**Collection (execution app, offline-first)**: claimed trip → Start
collection → driver scans bag/parcel barcodes; the app matches LOCALLY
against parcel refs already in the offer/my-trips payload — the claimed
trip carries everything needed, so scanning-based collection completes
fully offline (the picking-app model: claimed work is self-contained,
events push on reconnect). A fully-scanned order confirms COLLECTED
(evidence: scanned refs); last confirmed order auto-flips the TRIP to
collected (mirror of trip auto-complete). **PIN override per order**:
driver taps "Can't scan" → store staff reads the pickup PIN (picking-app
handover view / flightboard audited reveal) → driver enters → same
deferred-verification model as delivery: online = interactive verify
(rate-limited), offline = capture + complete locally + verify on sync,
mismatch → flightboard exception. Covers unbarcoded `loose-N` packages
too. An order whose goods can't be found fails at collection with a
reason; the trip proceeds with the rest. Edge: the pin REVEAL happens on
the store's surface — if the store device is also offline the override has
no pin to give; acceptable (scan is the primary path), noted not solved.

**Delivery (offline-first)**: the delivered report CARRIES the evidence —
`{pinEntered?, method: 'id-attestation'|'visual-override', docType?}` — and
the server stamps a verification OUTCOME when it processes the report:
`verified` | `mismatch` | `not-checked`. The report is always ACCEPTED
(goods already changed hands; rejecting a deferred report can't undo
reality) — a `mismatch`/`not-checked` outcome raises a flightboard
exception (`delivery_verification_mismatch`) + activity-log entry for ops
follow-up instead.

- ONLINE (common case): the app pre-verifies the pin interactively BEFORE
  handover (rate-limited endpoint) — wrong pin at the door → driver
  withholds the goods and fails the stop with reason.
- OFFLINE: the app captures the entered pin, completes the stop locally,
  and queues the report (mobile-kit outbox, Idempotency-Key — the same
  machinery as pick outcomes; the execution app's report calls moving onto
  that queue is the already-planned prerequisite). UI shows "verification
  pending sync". The driver gets no at-door mismatch feedback offline —
  inherent trade-off, surfaced as the exception on sync.
- Queued reports drain FIFO per trip (collected → stop outcomes), server
  replays stored responses on retry; verification outcomes never 4xx the
  drain (a mismatch is recorded, not rejected).

Age attestation works offline trivially (driver-entered evidence, no
secret). Restricted orders require the evidence on the report; the
visual-override option renders and is accepted ONLY when the stamped
policy allows it.

**Audited reveal (management)**: pins never appear in list/detail DTOs.
`GET /clients/:id/fulfilments/:fid/handover-pins` behind a new permission
(e.g. ViewHandoverPins) appends an activity-log entry (source=admin,
category `pin-viewed`, actor) as part of the read; surfaced as a
flightboard row action + fulfilment side-panel button.

## Guided delivery journey (Andrew, 2026-07-14 — BUILT same day)

The execution app walks stops IN ROUTE ORDER: only the active stop is
actionable — 🧭 Navigate (default maps app: `geo:` intent on device,
Google Maps directions in browser) → 📍 I've arrived (local timestamp,
rides the report as `evidence.arrivedAt` — offline-safe, gives ops
arrival-to-handover timing) → proof → Delivered/Failed → next stop
unlocks → last terminal stop fires `trip:completed` (unchanged).

**Proof modes** — `client_settings.fulfilment.deliveryProof:
none | pin | picture` (default 'pin'; legacy deliveryPinEnabled input
maps true→pin/false→none). Stamped at creation like everything else;
requirements carry it to the driver (`deliveryProof` alongside the legacy
boolean; old rows normalize via `requiredDeliveryProof`). Pins generate
ONLY for mode 'pin'. 'picture' = proof-of-delivery photo; 'none' = tap
through (age check stays orthogonal to all three).

**POD photos + the BLOB STORE port** (first binary asset): framework
`BlobStore` port + `parseBlobStoreConfig`; DRIVER FROM CONFIG
(`FULFILGO_BLOB_STORE=db` default | `s3://bucket/prefix` deployed —
Andrew's call: db locally, S3 in real environments; the S3 driver
lazy-imports @aws-sdk/client-s3). Client-scoped keys. Refs are
CLIENT-GENERATED (`pod_…`) so offline evidence can reference a photo
before its upload drains — `PUT /pod-photos/:ref` is an idempotent
upsert (driver session), queued BEFORE the report (FIFO); `GET` serves
the image (any authenticated scope). Missing photo on a
picture-proof delivery = accepted + flagged (`delivery photo missing` →
verification entry + flightboard exception), same deferred philosophy.
Smoke 10/10: requirements carry the mode, blob round trip, evidence
photoRef+arrivedAt, missing-photo flag, proof-none straight-through.
NOT verified: S3 driver against a real bucket; native camera capture.

## One active trip per driver (Andrew, 2026-07-14 — BUILT same day)

Industry norm: concurrent orders are PLANNER-composed into one route
(DoorDash batched offers / Add to Route; Postmates forces add-ons) —
drivers never self-stack. Own channel: compose refuses
(`OPEN_TRIP_EXISTS`) and claim 409s while a claimed trip exists; app
hides Find work. EPOD door exempt (their workload management).
Consolidating two un-started trips is unreachable under the rule; the
surviving need is a TOP-UP (extend a claimed un-collected trip at the
same store within caps) — queued, not built.

## Open edges (flagged, not blocking)

- Substitutions can escalate restriction: block subs carrying
  `restrictedMinAge` above the fulfilment's stamp when approved-sub lists
  land.
- Collect-type age check + handover pin = store-staff surface (not driver);
  delivery scoped first, seam left.
- Failed-delivery physical return leg is untracked today (pre-existing gap,
  more likely once checks can fail).
- PIN length/format TBD at build time (suggest 4 digits, leading-zero-safe
  strings).
