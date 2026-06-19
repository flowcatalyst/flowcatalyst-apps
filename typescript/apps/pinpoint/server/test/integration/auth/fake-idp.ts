/**
 * In-process OIDC IdP for integration tests. Just enough surface to
 * exercise the pinpoint OIDC client + token validator end-to-end:
 *
 *   - `GET /.well-known/openid-configuration` — discovery
 *   - `GET /jwks`                              — JWKS for verifying access tokens
 *   - `GET /authorize`                         — auto-approves and redirects with code
 *   - `POST /token`                            — auth-code + refresh-token grants
 *   - `GET /userinfo`                          — bare-minimum claims response
 *
 * Tokens are signed with a freshly-generated RSA keypair per IdP
 * instance. The public key is served via the JWKS endpoint so the
 * pinpoint validator can verify them without any shared secret.
 *
 * What this fake IdP deliberately does NOT do:
 *   - Real user-interaction screens (consent, login). The /authorize
 *     route auto-approves whatever the test sets via `setAuthorizedUser`.
 *   - Code-verifier validation. We accept any PKCE pair — production
 *     IdPs verify; we trust the openid-client library to send the right
 *     thing. The test point is the pinpoint side, not the IdP side.
 *   - Real refresh-token rotation semantics. Each refresh mints a new
 *     token pair; the old refresh token is invalidated. Tests that want
 *     to assert revoke behaviour can call `invalidateRefreshToken`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import { parse as parseQueryString } from 'node:querystring';
import Fastify, { type FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';

export interface FakeIdpUser {
  readonly sub: string;
  readonly name?: string;
  readonly email?: string;
  readonly roles?: readonly string[];
}

export interface FakeIdp {
  readonly url: string;
  /** Issuer URL (same as `url`; alias for clarity in tests). */
  readonly issuerUrl: string;
  /**
   * Configure who the IdP "logs in" on the next /authorize hit. Stays
   * sticky until changed.
   */
  setAuthorizedUser(user: FakeIdpUser): void;
  /** Mint an access token directly (useful for bearer-flow tests). */
  signAccessToken(user: FakeIdpUser, options?: { expiresInSeconds?: number }): Promise<string>;
  /** Force a stored refresh token to fail the next exchange (simulates revoke). */
  invalidateRefreshToken(token: string): void;
  stop(): Promise<void>;
}

interface StoredRefreshToken {
  readonly user: FakeIdpUser;
  revoked: boolean;
}

export interface FakeIdpOptions {
  readonly audience?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  /** Default access-token lifetime, in seconds. Defaults to 3600. */
  readonly accessTokenTtl?: number;
}

const DEFAULT_AUDIENCE = 'pinpoint-test';
const DEFAULT_CLIENT_ID = 'pinpoint-test-client';

