import type { Principal, PrincipalDraft } from './principal.js';
import type { PrincipalId } from './ids.js';

export interface PrincipalRepository {
  findById(id: PrincipalId): Promise<Principal | null>;

  /**
   * Insert or update a principal by id. Returns the persisted row.
   *
   * Used by the auth flow — on first authenticated request (or OIDC
   * callback in a later slice), the principal is upserted from token
   * claims so subsequent reads can resolve it.
   */
  upsert(draft: PrincipalDraft): Promise<Principal>;
}
