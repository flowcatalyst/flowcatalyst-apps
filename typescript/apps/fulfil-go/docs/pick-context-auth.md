# Pick context — picker auth & device model (design)

Status: agreed in discussion with Andrew, 2026-07-09. **Nothing implemented yet** —
the pick context is still the landing pad (`POST /clients/:clientId/picks` acks +
logs). This is the foundation the pick context is built on: how a person on a
shared store station proves who they are and what store they act for.

Scope: the **picking** app (in-store, shared station). The driver/execution app
(mobile, in the field) is out of scope here — it may keep platform OIDC or adopt
a variant later; its offline-login needs differ (see Non-goals).

## Why picker identity is local to the pick context

Platform OIDC (the existing `server/src/auth` path — `token-validator`,
`oidc-client`, `role-permissions`) is right for **management/dispatch/admin**
users on the management app: real accounts, email, platform roles. It is wrong
for frontline pickers — high turnover, shared devices, often no corporate email.
So pickers are a **local identity owned by the pick context**; they never reach
the platform. The platform still owns the tenant (`clientId`) and machine
identity; picker outcomes become domain events attributed to a local picker id.

This means two auth planes coexist on the fulfil-go server:

- **Platform OIDC** — management app, dispatch, admin (unchanged).
- **Pick-context local identity** — pickers + their stations (new, this doc).

## The core model: device plane vs person plane

The single idea everything else falls out of — **separate the device from the
person**:

- **Device = store identity.** A station is enrolled to exactly one store. Set
  once at enrollment, **immutable until an admin reassigns or revokes it**. This
  is a _possession_ factor.
- **Person = who is signed in right now.** Per-login credential (QR badge or
  PIN). On a shared station many pickers sign in and out over a day against the
  same store-bound device.

Payoff: **a PIN on an enrolled device is already two factors** (enrolled device
you have + PIN you know) without building real MFA. Security is anchored by
device enrollment, so the per-person credential stays lightweight. "Shared
station" and "personal phone" become the same model — the second is just a
device where one person happens to be the only one who logs in.

Confirmed with Andrew: **pick is shared station.** User exits → someone else
logs in. Store-bound device + per-user login.

## Per-user auth policy

Each picker has `primaryAuthMethod: 'pin' | 'qr'`, chosen at creation.

- **PIN-primary** → PIN only, always. **No QR issued. That is it.**
- **QR-primary** → badge QR active, **no standing PIN**. A **break-glass PIN**
  is minted by an admin only when the badge is lost, and closes when the
  replacement badge is issued.

A picker therefore holds a subset of these credentials:

```
Credential            Present for            Lifetime
────────────────────  ─────────────────────  ─────────────────────────────
standingPin           PIN-primary            permanent (until reset)
qrBadge               QR-primary             until revoked/replaced
breakGlassPin         QR-primary, lost badge  single-use window, auto-expires
```

### QR is a revocable, PIN-strength bearer secret

A printed/exported QR can be photographed and copied, so it is **roughly
PIN-strength — not stronger**. Rules:

- The QR encodes a **high-entropy opaque token** (≥128-bit, URL-safe). We store
  only its **hash** (slow hash, per-credential salt); the raw token is shown
  **once** at generation for print/export.
- It is **revocable and reissuable** server-side.
- A scanned QR is **not** treated as more trustworthy than a typed PIN.

### Break-glass PIN — Option B (chosen)

**No standing PIN exists for a QR-primary user.** The admin _issues_ a fresh
temporary PIN at the moment the badge is reported lost:

- 6 digits, hashed + salted, **shown once**, `expiresAt` (default **72h**) as
  defense-in-depth even if no replacement is issued.
- At most one active break-glass PIN per picker.

The lost-badge flow is **one coupled workflow, not an independent toggle**:

```
report-badge-lost   →  REVOKE old QR (it is a loose secret now — the important
                       half)  +  MINT temporary break-glass PIN (shown once)
issue-replacement   →  ACTIVATE new QR  +  CLOSE break-glass PIN
break-glass expiry  →  CLOSE break-glass PIN (no replacement yet → user is
                       locked out until admin acts; by design)
```

## Login UX on a shared station

