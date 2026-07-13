import {
  createLocalStorageTokenStore,
  createPkcePair,
  createSession,
  randomState,
  type Session,
} from '@fulfil-go/mobile-kit/auth-web';

/**
 * Management-app OIDC session — the same PKCE brokering the mobile apps use
 * (server-side 'management' OAuth client), with a plain browser redirect
 * instead of the system-browser/deep-link dance:
 *
 *   signIn() → POST /auth/mobile/authorize-url → window.location = IdP →
 *   /login/callback → completeSignIn(code, state) → POST /auth/mobile/token
 *
 * Signed OUT the api client falls back to the server's dev headers (when
 * the server runs FULFILGO_AUTH_DEV_FALLBACK) — dev keeps working without
 * a login; signing in upgrades the identity to real OIDC claims.
 */
const APP = 'management';
const PKCE_KEY = 'fulfilgo.mgmt.pkce';

export const session: Session = createSession({
  app: APP,
  store: createLocalStorageTokenStore('fulfilgo.mgmt.tokens'),
  baseUrl: '',
});

export function redirectUri(): string {
  return `${window.location.origin}/login/callback`;
}

/** Kick off the PKCE redirect. Throws when the server has no OIDC issuer. */
export async function signIn(returnTo = '/'): Promise<void> {
  const pair = await createPkcePair();
  const state = randomState();
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier: pair.verifier, state, returnTo }));
  const res = await fetch('/auth/mobile/authorize-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app: APP,
      codeChallenge: pair.challenge,
      redirectUri: redirectUri(),
      state,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Sign-in unavailable (${res.status}).`);
  }
  const { url } = (await res.json()) as { url: string };
  window.location.assign(url);
}

/** Finish the redirect: exchange the code, land the tokens. Returns returnTo. */
export async function completeSignIn(code: string, state: string): Promise<string> {
  const raw = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  if (!raw) throw new Error('No sign-in in progress — start again.');
  const pending = JSON.parse(raw) as { verifier: string; state: string; returnTo: string };
  if (pending.state !== state) throw new Error('State mismatch — start the sign-in again.');
  const res = await fetch('/auth/mobile/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app: APP,
      code,
      codeVerifier: pending.verifier,
      redirectUri: redirectUri(),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'The identity provider rejected the sign-in.');
  }
  await session.setTokens(await res.json());
  return pending.returnTo || '/';
}

export async function signOut(): Promise<void> {
  await session.signOut();
  // Identity (and any per-identity caches) changed wholesale — reload.
  window.location.assign('/');
}
