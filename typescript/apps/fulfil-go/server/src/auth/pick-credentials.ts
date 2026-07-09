/**
 * Picker credential hashing — PINs (and, later, QR badge tokens + enrollment
 * tokens) are stored ONLY as slow-hashes, never in the clear.
 *
 * Uses node's built-in `crypto.scrypt` deliberately: no native dependency to
 * install/build (keeps the supply-chain surface small), memory-hard, and
 * strong enough for a 6-digit PIN when paired with the device-enrollment
 * possession factor and a login attempt lockout (see the auth design doc).
 *
 * Encoded format: `s0$<N>$<r>$<p>$<saltB64url>$<keyB64url>` — the version tag
 * + cost params travel with the hash so params can be raised later without
 * breaking verification of existing rows.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const VERSION = 's0';
const KEY_LEN = 32;
const SALT_LEN = 16;
// scrypt cost. memory ≈ 128 * N * r ≈ 16 MiB at these values.
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const MAXMEM = 64 * 1024 * 1024;

// Promisified scrypt WITH cost options — `promisify(scrypt)` only types the
// no-options overload, so wrap the callback form ourselves.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Hash a secret (PIN / token) for at-rest storage. */
export async function hashSecret(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = (await scryptAsync(plain, salt, KEY_LEN, {
    ...PARAMS,
    maxmem: MAXMEM,
  })) as Buffer;
  return [VERSION, PARAMS.N, PARAMS.r, PARAMS.p, b64url(salt), b64url(key)].join('$');
}

/**
 * Constant-time verify of a plaintext secret against a stored hash. Returns
 * false (never throws) on any malformed/legacy hash so a corrupt row reads as
 * "wrong secret" rather than a 500.
 */
export async function verifySecret(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== VERSION) return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64!, 'base64url');
    expected = Buffer.from(keyB64!, 'base64url');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;

  const actual = (await scryptAsync(plain, salt, expected.length, {
    N,
    r,
    p,
    maxmem: MAXMEM,
  })) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * High-entropy opaque token (≥128-bit) for QR badges + device-enrollment
 * codes. base64url so it round-trips cleanly through a QR payload.
 */
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}
