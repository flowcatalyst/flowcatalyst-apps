/**
 * The CORE PROCESS-DEFINITION REGISTRY, v1 (docs/process-definitions.md
 * "Registry v1"): processDefinition stamp → coordinator module, each module
 * PLAIN TypeScript. The split it enforces:
 *
 *   - Aggregate COMMANDS (the use cases) own invariants: transitions,
 *     derivations (READY/FAILED), version bumps, state-guard idempotency.
 *   - A DEFINITION is thin POLICY: which command to invoke for which
 *     delivered event — whether and when, never how.
 *
 * The webhook route (delivery auth, ACK-on-state-guard, 500-for-retry) is
 * shared infrastructure — definitions plug into it, never fork it. The
 * `on/when/do` DSL + generated diagrams stay DEFERRED until a second real
 * definition exists.
 */
import type { Result } from '@fulfil-go/framework';
import type { RequestEpodProvisioningUseCase } from '../operations/epod-provisioning/epod-provisioning.use-cases.js';
import type {
  RegisterPartFailedUseCase,
  RegisterPartPickedUseCase,
  RegisterPartPickingUseCase,
} from '../operations/fulfilment-pick-process/fulfilment-pick-process.use-cases.js';
import type {
  RequestTransportUseCase,
  ScheduleTransportRequestUseCase,
} from '../operations/request-transport/request-transport.use-cases.js';

/** One platform delivery, normalized by the webhook route. */
export interface ProcessEvent {
  readonly eventType: string;
  readonly clientId: string;
  readonly fulfilmentId: string;
  /** The delivery body (dataOnly payload), string-decoding already handled. */
  readonly payload: unknown;
}

/**
 * The COMMANDS a definition may invoke — every entry is a context use case
 * that owns its own invariants and idempotency. Definitions get nothing
 * else: no repositories, no raw db.
 */
export interface ProcessCommands {
  readonly registerPartPicking: RegisterPartPickingUseCase;
  readonly registerPartPicked: RegisterPartPickedUseCase;
  readonly registerPartFailed: RegisterPartFailedUseCase;
  readonly requestEpodProvisioning: RequestEpodProvisioningUseCase;
  readonly requestTransport: RequestTransportUseCase;
  readonly scheduleTransportRequest: ScheduleTransportRequestUseCase;
}

export interface ProcessDefinition {
  readonly code: string;
  /** Event types this definition reacts to (drives the route's 400 gate). */
  readonly handles: readonly string[];
  /**
   * Decide and invoke the reaction for one delivered event — runs INSIDE
   * the route's runWrite tx. Business-rule / not-found failures are ACKed
   * by the route (handled:false); real errors 500 for a platform retry.
   */
  handle(event: ProcessEvent, commands: ProcessCommands): Promise<Result<unknown>>;
}

export interface ProcessRegistry {
  /**
   * Stamp → definition. Throws on an unknown stamp: that's a deploy/config
   * error (a stamped definition was removed) — the route 500s and the
   * platform retries while it gets fixed, nothing is silently misrouted.
   */
  resolve(code: string): ProcessDefinition;
  /** Union of every definition's `handles` — the route's supported gate. */
  supportedEventTypes(): readonly string[];
}

export function createProcessRegistry(definitions: readonly ProcessDefinition[]): ProcessRegistry {
  const byCode = new Map(definitions.map((d) => [d.code, d]));
  const supported = [...new Set(definitions.flatMap((d) => d.handles))];
  return {
    resolve(code): ProcessDefinition {
      const definition = byCode.get(code);
      if (!definition) {
        throw new Error(
          `Unknown process definition '${code}' — registered: ${[...byCode.keys()].join(', ')}.`,
        );
      }
      return definition;
    },
    supportedEventTypes: () => supported,
  };
}
