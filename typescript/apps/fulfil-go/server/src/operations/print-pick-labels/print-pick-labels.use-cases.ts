import type { PickSessionProjection } from '../../infrastructure/pick-session-projection.js';
/**
 * Bag-label printing (docs/bag-label-printing.md) — claimer-only operations
 * on the Pick aggregate, sharing report-pick-outcome's authorize-and-load
 * guard (and its ReportPickOutcome permission: printing labels is part of
 * packing). The server allocates refs and renders ZPL; DELIVERY to the LAN
 * printer is the picking app's job and best-effort — anything that didn't
 * come out of the printer is a reprint away.
 */
import {
  Result,
  UseCaseError,
  brandedTsid,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import type {
  AllocatePickLabelsCommand,
  PickLabelAllocation,
  ReprintPickLabelCommand,
} from '@fulfil-go/shared';
import { Pick } from '../../domain/picks/pick.js';
import {
  DEFAULT_LABEL_DIMENSIONS,
  renderBagLabelZpl,
  type LabelDimensions,
} from '../../domain/picks/label-zpl.js';
import {
  PickLabelsUpdated,
  type PickLabelsUpdatedData,
} from '../../domain/picks/events/pick-labels.event.js';
import type { PickRepository } from '../../domain/picks/pick.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import type { PrinterRepository } from '../../infrastructure/printer-repository.js';
import { authorizeAndLoad } from '../report-pick-outcome/report-pick-outcome.use-cases.js';

export interface PickLabelDocumentResult {
  readonly seq: number;
  readonly ref: string;
  readonly zpl: string;
}

export interface PickLabelsResult {
  readonly pickId: string;
  readonly allocation: PickLabelAllocation;
  readonly documents: readonly PickLabelDocumentResult[];
}

type DimensionsOutcome =
  | { readonly ok: true; readonly dims: LabelDimensions }
  | { readonly ok: false; readonly failure: Result<never> };

/**
 * Resolve the label dimensions the ZPL is rendered for. `printerId` must be
 * one of the pick's store's printers — a station can't render against
 * another store's equipment; omitted = default dimensions (station prints
 * without a registered printer selected, e.g. Browser Print in dev).
 */
async function resolveDimensions(
  printers: PrinterRepository,
  clientId: string,
  storeRef: string,
  printerId: string | undefined,
): Promise<DimensionsOutcome> {
  if (!printerId) return { ok: true, dims: DEFAULT_LABEL_DIMENSIONS };
  const printer = await printers.findById(clientId, printerId);
  if (!printer || printer.storeRef !== storeRef) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.notFound(
          'PRINTER_NOT_FOUND',
          `Printer '${printerId}' does not exist at store '${storeRef}'.`,
        ),
      ),
    };
  }
  if (!printer.active) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.businessRule('PRINTER_INACTIVE', `Printer '${printer.name}' is inactive.`),
      ),
    };
  }
  return {
    ok: true,
    dims: {
      widthMm: printer.labelWidthMm,
      heightMm: printer.labelHeightMm,
      dpi: printer.dpi,
    },
  };
}

function renderAll(pick: Pick, dims: LabelDimensions): PickLabelDocumentResult[] {
  const allocation = pick.labels;
  if (!allocation) return [];
  return allocation.labels.map((label) => ({
    seq: label.seq,
    ref: label.ref,
    zpl: renderBagLabelZpl(
      {
        shortId: pick.shortId,
        storeRef: pick.storeRef,
        slotStart: pick.slotStart,
        timezone: pick.timezone,
        ref: label.ref,
        seq: label.seq,
        count: allocation.count,
      },
      dims,
    ),
  }));
}

/**
 * Allocate (first print) or replace (count changed) or re-render (same
 * count) the pick's bag-label set. Returns the allocation plus rendered ZPL
 * for EVERY active label — on a replace the "n / X" totals change, so the
 * whole set re-prints; kept seqs keep their refs, so bags already scanned
 * into the trolley stay valid.
 */
