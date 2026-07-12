import { and, between, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { fulfilments } from '../../../infrastructure/schema/fulfilments.js';
import { fulfilmentParts } from '../../../infrastructure/schema/fulfilment-parts.js';
import { picks } from '../../../infrastructure/schema/picks.js';
import { loadStoreSettingsResolver } from '../../../infrastructure/store-settings-resolver.js';

/**
 * Operational flightboard: one read across fulfilments + parts + picks in
 * the ±24h slot window, aggregated in process (dev-scale; the seam for a
 * materialized view is this module's return shape).
 *
 * Exception thresholds come from STORE-PROFILE resolution (shared
 * StoreSettingsSchema; defaults ⇐ default profile ⇐ store profile ⇐ store
 * overrides) — observation settings resolve LIVE, so retuning re-evaluates
 * everything in flight:
 * - release_overdue: part still `pending` past releaseAt — the platform
 *   release cron missed it (a real failure mode we've seen).
 * - pick_late_unclaimed: pick `requested` and (older than the claim SLA OR
 *   too close to slot start).
 * - pick_late_incomplete: pick `claimed` and too close to slot start. NB
 *   the server cannot distinguish "claimed but not started" from "started
 *   but unfinished" — per-line WIP lives on the station until
 *   pick-into-bag-directly lands pick_lines as rows.
 * Transport exception kinds are reserved; they land with the transport
 * context (there is no transport data yet).
 */
const MINUTE_MS = 60_000;

const BOARD_EXCLUDED_STATUSES = new Set([
  'completed',
  'partially_completed',
  'cancelled',
  'failed',
]);

export type FlightboardExceptionKind =
  | 'release_overdue'
  | 'pick_late_unclaimed'
  | 'pick_late_incomplete'
  | 'transport_late_unclaimed' // reserved — transport context
  | 'transport_late_unstarted' // reserved
  | 'transport_late_incomplete'; // reserved

export interface FlightboardException {
  kind: FlightboardExceptionKind;
  fulfilmentId: string;
  externalRef: string;
  partShortId: string;
  storeRef: string;
  serviceLevel: string;
  slotStart: string;
  /** Minutes since the exception condition began. */
  sinceMinutes: number;
  detail: string;
}

export interface FlightboardPartRow {
  shortId: string;
  storeRef: string;
  status: string;
  pickStatus: string | null;
  pickClaimedAt: string | null;
  exceptions: FlightboardExceptionKind[];
}

export interface FlightboardRow {
  id: string;
  externalRef: string;
  type: string;
  serviceLevel: string;
  status: string;
  slotStart: string;
  slotEnd: string;
  stores: string[];
  parts: FlightboardPartRow[];
  exceptions: FlightboardExceptionKind[];
}

export interface FlightboardKpis {
  totalOrders: number;
  totalPicked: number;
  totalFailed: number;
  /** null until the transport context exists — no delivery data yet. */
  totalDelivered: number | null;
  pickedOnTimePct: number | null;
  pickedInFullPct: number | null;
  onTimePct: number | null; // transport-dependent
  otifPct: number | null; // transport-dependent
}

export interface FlightboardResult {
  windowStart: string;
  windowEnd: string;
  kpis: FlightboardKpis;
  exceptions: FlightboardException[];
  board: FlightboardRow[];
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function minutesSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MINUTE_MS));
}

