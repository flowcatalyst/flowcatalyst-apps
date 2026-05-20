/**
 * No-op verifier — always returns null. Mirror of Rust `NoopVerifier`.
 *
 * Default impl when `PINPOINT_LLM_PROVIDER=none` (or unset). Keeps the
 * matching pipeline runnable without any LLM creds / sidecar — the
 * algorithmic matcher's verdict stands on its own; verification is
 * an optional quality layer on top.
 */
import type { AddressVerifier } from '../../domain/services/address-verifier.js';

export function createNoopVerifier(): AddressVerifier {
  return {
    async verify(): Promise<null> {
      return null;
    },
  };
}
