<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useRoute, useRouter } from 'vue-router';
import {
  fitBagSize,
  resolveBagSpecs,
  resolveConstructionByTemperature,
  sortPickLines,
  type FulfilmentLineLocation,
  type PackageConstruction,
  type PickDto,
  type PickSortAlgorithm,
  type ResolvedBagSpecs,
  type ResolvedConstructionByTemperature,
} from '@fulfil-go/shared';
import { useAppCtx } from '../context.js';
import { printZpl, type PrinterEndpoint } from '../print/print.js';

/**
 * Pick-then-pack workflow, SCAN-FIRST (docs/picking-workflow.md):
 *
 * Stage PICK: scanning is the primary interaction — each scan confirms the
 * right product (gtin/sku match) and +1s the line. The wedge input serves
 * USB/Bluetooth keyboard scanners (and browser dev); native adds the camera.
 * Manual +/- stays as the fallback. Lines sort per the pick's CAPTURED
 * sortAlgorithm (walk-sequence / aisle-bay-shelf / as-received — shared
 * sortPickLines over line.location, legacy attributes.aisle as fallback).
 * Substitution (when the line/fulfilment allows it) records the
 * replacement's scanned barcode — approved-substitute lists arrive with
 * the master-data gateway.
 *
 * Stage PACK: unchanged sub-modes; packable units = picked + substituted.
 */
const ctx = useAppCtx();
const route = useRoute();
const router = useRouter();

const pickId = computed(() => route.params['pickId'] as string);
const pick = computed<PickDto | undefined>(() => ctx.picks.byId(pickId.value));

const stage = ref<'pick' | 'pack'>('pick');
/** externalLineRef → ordered-product units counted. */
const counts = reactive<Record<string, number>>({});
/** externalLineRef → substituted items. */
const subs = reactive<Record<string, { barcode: string; description: string; quantity: number }[]>>(
  {},
);
const busy = ref(false);
const error = ref<string | null>(null);
const failOpen = ref(false);
const failReason = ref('');
/** The one question at the end: does this pick require a vehicle? */
const vehicleOpen = ref(false);
const vehicleYesConfirm = ref(false);
watch(vehicleOpen, (open) => {
  if (open) vehicleYesConfirm.value = false; // fresh question every time
});
const isNative = Capacitor.isNativePlatform();
const scanBusy = ref(false);
const scanValue = ref('');
/** Line ref whose substitute panel is open. */
const subPanelFor = ref<string | null>(null);
const subForm = reactive({ barcode: '', description: '', quantity: 1 });

// ── Packing state (unchanged model) ───────────────────────────────────────
type PackMode = 'items' | 'bags';
const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
// Chain-wide temperature terminology: ambient / chilled / frozen / hot
// ('hot' = warm prepared food, coffee — kept apart, picked & packed last).
const TEMPS = [
  { value: 'ambient', label: 'Ambient' },
  { value: 'chilled', label: 'Chilled' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'hot', label: 'Hot' },
] as const;
// Bag CONSTRUCTION (docs/bag-sizing.md): industry naming — the frozen tier
// is an insulated bag + gel packs, never "a frozen bag".
const CONSTRUCTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'insulated', label: 'Insulated' },
  { value: 'insulated-gel', label: 'Insulated + gel' },
] as const;

interface PackagedUnit {
  ref: string;
  kind: 'bag' | 'loose';
  size: (typeof SIZES)[number] | null;
  temperature: (typeof TEMPS)[number]['value'];
  construction: PackageConstruction;
  items: Record<string, number>;
}

const packMode = ref<PackMode>('items');
const packages = ref<PackagedUnit[]>([]);

// ── Bag labels (docs/bag-label-printing.md): printing X pre-allocates X
// package refs on the pick; the scanned bag refs COME FROM these labels.
// Refs are stable per (pick, seq) server-side, so a replace never touches
// bags already in the trolley. ─────────────────────────────────────────────
interface PickLabel {
  seq: number;
  ref: string;
  reprints: number;
}
interface LabelAllocation {
  count: number;
  labels: PickLabel[];
  voidedRefs: string[];
}
interface LabelDocument {
  seq: number;
  ref: string;
  zpl: string;
}
const labelAlloc = ref<LabelAllocation | null>(null);
const labelCount = ref(1);
const labelBusy = ref(false);
const labelError = ref<string | null>(null);
/** seq → outcome of the LAST delivery attempt from this station. */
const labelDelivered = reactive<Record<number, boolean>>({});
const activeRef = ref<string | null>(null);
/** "Add package" takes over the screen (drawer) — kind toggle, bag default. */
const pkgDrawerOpen = ref(false);
const PKG_KINDS = [
  { value: 'bag', label: '🛍 Bag' },
  { value: 'loose', label: '📦 Loose' },
] as const;
const pkgForm = reactive({
  kind: 'bag' as 'bag' | 'loose',
  ref: '',
  size: null as (typeof SIZES)[number] | null,
  temperature: 'ambient' as (typeof TEMPS)[number]['value'],
  construction: 'standard' as PackageConstruction,
  /** Picker tapped a construction square — stop auto-deriving. */
  constructionTouched: false,
});
let looseSeq = 0;

// ── Station bag catalog (docs/bag-sizing.md): drives loose auto-size, the
// derived construction chip and the oversize sanity check. Fetched per
// visit; code defaults keep everything working offline. ──────────────────
const stationBagSpecs = ref<ResolvedBagSpecs>(resolveBagSpecs());
const stationConstructionMap = ref<ResolvedConstructionByTemperature>(
  resolveConstructionByTemperature(),
);
onMounted(async () => {
  try {
    const res = await ctx.api.json<{
      bagSpecs: ResolvedBagSpecs;
      constructionByTemperature: ResolvedConstructionByTemperature;
    }>(`/clients/${ctx.station.clientId.value}/pick-station-settings`);
    stationBagSpecs.value = res.bagSpecs;
    stationConstructionMap.value = res.constructionByTemperature;
  } catch {
    // Offline / pre-feature server — the shared code defaults stand in.
  }
});

// Construction derives from the picker-set temperature square until the
// picker explicitly taps a construction (then their choice sticks).
watch(
  () => pkgForm.temperature,
  (t) => {
    if (!pkgForm.constructionTouched) pkgForm.construction = stationConstructionMap.value[t];
  },
);

