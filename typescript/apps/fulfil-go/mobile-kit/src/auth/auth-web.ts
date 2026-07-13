/**
 * Web-safe auth surface (no Capacitor imports) — what a desktop web app
 * (management) needs to run the same PKCE flow as the mobile apps: pair
 * generation, the token session (refresh single-flight), and the TokenStore
 * interface to back with localStorage. Exported as the
 * `@fulfil-go/mobile-kit/auth-web` subpath so web consumers never pull the
 * @capacitor/preferences-backed store.
 */
export { createPkcePair, randomState, type PkcePair } from './pkce.js';
export { createSession, type Session, type SessionOptions } from './session.js';
export type { StoredTokens, TokenStore } from './token-store.js';

/** Browser token persistence — the web counterpart of the Preferences store. */
export function createLocalStorageTokenStore(
  key = 'fulfilgo.tokens',
): import('./token-store.js').TokenStore {
  return {
    async load() {
      const value = localStorage.getItem(key);
      if (!value) return null;
      try {
        return JSON.parse(value) as import('./token-store.js').StoredTokens;
      } catch {
        return null;
      }
    },
    async save(tokens) {
      localStorage.setItem(key, JSON.stringify(tokens));
    },
    async clear() {
      localStorage.removeItem(key);
    },
  };
}