The device is store-bound but many people use it, which surfaces an asymmetry:

- **QR self-identifies** — the token maps to the user, so login is a single
  **scan**.
- **A PIN does not** — `1234` alone can't say _which_ picker. PIN login is two
  steps: **identify → enter PIN**.

Identify step = **staff code** entry (chosen over tap-your-name to avoid
flashing the store roster on a back-of-house screen). The **store binding powers
the eligibility list**: only pickers on _this device's store_ who currently have
PIN login enabled (PIN-primary users + anyone in a break-glass window) can
complete a PIN login.

```
Station login screen
├── [ Scan badge ]         ← QR-primary happy path (single action)
└── [ Sign in with PIN ]   ← staff code → PIN
     (server checks: staffCode ∈ this store, PIN login currently enabled)
```

## Sessions — three distinct layers

1. **Device enrollment** — long-lived, store-bound, **survives every person
   sign-out**. Only an admin reassign/revoke ends it. Backed by a device record
   (revocable) + a refreshable device credential.
2. **Person session** — short-lived access token + refresh, minted on
   scan/PIN login. Ends on **Exit** (explicit sign-out) or **inactivity
   auto-logout** (idle timeout — so the next person at the station isn't acting
   as the last one).
3. **Offline work** — actions queue under whoever is signed in; each queued
   action carries `pickerId` + `Idempotency-Key` and is validated server-side at
   drain time (server is authoritative).

Revocation/suspension takes effect at the **next refresh** (≤ access TTL): the
refresh path re-checks device status + picker status.

### Login online, work offline (station simplification)

Full offline _login_ would force caching a whole store's PIN hashes on the
shared device — **we don't.** The station is wall-powered on store wifi:

- **Login requires connectivity.** Far less credential material on the device.
- **Actions tolerate blips** via the existing mobile-kit offline queue.

(Full offline login is a driver/execution-app-in-the-field concern, not the
picking station — see Non-goals.)

## Aggregates (pick context)

```
Store (registry entity — the anchor pickers & devices bind to)
├── clientId            tenant (TSID)
├── storeRef            unique per client (matches fulfilment part origin.ref)
└── name, timezone, …

PickerUser                                    pkr_<tsid>
├── clientId · storeRef                        one store per picker (v1)
├── displayName
├── staffCode           unique per (clientId, storeRef); the PIN-login identifier
├── primaryAuthMethod   'pin' | 'qr'
├── status              active | suspended
├── credentials
│   ├── standingPin?     { pinHash, salt }              (PIN-primary only)
│   ├── qrBadge?         { tokenHash, status, issuedAt } (QR-primary only)
│   └── breakGlassPin?   { pinHash, salt, expiresAt }    (transient)
├── lockout             { failedAttempts, lockedUntil }  (PIN brute-force guard)
└── version

Device                                         dev_<tsid>
├── clientId · storeRef                        immutable until reassign/revoke
├── installId           opaque id from Capacitor secure storage
├── label               human name ("Aisle-3 tablet")
├── status              enrolled | revoked
├── enrolledAt · enrolledBy
└── version

DeviceEnrollmentToken (short-lived, single-use)
├── clientId · storeRef
├── tokenHash           what the enrollment QR/code encodes
├── expiresAt · consumedAt
```

Notes:

- **Store registry ownership** is a parked question (see below) — pickers/devices
  need a real store entity to bind to; simplest is the pick context owns it.
- Branded TSIDs, optimistic `version`, `eventGroup(aggregateCode, id)` message
  groups per house rules (CLAUDE.md).

## Endpoint surface

**Picker-facing** (`/pick-auth/*`, picker app; some pre-session but
device-authenticated):

```
POST /clients/:clientId/pick-auth/enroll         device enroll: {enrollToken, installId, label}
                                                  → binds device↔store, returns device credential
POST /clients/:clientId/pick-auth/login/qr        {badgeToken}      (device-authed) → person session
POST /clients/:clientId/pick-auth/login/pin       {staffCode, pin}  (device-authed) → person session
GET  /clients/:clientId/pick-auth/roster          this store's PIN-eligible pickers (device-authed)
POST /pick-auth/refresh                            refresh person session
POST /pick-auth/logout                             end person session (Exit)
```

