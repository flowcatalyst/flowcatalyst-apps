# FulfilGo Drive — native Android execution (driver) app

Kotlin + Jetpack Compose, Android-only, stock Material 3. Replaces the
Capacitor execution app in `typescript/apps/fulfil-go/execution-app`.

## Prerequisites (macOS)

Everything comes with **Android Studio** — no separate installs:

- Android Studio (provides the SDK at `~/Library/Android/sdk` and the JDK
  the build uses — `gradle.properties` points `org.gradle.java.home` at
  Studio's bundled JBR, because Gradle 8.14 can't run on newer JDKs like
  the shell's GraalVM 25).
- One emulator AVD with a **Google Play** system image (the barcode
  scanner needs Play services). `Medium_Phone_API_36.0` qualifies; create
  others via Android Studio → Device Manager.

## Start dev

Backend first (from the monorepo's `typescript/` directory — full detail in
`typescript/apps/fulfil-go/CLAUDE.md`):

```bash
fc-dev                                   # platform + embedded Postgres :15432
cd typescript
pnpm --filter @fulfil-go/server db:init && pnpm --filter @fulfil-go/server db:migrate  # once per fresh db
pnpm dev:fulfil-go                       # server :3200 + web apps :5175-5177
```

Then the app:

```bash
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.0 &   # or Studio's Device Manager
cd kotlin/fulfil-go-execution
./gradlew :app:installDebug              # build + install on the running emulator
~/Library/Android/sdk/platform-tools/adb shell am start -n io.flowcatalyst.fulfilgo.execution/.MainActivity
```

Debug builds default the server URL to `http://10.0.2.2:3200` — the
emulator's alias for your Mac's localhost, so the dev server just works.
**Physical device**: enable USB debugging, plug in, `./gradlew
:app:installDebug`, then set Settings → Server URL to your Mac's LAN IP
(e.g. `http://192.168.x.x:3200`; the debug manifest allows cleartext).

### Driver flow (the claim marketplace)

1. Management app (`:5177`) → Transport → Depots/Drivers: seed depots +
   drivers (seeded PIN `374837`), and generate fulfilments so there's work.
2. App → Settings: bind the station (Client id `clt_…` + Depot ref), Save.
3. App → Driver sign in: staff code + PIN.
4. Work tab: Find work → claim the offer → per-stop collected/delivered.

Telemetry (Settings → "Share location while on duty") additionally needs a
**Platform sign in** (OIDC via the deep link) — driver PIN sessions don't
authorize the telemetry ingest.

## Regenerating the API DTOs

`app/src/main/java/io/flowcatalyst/fulfilgo/execution/api/Generated.kt` is
GENERATED from the TypeBox contract in `@fulfil-go/shared`
(`src/api/transport.dto.ts` + `src/api/kotlin-contract.ts` — the same
schemas the server routes enforce). After any contract change:

```bash
cd typescript && pnpm --filter @fulfil-go/shared gen:kotlin
```

Adding a new endpoint the app consumes? Define its schemas in shared,
reference them in the server route, add them to `KOTLIN_CONTRACT`,
regenerate.

## Tests / checks

```bash
./gradlew :app:assembleDebug             # compile check
cd typescript && pnpm --filter @fulfil-go/shared typecheck && pnpm --filter @fulfil-go/server test
```

Architecture notes and gotchas live in `CLAUDE.md` next to this file.
