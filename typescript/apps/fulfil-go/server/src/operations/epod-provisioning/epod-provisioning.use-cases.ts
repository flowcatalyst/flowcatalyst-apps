/**
 * EPOD master-data pre-provisioning (docs/transport-context.md "EPOD
 * integration plan", docs/epod-integration-notes.md).
 *
 * Two halves of one loop:
 *
 *   RequestEpodProvisioningUseCase — the PROCESS-MANAGER DECIDER on
 *   `fulfilment:created`: when any origin store's settings select the EPOD
 *   execution system, create the provisioning DISPATCH JOB (outbox →
 *   platform → HMAC POST back to /clients/:id/epod/provision). Exactly-once
 *   guard: there is no part/fulfilment transition to lean on, so the
 *   PROCESSING LOG is the state guard — an 'epod-provision-dispatched'
 *   entry is checked before and appended with the outbox write in the SAME
 *   tx (runWrite). Replays hit the guard and get ACKed; a concurrent
 *   double-delivery is additionally deduped platform-side by the dispatch
 *   job's idempotency key.
 *
 *   ProvisionEpodUseCase — the dispatch job's TARGET: push the delivery
 *   destination + all parts' products to EPOD's upsert endpoints.
 *   Idempotent BY CONSTRUCTION (their upserts key on reference), so replays
 *   are safe and no local guard is needed. The EPOD HTTP calls happen
 *   OUTSIDE any db tx (house rule: keep write txs short); the activity-log
 *   record is appended best-effort afterwards. EPOD/API errors
 *   propagate → the route 500s → the platform retries.
 */
import { CreateDispatchJobDto, type OutboxManager } from '@flowcatalyst/sdk';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  Result,
  ScopeStore,
  UseCaseError,
  emitEvent,
  eventGroup,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { asFulfilmentId } from '../../domain/fulfilments/ids.js';
import { FulfilmentEpodProvisionRequested } from '../../domain/fulfilments/events/fulfilment-epod-provision-requested.event.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import { loadStoreSettingsResolver } from '../../infrastructure/store-settings-resolver.js';
import type { EpodClient } from '../../transport/epod/client.js';
import {
  toEpodDestinationLocation,
  toEpodProducts,
} from '../../transport/epod/provisioning-mapper.js';
import type { EpodUpsertResponse } from '../../transport/epod/types.js';

export const EPOD_EXECUTION_SYSTEM = 'epod' as const;
/** Processing-log category that doubles as the dispatch state guard. */
export const EPOD_PROVISION_DISPATCHED_CATEGORY = 'epod-provision-dispatched' as const;

export interface EpodProvisioningCommand {
  readonly clientId: string;
  readonly fulfilmentId: string;
}

export interface EpodDispatchConfig {
  /** Base URL the platform's dispatcher calls back into (provision target). */
  readonly publicBaseUrl: string;
  readonly dispatchPoolCode: string;
}

export class RequestEpodProvisioningUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly db: PostgresJsDatabase,
    private readonly fulfilments: FulfilmentRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly outbox: OutboxManager,
    private readonly dispatch: EpodDispatchConfig,
  ) {}

  async execute(
    command: EpodProvisioningCommand,
  ): Promise<Result<FulfilmentEpodProvisionRequested>> {
    const scope = ScopeStore.require();

    const fulfilment = await this.fulfilments.findById(
      command.clientId,
      asFulfilmentId(command.fulfilmentId),
    );
    if (!fulfilment) {
      return Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      );
    }

    // State guard (same tx as the writes below): dispatched once, ever.
    if (await this.activityLog.hasEntry(fulfilment.id, EPOD_PROVISION_DISPATCHED_CATEGORY)) {
      return Result.failure(
        UseCaseError.businessRule(
          'EPOD_PROVISION_ALREADY_DISPATCHED',
          `EPOD provisioning already dispatched for fulfilment '${fulfilment.id}'.`,
        ),
      );
    }

    const originRefs = [...new Set(fulfilment.parts.map((p) => p.origin.ref))];
    const resolver = await loadStoreSettingsResolver(this.db, fulfilment.clientId, originRefs);
    const epodOrigins = originRefs.filter((ref) => {
      const settings = resolver.resolve(ref);
      return (
        settings.executionSystems.includes(EPOD_EXECUTION_SYSTEM) ||
        settings.defaultExecutionSystem === EPOD_EXECUTION_SYSTEM
      );
    });
    if (epodOrigins.length === 0) {
      return Result.failure(
        UseCaseError.businessRule(
          'EPOD_NOT_CONFIGURED_FOR_STORES',
          `No origin store of fulfilment '${fulfilment.id}' runs the EPOD execution system.`,
          { originRefs },
        ),
      );
    }

    const dispatchJob = CreateDispatchJobDto.create(
      'fulfil-go:fulfilment',
      'epod-provision',
      `${this.dispatch.publicBaseUrl}/clients/${fulfilment.clientId}/epod/provision`,
      { fulfilmentId: fulfilment.id },
      this.dispatch.dispatchPoolCode,
    )
      .withSubject(`fulfilment.${fulfilment.id}`)
      .withMessageGroup(eventGroup('fulfilment', fulfilment.id))
      // NOTE: no .withMetadata() — the TS SDK serializes metadata as an
      // OBJECT but the Go platform requires [{key,value}] (SDK bug, flagged).
      .withIdempotencyKey(`epod-provision-${fulfilment.id}`);

    // Joins the ambient use-case tx via the ALS-aware outbox driver — the
    // job, the guard entry and the event commit (or roll back) together.
    await this.outbox.createDispatchJob(dispatchJob);

    await this.activityLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      subjectType: 'fulfilment',
      subjectId: fulfilment.id,
      source: 'domain',
      actor: scope.principalId,
      category: EPOD_PROVISION_DISPATCHED_CATEGORY,
      message: `EPOD provisioning dispatched (origin store${epodOrigins.length === 1 ? '' : 's'} ${epodOrigins.join(', ')}).`,
      data: { epodOrigins, originRefs },
    });

    const event = new FulfilmentEpodProvisionRequested(scope, {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      originRefs: epodOrigins,
    });
    return emitEvent(this.uow, event, command);
  }
}

