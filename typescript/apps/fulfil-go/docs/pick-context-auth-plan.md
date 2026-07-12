# Pick context — picker auth: implementation plan

Companion to `pick-context-auth.md` (the design). Sequenced so each phase is
independently testable and the risky foundations land first. File paths are
concrete; patterns mirror what already exists (composition root in
`server/src/app-context.ts`, one-permission-per-use-case, drizzle migrations,
optimistic locking per CLAUDE.md).

## Two things that don't exist yet (the load-bearing risks)

Everything hard about this reduces to two gaps in the current server:

1. **The server issues no tokens.** `extractRequestToken` (server.ts) only
   _validates_ external platform JWTs via JWKS. Picker sessions are
   **fulfil-go-signed** — we need a `PickerTokenService` (sign + verify) with a
   local key. New capability, build it first.
2. **`Scope` carries only `{sub, permissions}`.** Store-scoped authz needs
   `storeRef` (and `deviceId`) on the request scope. `Scope`/`RequestToken` come
   from our own `@fulfil-go/framework`, so we extend them with an optional
   attributes bag. This is the linchpin — do it in Phase 0 or nothing downstream
   can enforce store scope.

Do these two in Phase 0; the rest is the familiar aggregate→repo→use-case→route
rhythm.

---

## Phase 0 — Foundations (unblock everything)

- **Extend the request scope.** In `@fulfil-go/framework`: add optional
  `attributes?: { storeRef?: string; deviceId?: string }` (or a typed
  `PickerContext`) to `RequestToken` + surface it on `Scope`
  (`scope.storeRef`). Keep it optional so platform-OIDC scopes are unaffected.
- **`PickerTokenService`** (`server/src/auth/picker-token.ts`): `issueSession`
  (access + refresh) and `verifySession` using `jose` `SignJWT`/`jwtVerify`
  with `PICKER_SESSION_SECRET` (HS256 to start; EdDSA keypair later). Claims:
  `sub=pkr_…`, `clientId`, `storeRef`, `deviceId`, `permissions`, short `exp`.
  Also a device-credential variant (long-lived, `typ=device`).
- **Credential crypto** (`server/src/auth/pick-credentials.ts`): PIN/QR/token
  hash + verify via node's built-in `crypto.scrypt` (no native dep — aligns with
  the supply-chain memo), `randomBytes` for the ≥128-bit QR token and
  enrollment token, constant-time compare.
- **Env + config**: `PICKER_SESSION_SECRET`, `PICKER_ACCESS_TTL`,
  `PICKER_REFRESH_TTL`, `PICKER_DEVICE_TTL`, `PICKER_BREAKGLASS_PIN_TTL` (72h),
  `PICKER_PIN_MAX_ATTEMPTS`. Extend `auth-config.ts`; update `.env.example`.

Exit: unit tests for token round-trip (issue→verify, tamper→reject, expiry) and
scrypt hash/verify + lockout counter.

## Phase 1 — Identity domain (aggregates + persistence)

Mirror `domain/fulfilments` + `infrastructure/schema/*` + repositories, register
in `createAppContext`.

- **Drizzle schema** (`infrastructure/schema/`): `stores`, `picker_users`,
  `devices`, `device_enrollment_tokens`. Uniqueness: `stores(clientId, storeRef)`,
  `picker_users(clientId, storeRef, staffCode)`, `devices(clientId, installId)`.
  Store credential **hashes only**. New migration via `pnpm db:migrate`.
