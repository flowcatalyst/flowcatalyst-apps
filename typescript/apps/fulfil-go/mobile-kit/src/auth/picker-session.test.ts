import { describe, expect, it, vi } from 'vitest';
import { createPickerSession, pickerPinLogin, PickerLoginError } from './picker-session.js';
import type { StoredTokens, TokenStore } from './token-store.js';

function memoryStore(initial: StoredTokens | null = null): TokenStore {
  let tokens = initial;
  return {
    load: async () => tokens,
    save: async (t) => {
      tokens = t;
    },
    clear: async () => {
      tokens = null;
    },
  };
}

const tokenBody = { tokenType: 'Bearer', accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 };

describe('pickerPinLogin', () => {
  it('POSTs credentials and returns the token payload', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(tokenBody), { status: 200 }),
    ) as unknown as typeof fetch;
    const res = await pickerPinLogin(
      'http://x/',
      { clientId: 'cli_1', storeRef: 's1', staffCode: 'P01', pin: '123456' },
      fetchImpl,
    );
    expect(res.accessToken).toBe('a2');
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('http://x/clients/cli_1/pick-auth/login/pin');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      storeRef: 's1',
      staffCode: 'P01',
      pin: '123456',
    });
  });

  it('throws PickerLoginError with the server code on failure', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 'PICKER_LOCKED', message: 'locked' }), {
        status: 423,
      })) as typeof fetch;
    await expect(
      pickerPinLogin('http://x', { clientId: 'c', storeRef: 's', staffCode: 'P', pin: '1234' }, fetchImpl),
    ).rejects.toMatchObject({ status: 423, code: 'PICKER_LOCKED' });
    // Sanity: it's our typed error.
    await pickerPinLogin('http://x', { clientId: 'c', storeRef: 's', staffCode: 'P', pin: '1234' }, fetchImpl).catch(
      (err) => expect(err).toBeInstanceOf(PickerLoginError),
    );
  });
});

describe('createPickerSession', () => {
  it('setSession converts expiresIn seconds to an epoch expiresAt', async () => {
    const store = memoryStore();
    const session = createPickerSession({
      store,
      baseUrl: 'http://x',
      getClientId: () => 'cli_1',
    });
    const before = Date.now();
    await session.setSession({ tokenType: 'Bearer', accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
    const stored = await store.load();
    expect(stored?.accessToken).toBe('a1');
    expect(stored?.expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(await session.getAccessToken()).toBe('a1');
  });

  it('refreshes an expired token against the station clientId (single-flight)', async () => {
    const store = memoryStore({ accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() - 1 });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(tokenBody), { status: 200 }),
    ) as unknown as typeof fetch;
    const session = createPickerSession({
      store,
      baseUrl: 'http://x',
      getClientId: () => 'cli_1',
      fetchImpl,
    });
    const [t1, t2] = await Promise.all([session.getAccessToken(), session.getAccessToken()]);
    expect(t1).toBe('a2');
    expect(t2).toBe('a2');
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://x/clients/cli_1/pick-auth/refresh',
    );
  });

  it('clears tokens + fires onSignedOut on a 401 refresh', async () => {
    const store = memoryStore({ accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() - 1 });
    const onSignedOut = vi.fn();
    const fetchImpl = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    const session = createPickerSession({
      store,
      baseUrl: 'http://x',
      getClientId: () => 'cli_1',
      fetchImpl,
      onSignedOut,
    });
    expect(await session.getAccessToken()).toBeNull();
    expect(await store.load()).toBeNull();
    expect(onSignedOut).toHaveBeenCalled();
  });

  it('keeps tokens on a network failure (retry later)', async () => {
    const store = memoryStore({ accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() - 1 });
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const session = createPickerSession({
      store,
      baseUrl: 'http://x',
      getClientId: () => 'cli_1',
      fetchImpl,
    });
    expect(await session.getAccessToken()).toBeNull();
    expect((await store.load())?.refreshToken).toBe('r1');
  });
});
