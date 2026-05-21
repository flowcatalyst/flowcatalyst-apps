/**
 * BFF countries list. Mirror of Rust `routes/bff/countries.rs::list_countries`.
 *
 * The SPA wants a flat array (no `{items, total}` framing here — matches
 * Rust). Filters out the OSM "-99" sentinel that the seed uses for
 * disputed territories (Antarctica, etc.). No geometry payload — the SPA
 * uses this for a dropdown.
 */
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import { countries } from '../../../infrastructure/schema/countries.js';

const ItemSchema = Type.Object({
  isoA3: Type.String(),
  isoA2: Type.String(),
  name: Type.String(),
});

const ResponseSchema = Type.Array(ItemSchema);

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffCountriesRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/countries',
    {
      schema: {
        tags: ['BFF'],
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const rows = await appContext.db
        .select({ isoA3: countries.isoA3, isoA2: countries.isoA2, name: countries.name })
        .from(countries)
        .where(sql`${countries.isoA3} <> '-99'`)
        .orderBy(countries.name);

      return reply.code(200).send(rows);
    },
  );
}
