/**
 * The STANDARD process definition — the default coordinator every client
 * gets (hand-authored flow diagram: docs/processes/standard-fulfilment.mmd).
 *
 * Thin policy only: each delivered event maps to ONE context command. The
 * commands own the invariants — part transitions, READY/FAILED derivations,
 * the all-or-nothing fan-out driven by the fulfilment's own stamped
 * policies, state-guard idempotency.
 */
import { Result, UseCaseError } from '@fulfil-go/framework';
import type { PickClaimedData } from '../domain/picks/events/pick-claimed.event.js';
import type {
  PickFailedData,
  PickOutcomeData,
} from '../domain/picks/events/pick-outcome.events.js';
import { STANDARD_PROCESS_DEFINITION } from '@fulfil-go/shared';
import type { ProcessDefinition, ProcessEvent, ProcessCommands } from './process-registry.js';

const HANDLES = [
  'fulfil-go:fulfilment:fulfilment:created',
  'fulfil-go:pick:pick:claimed',
  'fulfil-go:pick:pick:picked',
  'fulfil-go:pick:pick:short-picked',
  'fulfil-go:pick:pick:failed',
] as const;

export const standardDefinition: ProcessDefinition = {
  code: STANDARD_PROCESS_DEFINITION,
  handles: HANDLES,

  async handle(event: ProcessEvent, commands: ProcessCommands): Promise<Result<unknown>> {
    switch (event.eventType) {
      case 'fulfil-go:fulfilment:fulfilment:created':
        // EPOD pre-provisioning: when an origin store's settings select the
        // EPOD execution system, dispatch the provisioning job. Guarded by
        // the 'epod-provision-dispatched' activity-log entry (no aggregate
        // transition exists for this decision).
        return commands.requestEpodProvisioning.execute({
          clientId: event.clientId,
          fulfilmentId: event.fulfilmentId,
        });

      case 'fulfil-go:pick:pick:claimed': {
        const data = event.payload as PickClaimedData;
        return commands.registerPartPicking.execute({
          clientId: event.clientId,
          fulfilmentId: event.fulfilmentId,
          partId: data.partId,
          pickerId: data.pickerId,
        });
      }

      case 'fulfil-go:pick:pick:picked':
      case 'fulfil-go:pick:pick:short-picked': {
        const data = event.payload as PickOutcomeData;
        return commands.registerPartPicked.execute({
          clientId: event.clientId,
          fulfilmentId: event.fulfilmentId,
          partId: data.partId,
          pickerId: data.pickerId,
          short: event.eventType === 'fulfil-go:pick:pick:short-picked',
          requiresVehicle: data.requiresVehicle ?? false,
          lineResults: data.lineResults.map((r) => ({
            externalLineRef: r.externalLineRef,
            pickedQuantity: r.pickedQuantity,
            ...(r.substitutions ? { substitutions: r.substitutions } : {}),
          })),
          packages: data.packages ?? [],
        });
      }

      case 'fulfil-go:pick:pick:failed': {
        const data = event.payload as PickFailedData;
        return commands.registerPartFailed.execute({
          clientId: event.clientId,
          fulfilmentId: event.fulfilmentId,
          partId: data.partId,
          pickerId: data.pickerId,
          reason: data.reason,
        });
      }

      default:
        // The route gates on the registry's union of handles; reaching here
        // means THIS definition doesn't react — ACK, don't retry.
        return Result.failure(
          UseCaseError.businessRule(
            'EVENT_NOT_HANDLED_BY_DEFINITION',
            `Definition '${standardDefinition.code}' has no reaction to '${event.eventType}'.`,
          ),
        );
    }
  },
};
