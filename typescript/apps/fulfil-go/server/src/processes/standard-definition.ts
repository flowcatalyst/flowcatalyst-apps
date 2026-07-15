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
import type { FulfilmentPickedData } from '../domain/fulfilments/events/fulfilment-pick-progress.events.js';
import type { TransportOrderEventData } from '../domain/transport-orders/events/transport-order.events.js';
import type { PickCarFlagUpdatedData } from '../domain/picks/events/pick-car-flag.event.js';
import type { PickClaimedData } from '../domain/picks/events/pick-claimed.event.js';
import type {
  PickFailedData,
  PickOutcomeData,
} from '../domain/picks/events/pick-outcome.events.js';
import { STANDARD_PROCESS_DEFINITION } from '@fulfil-go/shared';
import type { ProcessDefinition, ProcessEvent, ProcessCommands } from './process-registry.js';

const HANDLES = [
  'fulfil-go:fulfilment:fulfilment:created',
  'fulfil-go:fulfilment:fulfilment:picked',
  'fulfil-go:pick:pick:claimed',
  'fulfil-go:pick:pick:picked',
  'fulfil-go:pick:pick:short-picked',
  'fulfil-go:pick:pick:failed',
  'fulfil-go:pick:pick:car-flag-updated',
  'fulfil-go:transport:order:delivered',
  'fulfil-go:transport:order:failed',
  'fulfil-go:transport:order:cancelled',
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

      case 'fulfil-go:fulfilment:fulfilment:picked': {
        // Fulfilment READY → the transport trigger. THE standard timing
        // policy: ASAP requests immediately; STANDARD books a timed
        // reaction at slotStart − transportLeadTime (reactions sweep).
        const data = event.payload as FulfilmentPickedData;
        return data.serviceLevel === 'ASAP'
          ? commands.requestTransport.execute({
              clientId: event.clientId,
              fulfilmentId: event.fulfilmentId,
            })
          : commands.scheduleTransportRequest.execute({
              clientId: event.clientId,
              fulfilmentId: event.fulfilmentId,
            });
      }

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
          requiresCarOrLarger: data.requiresCarOrLarger ?? false,
          lineResults: data.lineResults.map((r) => ({
            externalLineRef: r.externalLineRef,
            pickedQuantity: r.pickedQuantity,
            ...(r.substitutions ? { substitutions: r.substitutions } : {}),
          })),
          packages: data.packages ?? [],
        });
      }

      case 'fulfil-go:pick:pick:car-flag-updated': {
        // Supervisor flag on a COMPLETED pick → re-stamp the part while
        // transport hasn't been requested (pre-completion flags simply ride
        // the completion actuals — the decider ACKs those).
        const data = event.payload as PickCarFlagUpdatedData;
        return commands.registerPartCarFlag.execute({
          clientId: event.clientId,
          fulfilmentId: event.fulfilmentId,
          partId: data.partId,
          requiresCarOrLarger: data.requiresCarOrLarger,
          pickStatus: data.pickStatus,
        });
      }

      case 'fulfil-go:transport:order:delivered':
      case 'fulfil-go:transport:order:failed':
      case 'fulfil-go:transport:order:cancelled': {
        // THE COMPLETION LEG: the transport order's terminal outcome lands
        // on the part; the command owns the completing → completed/
        // partially_completed/failed derivation.
        const data = event.payload as TransportOrderEventData;
        return commands.registerPartDelivery.execute({
          clientId: event.clientId,
          fulfilmentId: event.fulfilmentId,
          partId: data.partId,
          transportOrderId: data.transportOrderId,
          provider: data.provider,
          delivered: event.eventType === 'fulfil-go:transport:order:delivered',
          ...(data.reason ? { reason: data.reason } : {}),
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
