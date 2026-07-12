import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { FulfilGoPermission } from '@fulfil-go/shared';
import { Fulfilment, type CreateFulfilmentPartInput } from '../../domain/fulfilments/fulfilment.js';
import { newFulfilmentId, newFulfilmentPartId } from '../../domain/fulfilments/ids.js';
import { FulfilmentCreated } from '../../domain/fulfilments/events/fulfilment-created.event.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import type { FulfilmentProcessingLogRepository } from '../../infrastructure/fulfilment-processing-log-repository.js';
import { serviceDayOf, type ShortIdAllocator } from '../../infrastructure/short-id-allocator.js';
import type { CreateFulfilmentCommand } from './create-fulfilment.command.js';

/**
 * Resolves the pick lead time (minutes before slotStart) for a part's
 * origin store — backed by store-profile resolution in app-context. Only
 * consulted when the command does NOT carry pickLeadTimeMinutes: an
 * upstream system managing its own settings sends the value and wins.
 */
export type PickLeadTimeResolver = (
  clientId: string,
  storeRef: string,
  type: 'delivery' | 'collect',
) => Promise<number>;

export class CreateFulfilmentUseCase {
  static readonly requiredPermission = FulfilGoPermission.CreateFulfilment;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly fulfilments: FulfilmentRepository,
    private readonly shortIds: ShortIdAllocator,
    private readonly processingLog: FulfilmentProcessingLogRepository,
    private readonly pickLeadTime: PickLeadTimeResolver,
  ) {}

  async execute(command: CreateFulfilmentCommand): Promise<Result<FulfilmentCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.CreateFulfilment}.`,
        ),
      );
    }

    const slotStart = new Date(command.slotStart);
    const slotEnd = new Date(command.slotEnd);
    if (!(slotEnd.getTime() > slotStart.getTime())) {
      return Result.failure(
        UseCaseError.validation('SLOT_INVALID', 'slotEnd must be after slotStart.'),
      );
    }
    if (!isValidTimezone(command.timezone)) {
      return Result.failure(
        UseCaseError.validation(
          'TIMEZONE_INVALID',
          `'${command.timezone}' is not a valid IANA timezone.`,
        ),
      );
    }
    if (command.destination.kind !== command.type) {
      return Result.failure(
        UseCaseError.validation(
          'DESTINATION_TYPE_MISMATCH',
          `A '${command.type}' fulfilment requires a '${command.type}' destination.`,
        ),
      );
    }

    // Create-idempotency: one fulfilment per upstream reference. The unique
    // index on (client_id, external_source, external_ref) backstops races.
    const existing = await this.fulfilments.findByExternalRef(
      command.clientId,
      command.externalSource,
      command.externalRef,
    );
    if (existing) {
      return Result.failure(
        UseCaseError.businessRule(
          'FULFILMENT_ALREADY_EXISTS',
          `A fulfilment for ${command.externalSource}/${command.externalRef} already exists.`,
          { fulfilmentId: existing.id },
        ),
      );
    }

    const now = new Date();
    const id = newFulfilmentId();
    const serviceDay = serviceDayOf(slotStart, command.timezone);

    // Pick release time (precomputed once — slots are immutable, per PART):
    // ASAP releases immediately; STANDARD releases leadTime before the slot.
    // Lead time source: explicit command value wins (an upstream system
    // managing its own settings just sends it); otherwise hydrated from the
    // part's origin STORE PROFILE (default profile carries global config).
    // A past releaseAt is fine — the sweep releases it on its next tick
    // (Andrew's rule: always release, log late).
    const parts: CreateFulfilmentPartInput[] = [];
    for (const partInput of command.parts) {
      const leadMinutes =
        command.pickLeadTimeMinutes ??
        (await this.pickLeadTime(command.clientId, partInput.origin.ref, command.type));
      parts.push({
        id: newFulfilmentPartId(),
        releaseAt:
          command.serviceLevel === 'ASAP'
            ? now
            : new Date(slotStart.getTime() - leadMinutes * 60_000),
        shortId: await this.shortIds.allocate(command.clientId, partInput.origin.ref, serviceDay),
        origin: partInput.origin,
        lines: partInput.lines,
      });
    }

    const fulfilment = Fulfilment.create({
      id,
      clientId: command.clientId,
      externalSource: command.externalSource,
      externalRef: command.externalRef,
      type: command.type,
      serviceLevel: command.serviceLevel,
      slotStart,
      slotEnd,
      timezone: command.timezone,
      destination: command.destination,
      policies: command.policies,
      provenance: command.provenance ?? null,
      additionalData: command.additionalData ?? null,
      parts,
      now,
    });

    const event = new FulfilmentCreated(scope, {
      fulfilmentId: id,
      clientId: command.clientId,
      externalSource: command.externalSource,
      externalRef: command.externalRef,
      type: command.type,
      serviceLevel: command.serviceLevel,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      parts: fulfilment.parts.map((part) => ({
        partId: part.id,
        shortId: part.shortId,
        originRef: part.origin.ref,
      })),
    });

    // Same tx as the aggregate + outbox writes — rolls back together.
    await this.processingLog.append({
      clientId: command.clientId,
      fulfilmentId: id,
      actor: scope.principalId,
      category: 'lifecycle',
      message: `Fulfilment created (${command.type}, ${command.serviceLevel}) with ${parts.length} part(s).`,
      data: {
        externalSource: command.externalSource,
        externalRef: command.externalRef,
        pickLeadTimeMinutesSource:
          command.pickLeadTimeMinutes !== undefined
            ? `command:${command.pickLeadTimeMinutes}`
            : 'store-profile',
        parts: fulfilment.parts.map((p) => ({
          partId: p.id,
          shortId: p.shortId,
          releaseAt: p.releaseAt.toISOString(),
        })),
      },
    });

    return commitAggregate(this.uow, this.registry, fulfilment, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateFulfilmentUseCase.requiredPermission);
  }
}

function isValidTimezone(timezone: string): boolean {
  try {
    return Intl.DateTimeFormat('en-CA', { timeZone: timezone }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}