/** Loose ref → the pick line it names (the item's own barcode). */
const looseLineMatch = computed(() => {
  if (pkgForm.kind !== 'loose') return undefined;
  const value = pkgForm.ref.trim();
  if (!value) return undefined;
  return lines.value.find((l) => l.gtin === value || l.sku === value);
});

/** Auto-fitted size-equivalent from the matched line's volumetrics. */
const looseAutoSize = computed(() => {
  const v = looseLineMatch.value?.volumetric;
  if (!v?.lengthMm || !v.widthMm || !v.heightMm) return undefined;
  return fitBagSize(
    { lengthMm: v.lengthMm, widthMm: v.widthMm, heightMm: v.heightMm },
    stationBagSpecs.value,
  );
});
watch(looseAutoSize, (s) => {
  if (pkgForm.kind === 'loose') pkgForm.size = s === undefined ? pkgForm.size : (s ?? 'XL');
});

// ── In-progress trolley persistence: a reload/crash mid-pick must not lose
// the work. Keyed per pick; cleared on any terminal outcome. ──────────────
const wipKey = () => `fulfilgo.pick.wip.${pickId.value}`;
let restoringWip = false;

function saveWip(): void {
  if (restoringWip || !pick.value) return;
  localStorage.setItem(
    wipKey(),
    JSON.stringify({
      counts: { ...counts },
      subs: JSON.parse(JSON.stringify(subs)),
      stage: stage.value,
      packMode: packMode.value,
      packages: packages.value,
      looseSeq,
    }),
  );
}

function restoreWip(): void {
  const raw = localStorage.getItem(wipKey());
  if (!raw) return;
  try {
    const wip = JSON.parse(raw) as {
      counts: Record<string, number>;
      subs: Record<string, { barcode: string; description: string; quantity: number }[]>;
      stage: 'pick' | 'pack';
      packMode: PackMode;
      packages: PackagedUnit[];
      looseSeq: number;
    };
    restoringWip = true;
    Object.assign(counts, wip.counts);
    Object.assign(subs, wip.subs);
    stage.value = wip.stage;
    packMode.value = wip.packMode;
    packages.value = wip.packages;
    looseSeq = wip.looseSeq;
    restoringWip = false;
  } catch {
    localStorage.removeItem(wipKey());
  }
}

function clearWip(): void {
  localStorage.removeItem(wipKey());
}

watch([counts, subs, stage, packMode, packages], () => saveWip(), { deep: true });

watch(
  pick,
  (p, prev) => {
    if (!p) return;
    for (const line of p.lines as { externalLineRef: string }[]) {
      counts[line.externalLineRef] ??= 0;
      subs[line.externalLineRef] ??= [];
    }
    if (!prev) {
      restoreWip(); // first load of this pick — resume the trolley
      // The label allocation is server state (survives station swaps) —
      // seed from the pick DTO, then track PUT/reprint responses locally.
      const alloc = (p.labels ?? null) as LabelAllocation | null;
      labelAlloc.value = alloc;
      labelCount.value = alloc?.count ?? 1;
    }
  },
  { immediate: true },
);

type Line = {
  externalLineRef: string;
  sku: string;
  gtin?: string;
  description: string;
  imageUrl?: string;
  quantity: number;
  volumetric?: { weightGrams: number; lengthMm?: number; widthMm?: number; heightMm?: number };
  temperatureClass?: string;
  allowSubstitutes?: boolean;
  location?: FulfilmentLineLocation;
  attributes?: Record<string, string>;
};

/** The algorithm captured on the pick at intake; guarded for pre-feature picks. */
const sortAlgorithm = computed<PickSortAlgorithm>(() => {
  const value = pick.value?.sortAlgorithm;
  return value === 'aisle-bay-shelf' || value === 'as-received' ? value : 'walk-sequence';
});

/** Walk order per the pick's CAPTURED sort algorithm (shared sortPickLines). */
const lines = computed(() =>
  sortPickLines((pick.value?.lines ?? []) as Line[], sortAlgorithm.value),
);

/** Location pill: locationDisplay > composed aisle·bay·shelf > legacy attributes.aisle. */
function lineLocationLabel(line: Line): string | null {
  if (line.location?.locationDisplay) return line.location.locationDisplay;
  const parts = [line.location?.aisle, line.location?.bay, line.location?.shelf].filter(Boolean);
  if (parts.length > 0) return parts.join('·');
  return line.attributes?.['aisle'] ?? null;
}

// ── Quantities ────────────────────────────────────────────────────────────
const subUnits = (ref_: string): number => (subs[ref_] ?? []).reduce((s, x) => s + x.quantity, 0);
const fulfilled = (ref_: string): number => (counts[ref_] ?? 0) + subUnits(ref_);
const imgFailed = reactive<Record<string, boolean>>({});

function bump(line: Line, delta: number): void {
  const next = (counts[line.externalLineRef] ?? 0) + delta;
  const max = line.quantity - subUnits(line.externalLineRef);
  counts[line.externalLineRef] = Math.min(Math.max(next, 0), max);
}
function fillLine(line: Line): void {
  counts[line.externalLineRef] = line.quantity - subUnits(line.externalLineRef);
}
function fillAll(): void {
  for (const line of lines.value) fillLine(line);
}

const totalOrdered = computed(() => lines.value.reduce((s, l) => s + l.quantity, 0));
const totalFulfilled = computed(() =>
  lines.value.reduce((s, l) => s + fulfilled(l.externalLineRef), 0),
);
const isShort = computed(() => totalFulfilled.value < totalOrdered.value);
const shortBlocked = computed(() => isShort.value && pick.value?.requireFullPick === true);

function lineAllowsSubs(line: Line): boolean {
  return line.allowSubstitutes ?? pick.value?.allowSubstitutes ?? false;
}

// ── Scanning ──────────────────────────────────────────────────────────────
/** Apply a scanned/typed code: confirm the product and +1 the line. */
function applyScan(code: string): void {
  const value = code.trim();
  if (!value) return;
  error.value = null;
  const line = lines.value.find((l) => l.gtin === value || l.sku === value);
  if (!line) {
    error.value = `No line matches barcode '${value}' — wrong item? Use Substitute if allowed.`;
    return;
  }
  if (stage.value === 'pick') {
    if (fulfilled(line.externalLineRef) >= line.quantity) {
      error.value = `#${line.externalLineRef} (${line.description}) is already fully picked.`;
      return;
    }
    bump(line, 1);
  } else {
    assign(line, 1);
  }
}