interface UpsertSummary {
  readonly count: number;
  readonly created: number;
  readonly updated: number;
  readonly restored: number;
  readonly failed: number;
}

export type ProvisionEpodOutcome =
  | {
      readonly kind: 'provisioned';
      readonly locations: UpsertSummary | null;
      readonly products: UpsertSummary | null;
      /** Destination skipped (collect fulfilment, or no coordinates). */
      readonly destinationSkipped: string | null;
    }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'not_found' };

function summarize(count: number, response: EpodUpsertResponse): UpsertSummary {
  return {
    count,
    created: response.created_count,
    updated: response.updated_count,
    restored: response.restored_count,
    failed: response.failed_count,
  };
}

export class ProvisionEpodUseCase {
  constructor(
    private readonly fulfilments: FulfilmentRepository,
    private readonly activityLog: ActivityLogRepository,
    /** null = FULFILGO_EPOD_BASE_URL / _TENANT_CODE unset (dev) — log + skip. */
    private readonly client: EpodClient | null,
  ) {}

  /**
   * NOT the Result/commitAggregate shape on purpose: the EPOD HTTP calls
   * must run OUTSIDE any db tx, and the only local write is a best-effort
   * activity-log record appended after the response — so this returns a
   * plain outcome. EpodApiError/network failures THROW so the route can 500
   * for a platform retry.
   */
  async execute(command: EpodProvisioningCommand): Promise<ProvisionEpodOutcome> {
    const scope = ScopeStore.require();

    const fulfilment = await this.fulfilments.findById(
      command.clientId,
      asFulfilmentId(command.fulfilmentId),
    );
    if (!fulfilment) return { kind: 'not_found' };

    // Best-effort-after (docs/activity-log.md): there is no shared tx with
    // EPOD — the record of the external interaction must never fail it.
    const appendLog = (category: string, message: string, data: unknown): Promise<void> =>
      this.activityLog.appendDetached({
        clientId: fulfilment.clientId,
        fulfilmentId: fulfilment.id,
        subjectType: 'fulfilment',
        subjectId: fulfilment.id,
        source: 'epod',
        actor: scope.principalId,
        category,
        message,
        data,
      });

    if (!this.client) {
      const reason =
        'EPOD client not configured (FULFILGO_EPOD_BASE_URL / FULFILGO_EPOD_TENANT_CODE unset)';
      await appendLog('integration', `EPOD provisioning SKIPPED — ${reason}.`, null);
      return { kind: 'skipped', reason };
    }

    const destination = toEpodDestinationLocation(fulfilment);
    const destinationSkipped =
      destination !== null
        ? null
        : fulfilment.type === 'delivery'
          ? 'destination has no coordinates — EPOD locations require latitude/longitude'
          : 'collect fulfilment — collection points are store-side topology, not provisioned';
    const products = toEpodProducts(fulfilment.parts);

    // Idempotent upserts on their side — replays converge, no local guard.
    const locationResult = destination ? await this.client.upsertLocations([destination]) : null;
    const productResult = products.length > 0 ? await this.client.upsertProducts(products) : null;

    const locations = locationResult ? summarize(1, locationResult) : null;
    const productSummary = productResult ? summarize(products.length, productResult) : null;
    await appendLog(
      'integration',
      `EPOD provisioned: ${
        locations
          ? `1 destination (${locations.created} created/${locations.updated} updated)`
          : `destination skipped (${destinationSkipped ?? 'n/a'})`
      }, ${
        productSummary
          ? `${productSummary.count} product(s) (${productSummary.created} created/${productSummary.updated} updated, ${productSummary.failed} failed)`
          : 'no products'
      }.`,
      { locations, products: productSummary, destinationSkipped },
    );

    return { kind: 'provisioned', locations, products: productSummary, destinationSkipped };
  }
}
