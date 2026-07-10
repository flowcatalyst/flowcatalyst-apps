/**
 * THE FULFILMENT PROCESS MANAGER (first slice): reactions to pick-context
 * events, delivered by the platform subscription to /processes/fulfilment.
 *
 * One decider per inbound event (co-located — same thin shape):
 *   pick:claimed              → part pick_requested → picking
 *   pick:picked/short-picked  → part → picked|short_picked; when every viable
 *                               part is picked → fulfilment → READY +
 *                               fulfilment:picked (the transport trigger)
 *   pick:failed               → part → failed; policy decision:
 *                               allowPartialFulfilment=false → cancel sibling
 *                               parts + fulfilment FAILED (all-or-nothing);
 *                               true → continue with viable parts (failing
 *                               the fulfilment only when none remain).
 *
 * Deliveries retry, so every decider is idempotent: state guards return
 * business-rule failures the webhook ACKs (200) — only real errors 500 for a
 * platform retry. Service-scoped (no user permission), like the release sweep.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  emitEvent,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { Fulfilment, type FulfilmentPart } from '../../domain/fulfilments/fulfilment.js';
import { asFulfilmentId, asFulfilmentPartId } from '../../domain/fulfilments/ids.js';
import {
  FulfilmentFailed,
  FulfilmentPartFailed,
  FulfilmentPartPicked,
  FulfilmentPartPicking,
  FulfilmentPicked,
} from '../../domain/fulfilments/events/fulfilment-pick-progress.events.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import type { FulfilmentProcessingLogRepository } from '../../infrastructure/fulfilment-processing-log-repository.js';

export interface PickEventRef {
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly partId: string;
  readonly pickerId: string;
}

export interface PartPickedCommand extends PickEventRef {
  readonly short: boolean;
  readonly lineResults: readonly {
    externalLineRef: string;
    pickedQuantity: number;
    substitutions?: readonly {
      barcode: string;
      description: string | null;
      quantity: number;
    }[];
  }[];
}

export interface PartFailedCommand extends PickEventRef {
  readonly reason: string;
}

type LoadOutcome =
  | {
      readonly ok: true;
      readonly fulfilment: Fulfilment;
      readonly part: FulfilmentPart;
      readonly scope: Scope;
    }
  | { readonly ok: false; readonly failure: Result<never> };

async function load(repo: FulfilmentRepository, command: PickEventRef): Promise<LoadOutcome> {
  const scope = ScopeStore.require();
  const fulfilment = await repo.findById(command.clientId, asFulfilmentId(command.fulfilmentId));
  if (!fulfilment) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      ),
    };
  }
  const part = fulfilment.parts.find((p) => p.id === command.partId);
  if (!part) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.notFound('PART_NOT_FOUND', `Part '${command.partId}' does not exist.`),
      ),
    };
  }
  return { ok: true, fulfilment, part, scope };
}

function alreadyProcessed(part: FulfilmentPart): Result<never> {
  return Result.failure(
    UseCaseError.businessRule(
      'PART_TRANSITION_ALREADY_APPLIED',
      `Part '${part.id}' is '${part.status}' — event already applied or superseded.`,
      { status: part.status },
    ),
  );
}

export class RegisterPartPickingUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly fulfilments: FulfilmentRepository,
    private readonly processingLog: FulfilmentProcessingLogRepository,
  ) {}

  async execute(command: PickEventRef): Promise<Result<FulfilmentPartPicking>> {
    const loaded = await load(this.fulfilments, command);
    if (!loaded.ok) return loaded.failure;
    const { fulfilment: prior, part, scope } = loaded;
    // Only from pick_requested — a later outcome event may have raced ahead
    // (per-pick ordering doesn't order against OTHER picks' events).
    if (part.status !== 'pick_requested') return alreadyProcessed(part);

    const now = new Date();
    const fulfilment = Fulfilment.partPicking(prior, asFulfilmentPartId(command.partId), now);
    const event = new FulfilmentPartPicking(scope, {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      partId: part.id,
      shortId: part.shortId,
      pickerId: command.pickerId,
    });
    await this.processingLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      actor: scope.principalId,
      category: 'pick-progress',
      message: `Part #${part.shortId} picking started.`,
      data: { partId: part.id, pickerId: command.pickerId },
    });
    return commitAggregate(this.uow, this.registry, fulfilment, event, command);
  }
}

export class RegisterPartPickedUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly fulfilments: FulfilmentRepository,
    private readonly processingLog: FulfilmentProcessingLogRepository,
  ) {}

  async execute(command: PartPickedCommand): Promise<Result<FulfilmentPartPicked>> {
    const loaded = await load(this.fulfilments, command);
    if (!loaded.ok) return loaded.failure;
    const { fulfilment: prior, part, scope } = loaded;
    // pick_requested is allowed too — the claimed event may have been missed.
    if (part.status !== 'picking' && part.status !== 'pick_requested') {
      return alreadyProcessed(part);
    }

    const now = new Date();
    let fulfilment = Fulfilment.partPickOutcome(
      prior,
      asFulfilmentPartId(command.partId),
      command.short,
      now,
    );

    await this.processingLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      actor: scope.principalId,
      category: 'pick-progress',
      message: command.short
        ? `Part #${part.shortId} picked SHORT.`
        : `Part #${part.shortId} picked in full.`,
      data: { partId: part.id, pickerId: command.pickerId, short: command.short },
    });

    // Derivation point: everything pickable picked → READY (await transport).
    if (fulfilment.status === 'in_progress' && Fulfilment.allViablePicked(fulfilment)) {
      fulfilment = Fulfilment.markReady(fulfilment, now);
      const picked = new FulfilmentPicked(scope, {
        fulfilmentId: fulfilment.id,
        clientId: fulfilment.clientId,
        externalSource: fulfilment.externalSource,
        externalRef: fulfilment.externalRef,
        parts: Fulfilment.viableParts(fulfilment).map((p) => ({
          partId: p.id,
          shortId: p.shortId,
          short: p.status === 'short_picked',
        })),
      });
      const emitted = await emitEvent(this.uow, picked, command);
      if (isFailure(emitted)) return emitted;
      await this.processingLog.append({
        clientId: fulfilment.clientId,
        fulfilmentId: fulfilment.id,
        actor: scope.principalId,
        category: 'lifecycle',
        message: 'Fulfilment READY — all parts picked; awaiting transport.',
        data: null,
      });
    }

    const event = new FulfilmentPartPicked(scope, {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      partId: part.id,
      shortId: part.shortId,
      pickerId: command.pickerId,
      short: command.short,
      lineResults: command.lineResults.map((r) => ({
        externalLineRef: r.externalLineRef,
        pickedQuantity: r.pickedQuantity,
        ...(r.substitutions ? { substitutions: r.substitutions.map((s) => ({ ...s })) } : {}),
      })),
    });
    return commitAggregate(this.uow, this.registry, fulfilment, event, command);
  }
}

export class RegisterPartFailedUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly fulfilments: FulfilmentRepository,
    private readonly processingLog: FulfilmentProcessingLogRepository,
  ) {}

  async execute(command: PartFailedCommand): Promise<Result<FulfilmentPartFailed>> {
    const loaded = await load(this.fulfilments, command);
    if (!loaded.ok) return loaded.failure;
    const { fulfilment: prior, part, scope } = loaded;
    if (part.status !== 'picking' && part.status !== 'pick_requested') {
      return alreadyProcessed(part);
    }

    const now = new Date();
    let fulfilment = Fulfilment.partFailed(prior, asFulfilmentPartId(command.partId), now);

    await this.processingLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      actor: scope.principalId,
      category: 'pick-progress',
      message: `Part #${part.shortId} pick FAILED: ${command.reason}`,
      data: { partId: part.id, pickerId: command.pickerId, reason: command.reason },
    });

    // The policy decision (docs/fulfilment-context.md):
    const allOrNothing = !fulfilment.policies.allowPartialFulfilment;
    const viable = Fulfilment.viableParts(fulfilment);
    const shouldFail = allOrNothing || viable.length === 0;
    if (fulfilment.status === 'in_progress' && shouldFail) {
      fulfilment = Fulfilment.failFulfilment(fulfilment, now);
      const reason = allOrNothing
        ? `Part #${part.shortId} failed and the fulfilment is all-or-nothing: ${command.reason}`
        : `No viable parts remain (last failure: ${command.reason})`;
      const failed = new FulfilmentFailed(scope, {
        fulfilmentId: fulfilment.id,
        clientId: fulfilment.clientId,
        externalSource: fulfilment.externalSource,
        externalRef: fulfilment.externalRef,
        reason,
      });
      const emitted = await emitEvent(this.uow, failed, command);
      if (isFailure(emitted)) return emitted;
      await this.processingLog.append({
        clientId: fulfilment.clientId,
        fulfilmentId: fulfilment.id,
        actor: scope.principalId,
        category: 'lifecycle',
        message: `Fulfilment FAILED — ${reason}`,
        data: null,
      });
    } else if (fulfilment.status === 'in_progress' && Fulfilment.allViablePicked(fulfilment)) {
      // Partial allowed and the remaining parts are already picked → ready.
      fulfilment = Fulfilment.markReady(fulfilment, now);
      const picked = new FulfilmentPicked(scope, {
        fulfilmentId: fulfilment.id,
        clientId: fulfilment.clientId,
        externalSource: fulfilment.externalSource,
        externalRef: fulfilment.externalRef,
        parts: Fulfilment.viableParts(fulfilment).map((p) => ({
          partId: p.id,
          shortId: p.shortId,
          short: p.status === 'short_picked',
        })),
      });
      const emitted = await emitEvent(this.uow, picked, command);
      if (isFailure(emitted)) return emitted;
      await this.processingLog.append({
        clientId: fulfilment.clientId,
        fulfilmentId: fulfilment.id,
        actor: scope.principalId,
        category: 'lifecycle',
        message: 'Fulfilment READY — remaining viable parts picked; awaiting transport.',
        data: null,
      });
    }

    const event = new FulfilmentPartFailed(scope, {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      partId: part.id,
      shortId: part.shortId,
      pickerId: command.pickerId,
      reason: command.reason,
    });
    return commitAggregate(this.uow, this.registry, fulfilment, event, command);
  }
}