function onWedgeScan(): void {
  applyScan(scanValue.value);
  scanValue.value = '';
}

async function cameraScan(target: 'line' | 'pkg' | 'sub'): Promise<void> {
  scanBusy.value = true;
  error.value = null;
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
    const { camera } = await BarcodeScanner.requestPermissions();
    if (camera !== 'granted' && camera !== 'limited') throw new Error('camera permission denied');
    const { barcodes } = await BarcodeScanner.scan();
    const code = barcodes[0]?.rawValue;
    if (!code) return;
    if (target === 'line') applyScan(code);
    else if (target === 'pkg') pkgForm.ref = code;
    else subForm.barcode = code;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    scanBusy.value = false;
  }
}

// ── Substitutes ───────────────────────────────────────────────────────────
function openSubPanel(line: Line): void {
  subPanelFor.value = line.externalLineRef;
  subForm.barcode = '';
  subForm.description = '';
  subForm.quantity = Math.max(1, line.quantity - fulfilled(line.externalLineRef));
}

function addSubstitute(line: Line): void {
  const remaining = line.quantity - fulfilled(line.externalLineRef);
  if (!subForm.barcode.trim() || subForm.quantity < 1 || subForm.quantity > remaining) return;
  subs[line.externalLineRef]!.push({
    barcode: subForm.barcode.trim(),
    description: subForm.description.trim(),
    quantity: subForm.quantity,
  });
  subPanelFor.value = null;
}

function removeSubstitute(lineRef: string, index: number): void {
  subs[lineRef]!.splice(index, 1);
}

// ── Packing helpers (packable units = fulfilled) ──────────────────────────
const assignedPerLine = computed(() => {
  const totals: Record<string, number> = {};
  for (const pkg of packages.value) {
    for (const [lineRef, qty] of Object.entries(pkg.items)) {
      totals[lineRef] = (totals[lineRef] ?? 0) + qty;
    }
  }
  return totals;
});
const unassignedTotal = computed(() =>
  lines.value.reduce(
    (s, l) => s + (fulfilled(l.externalLineRef) - (assignedPerLine.value[l.externalLineRef] ?? 0)),
    0,
  ),
);
const activePackage = computed(() => packages.value.find((p) => p.ref === activeRef.value));

function switchMode(mode: PackMode): void {
  if (packages.value.length > 0) return;
  packMode.value = mode;
}

// ── Bag-label actions ─────────────────────────────────────────────────────
const scannedRefs = computed(() => new Set(packages.value.map((p) => p.ref)));
const labelForRef = (ref_: string): PickLabel | null =>
  labelAlloc.value?.labels.find((l) => l.ref === ref_) ?? null;

/**
 * Host/port read fresh from the registry at print time — equipment edits
 * take effect without re-binding the station. Null = no printer bound
 * (fine in browser dev, where Browser Print delivers instead).
 */
async function stationPrinter(): Promise<(PrinterEndpoint & { id: string }) | null> {
  const id = ctx.station.printerId.value;
  if (!id) return null;
  const res = await ctx.api.json<{
    printers: { id: string; host: string; port: number; active: boolean }[];
  }>(`/clients/${ctx.station.clientId.value}/printers`);
  const printer = res.printers.find((p) => p.id === id && p.active);
  return printer ? { id: printer.id, host: printer.host, port: printer.port } : null;
}

/** Delivery is best-effort: the allocation is committed server-side, so a
 * jammed printer just means tapping that label's reprint chip. */
async function deliverLabels(
  documents: readonly LabelDocument[],
  printer: PrinterEndpoint | null,
): Promise<void> {
  for (const doc of documents.toSorted((a, b) => a.seq - b.seq)) {
    try {
      await printZpl(printer, doc.zpl);
      labelDelivered[doc.seq] = true;
    } catch (err) {
      labelDelivered[doc.seq] = false;
      labelError.value = `Label ${doc.seq} didn't print (${err instanceof Error ? err.message : String(err)}) — tap it below to reprint.`;
    }
  }
}

/** Shrinking below a seq whose bag is already in the trolley would void a
 * ref the picker physically used — the server can't see the trolley, so
 * the guard lives here. */
function replaceBlockedBy(newCount: number): PickLabel | null {
  if (!labelAlloc.value) return null;
  return (
    labelAlloc.value.labels.find((l) => l.seq > newCount && scannedRefs.value.has(l.ref)) ?? null
  );
}

async function printLabels(): Promise<void> {
  if (!pick.value || labelBusy.value) return;
  labelError.value = null;
  const blocked = replaceBlockedBy(labelCount.value);
  if (blocked) {
    labelError.value = `Bag ${blocked.seq} is already in the trolley — remove it before dropping to ${labelCount.value} label(s).`;
    return;
  }
  labelBusy.value = true;
  try {
    const printer = await stationPrinter();
    if (isNative && !printer) {
      labelError.value = 'No station printer selected — choose one in Settings.';
      return;
    }
    const res = await ctx.api.json<{ allocation: LabelAllocation; documents: LabelDocument[] }>(
      `/clients/${ctx.station.clientId.value}/picks/${pick.value.id}/labels`,
      {
        method: 'PUT',
        body: { count: labelCount.value, ...(printer ? { printerId: printer.id } : {}) },
      },
    );
    labelAlloc.value = res.allocation;
    labelCount.value = res.allocation.count;
    await deliverLabels(res.documents, printer);
  } catch (err) {
    labelError.value = err instanceof Error ? err.message : String(err);
  } finally {
    labelBusy.value = false;
  }
}

/** Reprint ONE damaged label — same ref, same barcode (server records it). */
async function reprintLabel(seq: number): Promise<void> {
  if (!pick.value || labelBusy.value) return;
  labelBusy.value = true;
  labelError.value = null;
  try {
    const printer = await stationPrinter();
    if (isNative && !printer) {
      labelError.value = 'No station printer selected — choose one in Settings.';
      return;
    }
    const res = await ctx.api.json<{ allocation: LabelAllocation; documents: LabelDocument[] }>(
      `/clients/${ctx.station.clientId.value}/picks/${pick.value.id}/labels/${seq}/reprint`,
      { method: 'POST', body: printer ? { printerId: printer.id } : {} },
    );
    labelAlloc.value = res.allocation;
    await deliverLabels(res.documents, printer);
  } catch (err) {
    labelError.value = err instanceof Error ? err.message : String(err);
  } finally {
    labelBusy.value = false;
  }
}

