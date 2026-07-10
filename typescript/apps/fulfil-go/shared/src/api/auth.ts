import { type Static, Type } from '@sinclair/typebox';

/**
 * Mobile PKCE flow: the app generates verifier+challenge, the server brokers
 * the IdP exchange (issuer/client config stays server-side) and returns
 * tokens as JSON — no cookies, no server session. The verifier never leaves
 * the device until the code exchange.
 */
const AppSchema = Type.Union([
  Type.Literal('execution'),
  Type.Literal('picking'),
  Type.Literal('management'),
]);

export const AuthorizeUrlRequestSchema = Type.Object(
  {
    /** Which OAuth client to broker for; omitted = the 'default' client. */
    app: Type.Optional(AppSchema),
    codeChallenge: Type.String({ minLength: 43, maxLength: 128 }),
    redirectUri: Type.String(),
    state: Type.String({ minLength: 8, maxLength: 128 }),
  },
  { $id: 'AuthorizeUrlRequest' },
);
export type AuthorizeUrlRequest = Static<typeof AuthorizeUrlRequestSchema>;

export const AuthorizeUrlResponseSchema = Type.Object(
  {
    url: Type.String(),
  },
  { $id: 'AuthorizeUrlResponse' },
);
export type AuthorizeUrlResponse = Static<typeof AuthorizeUrlResponseSchema>;

export const MobileTokenRequestSchema = Type.Object(
  {
    app: Type.Optional(AppSchema),
    code: Type.String(),
    codeVerifier: Type.String({ minLength: 43, maxLength: 128 }),
    redirectUri: Type.String(),
  },
  { $id: 'MobileTokenRequest' },
);
export type MobileTokenRequest = Static<typeof MobileTokenRequestSchema>;

export const MobileRefreshRequestSchema = Type.Object(
  {
    app: Type.Optional(AppSchema),
    refreshToken: Type.String(),
  },
  { $id: 'MobileRefreshRequest' },
);
export type MobileRefreshRequest = Static<typeof MobileRefreshRequestSchema>;

/** Also the response shape of the Transistorsoft `authorization.refreshUrl`. */
export const MobileTokenResponseSchema = Type.Object(
  {
    accessToken: Type.String(),
    refreshToken: Type.Optional(Type.String()),
    /** Epoch milliseconds at which accessToken expires. */
    expiresAt: Type.Number(),
  },
  { $id: 'MobileTokenResponse' },
);
export type MobileTokenResponse = Static<typeof MobileTokenResponseSchema>;

/**
 * Picker session tokens (fulfil-go-issued, NOT platform OIDC) — the response
 * of /pick-auth/login/pin and /pick-auth/refresh. `expiresIn` is seconds
 * (OAuth convention), unlike MobileTokenResponse's epoch `expiresAt`.
 */
export const PickerTokenResponseSchema = Type.Object(
  {
    tokenType: Type.Literal('Bearer'),
    accessToken: Type.String(),
    refreshToken: Type.String(),
    expiresIn: Type.Integer(),
  },
  { $id: 'PickerTokenResponse' },
);
export type PickerTokenResponse = Static<typeof PickerTokenResponseSchema>;
