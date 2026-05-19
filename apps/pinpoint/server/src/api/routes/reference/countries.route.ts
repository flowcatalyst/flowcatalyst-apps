import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';

const CountrySchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  isoA2: Type.String(),
  isoA3: Type.String(),
});

const CountriesResponseSchema = Type.Object({
  countries: Type.Array(CountrySchema),
});

/**
 * GET /countries — list all reference countries, sorted by name.
 *
 * The seed table is empty until Slice 5 lands the PostGIS extension and
 * the geometry-enriched ~250-country dataset. Until then this endpoint
 * returns whatever the operator has loaded by hand.
 */
export function registerCountriesRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/countries',
    {
      schema: {
        tags: ['Reference'],
        response: {
          200: CountriesResponseSchema,
        },
      },
    },
    async () => {
      const list = await appContext.repositories.countries.listAll();
      return { countries: list.map((c) => ({ ...c })) };
    },
  );
}