function addPackage(): void {
  error.value = null;
  const pkgRef = pkgForm.ref.trim();
  if (!pkgRef || (pkgForm.kind === 'bag' && !pkgForm.size)) return;
  if (packages.value.some((p) => p.ref === pkgRef)) {
    error.value = `'${pkgRef}' is already added.`;
    return;
  }
  // A voided ref is a label from a replaced set — physically stale.
  if (labelAlloc.value?.voidedRefs.includes(pkgRef)) {
    error.value = `That label was replaced — scan one of the current ${labelAlloc.value.count} labels.`;
    return;
  }
  pushPackage(pkgRef);
}

/** Unlabelled awkward loose item — no barcode to scan, fall back to a generated ref. */
function addLooseWithoutBarcode(): void {
  looseSeq += 1;
  pushPackage(`loose-${looseSeq}`);
}

function pushPackage(pkgRef: string): void {
  packages.value.push({
    ref: pkgRef,
    kind: pkgForm.kind,
    // Loose keeps its size-equivalent (auto-fit or picker-chosen) — it is
    // the trip-capacity currency (docs/bag-sizing.md).
    size: pkgForm.size,
    temperature: pkgForm.temperature,
    construction: pkgForm.construction,
    items: {},
  });
  activeRef.value = pkgRef;
  pkgForm.kind = 'bag';
  pkgForm.ref = '';
  pkgForm.size = null;
  pkgForm.temperature = 'ambient';
  pkgForm.construction = stationConstructionMap.value.ambient;
  pkgForm.constructionTouched = false;
  pkgDrawerOpen.value = false;
}

/** Generated loose-N refs have no physical barcode; scanned/labelled refs do. */
const packageTitle = (pkg: PackagedUnit): string =>
  pkg.kind === 'loose'
    ? /^loose-\d+$/.test(pkg.ref)
      ? '📦 Loose'
      : `📦 ${pkg.ref}`
    : `🛍 ${pkg.ref}`;

function removePackage(pkgRef: string): void {
  packages.value = packages.value.filter((p) => p.ref !== pkgRef);
  if (activeRef.value === pkgRef) activeRef.value = packages.value[0]?.ref ?? null;
}

function assign(line: Line, delta: number): void {
  const pkg = activePackage.value;
  if (!pkg) {
    error.value = 'Add or select a bag first.';
    return;
  }
  const inPkg = pkg.items[line.externalLineRef] ?? 0;
  const packable = fulfilled(line.externalLineRef);
  const assignedElsewhere = (assignedPerLine.value[line.externalLineRef] ?? 0) - inPkg;
  const next = Math.min(Math.max(inPkg + delta, 0), packable - assignedElsewhere);
  if (next === 0) delete pkg.items[line.externalLineRef];
  else pkg.items[line.externalLineRef] = next;
}

const canComplete = computed(() => {
  if (packages.value.length === 0) return false;
  if (packMode.value === 'items') return unassignedTotal.value === 0;
  return true;
});

// ── Oversize sanity check (docs/bag-sizing.md, Andrew's addition):
// bags-only mode can't verify contents fit, so completion compares picked
// volumetrics against the DECLARED packages. Soft warning, never a block.
const sortedDims = (d: { lengthMm: number; widthMm: number; heightMm: number }) =>
  [d.lengthMm, d.widthMm, d.heightMm].toSorted((a, b) => b - a);
const containsDims = (
  item: { lengthMm: number; widthMm: number; heightMm: number },
  box: { lengthMm: number; widthMm: number; heightMm: number },
) => sortedDims(item).every((v, i) => v <= (sortedDims(box)[i] as number));
const volumeMm3 = (d: { lengthMm: number; widthMm: number; heightMm: number }) =>
  d.lengthMm * d.widthMm * d.heightMm;

const packagingWarnings = computed<string[]>(() => {
  if (packages.value.length === 0) return [];
  const specs = stationBagSpecs.value;
  const warnings: string[] = [];
  const bags = packages.value.filter((p) => p.kind === 'bag' && p.size);
  const largestBag = bags
    .map((p) => specs[p.size as keyof typeof specs].dims)
    .toSorted((a, b) => volumeMm3(b) - volumeMm3(a))[0];
  const hasLoose = packages.value.some((p) => p.kind === 'loose');

  let itemsVolume = 0;
  for (const line of lines.value) {
    const units = fulfilled(line.externalLineRef);
    const v = line.volumetric;
    if (units === 0 || !v?.lengthMm || !v.widthMm || !v.heightMm) continue;
    const dims = { lengthMm: v.lengthMm, widthMm: v.widthMm, heightMm: v.heightMm };
    itemsVolume += volumeMm3(dims) * units;
    if (!hasLoose && (!largestBag || !containsDims(dims, largestBag))) {
      warnings.push(
        `"${line.description}" looks bigger than your largest bag — add a bigger bag or a loose item.`,
      );
    }
  }
  const declaredVolume = packages.value.reduce((sum, p) => {
    if (p.size) return sum + volumeMm3(specs[p.size as keyof typeof specs].dims);
    return sum;
  }, 0);
  // 20% slack: items never pack perfectly; only flag a real overflow.
  if (declaredVolume > 0 && itemsVolume > declaredVolume * 1.2) {
    warnings.push(
      'Everything picked may not fit the declared bags — check the sizes or add a bag.',
    );
  }
  return warnings;
});

/** Remaining units of a line still to pack (items sub-mode). */
const remainingToPack = (ref_: string): number =>
  fulfilled(ref_) - (assignedPerLine.value[ref_] ?? 0);

/** Unpacked lines first (walk-order within each group); done lines sink. */
const packLines = computed(() =>
  [...lines.value].sort((a, b) => {
    const ra = remainingToPack(a.externalLineRef) > 0 ? 0 : 1;
    const rb = remainingToPack(b.externalLineRef) > 0 ? 0 : 1;
    return ra - rb;
  }),
);
const allPacked = computed(
  () => packMode.value === 'items' && packages.value.length > 0 && unassignedTotal.value === 0,
);

// ── Actions ───────────────────────────────────────────────────────────────
/**
 * Submit an outcome. Online HTTP errors show inline (validation feedback);
 * a NETWORK failure queues the request (Idempotency-Key + 10s-cap backoff,
 * server replays stored responses), flips the pick locally, and moves on —
 * connectivity loss never blocks finishing a claimed pick.
 */