export async function queryFlightboard(
  db: PostgresJsDatabase,
  clientId: string,
  storeRefs: readonly string[] | undefined,
  now: Date = new Date(),
): Promise<FlightboardResult> {
  const windowStart = new Date(now.getTime() - 24 * 60 * MINUTE_MS);
  const windowEnd = new Date(now.getTime() + 24 * 60 * MINUTE_MS);
  const settingsResolver = await loadStoreSettingsResolver(db, clientId);

  const fulfilmentRows = await db
    .select()
    .from(fulfilments)
    .where(
      and(
        eq(fulfilments.clientId, clientId),
        between(fulfilments.slotStart, windowStart, windowEnd),
      ),
    )
    .orderBy(fulfilments.slotStart)
    .limit(1000);

  const ids = fulfilmentRows.map((f) => f.id);
  const partRows = ids.length
    ? await db.select().from(fulfilmentParts).where(inArray(fulfilmentParts.fulfilmentId, ids))
    : [];
  const partIds = partRows.map((p) => p.id);
  const pickRows = partIds.length
    ? await db.select().from(picks).where(inArray(picks.partId, partIds))
    : [];

  const picksByPart = new Map(pickRows.map((p) => [p.partId, p]));
  const partsByFulfilment = new Map<string, typeof partRows>();
  for (const part of partRows) {
    const list = partsByFulfilment.get(part.fulfilmentId) ?? [];
    list.push(part);
    partsByFulfilment.set(part.fulfilmentId, list);
  }

  // Store filter: a fulfilment matches when ANY part is at a selected store.
  const storeSet = storeRefs && storeRefs.length > 0 ? new Set(storeRefs) : null;
  const visible = fulfilmentRows.filter((f) => {
    if (!storeSet) return true;
    return (partsByFulfilment.get(f.id) ?? []).some((p) => storeSet.has(p.originRef));
  });

  // ── KPIs (whole window, terminal statuses included) ─────────────────────
  const nonCancelled = visible.filter((f) => f.status !== 'cancelled' && f.status !== 'cancelling');
  const picked = nonCancelled.filter((f) =>
    ['ready', 'completing', 'completed', 'partially_completed'].includes(f.status),
  );
  const failed = nonCancelled.filter((f) => f.status === 'failed');

  const windowPartIds = new Set(
    visible.flatMap((f) => (partsByFulfilment.get(f.id) ?? []).map((p) => p.id)),
  );
  const completedPicks = pickRows.filter(
    (p) =>
      windowPartIds.has(p.partId) &&
      (p.status === 'picked' || p.status === 'short_picked') &&
      p.completedAt !== null,
  );
  const onTimePicks = completedPicks.filter(
    (p) => (p.completedAt?.getTime() ?? Infinity) <= p.slotStart.getTime(),
  );
  const fullPicks = completedPicks.filter((p) => p.status === 'picked');

  // ── Exceptions + board ───────────────────────────────────────────────────
  const exceptions: FlightboardException[] = [];
  const board: FlightboardRow[] = [];

  for (const f of visible) {
    if (BOARD_EXCLUDED_STATUSES.has(f.status)) continue;
    const parts = partsByFulfilment.get(f.id) ?? [];
    const partViews: FlightboardPartRow[] = [];
    const rowKinds = new Set<FlightboardExceptionKind>();

    for (const part of parts) {
      const pick = picksByPart.get(part.id);
      const settings = settingsResolver.resolve(part.originRef);
      const partKinds: FlightboardExceptionKind[] = [];

      const push = (kind: FlightboardExceptionKind, since: Date, detail: string): void => {
        partKinds.push(kind);
        rowKinds.add(kind);
        exceptions.push({
          kind,
          fulfilmentId: f.id,
          externalRef: f.externalRef,
          partShortId: part.shortId,
          storeRef: part.originRef,
          serviceLevel: f.serviceLevel,
          slotStart: f.slotStart.toISOString(),
          sinceMinutes: minutesSince(since, now),
          detail,
        });
      };

      if (
        part.status === 'pending' &&
        now.getTime() > part.releaseAt.getTime() + settings.releaseOverdueMinutes * MINUTE_MS
      ) {
        push(
          'release_overdue',
          part.releaseAt,
          'Part past releaseAt but never released — check the platform release cron.',
        );
      }

      if (pick && pick.status === 'requested') {
        const staleClaim =
          now.getTime() > pick.createdAt.getTime() + settings.pickClaimSlaMinutes * MINUTE_MS;
        const urgent =
          f.slotStart.getTime() - now.getTime() <
          settings.pickClaimUrgentBeforeSlotMinutes * MINUTE_MS;
        if (staleClaim || urgent) {
          push(
            'pick_late_unclaimed',
            pick.createdAt,
            urgent ? 'Unclaimed with the slot imminent.' : 'Unclaimed past the claim SLA.',
          );
        }
      }

      if (
        pick &&
        pick.status === 'claimed' &&
        f.slotStart.getTime() - now.getTime() <
          settings.pickingDeadlineBeforeSlotMinutes * MINUTE_MS
      ) {
        push(
          'pick_late_incomplete',
          pick.claimedAt ?? pick.createdAt,
          'Claimed but not completed with the slot imminent.',
        );
      }

      partViews.push({
        shortId: part.shortId,
        storeRef: part.originRef,
        status: part.status,
        pickStatus: pick?.status ?? null,
        pickClaimedAt: pick?.claimedAt?.toISOString() ?? null,
        exceptions: partKinds,
      });
    }

    board.push({
      id: f.id,
      externalRef: f.externalRef,
      type: f.type,
      serviceLevel: f.serviceLevel,
      status: f.status,
      slotStart: f.slotStart.toISOString(),
      slotEnd: f.slotEnd.toISOString(),
      stores: [...new Set(parts.map((p) => p.originRef))],
      parts: partViews,
      exceptions: [...rowKinds],
    });
  }

  // ASAP first, then oldest slot.
  board.sort((a, b) => {
    const asap = Number(b.serviceLevel === 'ASAP') - Number(a.serviceLevel === 'ASAP');
    if (asap !== 0) return asap;
    return a.slotStart.localeCompare(b.slotStart);
  });
  exceptions.sort((a, b) => b.sinceMinutes - a.sinceMinutes);

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    kpis: {
      totalOrders: nonCancelled.length,
      totalPicked: picked.length,
      totalFailed: failed.length,
      totalDelivered: null,
      pickedOnTimePct: pct(onTimePicks.length, completedPicks.length),
      pickedInFullPct: pct(fullPicks.length, completedPicks.length),
      onTimePct: null,
      otifPct: null,
    },
    exceptions,
    board,
  };
}
