/**
 * Branded IDs for the auth subdomain. `PrincipalId` is the verbatim OIDC
 * `sub` claim — not a TSID-prefixed pinpoint ID — because the identity
 * provider owns its shape.
 */
export type PrincipalId = string & { readonly __brand: 'PrincipalId' };

export function asPrincipalId(value: string): PrincipalId {
  return value as PrincipalId;
}
