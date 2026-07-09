/**
 * Picker session tokens — fulfil-go-ISSUED (not platform-validated) JWTs for
 * the shared-station picking app. Distinct from the platform-OIDC path in
 * `token-validator.ts`, which only *validates* externally-minted tokens.
 *
 * Two token types, both HS256-signed with `PICKER_SESSION_SECRET`:
 *   - access  (short-lived) — carries the store-scoped permission set + the
 *     `storeRef`/`deviceId` the request scope is scoped by.
 *   - refresh (longer-lived) — identity only; exchanged for a fresh access
 *     token at `/pick-auth/refresh`.
 *
 * The `iss` claim (default `fulfilgo-pick`) lets `extractRequestToken` route a
 * bearer token to this verifier vs. the platform JWKS one by peeking the
 * unverified issuer — so a picker token never triggers a failed JWKS verify.
 */
import { SignJWT, jwtVerify, decodeJwt, errors as joseErrors } from 'jose';
import type { PickerAuthConfig } from './auth-config.js';

export interface IssueSessionInput {
  readonly pickerId: string;
  readonly clientId: string;
  readonly storeRef: string;
  readonly permissions: readonly string[];
  readonly deviceId?: string | undefined;
}

export interface PickerAccessClaims {
  readonly pickerId: string;
  readonly clientId: string;
  readonly storeRef: string;
  readonly deviceId: string | null;
  readonly permissions: readonly string[];
}

export interface PickerRefreshClaims {
  readonly pickerId: string;
  readonly clientId: string;
  readonly storeRef: string;
  readonly deviceId: string | null;
}

export interface IssuedSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Access-token lifetime in seconds — the client schedules refresh from this. */
  readonly expiresIn: number;
}

export interface PickerTokenService {
  issueSession(input: IssueSessionInput): Promise<IssuedSession>;
  verifyAccess(token: string): Promise<PickerAccessClaims>;
  verifyRefresh(token: string): Promise<PickerRefreshClaims>;
  /** True when the (unverified) issuer marks this as one of our picker tokens. */
  isPickerToken(token: string): boolean;
}

/** Thrown for any invalid/expired/wrong-type picker token. */
export class PickerTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PickerTokenError';
  }
}

export function createPickerTokenService(config: PickerAuthConfig): PickerTokenService {
  const secret = new TextEncoder().encode(config.secret);
  const { issuer } = config;

  async function sign(
    payload: Record<string, unknown>,
    subject: string,
    ttlSeconds: number,
  ): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(issuer)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(secret);
  }

  async function verify(token: string, expectedTyp: 'access' | 'refresh') {
    try {
      const { payload } = await jwtVerify(token, secret, { issuer });
      if (payload['typ'] !== expectedTyp) {
        throw new PickerTokenError(`Expected a ${expectedTyp} token.`);
      }
      return payload;
    } catch (err) {
      if (err instanceof PickerTokenError) throw err;
      if (err instanceof joseErrors.JOSEError) {
        throw new PickerTokenError(`Invalid picker ${expectedTyp} token: ${err.code}`);
      }
      throw err;
    }
  }

  return {
    async issueSession(input: IssueSessionInput): Promise<IssuedSession> {
      const common = {
        cid: input.clientId,
        str: input.storeRef,
        dev: input.deviceId ?? null,
      };
      const accessToken = await sign(
        { ...common, typ: 'access', perms: [...input.permissions] },
        input.pickerId,
        config.accessTtlSeconds,
      );
      const refreshToken = await sign(
        { ...common, typ: 'refresh' },
        input.pickerId,
        config.refreshTtlSeconds,
      );
      return { accessToken, refreshToken, expiresIn: config.accessTtlSeconds };
    },

    async verifyAccess(token: string): Promise<PickerAccessClaims> {
      const payload = await verify(token, 'access');
      const perms = payload['perms'];
      return {
        pickerId: String(payload.sub),
        clientId: String(payload['cid']),
        storeRef: String(payload['str']),
        deviceId: typeof payload['dev'] === 'string' ? payload['dev'] : null,
        permissions: Array.isArray(perms) ? perms.filter((p): p is string => typeof p === 'string') : [],
      };
    },

    async verifyRefresh(token: string): Promise<PickerRefreshClaims> {
      const payload = await verify(token, 'refresh');
      return {
        pickerId: String(payload.sub),
        clientId: String(payload['cid']),
        storeRef: String(payload['str']),
        deviceId: typeof payload['dev'] === 'string' ? payload['dev'] : null,
      };
    },

    isPickerToken(token: string): boolean {
      try {
        return decodeJwt(token).iss === issuer;
      } catch {
        return false;
      }
    },
  };
}
