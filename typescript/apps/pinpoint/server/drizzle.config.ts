import { defineConfig } from 'drizzle-kit';

/**
 * Local-dev default matches the container started by `pnpm db:up`. Pinpoint
 * owns a dedicated `pinpoint` database with its tables in the `public` schema;
 * `schemaFilter` keeps generated migrations scoped to `public` so drizzle-kit
 * doesn't try to diff the postgis/pg_trgm/topology schemas.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/schema.ts',
  out: './drizzle',
  schemaFilter: ['public'],
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://pinpoint:pinpoint@localhost:5433/pinpoint',
  },
});
