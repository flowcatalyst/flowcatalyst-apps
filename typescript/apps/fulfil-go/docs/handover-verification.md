# Handover verification — collection scanning, pickup/delivery PINs, age checks

Status: DESIGNED with Andrew 2026-07-13 (decisions locked below) — NOT built.
Owner contexts: fulfilment (secrets + policy stamps), transport (requirements
+ evidence), execution app (driver flows), management (audited reveal).

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
  requiresVehicle; restricted orders fall through the candidate chain).

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

**Collection (execution app)**: claimed trip → Start collection → driver
scans bag/parcel barcodes; app matches locally against parcel refs already
in the offer/my-trips payload; a fully-scanned order confirms COLLECTED
(evidence: scanned refs); last confirmed order auto-flips the TRIP to
collected (mirror of trip auto-complete). **PIN override per order**: driver
taps "Can't scan" → store staff reads the pickup PIN (picking-app handover
view / flightboard audited reveal) → driver enters → server verifies —
deliberately ONLINE-ONLY; rate-limit attempts + activity-log failures.
Covers unbarcoded `loose-N` packages too. An order whose goods can't be
found fails at collection with a reason; the trip proceeds with the rest.

**Delivery**: customer tells the driver the delivery PIN → server verifies
on the delivered report. Restricted orders additionally require
`verification: {method: 'id-attestation', docType}` or
`{method: 'visual-override'}` — the override renders and is accepted ONLY
when the stamped policy allows it. Wrong-PIN/failed-check → order fails
with reason (return-to-store physical leg is a separate backlog item).

**Audited reveal (management)**: pins never appear in list/detail DTOs.
`GET /clients/:id/fulfilments/:fid/handover-pins` behind a new permission
(e.g. ViewHandoverPins) appends an activity-log entry (source=admin,
category `pin-viewed`, actor) as part of the read; surfaced as a
flightboard row action + fulfilment side-panel button.

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