export class AllocatePickLabelsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly picks: PickRepository,
    private readonly printers: PrinterRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly pickSessions: PickSessionProjection,
  ) {}

  async execute(command: AllocatePickLabelsCommand): Promise<Result<PickLabelsResult>> {
    const loaded = await authorizeAndLoad(this.picks, command);
    if (!loaded.ok) return loaded.failure;
    const { pick: prior, scope } = loaded;

    const dims = await resolveDimensions(
      this.printers,
      command.clientId,
      prior.storeRef,
      command.printerId,
    );
    if (!dims.ok) return dims.failure;

    const priorCount = prior.labels?.count ?? null;
    const action: PickLabelsUpdatedData['action'] =
      priorCount === null ? 'allocated' : priorCount === command.count ? 'reprinted' : 'replaced';

    const now = new Date();
    const pick = Pick.setLabelCount(prior, command.count, () => brandedTsid('pkg'), now);
    const allocation = pick.labels!;

    const event = new PickLabelsUpdated(scope, {
      pickId: pick.id,
      clientId: pick.clientId,
      storeRef: pick.storeRef,
      fulfilmentId: pick.fulfilmentId,
      partId: pick.partId,
      shortId: pick.shortId,
      pickerId: scope.principalId,
      action,
      count: allocation.count,
      labels: allocation.labels.map((l) => ({ ...l })),
      voidedRefs: [...allocation.voidedRefs],
    });

    const message =
      action === 'allocated'
        ? `Part #${pick.shortId} bag labels printed (${allocation.count}) at ${pick.storeRef}.`
        : action === 'replaced'
          ? `Part #${pick.shortId} bag labels replaced: ${allocation.count} (was ${priorCount}) at ${pick.storeRef}.`
          : `Part #${pick.shortId} bag labels reprinted (all ${allocation.count}) at ${pick.storeRef}.`;
    await this.activityLog.append({
      clientId: pick.clientId,
      fulfilmentId: pick.fulfilmentId,
      subjectType: 'pick',
      subjectId: pick.id,
      source: 'domain',
      actor: scope.principalId,
      category: 'label-print',
      message,
      data: { pickId: pick.id, partId: pick.partId, action, count: allocation.count },
    });

    // Projection row rides the same tx (docs/projections.md).
    await this.pickSessions.upsert(pick);

    const committed = await commitAggregate(this.uow, this.registry, pick, event, command);
    return Result.map(committed, () => ({
      pickId: pick.id,
      allocation,
      documents: renderAll(pick, dims.dims),
    }));
  }
}

/** Reprint ONE damaged label — same ref, same barcode; the reprint is recorded. */
export class ReprintPickLabelUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly picks: PickRepository,
    private readonly printers: PrinterRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly pickSessions: PickSessionProjection,
  ) {}

  async execute(command: ReprintPickLabelCommand): Promise<Result<PickLabelsResult>> {
    const loaded = await authorizeAndLoad(this.picks, command);
    if (!loaded.ok) return loaded.failure;
    const { pick: prior, scope } = loaded;

    const allocation = prior.labels;
    const label = allocation?.labels.find((l) => l.seq === command.seq);
    if (!allocation || !label) {
      return Result.failure(
        UseCaseError.notFound(
          'LABEL_NOT_FOUND',
          `Pick '${prior.id}' has no bag label ${command.seq}.`,
        ),
      );
    }

    const dims = await resolveDimensions(
      this.printers,
      command.clientId,
      prior.storeRef,
      command.printerId,
    );
    if (!dims.ok) return dims.failure;

    const now = new Date();
    const pick = Pick.recordLabelReprint(prior, command.seq, now);
    const updated = pick.labels!;

    const event = new PickLabelsUpdated(scope, {
      pickId: pick.id,
      clientId: pick.clientId,
      storeRef: pick.storeRef,
      fulfilmentId: pick.fulfilmentId,
      partId: pick.partId,
      shortId: pick.shortId,
      pickerId: scope.principalId,
      action: 'reprinted',
      count: updated.count,
      labels: updated.labels.map((l) => ({ ...l })),
      voidedRefs: [...updated.voidedRefs],
      seq: command.seq,
    });

    // Chain-relevant once the bag is part of a completed pick: the reprint
    // trail explains duplicate-looking labels at handover.
    await this.activityLog.append({
      clientId: pick.clientId,
      fulfilmentId: pick.fulfilmentId,
      subjectType: 'pick',
      subjectId: pick.id,
      source: 'domain',
      actor: scope.principalId,
      category: 'label-print',
      message: `Part #${pick.shortId} bag label ${command.seq}/${updated.count} reprinted at ${pick.storeRef}.`,
      data: { pickId: pick.id, partId: pick.partId, action: 'reprinted', seq: command.seq },
    });

    await this.pickSessions.upsert(pick);

    const committed = await commitAggregate(this.uow, this.registry, pick, event, command);
    return Result.map(committed, () => ({
      pickId: pick.id,
      allocation: updated,
      documents: renderAll(pick, dims.dims).filter((d) => d.seq === command.seq),
    }));
  }
}