export async function startFakeIdp(options: FakeIdpOptions = {}): Promise<FakeIdp> {
  const audience = options.audience ?? DEFAULT_AUDIENCE;
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const accessTokenTtl = options.accessTokenTtl ?? 3600;

  // RS256 keypair — pinpoint's validator works against any RSxxx /
  // ESxxx jose can verify; RS256 keeps deps minimal.
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk: JWK = await exportJWK(publicKey);
  const kid = 'fake-idp-key-1';
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  let authorizedUser: FakeIdpUser = {
    sub: 'prn_default_test_user',
    name: 'Default Test User',
    email: 'default@example.test',
    roles: ['admin'],
  };

  // code → user. Auth-code grants pop the entry on exchange.
  const pendingCodes = new Map<string, FakeIdpUser>();
  // refresh_token → user mapping. Single-use rotation: redeemed
  // refresh tokens are revoked.
  const refreshTokens = new Map<string, StoredRefreshToken>();

  /**
   * Mint a JWT signed by the IdP keypair. `aud` differs by token
   * type: access tokens are scoped to the resource audience; id
   * tokens to the client_id (per OIDC spec, the id_token's `aud`
   * MUST contain the client_id). openid-client verifies the id_token
   * audience against `client_id` during the auth-code grant.
   */
  async function signToken(user: FakeIdpUser, ttlSeconds: number, aud: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      sub: user.sub,
      iss: serverUrl(),
      aud,
      iat: now,
      exp: now + ttlSeconds,
      roles: user.roles ?? [],
      // Random per-token jti: without it, two tokens minted in the
      // same wall-clock second (e.g. auth-code grant immediately
      // followed by a refresh in a test) would be byte-identical and
      // assertions like `expect(refreshed).not.toBe(initial)` would
      // fail. Real IdPs see real elapsed time between mints so this
      // doesn't matter outside the test rig.
      jti: randomUUID(),
    };
    if (user.name) payload['name'] = user.name;
    if (user.email) payload['email'] = user.email;
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid })
      .sign(privateKey as CryptoKey);
  }

  function newRefreshToken(user: FakeIdpUser): string {
    const token = randomBytes(32).toString('base64url');
    refreshTokens.set(token, { user, revoked: false });
    return token;
  }

  const server: FastifyInstance = Fastify({ logger: false });

  // Inline form-urlencoded parser. openid-client posts the token
  // request as application/x-www-form-urlencoded; without this parser
  // Fastify rejects with FST_ERR_CTP_INVALID_MEDIA_TYPE. Adding a new
  // workspace dep for one route's content type isn't worth it.
  server.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const parsed = parseQueryString(body as string);
        // Flatten array values — token-endpoint params are always
        // single-valued.
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) flat[k] = v[0] ?? '';
          else if (typeof v === 'string') flat[k] = v;
        }
        done(null, flat);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Hold the URL after listen() resolves. Discovery uses it as `iss`.
  let serverUrlValue = '';
  function serverUrl(): string {
    return serverUrlValue;
  }

  // ---- discovery -----------------------------------------------------------
  server.get('/.well-known/openid-configuration', () => ({
    issuer: serverUrl(),
    authorization_endpoint: `${serverUrl()}/authorize`,
    token_endpoint: `${serverUrl()}/token`,
    userinfo_endpoint: `${serverUrl()}/userinfo`,
    jwks_uri: `${serverUrl()}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
  }));

  // ---- JWKS ----------------------------------------------------------------
  server.get('/jwks', () => ({ keys: [publicJwk] }));

  // ---- /authorize: auto-approve --------------------------------------------
  server.get<{
    Querystring: {
      client_id?: string;
      redirect_uri?: string;
      state?: string;
      response_type?: string;
      scope?: string;
      code_challenge?: string;
      code_challenge_method?: string;
    };
  }>('/authorize', async (request, reply) => {
    const q = request.query;
    if (q.client_id !== clientId) {
      return reply.code(400).send({ error: 'invalid_client', client_id_received: q.client_id });
    }
    if (!q.redirect_uri) {
      return reply.code(400).send({ error: 'missing_redirect_uri' });
    }
    const code = randomUUID();
    pendingCodes.set(code, authorizedUser);
    const callback = new URL(q.redirect_uri);
    callback.searchParams.set('code', code);
    if (q.state) callback.searchParams.set('state', q.state);
    return reply.redirect(callback.toString(), 302);
  });

  // ---- /token: authorization_code + refresh_token --------------------------
  server.post<{
    Body: Record<string, string | undefined>;
  }>('/token', async (request, reply) => {
    const body = request.body ?? {};
    const grantType = body['grant_type'];

    if (grantType === 'authorization_code') {
      const code = body['code'];
      if (!code || !pendingCodes.has(code)) {
        return reply.code(400).send({ error: 'invalid_grant', detail: 'unknown code' });
      }
      const user = pendingCodes.get(code)!;
      pendingCodes.delete(code);
      const accessToken = await signToken(user, accessTokenTtl, audience);
      const idToken = await signToken(user, accessTokenTtl, clientId);
      const refreshToken = newRefreshToken(user);
      return reply.send({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: accessTokenTtl,
        id_token: idToken,
        scope: 'openid profile email',
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body['refresh_token'];
      if (!refreshToken) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const stored = refreshTokens.get(refreshToken);
      if (!stored || stored.revoked) {
        return reply.code(400).send({ error: 'invalid_grant', detail: 'refresh token rejected' });
      }
      stored.revoked = true; // rotate
      const newAccessToken = await signToken(stored.user, accessTokenTtl, audience);
      const newRefreshTokenStr = newRefreshToken(stored.user);
      return reply.send({
        access_token: newAccessToken,
        refresh_token: newRefreshTokenStr,
        token_type: 'Bearer',
        expires_in: accessTokenTtl,
        scope: 'openid profile email',
      });
    }

    return reply.code(400).send({ error: 'unsupported_grant_type' });
  });

  // ---- /userinfo -----------------------------------------------------------
  server.get('/userinfo', (request, reply) => {
    const auth = request.headers['authorization'];
    if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
      return reply.code(401).send({ error: 'invalid_token' });
    }
    return reply.send({
      sub: authorizedUser.sub,
      name: authorizedUser.name,
      email: authorizedUser.email,
    });
  });

  await server.listen({ host: '127.0.0.1', port: 0 });
  const addr = server.server.address() as AddressInfo;
  serverUrlValue = `http://127.0.0.1:${addr.port}`;

  return {
    url: serverUrlValue,
    issuerUrl: serverUrlValue,
    setAuthorizedUser(user) {
      authorizedUser = user;
    },
    async signAccessToken(user, opts = {}) {
      return signToken(user, opts.expiresInSeconds ?? accessTokenTtl, audience);
    },
    invalidateRefreshToken(token) {
      const stored = refreshTokens.get(token);
      if (stored) stored.revoked = true;
    },
    async stop() {
      await server.close();
    },
  };
}