async function submitOutcome(
  path: string,
  body: unknown,
  localStatus: 'picked' | 'failed',
): Promise<void> {
  if (!pick.value) return;
  busy.value = true;
  error.value = null;
  try {
    let res: Response;
    try {
      res = await ctx.api.request(path, { method: 'POST', body });
    } catch {
      // Network down — hand to the offline outbox and carry on.
      await ctx.queue.enqueue({ endpoint: path, body });
      ctx.picks.markLocallyTerminal(pick.value.id, localStatus);
      clearWip();
      failOpen.value = false;
      await router.push('/picks');
      return;
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      error.value = `Failed (${res.status}): ${detail}`;
      return;
    }
    clearWip();
    failOpen.value = false;
    await ctx.picks.hydrate();
    await router.push('/picks');
  } finally {
    busy.value = false;
  }
}

async function complete(requiresCarOrLarger: boolean): Promise<void> {
  if (!pick.value) return;
  vehicleOpen.value = false;
  await submitOutcome(
    `/clients/${ctx.station.clientId.value}/picks/${pick.value.id}/complete`,
    {
      requiresCarOrLarger,
      lines: lines.value.map((l) => ({
        externalLineRef: l.externalLineRef,
        pickedQuantity: counts[l.externalLineRef] ?? 0,
        ...((subs[l.externalLineRef]?.length ?? 0) > 0
          ? {
              substitutions: subs[l.externalLineRef]!.map((s) => ({
                barcode: s.barcode,
                ...(s.description ? { description: s.description } : {}),
                quantity: s.quantity,
              })),
            }
          : {}),
      })),
      packages: packages.value.map((p) => ({
        ref: p.ref,
        kind: p.kind,
        ...(p.size ? { size: p.size } : {}),
        temperature: p.temperature,
        construction: p.construction,
        ...(packMode.value === 'items'
          ? {
              items: Object.entries(p.items).map(([externalLineRef, quantity]) => ({
                externalLineRef,
                quantity,
              })),
            }
          : {}),
      })),
    },
    'picked',
  );
}

async function fail(): Promise<void> {
  if (!pick.value || !failReason.value.trim()) return;
  await submitOutcome(
    `/clients/${ctx.station.clientId.value}/picks/${pick.value.id}/fail`,
    { reason: failReason.value.trim() },
    'failed',
  );
}
</script>