- **Branded ids**: `str_`, `pkr_`, `dev_`, `den_` (framework `brandedTsid`).
- **Aggregates** (`domain/pick-identity/`):
  - `Store` — thin registry entity (working assumption: pick context owns it;
    see design doc's parked question).
  - `PickerUser` — `create`, `issueBadge`, `reportBadgeLost`
    (revoke QR + mint break-glass PIN), `replaceBadge` (new QR + close PIN),
    `suspend`/`reactivate`, `registerFailedPin`/`resetLockout`. Credential value
    objects: `standingPin?`, `qrBadge?`, `breakGlassPin?` per the design's
    state table. Optimistic `version`.
  - `Device` — `enroll`, `reassign`, `revoke`.
  - `DeviceEnrollmentToken` — `mint`, `consume` (single-use, TTL).
- **Repositories** + register aggregates; add to `AppContextRepositories`.

Exit: unit tests for the **credential state machine** — especially
report-lost→temp-PIN→replacement, break-glass expiry, PIN-primary never gets a
QR, QR-primary has no standing PIN.

## Phase 2 — Admin use-cases + routes (management side, platform-OIDC authed)

- **Permissions** (`shared/domain/permissions.ts`): add admin perms
  `ManagePickers`, `ManageDevices`, and the store-scoped picker perms for later
  (`ViewStorePicks`, `ClaimPick`, `ReportPickOutcome`). Add a `Picker` role
  bundle; wire `ManagePickers`/`ManageDevices` into an admin role. (Picker perms
  are issued by our token service, NOT granted via platform claims — so they
  don't go through `resolvePermissions`.)
- **Use-cases** (`operations/…`, one permission each, `commitAggregate`
  pattern): `create-picker`, `list-pickers`, `generate-badge`,
  `report-badge-lost`, `replace-badge`, `suspend-picker`; `mint-enrollment`,
  `list-devices`, `reassign-device`, `revoke-device`.
- **Routes** (`api/routes/pickers`, `api/routes/devices`): `/clients/:clientId/…`
  per the design's admin surface. Raw QR token + temp PIN returned **once**,
  never re-fetchable. Wire in `server.ts`.

Exit: integration tests — create picker (both methods), generate badge returns
token once, report-lost revokes + returns temp PIN, replace closes PIN;
enroll/reassign/revoke device.

## Phase 3 — Picker auth scheme + login/enroll endpoints (the second plane)

- **Routes** (`api/routes/pick-auth`): `POST /enroll` (device→store bind via
  enrollment token + `installId`, returns device credential), `POST /login/qr`,
  `POST /login/pin` (staffCode+PIN, device-authed), `GET /roster` (this device's
  store, PIN-eligible pickers), `POST /refresh`, `POST /logout`.
- **Wire into `extractRequestToken`**: after the platform-JWT branch, add a
  **picker-session branch** — verify via `PickerTokenService`, produce a
  `RequestToken` with the fixed store-picker permission set + `storeRef`/
  `deviceId` attributes. Platform and picker tokens are distinguishable by
  issuer/kid, so the two verifiers don't collide. Keep the single global
  `onRequest` hook.
- **Guards**: rate-limit `/pick-auth/*`; PIN lockout via the aggregate counter;
  reject login on revoked device / suspended picker / expired break-glass PIN.

Exit: integration tests — enroll → login/qr → an authed pick call scoped to the
store; PIN login after report-lost; **cross-store call rejected**; revoked
device blocks refresh.

## Phase 4 — Picking app (mobile-kit + picking-app)

- **mobile-kit**: a **second auth strategy** (`auth/local-credential/`) —
  device enrollment + scan/PIN login against `/pick-auth/*`. Reuse `session`,
  `token-store`, `api-client` (bearer injection), and refresh; swap only
  credential acquisition (not the PKCE browser flow). Persist `installId` in
  Capacitor secure storage.
- **picking-app**: first-run **device-enrollment** screen (scan enrollment QR);
  **LoginPage** = "Scan badge" (camera) + "Sign in with PIN" (staff code → PIN);
  **Exit** button + **inactivity auto-logout**; store-bound header. Login
  requires connectivity; actions keep using the existing offline queue.

Exit: browser-dev walk-through (enroll a station, badge-login, exit, PIN-login
another picker); confirm queued actions carry the picker id.

## Phase 5 — Management-app admin screens

- **Pickers** page (per store): list / create / edit; **Generate badge** →
  render QR (client-side `qrcode` dep — small, flag for the Renovate hold) as a
  printable/exportable PNG; **Report lost** → show one-time temp PIN; **Issue
  replacement**; suspend/reactivate.
- **Devices** page: list enrolled; **Enroll** → render enrollment QR; **Reassign**;
  **Revoke**.
- Follow the existing non-modal side-panel pattern (see the fulfilments page +
  `docs/ui-guidelines.md`).

Exit: end-to-end from the admin UI — provision store + device + picker, print a
badge, enroll the station in the picking app, log in with that badge.

## Phase 6 — Provisioning, sync, docs

- **flowcatalyst sync** (`scripts/sync-flowcatalyst.ts`): register the admin
  permissions/roles so real OIDC admins can be granted `ManagePickers`/
  `ManageDevices`.
- **Env/docs**: finalise `.env.example`; add gotchas + key-rotation note to
  `CLAUDE.md`; cross-link both pick-context docs.
- **Key management**: `PICKER_SESSION_SECRET` handling + rotation story
  (dual-key verify window) — note for deploy, not local dev.

---

## Dependency order & sizing (rough)

```
Phase 0 (scope + token service + crypto)   ← must be first; small but pivotal
   └─ Phase 1 (domain + schema)            ← medium
        ├─ Phase 2 (admin use-cases/routes) ┐
        └─ Phase 3 (picker auth endpoints)  ┘ ← can run in parallel after P1
              ├─ Phase 4 (picking app)      ┐
              └─ Phase 5 (management screens)┘ ← parallel after their server deps
                    └─ Phase 6 (sync/docs)  ← last
```

A thin **vertical slice first** is the fastest way to de-risk: Phase 0 → a
minimal Phase 1 (`Store` + `PickerUser` PIN-primary only, no QR) → the
`login/pin` half of Phase 3 → prove a store-scoped authed call end-to-end. Then
layer QR badges, devices/enrollment, break-glass, and the UIs. Recommend we cut
that slice as the first PR.

## Decisions to confirm before Phase 0

- **Extend framework `Scope`** with an attributes bag (recommended) vs. re-deriving
  `storeRef` from the picker id per call (an extra read; rejected).
- **HS256 shared secret** for picker tokens to start (simplest) vs. EdDSA keypair
  now (better rotation) — recommend HS256 now, keypair before prod.
- **Store registry ownership** — pick context owns `Store` (working assumption);
  resolve against the fulfilment doc's parked reference-data question.
