# @pinpoint/flows — flow walkthrough harness

Drives the **running** pinpoint server end to end through the same typed API
client the SPA uses, with realistic Cape Town data, and narrates every flow:
create → match (exact / fuzzy / new master) → geocode → confirm → feature
association → rematch → scheduled-job webhook → operator actions → outbox.

```
# 1. server with the dev identity header enabled (any spare port)
PINPOINT_AUTH_DEV_FALLBACK=true PORT=3100 pnpm --filter @pinpoint/server dev
# 2. run the walkthrough (from typescript/)
pnpm flows:pinpoint                       # all flows, keeps the seeded data
pnpm flows:pinpoint -- --seed-only        # just seed, then explore in the SPA
pnpm flows:pinpoint -- --cleanup          # delete what it created at the end
pnpm flows:pinpoint -- --base-url http://localhost:3197 --principal prn_me
pnpm flows:pinpoint -- --no-db            # skip the outbox_messages observation
```

Needs: libpostal sidecar (`pnpm --filter @pinpoint/server libpostal:up`),
network for Photon (falls back to operator confirm-geocode when unavailable),
`DATABASE_URL` (defaults to fc-dev's pinpoint DB) for the outbox observation,
and `FLOWCATALYST_SIGNING_SECRET` matching the server's if it enforces HMAC
(unset = the server's dev bypass). Exit code 1 if any assertion failed.

Regenerate `src/schema.gen.d.ts` with `pnpm gen` (wired into `pnpm openapi:pinpoint`).
