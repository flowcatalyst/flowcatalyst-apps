import { defineConfig } from 'drizzle-kit';

/**
 * Local-dev default matches the container started by `pnpm db:up`. Pinpoint
 * tables live in a Postgres schema named `pinpoint` rather than `public`;
 * the role's search_path (set by `pnpm db:init`) makes drizzle-kit emit
 * + introspect tables in that schema. `schemaFilter` keeps generated
 * migrations scoped to it.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/schema.ts',
  out: './drizzle',
  schemaFilter: ['pinpoint'],
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ?? 'postgresql://pinpoint:pinpoint@localhost:5433/pinpoint',
  },
});
