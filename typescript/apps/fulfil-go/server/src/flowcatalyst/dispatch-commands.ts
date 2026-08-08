/**
 * Fully qualified dispatch-job command codes.
 *
 * The platform facets dispatch jobs on the code's colon segments
 * (application:subdomain:aggregate:action) and resolves delivery signing
 * credentials from the application segment; the SDK (≥0.9.10) rejects
 * anything that isn't four non-empty segments. Declare every dispatch
 * command here — never inline a code at the call site.
 */
import { FULFILGO_APPLICATION_CODE } from './index.js';

/** create-pick command → pick context intake (`POST /clients/:id/picks`). */
export const CreatePickCommandCode =
  `${FULFILGO_APPLICATION_CODE}:fulfilment:part:create-pick` as const;

/** book command → transport booking landing pad (`POST …/transport/orders/:id/book`). */
export const BookTransportOrderCommandCode =
  `${FULFILGO_APPLICATION_CODE}:transport:order:book` as const;

/** epod-provision command → EPOD master-data provisioning (`POST …/epod/provision`). */
export const EpodProvisionCommandCode =
  `${FULFILGO_APPLICATION_CODE}:fulfilment:fulfilment:epod-provision` as const;
