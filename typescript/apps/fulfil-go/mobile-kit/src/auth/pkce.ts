/**
 * PKCE pair generation on-device via WebCrypto (works in the Capacitor
 * WebView and in browser dev). The verifier NEVER leaves the device until
 * the code exchange — the server only ever sees the S256 challenge.
 */
export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

function base64url(bytes: Uint8Array): string {
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}