<template>
  <div v-if="!pick" class="p-6 text-center text-neutral-400">
    Pick not found — it may have been completed elsewhere.
  </div>
  <div v-else class="flex flex-col gap-4 p-4 pb-8">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <p class="font-mono text-2xl font-semibold">#{{ pick.shortId }}</p>
        <p class="text-xs text-neutral-500">
          {{ stage === 'pick' ? 'Picking' : 'Packing' }} · {{ totalFulfilled }}/{{ totalOrdered }}
          units
          <template v-if="stage === 'pack' && packMode === 'items'">
            · {{ unassignedTotal }} to pack
          </template>
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <span
          v-if="pick.serviceLevel === 'ASAP'"
          class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
        >
          ASAP
        </span>
        <span
          v-if="pick.requireFullPick"
          class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
          title="The fulfilment does not allow partial fulfilment"
        >
          FULL PICK REQUIRED
        </span>
      </div>
    </div>

    <!-- Scan wedge: primary interaction. USB/BT scanners type + Enter. -->
    <div class="flex gap-2">
      <UInput
        v-model="scanValue"
        placeholder="📷 Scan barcode to confirm & count…"
        class="flex-1 font-mono"
        size="xl"
        autocomplete="off"
        autofocus
        @keydown.enter.prevent="onWedgeScan"
      />
      <UButton
        v-if="isNative"
        size="xl"
        variant="soft"
        :loading="scanBusy"
        @click="cameraScan(stage === 'pick' ? 'line' : 'line')"
      >
        📷
      </UButton>
    </div>

    <UAlert v-if="error" :description="error" color="error" variant="soft" />

    <!-- ════ STAGE: PICK ════ -->
    <template v-if="stage === 'pick'">
      <div class="flex justify-end">
        <UButton variant="ghost" size="sm" @click="fillAll">Mark all picked</UButton>
      </div>

      <UCard v-for="line in lines" :key="line.externalLineRef" :ui="{ body: 'p-2 sm:p-3' }">
        <div class="flex items-center gap-3">
          <!-- Product image (placeholder when missing / failed to load) -->
          <div class="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
            <img
              v-if="line.imageUrl && !imgFailed[line.externalLineRef]"
              :src="line.imageUrl"
              :alt="line.description"
              class="h-full w-full object-cover"
              loading="lazy"
              @error="imgFailed[line.externalLineRef] = true"
            />
            <div
              v-else
              class="flex h-full w-full items-center justify-center text-lg font-semibold text-neutral-400"
            >
              {{ line.description.charAt(0).toUpperCase() }}
            </div>
          </div>

          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ line.description }}</p>
            <p class="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <span
                v-if="lineLocationLabel(line)"
                class="rounded bg-brand-50 px-1.5 py-0.5 font-mono font-semibold text-brand-700"
              >
                {{ lineLocationLabel(line) }}
              </span>
              <span class="font-mono">{{ line.sku }}</span>
              <span
                v-if="line.temperatureClass && line.temperatureClass !== 'ambient'"
                class="text-cyan-600"
              >
                {{ line.temperatureClass }}
              </span>
            </p>
            <p v-if="subUnits(line.externalLineRef) > 0" class="text-[11px] text-amber-600">
              +{{ subUnits(line.externalLineRef) }} substitute(s)
            </p>
          </div>

          <!-- Big touch targets: the buttons ARE the padding now. -->
          <div class="flex shrink-0 items-stretch gap-1.5">
            <button
              class="h-14 w-14 rounded-lg bg-neutral-100 text-2xl font-semibold text-neutral-600 active:bg-neutral-200 disabled:opacity-30"
              :disabled="(counts[line.externalLineRef] ?? 0) === 0"
              @click="bump(line, -1)"
            >
              −
            </button>
            <button
              class="min-w-16 rounded-lg text-center font-mono text-lg"
              :class="
                fulfilled(line.externalLineRef) === line.quantity
                  ? 'bg-emerald-50 font-semibold text-emerald-600'
                  : 'bg-white'
              "
              title="Tap to mark line fully picked"
              @click="fillLine(line)"
            >
              {{ fulfilled(line.externalLineRef) }}/{{ line.quantity }}
            </button>
            <button
              class="h-14 w-14 rounded-lg bg-brand-50 text-2xl font-semibold text-brand-700 active:bg-brand-100 disabled:opacity-30"
              :disabled="fulfilled(line.externalLineRef) >= line.quantity"
              @click="bump(line, 1)"
            >
              +
            </button>
          </div>
        </div>

        <!-- Substitute affordance + panel -->
        <div
          v-if="lineAllowsSubs(line) && fulfilled(line.externalLineRef) < line.quantity"
          class="mt-2"
        >
          <UButton
            v-if="subPanelFor !== line.externalLineRef"
            size="xs"
            color="warning"
            variant="soft"
            @click="openSubPanel(line)"
          >
            ↔ Substitute unavailable item
          </UButton>
          <div
            v-else
            class="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-2"
          >
            <div class="flex gap-2">
              <UInput
                v-model="subForm.barcode"
                placeholder="Scan substitute barcode…"
                class="flex-1 font-mono"
                autocomplete="off"
              />
              <UButton
                v-if="isNative"
                variant="soft"
                :loading="scanBusy"
                @click="cameraScan('sub')"
              >
                📷
              </UButton>
            </div>
            <UInput v-model="subForm.description" placeholder="Description (optional)" />
            <div class="flex items-center gap-2">
              <span class="text-xs text-neutral-500">Qty</span>
              <UInput
                v-model.number="subForm.quantity"
                type="number"
                :min="1"
                :max="line.quantity - fulfilled(line.externalLineRef)"
                class="w-20"
              />
              <UButton
                size="sm"
                color="warning"
                :disabled="!subForm.barcode.trim()"
                @click="addSubstitute(line)"
              >
                Add substitute
              </UButton>
              <UButton size="sm" color="neutral" variant="ghost" @click="subPanelFor = null">
                Cancel
              </UButton>
            </div>
          </div>
        </div>
        <ul
          v-if="(subs[line.externalLineRef]?.length ?? 0) > 0"
          class="mt-1 text-[11px] text-neutral-500"
        >
          <li
            v-for="(s, i) in subs[line.externalLineRef]"
            :key="i"
            class="flex items-center justify-between"
          >
            <span class="truncate">
              ↔ {{ s.quantity }}× <span class="font-mono">{{ s.barcode }}</span>
              {{ s.description ? `· ${s.description}` : '' }}
            </span>
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              @click="removeSubstitute(line.externalLineRef, i)"
            >
              ✕
            </UButton>
          </li>
        </ul>
      </UCard>

      <UAlert
        v-if="shortBlocked"
        title="Full pick required"
        description="This fulfilment doesn't allow partial fulfilment — pick every line in full
          (substitutes count where allowed), or fail the pick."
        color="warning"
        variant="soft"
      />

      <UButton
        size="xl"
        block
        :disabled="shortBlocked || totalFulfilled === 0"
        @click="stage = 'pack'"
      >
        Continue to packing {{ isShort ? `(short: ${totalFulfilled}/${totalOrdered})` : '' }}
      </UButton>
    </template>

    <!-- ════ STAGE: PACK ════ -->
    <template v-else>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="m in [
            { value: 'items', label: 'Scan items into bags', hint: 'contents tracked' },
            { value: 'bags', label: 'Bags only', hint: 'barcode + size' },
          ]"
          :key="m.value"
          class="rounded-lg border-2 p-3 text-left transition-colors"
          :class="
            packMode === m.value
              ? 'border-brand-600 bg-brand-50 text-brand-800'
              : 'border-neutral-200 bg-white text-neutral-600'
          "
          :disabled="packages.length > 0"
          @click="switchMode(m.value as 'items' | 'bags')"
        >
          <p class="text-sm font-semibold">{{ m.label }}</p>
          <p class="text-[11px] opacity-70">{{ m.hint }}</p>
        </button>
      </div>
      <p v-if="packages.length > 0" class="-mt-2 text-[11px] text-neutral-400">
        Mode locks once packing starts — remove all packages to switch.
      </p>

      <!-- Bag labels: printing X pre-allocates X package refs (n / X on the
           label). The refs scanned into the drawer come from these. -->
      <UCard :ui="{ body: 'p-3' }">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold">🏷 Bag labels</p>
          <p v-if="isNative && !ctx.station.printerId.value" class="text-[11px] text-amber-600">
            No printer bound — Settings
          </p>
        </div>
        <div class="mt-2 flex items-center gap-1.5">
          <button
            class="h-12 w-12 rounded-lg bg-neutral-100 text-2xl font-semibold text-neutral-600 active:bg-neutral-200 disabled:opacity-30"
            :disabled="labelCount <= 1 || labelBusy"
            @click="labelCount -= 1"
          >
            −
          </button>
          <span class="min-w-10 text-center font-mono text-lg">{{ labelCount }}</span>
          <button
            class="h-12 w-12 rounded-lg bg-neutral-100 text-2xl font-semibold text-neutral-600 active:bg-neutral-200 disabled:opacity-30"
            :disabled="labelCount >= 100 || labelBusy"
            @click="labelCount += 1"
          >
            +
          </button>
          <UButton class="flex-1" size="lg" :loading="labelBusy" @click="printLabels">
            {{
              !labelAlloc
                ? `Print ${labelCount} label${labelCount === 1 ? '' : 's'}`
                : labelCount === labelAlloc.count
                  ? 'Reprint all'
                  : `Replace with ${labelCount}`
            }}
          </UButton>
        </div>
        <UAlert
          v-if="labelError"
          class="mt-2"
          :description="labelError"
          color="error"
          variant="soft"
        />
        <template v-if="labelAlloc">
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="l in labelAlloc.labels"
              :key="l.seq"
              class="rounded-lg border px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors disabled:opacity-40"
              :class="
                scannedRefs.has(l.ref)
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : labelDelivered[l.seq] === false
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-neutral-200 bg-white text-neutral-600'
              "
              :disabled="labelBusy"
              :title="`${l.ref} — tap to reprint (same barcode)`"
              @click="reprintLabel(l.seq)"
            >
              {{ l.seq }}/{{ labelAlloc.count }} ↻
            </button>
          </div>
          <p class="mt-1 text-[11px] text-neutral-400">
            Tap a label to reprint it — same barcode. Green = its bag is in the trolley; red =
            didn't print.
          </p>
        </template>
      </UCard>

      <!-- Add package: one button that TAKES OVER the screen for capture.
           Kind is an option (bag default) — Andrew, 2026-07-13. -->
      <UDrawer v-model:open="pkgDrawerOpen" title="Add a package">
        <UButton size="xl" block>🛍 Add package</UButton>
        <template #body>
          <div class="flex flex-col gap-4 p-1">
            <div>
              <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Kind
              </p>
              <div class="flex gap-2">
                <button
                  v-for="k in PKG_KINDS"
                  :key="k.value"
                  class="h-14 flex-1 rounded-lg border-2 text-sm font-semibold transition-colors"
                  :class="
                    pkgForm.kind === k.value
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  "
                  @click="pkgForm.kind = k.value"
                >
                  {{ k.label }}
                </button>
              </div>
            </div>

            <div class="flex gap-2">
              <UInput
                v-model="pkgForm.ref"
                :placeholder="pkgForm.kind === 'bag' ? 'Scan bag barcode…' : 'Scan item barcode…'"
                class="flex-1 font-mono"
                size="xl"
                autocomplete="off"
                autofocus
              />
              <UButton
                v-if="isNative"
                size="xl"
                variant="soft"
                :loading="scanBusy"
                @click="cameraScan('pkg')"
              >
                📷
              </UButton>
            </div>

            <!-- Recognise a printed bag label the moment it's scanned. -->
            <p
              v-if="labelForRef(pkgForm.ref.trim())"
              class="rounded bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700"
            >
              🏷 Label {{ labelForRef(pkgForm.ref.trim())!.seq }} / {{ labelAlloc!.count }}
            </p>

            <!-- Loose with matched product dims: size auto-fits from the
                 store's bag catalog — only ask when nothing is known. -->
            <p
              v-if="pkgForm.kind === 'loose' && looseAutoSize !== undefined"
              class="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
            >
              📏 Size ≈ {{ pkgForm.size }} (auto from product dimensions{{
                looseAutoSize === null ? ' — larger than any bag' : ''
              }})
            </p>
            <div v-if="pkgForm.kind === 'bag' || looseAutoSize === undefined">
              <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Size {{ pkgForm.kind === 'loose' ? '(equivalent — for trip capacity)' : '' }}
              </p>
              <div class="flex gap-2">
                <button
                  v-for="s in SIZES"
                  :key="s"
                  class="h-14 flex-1 rounded-lg border-2 font-semibold transition-colors"
                  :class="
                    pkgForm.size === s
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  "
                  @click="pkgForm.size = pkgForm.size === s ? null : s"
                >
                  {{ s }}
                </button>
              </div>
            </div>

            <div>
              <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Type
              </p>
              <div class="flex gap-2">
                <button
                  v-for="t in TEMPS"
                  :key="t.value"
                  class="h-14 flex-1 rounded-lg border-2 text-sm font-semibold transition-colors"
                  :class="
                    pkgForm.temperature === t.value
                      ? t.value === 'frozen'
                        ? 'border-cyan-600 bg-cyan-600 text-white'
                        : t.value === 'chilled'
                          ? 'border-sky-500 bg-sky-500 text-white'
                          : 'border-brand-600 bg-brand-600 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  "
                  @click="pkgForm.temperature = t.value"
                >
                  {{ t.label }}
                </button>
              </div>
            </div>

            <!-- Construction pre-derives from the temperature square
                 (docs/bag-sizing.md) — tapping one makes it stick. -->
            <div>
              <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Bag type
                <span v-if="!pkgForm.constructionTouched" class="normal-case text-neutral-300">
                  · auto
                </span>
              </p>
              <div class="flex gap-2">
                <button
                  v-for="c in CONSTRUCTIONS"
                  :key="c.value"
                  class="h-12 flex-1 rounded-lg border-2 text-xs font-semibold transition-colors"
                  :class="
                    pkgForm.construction === c.value
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  "
                  @click="
                    pkgForm.construction = c.value;
                    pkgForm.constructionTouched = true;
                  "
                >
                  {{ c.label }}
                </button>
              </div>
            </div>

            <UButton
              size="xl"
              block
              :disabled="!pkgForm.ref.trim() || (pkgForm.kind === 'bag' && !pkgForm.size)"
              @click="addPackage"
            >
              {{ pkgForm.kind === 'bag' ? 'Add bag' : 'Add loose item' }}
            </UButton>
            <UButton
              v-if="pkgForm.kind === 'loose'"
              color="neutral"
              variant="soft"
              block
              @click="addLooseWithoutBarcode"
            >
              No barcode on it — add anyway
            </UButton>
            <UButton color="neutral" variant="ghost" block @click="pkgDrawerOpen = false">
              Cancel
            </UButton>
          </div>
        </template>
      </UDrawer>

      <!-- Packages -->
      <div v-if="packages.length > 0" class="flex flex-col gap-2">
        <p class="text-sm font-semibold">Packages ({{ packages.length }})</p>
        <UCard
          v-for="pkg in packages"
          :key="pkg.ref"
          :class="packMode === 'items' && activeRef === pkg.ref ? 'ring-2 ring-brand-500' : ''"
          @click="activeRef = pkg.ref"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-mono text-sm font-semibold">
                {{ packageTitle(pkg) }}
              </p>
              <p class="text-[11px] text-neutral-500">
                <template v-if="pkg.kind === 'bag'">{{ pkg.size }} · </template>
                {{ TEMPS.find((t) => t.value === pkg.temperature)?.label }}
                <template v-if="packMode === 'items'">
                  · {{ Object.values(pkg.items).reduce((a, b) => a + b, 0) }} item(s)
                </template>
                <template v-if="labelForRef(pkg.ref)">
                  · 🏷 {{ labelForRef(pkg.ref)!.seq }}/{{ labelAlloc!.count }}
                </template>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <span
                v-if="packMode === 'items' && activeRef === pkg.ref"
                class="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700"
              >
                PACKING INTO
              </span>
              <UButton size="xs" color="error" variant="ghost" @click.stop="removePackage(pkg.ref)">
                ✕
              </UButton>
            </div>
          </div>
        </UCard>
      </div>

      <!-- items sub-mode: assign fulfilled units into the active package.
           Unpacked lines first; fully-packed lines turn green + lock +. -->
      <template v-if="packMode === 'items'">
        <UAlert
          v-if="allPacked"
          color="success"
          variant="soft"
          title="✓ All items packed"
          description="Every fulfilled unit is in a package — complete the pick below."
        />
        <p class="text-sm font-semibold">
          Items to pack <span v-if="!allPacked">({{ unassignedTotal }} left)</span>
        </p>
        <UCard
          v-for="line in packLines"
          :key="`pack-${line.externalLineRef}`"
          :ui="{ body: 'p-2 sm:p-3' }"
          :class="remainingToPack(line.externalLineRef) === 0 ? 'bg-emerald-50/70' : ''"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">
                <span v-if="remainingToPack(line.externalLineRef) === 0" class="text-emerald-600">
                  ✓
                </span>
                {{ line.description }}
              </p>
              <p
                class="text-[11px]"
                :class="
                  remainingToPack(line.externalLineRef) === 0
                    ? 'text-emerald-600'
                    : 'text-neutral-500'
                "
              >
                {{
                  remainingToPack(line.externalLineRef) === 0
                    ? `all ${fulfilled(line.externalLineRef)} packed`
                    : `packed ${assignedPerLine[line.externalLineRef] ?? 0} of ${fulfilled(line.externalLineRef)}`
                }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                class="h-14 w-14 rounded-lg bg-neutral-100 text-2xl font-semibold text-neutral-600 active:bg-neutral-200 disabled:opacity-30"
                :disabled="(activePackage?.items[line.externalLineRef] ?? 0) === 0"
                @click="assign(line, -1)"
              >
                −
              </button>
              <span class="min-w-10 text-center font-mono">
                {{ activePackage?.items[line.externalLineRef] ?? 0 }}
              </span>
              <button
                class="h-14 w-14 rounded-lg bg-brand-50 text-2xl font-semibold text-brand-700 active:bg-brand-100 disabled:opacity-30"
                :disabled="remainingToPack(line.externalLineRef) === 0"
                @click="assign(line, 1)"
              >
                +
              </button>
            </div>
          </div>
        </UCard>
      </template>

      <div class="flex gap-2">
        <UButton color="neutral" variant="soft" @click="stage = 'pick'">← Back to picking</UButton>
        <!-- Complete → one final question before submitting. -->
        <UDrawer v-model:open="vehicleOpen" title="One last thing" class="flex-1">
          <UButton class="w-full" size="xl" :loading="busy" :disabled="!canComplete">
            Complete pick
            {{ packMode === 'items' && unassignedTotal > 0 ? `(${unassignedTotal} unpacked)` : '' }}
          </UButton>
          <template #body>
            <!-- Supervisor pre-flagged: the question is DECIDED — the
                 picker's answer can never downgrade it. -->
            <div v-if="pick.requiresCarOrLarger === true" class="flex flex-col gap-4 p-1">
              <!-- Soft packaging sanity check (docs/bag-sizing.md) — advise,
                   never block: the picker holds the physical truth. -->
              <UAlert
                v-for="(w, i) in packagingWarnings"
                :key="`pw-${i}`"
                :description="w"
                color="warning"
                variant="soft"
              />
              <p class="text-center text-lg font-semibold">🚗 Car or bigger — flagged</p>
              <p class="-mt-2 text-center text-xs text-neutral-500">
                A supervisor flagged this pick: it can't go on a bike or scooter.
              </p>
              <UButton size="xl" block class="h-16 text-xl font-bold" @click="complete(true)">
                Complete pick
              </UButton>
              <UButton color="neutral" variant="ghost" block @click="vehicleOpen = false">
                Cancel
              </UButton>
            </div>
            <div v-else class="flex flex-col gap-4 p-1">
              <UAlert
                v-for="(w, i) in packagingWarnings"
                :key="`pw-${i}`"
                :description="w"
                color="warning"
                variant="soft"
              />
              <!-- Clear language (Andrew, 2026-07-14): a scooter/bike does
                   NOT count — the flag means car or bigger. -->
              <p class="text-center text-lg font-semibold">
                Does this need a car or bigger?
              </p>
              <p class="-mt-2 text-center text-xs text-neutral-500">
                Too big/heavy for a bike or scooter.
              </p>
              <!-- "No" is the norm — big and primary. -->
              <UButton size="xl" block class="h-16 text-xl font-bold" @click="complete(false)">
                No — any vehicle is fine
              </UButton>
              <!-- "Yes" is deliberate — smaller than No, and double-confirmed.
                   Solid orange + white for contrast against the big No. -->
              <UButton
                v-if="!vehicleYesConfirm"
                size="lg"
                block
                class="h-12 bg-orange-500 font-semibold text-white hover:bg-orange-600 active:bg-orange-600"
                @click="vehicleYesConfirm = true"
              >
                Yes — car or bigger
              </UButton>
              <UButton
                v-else
                size="lg"
                block
                class="h-14 bg-orange-500 text-lg font-bold text-white hover:bg-orange-600 active:bg-orange-600"
                @click="complete(true)"
              >
                Confirm: 🚗 car or bigger required
              </UButton>
              <UButton color="neutral" variant="ghost" block @click="vehicleOpen = false">
                Cancel
              </UButton>
            </div>
          </template>
        </UDrawer>
      </div>
    </template>

    <!-- Fail: real button, clear separation, destructive confirm in a drawer. -->
    <div class="mt-8 border-t border-neutral-200 pt-6">
      <UDrawer v-model:open="failOpen" title="Fail this pick">
        <UButton color="error" size="lg" block class="font-bold">
          Can't fulfil — fail this pick
        </UButton>
        <template #body>
          <div class="flex flex-col gap-3 p-1">
            <UAlert
              color="error"
              variant="soft"
              title="This ends the pick"
              :description="
                pick.requireFullPick
                  ? 'This fulfilment is all-or-nothing — failing this pick will fail the whole order.'
                  : 'The order continues with its other parts (partial fulfilment is allowed).'
              "
            />
            <UTextarea
              v-model="failReason"
              placeholder="Why can't this pick be fulfilled? (required)"
              :rows="3"
              autofocus
            />
            <UButton
              color="error"
              size="xl"
              block
              class="font-bold"
              :loading="busy"
              :disabled="!failReason.trim()"
              @click="fail"
            >
              Fail pick
            </UButton>
            <UButton color="neutral" variant="soft" block @click="failOpen = false">
              Cancel — back to picking
            </UButton>
          </div>
        </template>
      </UDrawer>
    </div>
  </div>
</template>
