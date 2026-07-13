import { describe, expect, it, vi } from 'vitest';
import { EpodApiError, createEpodClient, type EpodClientConfig } from './client.js';
import { toEpodDestinationLocation, toEpodProducts } from './provisioning-mapper.js';
import type { EpodUpsertResponse } from './types.js';

const CONFIG: EpodClientConfig = {
  baseUrl: 'https://metro.integral.test',
  tenantCode: 'metro',
  platformUrl: 'http://fc.test:8080',
  clientId: 'oac_service',
  clientSecret: 's3cret',
};

const UPSERT_OK: EpodUpsertResponse = {
  success: true,
  created_count: 1,
  updated_count: 0,
  restored_count: 0,
  failed_count: 0,
  failed: [],
  results: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** fetch stub: routes the token endpoint + API calls, records every request. */
function stubFetch(
  handlers: { token?: () => Response; api?: (url: string, init?: RequestInit) => Response } = {},
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (url === 'http://fc.test:8080/oauth/token') {
      return handlers.token?.() ?? jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 });
    }
    return handlers.api?.(url, init) ?? jsonResponse(200, UPSERT_OK);
  });
  return { impl, calls };
}

describe('EpodClient auth', () => {
  it('mints a FlowCatalyst client-credentials token and sends bearer + tenant headers', async () => {
    const { impl, calls } = stubFetch();
    const client = createEpodClient(CONFIG, impl);

    await client.upsertLocations([
      { reference: 'loc-1', name: 'Drop', latitude: -29.1, longitude: 26.2 },
    ]);

    const tokenCall = calls[0]!;
    expect(tokenCall.url).toBe('http://fc.test:8080/oauth/token');
    const form = new URLSearchParams(tokenCall.init?.body as string);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('oac_service');
    expect(form.get('client_secret')).toBe('s3cret');

    const apiCall = calls[1]!;
    expect(apiCall.url).toBe(
      'https://metro.integral.test/api/v1/tms/epod/fulfilgo/locations/upsert',
    );
    const headers = apiCall.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tok-1');
    expect(headers['x-inhance-tenant']).toBe('metro');
    expect(headers['content-type']).toBe('application/json');
  });

  it('caches the token across calls (one token mint for two API calls)', async () => {
    const { impl, calls } = stubFetch();
    const client = createEpodClient(CONFIG, impl);

    await client.upsertLocations([]);
    await client.upsertProducts([]);

    const tokenCalls = calls.filter((c) => c.url.endsWith('/oauth/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('forces ONE token refresh on 401, then surfaces the failure', async () => {
    let apiHits = 0;
    const { impl, calls } = stubFetch({
      api: () =>
        apiHits++ === 0 ? jsonResponse(401, { message: 'expired' }) : jsonResponse(200, UPSERT_OK),
    });
    const client = createEpodClient(CONFIG, impl);

    const response = await client.upsertProducts([{ reference: 'SKU1', name: 'Milk' }]);
    expect(response.success).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(2);
  });

  it('surfaces a failed token request as EpodApiError', async () => {
    const { impl } = stubFetch({ token: () => new Response('nope', { status: 403 }) });
    const client = createEpodClient(CONFIG, impl);
    await expect(client.upsertProducts([])).rejects.toThrow(EpodApiError);
  });
});

describe('EpodClient payloads + errors', () => {
  it('posts {locations: [...]} to locations/upsert', async () => {
    const { impl, calls } = stubFetch();
    const client = createEpodClient(CONFIG, impl);
    const location = {
      reference: 'fulfilgo-dest-ful_1',
      name: 'T. Nkosi',
      address_1: '12 Oak Ave',
      city: 'Bloemfontein',
      latitude: -29.16,
      longitude: 26.23,
    };

    await client.upsertLocations([location]);
    expect(JSON.parse(calls[1]!.init?.body as string)).toEqual({ locations: [location] });
  });

  it('posts {products: [...]} to products/upsert', async () => {
    const { impl, calls } = stubFetch();
    const client = createEpodClient(CONFIG, impl);

    await client.upsertProducts([{ reference: 'SKU1', name: 'Milk 2L' }]);
    expect(calls[1]!.url).toBe(
      'https://metro.integral.test/api/v1/tms/epod/fulfilgo/products/upsert',
    );
    expect(JSON.parse(calls[1]!.init?.body as string)).toEqual({
      products: [{ reference: 'SKU1', name: 'Milk 2L' }],
    });
  });

  it('posts the route plan as-is to routes/plans (claim flow, later)', async () => {
    const { impl, calls } = stubFetch({ api: () => jsonResponse(200, { success: true }) });
    const client = createEpodClient(CONFIG, impl);
    const plan = { company: { reference: 'metro', name: 'Metro', routes: [] } };

    await client.sendRoutePlan(plan);
    expect(calls[1]!.url).toBe('https://metro.integral.test/api/v1/tms/epod/fulfilgo/routes/plans');
    expect(JSON.parse(calls[1]!.init?.body as string)).toEqual(plan);
  });

  it('surfaces non-2xx API responses as EpodApiError with the server message', async () => {
    const { impl } = stubFetch({
      api: () => jsonResponse(422, { message: 'reference is required' }),
    });
    const client = createEpodClient(CONFIG, impl);

    const failure = client.upsertLocations([
      { reference: '', name: 'x', latitude: 0, longitude: 0 },
    ]);
    await expect(failure).rejects.toMatchObject({
      name: 'EpodApiError',
      status: 422,
      message: expect.stringContaining('reference is required'),
    });
  });
});

describe('provisioning mapper', () => {
  const DELIVERY = {
    id: 'ful_123',
    type: 'delivery',
    destination: {
      kind: 'delivery',
      location: {
        ref: 'addr-9',
        name: 'T. Nkosi',
        address: {
          line1: '12 Oak Ave',
          city: 'Bloemfontein',
          region: 'Free State',
          postalCode: '9301',
          countryCode: 'ZA',
        },
        geo: { lat: -29.16, lng: 26.23 },
        contact: { name: 'Thabo Nkosi', phone: '+27831234567', email: 't@nkosi.test' },
      },
    },
  } as never as Parameters<typeof toEpodDestinationLocation>[0];

  it('maps a delivery destination onto the EPOD location shape (upstream ref wins)', () => {
    expect(toEpodDestinationLocation(DELIVERY)).toEqual({
      reference: 'addr-9',
      name: 'T. Nkosi',
      address_1: '12 Oak Ave',
      city: 'Bloemfontein',
      province: 'Free State',
      postal_code: '9301',
      latitude: -29.16,
      longitude: 26.23,
      contact: '+27831234567',
      email_address: 't@nkosi.test',
    });
  });

  it('falls back to the deterministic fulfilgo-dest reference when the location has no ref', () => {
    const noRef = structuredClone(DELIVERY) as { destination: { location: { ref?: string } } };
    delete noRef.destination.location.ref;
    expect(toEpodDestinationLocation(noRef as never)?.reference).toBe('fulfilgo-dest-ful_123');
  });

  it('returns null for collect fulfilments and for destinations without coordinates', () => {
    const collect = { ...DELIVERY, type: 'collect' } as never;
    expect(toEpodDestinationLocation(collect)).toBeNull();

    const noGeo = structuredClone(DELIVERY) as { destination: { location: { geo?: unknown } } };
    delete noGeo.destination.location.geo;
    expect(toEpodDestinationLocation(noGeo as never)).toBeNull();
  });

  it('dedupes products by sku across all parts (first description wins)', () => {
    const parts = [
      {
        lines: [
          { sku: 'SKU1', description: 'Milk 2L' },
          { sku: 'SKU2', description: 'Bread' },
        ],
      },
      {
        lines: [
          { sku: 'SKU1', description: 'Milk 2 litre (dupe)' },
          { sku: 'SKU3', description: 'Eggs 6' },
        ],
      },
    ] as never as Parameters<typeof toEpodProducts>[0];

    expect(toEpodProducts(parts)).toEqual([
      { reference: 'SKU1', name: 'Milk 2L' },
      { reference: 'SKU2', name: 'Bread' },
      { reference: 'SKU3', name: 'Eggs 6' },
    ]);
  });
});
