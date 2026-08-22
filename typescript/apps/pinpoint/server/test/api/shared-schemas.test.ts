/**
 * Guards for the shared `$id` schemas (OpenAPI components):
 *  - every entry has a unique, non-empty `$id` (duplicate ids would make
 *    `server.addSchema` throw at boot, but only at boot);
 *  - a `$ref` response — including an `allOf` intersection of a `$ref` and an
 *    inline object, which the BFF get-master-location route uses — serializes
 *    every field through Fastify's response serializer.
 */
import Fastify from 'fastify';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { SHARED_SCHEMAS } from '../../src/api/plugins/shared-schemas.js';
import { ErrorResponseRef } from '../../src/api/plugins/error-response.schema.js';
import { BffMasterLocationRef } from '../../src/api/routes/bff/master-locations/master-location.schema.js';
import { BffFeatureAssociationRef } from '../../src/api/routes/bff/locations/feature-association.schema.js';

describe('shared schemas', () => {
  it('every shared schema has a unique $id', () => {
    const ids = SHARED_SCHEMAS.map((s) => s.$id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('serializes $ref and allOf($ref + inline) responses with every field', async () => {
    const app = Fastify({ logger: false });
    for (const s of SHARED_SCHEMAS) app.addSchema(s);

    const master = {
      id: 'mst_1',
      address: '12 Long Street, Cape Town',
      houseNumber: '12',
      road: 'Long Street',
      suburb: null,
      city: 'Cape Town',
      state: null,
      postalCode: '8001',
      country: 'South Africa',
      status: 'VALIDATED',
      latitude: -33.92,
      longitude: 18.42,
      addressHash: 'h1',
      createdAt: '2026-08-22T10:00:00.000Z',
      features: [
        {
          layerFeatureId: 'lft_1',
          layerId: 'lyr_1',
          layerName: 'Zones',
          featureLabel: 'CBD',
          distanceMeters: 12.5,
        },
      ],
    };

    app.get(
      '/ml',
      {
        schema: {
          response: {
            200: Type.Intersect([
              BffMasterLocationRef,
              Type.Object({ features: Type.Array(BffFeatureAssociationRef) }),
            ]),
            404: ErrorResponseRef,
          },
        },
      },
      async () => master,
    );
    app.get('/missing', { schema: { response: { 404: ErrorResponseRef } } }, async (_req, reply) =>
      reply.code(404).send({ error: 'NotFound', message: 'nope' }),
    );
    await app.ready();

    const ok = await app.inject({ method: 'GET', url: '/ml' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual(master);

    const missing = await app.inject({ method: 'GET', url: '/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'NotFound', message: 'nope' });

    await app.close();
  });
});
