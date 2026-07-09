import { Preferences } from '@capacitor/preferences';

export interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Token persistence on @capacitor/preferences (UserDefaults / SharedPreferences).
 *
 * TODO(security): move to a Keychain/Keystore-backed plugin (e.g.
 * @aparajita/capacitor-secure-storage) before production — Preferences is
 * unencrypted at rest on Android. Kept behind this interface so the swap is
 * one file.
 */
export function createPreferencesTokenStore(key = 'fulfilgo.tokens'): TokenStore {
  return {
    async load(): Promise<StoredTokens | null> {
      const { value } = await Preferences.get({ key });
      if (!value) return null;
      try {
        return JSON.parse(value) as StoredTokens;
      } catch {
        return null;
      }
    },
    async save(tokens: StoredTokens): Promise<void> {
      await Preferences.set({ key, value: JSON.stringify(tokens) });
    },
    async clear(): Promise<void> {
      await Preferences.remove({ key });
    },
  };
}
