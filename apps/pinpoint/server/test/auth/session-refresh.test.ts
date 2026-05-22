/**
 * Unit test for tryRefreshSession. Drives the function with fakes for
 * oidcClient + tokenValidator + sessionStore so we can prove:
 *  - happy path: expired access token → refresh exchange → new token
 *    validates → returns claims, session has new tokens persisted
 *  - concurrent race: another request already refreshed → we validate
 *    the freshly-stored token without re-attempting refresh
 *  - missing refresh token → null (caller falls through to 401)
 *  - oidc / validator unconfigured → null
 *  - refresh-token rejected → null, session NOT mutated, warn logged
 */
import { describe, expect, it } from 'vitest';
import {
  tryRefreshSession,
  type RefreshLogger,
  type RefreshSessionDeps,
} from '../../src/auth/session-refresh.js';
import { createInMemorySessionStore, type Session } from '../../src/auth/session-store.js';
import type { OidcClient, OidcTokens } from '../../src/auth/oidc-client.js';
import type { TokenValidator, ValidatedToken } from '../../src/auth/token-validator.js';

function fakeLogger(): { log: RefreshLogger; warns: Array<{ meta: unknown; msg: string }> } {
  const warns: Array<{ meta: unknown; msg: string }> = [];
  return {
    log: { warn: (meta, msg) => warns.push({ meta, msg }) },
    warns,
  };
}

function buildDeps(overrides: {
  oidcClient?: OidcClient | null;
  tokenValidator?: TokenValidator | null;
} = {}): RefreshSessionDeps & { log: ReturnType<typeof fakeLogger> } {
  const logger = fakeLogger();
  return {
    oidcClient: overrides.oidcClient ?? null,
    tokenValidator: overrides.tokenValidator ?? null,
    sessionStore: createInMemorySessionStore(),
    log: logger.log,
    // Re-export the underlying captures for test assertions.
    ...{ logger },
  } as RefreshSessionDeps & { log: ReturnType<typeof fakeLogger> };
}

function seedSession(deps: RefreshSessionDeps, init: Partial<Session>): Session {
  const id = deps.sessionStore.generateId();
  return deps.sessionStore.create(id, init);
}

describe('tryRefreshSession', () => {
  it('returns null when oidcClient is not configured', async () => {
    const deps = buildDeps();
    const session = seedSession(deps, { accessToken: 'old', refreshToken: 'r1' });
    const result = await tryRefreshSession(deps, session);
    expect(result).toBeNull();
  });

  it('returns null when tokenValidator is not configured', async () => {
    const deps = buildDeps({ oidcClient: { refresh: async () => ({}) } as never });
    const session = seedSession(deps, { accessToken: 'old', refreshToken: 'r1' });
    const result = await tryRefreshSession(deps, session);
    expect(result).toBeNull();
  });

  it('returns null when the session lacks a refresh token', async () => {
    const deps = buildDeps({
      oidcClient: { refresh: async () => ({}) } as never,
      tokenValidator: { validate: async () => ({} as ValidatedToken) },
    });
    const session = seedSession(deps, { accessToken: 'old', refreshToken: null });
    const result = await tryRefreshSession(deps, session);
    expect(result).toBeNull();
  });

  it('refreshes + persists + returns claims on happy path', async () => {
    const refresh = async (rt: string): Promise<OidcTokens> => {
      expect(rt).toBe('refresh-1');
      return {
        accessToken: 'new-access',
        refreshToken: 'refresh-2',
        idToken: null,
        expiresAt: 1234,
      };
    };
    const validate = async (token: string): Promise<ValidatedToken> => {
      expect(token).toBe('new-access');
      return {
        sub: 'prn_alice',
        name: 'Alice',
        email: null,
        roles: ['admin'],
        raw: {},
      };
    };
    const deps = buildDeps({
      oidcClient: { refresh } as never,
      tokenValidator: { validate },
    });
    const session = seedSession(deps, { accessToken: 'old', refreshToken: 'refresh-1' });

    const result = await tryRefreshSession(deps, session);

    expect(result?.sub).toBe('prn_alice');
    // admin role → every permission, including TenancyClientCreate
    expect(result?.permissions?.has('pinpoint:tenancy:client:create')).toBe(true);

    const stored = deps.sessionStore.get(session.id);
    expect(stored?.accessToken).toBe('new-access');
    expect(stored?.refreshToken).toBe('refresh-2');
  });

  it('preserves the refresh token when the IdP does not rotate it', async () => {
    const refresh = async (): Promise<OidcTokens> => ({
      accessToken: 'new-access',
      refreshToken: null,
      idToken: null,
      expiresAt: null,
    });
    const validate = async (): Promise<ValidatedToken> => ({
      sub: 'prn_alice',
      name: null,
      email: null,
      roles: [],
      raw: {},
    });
    const deps = buildDeps({
      oidcClient: { refresh } as never,
      tokenValidator: { validate },
    });
    const session = seedSession(deps, { accessToken: 'old', refreshToken: 'keep-me' });

    await tryRefreshSession(deps, session);

    const stored = deps.sessionStore.get(session.id);
    expect(stored?.refreshToken).toBe('keep-me');
  });

  it('validates the already-rotated token when another request refreshed first', async () => {
    const refreshCalls: string[] = [];
    const refresh = async (rt: string): Promise<OidcTokens> => {
      refreshCalls.push(rt);
      throw new Error('refresh should not be invoked');
    };
    const validate = async (token: string): Promise<ValidatedToken> => {
      expect(token).toBe('rotated-by-other-request');
      return {
        sub: 'prn_alice',
        name: null,
        email: null,
        roles: ['viewer'],
        raw: {},
      };
    };
    const deps = buildDeps({
      oidcClient: { refresh } as never,
      tokenValidator: { validate },
    });
    const session = seedSession(deps, { accessToken: 'old', refreshToken: 'r1' });
    // Simulate the concurrent refresh: another request already swapped
    // the access token in the store.
    deps.sessionStore.update(session.id, { accessToken: 'rotated-by-other-request' });

    const result = await tryRefreshSession(deps, session);

    expect(result?.sub).toBe('prn_alice');
    expect(refreshCalls).toEqual([]); // never attempted our own refresh
  });

  it('returns null and warns when the refresh-token exchange fails', async () => {
    const logger = fakeLogger();
    const refresh = async (): Promise<OidcTokens> => {
      throw new Error('invalid_grant');
    };
    const validate = async (): Promise<ValidatedToken> => {
      throw new Error('should not validate');
    };
    const deps: RefreshSessionDeps = {
      oidcClient: { refresh } as never,
      tokenValidator: { validate },
      sessionStore: createInMemorySessionStore(),
      log: logger.log,
    };
    const session = seedSession(deps, { accessToken: 'old', refreshToken: 'bad-token' });

    const result = await tryRefreshSession(deps, session);

    expect(result).toBeNull();
    expect(logger.warns.length).toBe(1);
    expect(logger.warns[0]?.msg).toBe('OIDC token refresh failed');
    // Session left untouched so a subsequent request doesn't see partial
    // mutation.
    const stored = deps.sessionStore.get(session.id);
    expect(stored?.accessToken).toBe('old');
    expect(stored?.refreshToken).toBe('bad-token');
  });
});
