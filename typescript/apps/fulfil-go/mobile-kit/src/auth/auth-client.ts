import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import type { AuthorizeUrlResponse, MobileTokenResponse } from '@fulfil-go/shared';
import { createPkcePair, randomState } from './pkce.js';
import type { Session } from './session.js';

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface AuthClientOptions {
  /** Which server-side OAuth client to broker for ('execution' | 'picking' | 'management'). */
  readonly app?: string;
  /** Server base URL (auth broker routes live there). */
  readonly baseUrl: string;
  /** This app's deep-link redirect, e.g. `fulfilgo-exec://auth/callback`. Must be in the server allowlist. */
  readonly redirectUri: string;
  readonly session: Session;
  readonly fetchImpl?: typeof fetch;
}

export interface AuthClient {
  /**
   * Full native login round trip: PKCE pair → server-brokered authorize URL
   * → system in-app browser → `appUrlOpen` deep-link callback → code
   * exchange → tokens into the session store.
   *
   * Native-only: on the web platform `appUrlOpen` never fires — browser dev
   * uses the server's x-user-id dev fallback via ApiClientOptions.devUserId
   * instead of this flow.
   */
  login(): Promise<void>;
  logout(): Promise<void>;
}

/** Wait for the OS to hand us the deep-link callback for our redirect URI. */
function waitForCallback(redirectUri: string): Promise<URL> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void listener.then((l) => l.remove());
      reject(new Error('login timed out waiting for the deep-link callback'));
    }, LOGIN_TIMEOUT_MS);

    const listener = App.addListener('appUrlOpen', ({ url }) => {
      if (!url.startsWith(redirectUri)) return;
      clearTimeout(timeout);
      void listener.then((l) => l.remove());
      resolve(new URL(url));
    });
  });
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`auth ${path} failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as T;
  }

  return {
    async login(): Promise<void> {
      const { verifier, challenge } = await createPkcePair();
      const state = randomState();

      const { url } = await post<AuthorizeUrlResponse>('/auth/mobile/authorize-url', {
        ...(options.app ? { app: options.app } : {}),
        codeChallenge: challenge,
        redirectUri: options.redirectUri,
        state,
      });

      const callbackPromise = waitForCallback(options.redirectUri);
      await Browser.open({ url });
      const callback = await callbackPromise;
      await Browser.close().catch(() => {
        // iOS closes the SFSafariViewController itself on deep-link; ignore.
      });

      if (callback.searchParams.get('state') !== state) {
        throw new Error('login callback state mismatch — possible CSRF, aborting');
      }
      const code = callback.searchParams.get('code');
      if (!code) {
        const err = callback.searchParams.get('error') ?? 'missing code';
        throw new Error(`login was rejected: ${err}`);
      }

      const tokens = await post<MobileTokenResponse>('/auth/mobile/token', {
        ...(options.app ? { app: options.app } : {}),
        code,
        codeVerifier: verifier,
        redirectUri: options.redirectUri,
      });
      await options.session.setTokens(tokens);
    },

    async logout(): Promise<void> {
      await options.session.signOut();
    },
  };
}
