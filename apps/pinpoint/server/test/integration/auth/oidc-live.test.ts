/**
 * End-to-end OIDC integration test against a live IdP. The fake IdP
 * in `fake-idp.ts` exposes the full set of endpoints pinpoint actually
 * uses (discovery, JWKS, /authorize, /token, /userinfo) with a real
 * RS256 keypair, so this exercises:
 *
 *   - createTokenValidator → live JWKS fetch + JWT verify
 *   - createOidcClient → live discovery + authorization_code grant +
 *     refresh_token grant
 *   - tryRefreshSession composed end-to-end against a real /token
 *     endpoint
 *
 * The mocked unit tests for tryRefreshSession (test/auth/) cover the
 * branching logic; this suite proves the openid-client / jose wiring
 * works against a real OIDC counterpart.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenValidator } from '../../../src/auth/token-validator.js';
import { createOidcClient } from '../../../src/auth/oidc-client.js';
import { tryRefreshSession } from '../../../src/auth/session-refresh.js';
import { createInMemorySessionStore } from '../../../src/auth/session-store.js';
import { startFakeIdp, type FakeIdp } from './fake-idp.js';

describe('OIDC end-to-end against a live IdP', () => {
  let idp: FakeIdp;

  beforeAll(async () => {
    idp = await startFakeIdp({
      audience: 'pinpoint-test',
      clientId: 'pinpoint-test-client',
    });
  });

  afterAll(async () => {
    await idp.stop();
  });

  describe('createTokenValidator', () => {
    it('validates an access token minted by the IdP against its JWKS', async () => {
      const validator = createTokenValidator({
        issuerUrl: idp.issuerUrl,
        audience: 'pinpoint-test',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });
      const token = await idp.signAccessToken({
        sub: 'prn_alice',
        name: 'Alice',
        email: 'alice@example.test',
        roles: ['admin'],
      });

      const claims = await validator.validate(token);

      expect(claims.sub).toBe('prn_alice');
      expect(claims.name).toBe('Alice');
      expect(claims.email).toBe('alice@example.test');
      expect(claims.roles).toEqual(['admin']);
    });

    it('rejects an expired token', async () => {
      const validator = createTokenValidator({
        issuerUrl: idp.issuerUrl,
        audience: 'pinpoint-test',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });
      const token = await idp.signAccessToken(
        { sub: 'prn_bob' },
        { expiresInSeconds: -10 },
      );

      await expect(validator.validate(token)).rejects.toThrow();
    });

    it('rejects a token with the wrong audience', async () => {
      const validator = createTokenValidator({
        issuerUrl: idp.issuerUrl,
        audience: 'something-else',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });
      const token = await idp.signAccessToken({ sub: 'prn_alice', roles: [] });

      await expect(validator.validate(token)).rejects.toThrow();
    });
  });

  describe('createOidcClient', () => {
    it('runs the authorization_code grant end-to-end', async () => {
      const oidc = await createOidcClient({
        issuerUrl: idp.issuerUrl,
        audience: 'pinpoint-test',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });

      idp.setAuthorizedUser({
        sub: 'prn_alice',
        name: 'Alice',
        email: 'alice@example.test',
        roles: ['admin'],
      });

      // 1. Build the /authorize URL.
      const params = await oidc.buildAuthorizeUrl();
      expect(params.url.toString()).toContain(idp.issuerUrl);

      // 2. Hit the IdP's /authorize (no UA — just follow the redirect
      //    manually). The fake auto-approves the configured user.
      const authorizeResponse = await fetch(params.url.toString(), { redirect: 'manual' });
      expect(authorizeResponse.status).toBe(302);
      const location = authorizeResponse.headers.get('location');
      if (!location) throw new Error('IdP did not redirect from /authorize');

      const callbackUrl = new URL(location);
      expect(callbackUrl.searchParams.get('state')).toBe(params.state);
      expect(callbackUrl.searchParams.get('code')).toBeTruthy();

      // 3. Exchange the code for tokens.
      const tokens = await oidc.exchangeCode(callbackUrl, params.codeVerifier, params.state);
      expect(tokens.accessToken.length).toBeGreaterThan(0);
      expect(tokens.refreshToken?.length ?? 0).toBeGreaterThan(0);
    });

    it('refreshes an access token via the refresh_token grant', async () => {
      const oidc = await createOidcClient({
        issuerUrl: idp.issuerUrl,
        audience: 'pinpoint-test',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });
      idp.setAuthorizedUser({ sub: 'prn_carol', roles: ['operator'] });
      const params = await oidc.buildAuthorizeUrl();
      const r = await fetch(params.url.toString(), { redirect: 'manual' });
      const cb = new URL(r.headers.get('location')!);
      const initial = await oidc.exchangeCode(cb, params.codeVerifier, params.state);
      if (!initial.refreshToken) throw new Error('test setup: no refresh token');

      const refreshed = await oidc.refresh(initial.refreshToken);

      expect(refreshed.accessToken).not.toBe(initial.accessToken);
      expect(refreshed.refreshToken).not.toBe(initial.refreshToken);
    });

    it('fails the refresh exchange when the refresh token is revoked', async () => {
      const oidc = await createOidcClient({
        issuerUrl: idp.issuerUrl,
        audience: 'pinpoint-test',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });
      idp.setAuthorizedUser({ sub: 'prn_dan', roles: [] });
      const params = await oidc.buildAuthorizeUrl();
      const r = await fetch(params.url.toString(), { redirect: 'manual' });
      const cb = new URL(r.headers.get('location')!);
      const initial = await oidc.exchangeCode(cb, params.codeVerifier, params.state);
      if (!initial.refreshToken) throw new Error('test setup: no refresh token');

      idp.invalidateRefreshToken(initial.refreshToken);

      await expect(oidc.refresh(initial.refreshToken)).rejects.toThrow();
    });
  });

  describe('tryRefreshSession composed with the live IdP', () => {
    it('refreshes an expired session in-band against the real /token endpoint', async () => {
      const oidc = await createOidcClient({
        issuerUrl: idp.issuerUrl,
        audience: 'pinpoint-test',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });
      const validator = createTokenValidator({
        issuerUrl: idp.issuerUrl,
        audience: 'pinpoint-test',
        clientId: 'pinpoint-test-client',
        clientSecret: null,
        redirectUri: 'http://pinpoint.test/auth/callback',
        scopes: 'openid profile email',
      });

      idp.setAuthorizedUser({
        sub: 'prn_eve',
        roles: ['viewer'],
        email: 'eve@example.test',
      });
      const params = await oidc.buildAuthorizeUrl();
      const r = await fetch(params.url.toString(), { redirect: 'manual' });
      const cb = new URL(r.headers.get('location')!);
      const tokens = await oidc.exchangeCode(cb, params.codeVerifier, params.state);
      if (!tokens.refreshToken) throw new Error('test setup: no refresh token');

      // Seed a session that mirrors what /auth/callback writes today.
      const sessionStore = createInMemorySessionStore();
      const id = sessionStore.generateId();
      const session = sessionStore.create(id, {
        // Force the access token to be obviously bogus so validation
        // fails — this is the runtime trigger for tryRefreshSession.
        accessToken: 'expired.invalid.jwt',
        refreshToken: tokens.refreshToken,
        sub: 'prn_eve',
        email: 'eve@example.test',
      });

      const result = await tryRefreshSession(
        {
          oidcClient: oidc,
          tokenValidator: validator,
          sessionStore,
          log: { warn: () => {} },
        },
        session,
      );

      expect(result?.sub).toBe('prn_eve');
      // viewer role grants every `*:read` permission
      expect(result?.permissions?.has('pinpoint:tenancy:client:read')).toBe(true);
      expect(result?.permissions?.has('pinpoint:tenancy:client:create')).toBe(false);

      const stored = sessionStore.get(id);
      expect(stored?.accessToken).not.toBe('expired.invalid.jwt');
      expect(stored?.accessToken?.length ?? 0).toBeGreaterThan(0);
      expect(stored?.refreshToken).not.toBe(tokens.refreshToken);
    });
  });
});
