# fulfil-go execution app — native Android (Kotlin + Compose)

The driver app, ported from `typescript/apps/fulfil-go/execution-app`
(Capacitor) on 2026-07-22. Android-only by decision — drivers run Android;
the iOS door is closed deliberately. Stock Material 3 styling (dynamic color
on 12+), NO custom theme — that's a product decision, don't add one.

## Why native (don't relitigate)

Every hard capability of this app is platform work: background location
(foreground service + FusedLocationProvider replaces the licensed
Transistorsoft plugin), ML Kit scanning, CameraX/system camera evidence
capture, Room offline buffers. The other fulfil-go apps (picking,
management) STAY on the Nuxt/Capacitor stack — their requirements are
UI-heavy and background-light.

## Build & run

```bash
./gradlew :app:assembleDebug          # gradle.properties pins the JDK to
                                      # Android Studio's JBR (Gradle 8.14
                                      # can't run on the shell's GraalVM 25)
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.0 &
./gradlew :app:installDebug
```

Debug builds default the server URL to `http://10.0.2.2:3200` (emulator →
host fulfil-go server); it's editable under Settings → Server URL (physical
device: use your Mac's LAN IP; debug manifest allows cleartext). Dev flow is
the same claim-marketplace loop as before: management app seeds depots +
drivers → Settings binds the station (clientId + depotRef) → driver login
staff code + PIN → Find work.

## Architecture (mirrors the server contract, not the Vue code)

- `core/` — ApiClient (OkHttp, bearer + one 401 refresh-retry),
  DriverSession + PlatformSession (both TokenProviders; DRIVER WINS in
  CombinedTokenProvider — transport endpoints authorize on depot
  attributes), Prefs (DataStore: station binding + offline overlays),
  TokenStore (DataStore, namespaced per plane).
- `outbox/` — Room-backed port of mobile-kit's offline queue, SAME
  semantics: Idempotency-Key per item; 2xx done, 429/5xx backoff with
  attempt cap, network errors backoff WITHOUT consuming attempts, other
  4xx dead-letter (Settings → Failed changes).
- `telemetry/` — TelemetryService: location foreground service buffers
  fixes into Room and batch-POSTs `{location: [...]}` (Transistorsoft wire
  shape — the server ingest is unchanged) to `/telemetry/locations`, auth =
  PLATFORM session (not driver). Fixes delete only on 2xx. BootReceiver
  resumes tracking only if background location is granted (Android 14 FGS
  rule).
- `auth/PlatformAuth` — PKCE via Custom Tabs; deep link
  `fulfilgo-exec://auth/callback` lands in MainActivity.onNewIntent.
- `ui/work/` — WorkViewModel is the OffersPage port: claim marketplace,
  offer countdown, collection scanning (wedge + GmsBarcodeScanning), store
  PIN override, guided stops, delivery verification (PIN check-before-
  handover, POD photo, signature pad, age check + ID photo), fail dialog.
  Offline overlays (scanned/pending/arrived) live in Prefs and are pruned
  against server state exactly like the Vue app.

## Parity notes / gotchas

- `api/Generated.kt` is GENERATED from @fulfil-go/shared's TypeBox
  contract (`src/api/transport.dto.ts` + `kotlin-contract.ts` registry —
  the same schemas the server routes enforce). Regenerate after contract
  changes: `pnpm --filter @fulfil-go/shared gen:kotlin`. Never edit it;
  hand-written helpers stay in `api/Dto.kt`. The generated
  VerificationRequirements booleans are NULLABLE (contract is defensively
  optional) — compare with `== true`.
- Kotlin block comments NEST: a literal `/*` inside a KDoc (e.g. a glob or
  URL pattern) breaks the parse. Bit us on day one.
- SSE IS ported (`core/SseClient.kt`, OkHttp + Last-Event-ID + jittered
  backoff; 90s read timeout vs 25s server heartbeats). It follows the
  driver shift (connect on sign-in) and currently only feeds the Work
  header's live/offline dot — `onEvent` is the seam for trip.* events.
- The Capacitor execution-app still exists in the TS workspace until this
  app is verified on a real device (telemetry while terminated + deep-link
  login are device-only checks); delete it after cutover.
- GmsBarcodeScanning needs Google Play services (emulator: use a Play
  Store image — Medium_Phone_API_36.0 is one).
