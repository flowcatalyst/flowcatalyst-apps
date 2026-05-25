# sessions_table

Hand-written migration adding the `sessions` table for the postgres-
backed session-store driver (`PINPOINT_SESSION_DRIVER=postgres`). See
`src/auth/session-store-drizzle.ts`.

The `snapshot.json` file is **missing on purpose** — when the dev DB was
back up I'd run `pnpm db:generate` to produce a coherent snapshot, but
the dev Postgres container is wedged on the 18-vs-prior-volume issue
documented in HANDOFF.md. The drizzle-kit migrator only reads
`migration.sql` (drizzle 1.0 RC scans the directory alphabetically;
there's no `_journal.json`), so this migration applies cleanly. On the
next `drizzle-kit generate` after the dev DB is healthy again, the
snapshot will pick up the `sessions` table — at that point either let
drizzle-kit emit a no-op migration that's safe to drop, or regenerate
this directory from scratch and delete the README.
