import { defineConfig } from 'drizzle-kit';

/**
 * Local-dev default matches the container started by `pnpm db:up`. fulfil-go
 * owns a dedicated `fulfilgo` database with its tables in `public`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/schema.ts',
  out: './drizzle',
  schemaFilter: ['public'],
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://fulfilgo:fulfilgo@localhost:5434/fulfilgo',
  },
});