**Admin-facing** (management app, platform-OIDC):

```
POST /clients/:clientId/pickers                    create {storeRef, displayName, staffCode, primaryAuthMethod}
GET  /clients/:clientId/pickers?store=             list
POST /clients/:clientId/pickers/:id/badge          (re)generate QR — returns raw token ONCE (print/export)
POST /clients/:clientId/pickers/:id/badge/report-lost   revoke QR + mint temp PIN (returned once)
POST /clients/:clientId/pickers/:id/badge/replace       issue new QR + close temp PIN
POST /clients/:clientId/pickers/:id/suspend | /reactivate
POST /clients/:clientId/devices                    mint enrollment token/QR for a store
GET  /clients/:clientId/devices?store=             list enrolled devices
POST /clients/:clientId/devices/:id/reassign       move to another store  ← the "reassigned" case
POST /clients/:clientId/devices/:id/revoke         lost/stolen kill switch
```

## Token & server-auth model

- **Device credential**: proves "enrolled device for store S" — long-lived,
  refreshable, revocable (server-side device record checked on refresh).
- **Person session**: short-lived access JWT — claims `pickerId`, `clientId`,
  `storeRef`, `deviceId`, `permissions` — plus a refresh token. Idle timeout via
  short access TTL + refresh that checks last-activity + picker/device status.
- **Second auth scheme on fulfil-go server**: add a `PickerTokenValidator`
  alongside the existing platform-OIDC `token-validator`. A Fastify preHandler
  selects the scheme by route group (pick-auth + picker-facing pick ops use the
  picker scheme; management routes use platform OIDC). The picker principal maps
  into the existing `Scope`/`ScopeStore` shape (`principalId = pkr_…`, plus
  `storeRef` + store-scoped permissions), so use cases stay auth-scheme-agnostic.
- **mobile-kit** gains a **second auth strategy**: reuse `session` / `token-store`
  / `api-client` (bearer injection) / refresh; swap only credential acquisition
  (scan/PIN + device enrollment) in place of the PKCE browser flow.

## Authorization

- Store-scoped picker permissions (new `FulfilGoPermission.*` — e.g.
  `ViewStorePicks`, `ClaimPick`, `ReportPickOutcome`).
- **Enforced server-side on every pick call**: the picker's `scope.storeRef`
  must match the pick's store — same discipline as the existing `clientId`
  path-scoping. Cross-store access is rejected, not filtered.

## Security checklist

- QR token ≥128-bit opaque; store only the hash; show raw once.
- PIN + QR hashed with a slow KDF (argon2id/scrypt) + per-credential salt.
- PIN brute-force: attempt counter + lockout/backoff (6 digits = 10⁶).
- Enrollment token + break-glass PIN: single-use / single-active, short TTL,
  hashed at rest.
- Rate-limit all `/pick-auth/*` endpoints.
- Report-lost **revokes immediately** (don't wait for replacement).

## Management-app admin screens

- **Pickers** (per store): list, create/edit, choose primary method; **Generate
  badge** → renders the QR for print/export (PNG); **Report lost** → shows the
  one-time temp PIN; **Issue replacement**; suspend/reactivate.
- **Devices** (per store): list enrolled; **Enroll** → renders enrollment QR/code;
  **Reassign**; **Revoke**.

## Non-goals / parked

- **Driver/execution app**: separate decision — its field-offline needs differ
  (may require offline login), so it isn't folded into this shared-station model.
- **Store registry ownership** — RESOLVED (2026-07-10, Andrew): stores are
  BASE reference data with their own management section, not owned by the
  pick context. All contexts (picking, fulfilment, transport) bind to them by
  `storeRef`; the management app's IA mirrors this (nav sections per
  subdomain — Fulfilment / Picking / Transport / Stores — with each
  operational context owning its own user management).
- **Multi-store pickers**: v1 is one store per picker; extendable to memberships.
- **Elevated roles** (supervisor overrides, cross-store leads): future, on top of
  the base store-scoped picker role.
- **Biometric unlock** on personal devices: possible future fast-path, not for
  shared stations.

```

```
