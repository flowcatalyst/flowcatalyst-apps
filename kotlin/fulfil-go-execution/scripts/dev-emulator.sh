#!/usr/bin/env bash
# One-command dev loop for the execution app:
#   boots the emulator if none is running, waits for it, builds + installs
#   the debug APK, and launches the app.
#
#   ./scripts/dev-emulator.sh            # default AVD below
#   AVD=Pixel_8_API_35 ./scripts/dev-emulator.sh
#
# The debug build talks to http://10.0.2.2:3200 — the EMULATOR'S alias for
# the Mac's localhost. Start the server first: `pnpm dev:fulfil-go` (from
# typescript/). On the Mac itself that same server is http://localhost:3200.
set -euo pipefail
cd "$(dirname "$0")/.."

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
AVD="${AVD:-Medium_Phone_API_36.0}"
APP_ID="io.flowcatalyst.fulfilgo.execution"

# 1. Emulator up? (any device counts — a plugged-in phone works too)
if ! "$ADB" devices | awk 'NR>1 && $2=="device"' | grep -q .; then
  echo "▶ starting emulator '$AVD'…"
  "$EMULATOR" -avd "$AVD" >/dev/null 2>&1 &
  echo "▶ waiting for device…"
  "$ADB" wait-for-device
  # wait-for-device fires before Android finishes booting — poll boot_completed.
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 2
  done
  echo "▶ boot complete."
else
  echo "▶ device already connected."
fi

# 2. Build + install (installDebug builds what it needs).
echo "▶ building + installing debug APK…"
./gradlew :app:installDebug

# 3. Launch.
echo "▶ launching ${APP_ID}..."
"$ADB" shell am start -n "$APP_ID/.MainActivity"
echo "✓ running. Server URL defaults to http://10.0.2.2:3200 (Settings → Server URL to change)."
