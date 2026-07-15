<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useAppCtx } from '../context.js';

/**
 * The claim marketplace + the driver's active trips.
 *
 * Claim: request an offer → a reserved TRIP (driver + vehicle bound, 30s
 * hold) → claim before the countdown lapses. Anchor entry lets the driver
 * type the part number off the packaging.
 *
 * COLLECTION + DELIVERY are OFFLINE-FIRST (docs/handover-verification.md):
 * a claimed trip carries everything needed (parcel refs to scan-match,
 * verification REQUIREMENTS — never pin values). Reports go direct when
 * online and queue through the mobile-kit outbox when not; pin checks are
 * interactive online (verify BEFORE handover) and deferred otherwise — the
 * server stamps the outcome whenever the report lands and flags mismatches
 * for ops instead of rejecting them.
 */
interface OfferStop {
  orderId: string;
  shortId: string;
  destination: {
    name?: string;
    address?: { line1?: string; city?: string };
  };
  legKm: number | null;
  legMinutes: number | null;
}

interface Offer {
  groupId: string;
  partReferences: string[];
  transportOrderRefs: string[];
  expiresAt: string;
  originRef: string;
  stops: OfferStop[];
  routeKm: number | null;
  routeMinutes: number | null;
}

interface StopParcel {
  ref: string;
  kind: string;
  size: string | null;
  temperature: string;
}

interface StopVerification {
  requirements: {
    pickupPin: boolean;
    deliveryPin: boolean;
    minAge: number | null;
    ageVisualOverrideAllowed: boolean;
  };
  collectionMethod: string | null;
  deliveryPinOutcome: string | null;
}

interface MyTripStop extends OfferStop {
  status: string;
  parcels: StopParcel[];
  verification: StopVerification | null;
}

interface MyTrip {
  tripId: string;
  originRef: string;
  claimedAt: string;
  routeKm: number | null;
  routeMinutes: number | null;
  stops: MyTripStop[];
}

const ctx = useAppCtx();
const offer = ref<Offer | null>(null);
const myTrips = ref<MyTrip[]>([]);
const emptyReason = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const anchorRef = ref('');
const secondsLeft = ref(0);
let countdown: ReturnType<typeof setInterval> | null = null;

const EMPTY_MESSAGES: Record<string, string> = {
  NO_OFFERABLE_ORDERS: 'No deliveries waiting at your depot right now.',
  ANCHOR_NOT_FOUND: 'No waiting delivery matches that number.',
  ANCHOR_UNAVAILABLE: 'That delivery was just taken by another driver.',
  DEPOT_SERVES_NO_STORES: 'Your depot has no stores linked — ask a manager.',
  NO_STORE_ON_CLAIM_STRATEGY: 'No stores at your depot offer claimable work.',
  OPEN_TRIP_EXISTS: 'Finish your current trip before claiming another.',
};

/** ONE ACTIVE TRIP (Andrew, 2026-07-14): Find work hides while one is open. */
const hasOpenTrip = computed(() => myTrips.value.length > 0);
const emptyMessage = computed(() =>
  emptyReason.value ? (EMPTY_MESSAGES[emptyReason.value] ?? 'No work available right now.') : null,
);

// ── Offline-first local state ─────────────────────────────────────────────
// Scanned parcel refs per order (the collection WIP trolley — a crash or
// reload mid-collection must not lose scans) + report actions queued while
// offline (server state wins once it catches up).
const SCANNED_KEY = 'fulfilgo.exec.collect.v1';
const PENDING_KEY = 'fulfilgo.exec.pending.v1';
const ARRIVED_KEY = 'fulfilgo.exec.arrived.v1';
const scannedByOrder = reactive<Record<string, string[]>>(
  JSON.parse(localStorage.getItem(SCANNED_KEY) ?? '{}') as Record<string, string[]>,
);
const pendingByOrder = reactive<Record<string, string>>(
  JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as Record<string, string>,
);
/** "I've arrived" taps (orderId → ISO) — evidence timestamp, offline-safe. */
const arrivedByOrder = reactive<Record<string, string>>(
  JSON.parse(localStorage.getItem(ARRIVED_KEY) ?? '{}') as Record<string, string>,
);
watch(scannedByOrder, () => localStorage.setItem(SCANNED_KEY, JSON.stringify(scannedByOrder)), {
  deep: true,
});
watch(pendingByOrder, () => localStorage.setItem(PENDING_KEY, JSON.stringify(pendingByOrder)), {
  deep: true,
});
watch(arrivedByOrder, () => localStorage.setItem(ARRIVED_KEY, JSON.stringify(arrivedByOrder)), {
  deep: true,
});

const STATUS_RANK: Record<string, number> = {
  requested: 0,
  booked: 1,
  assigned: 2,
  collected: 3,
  delivered: 4,
  failed: 4,
};

/** Server status overlaid with locally-queued (not yet synced) actions. */
function effectiveStatus(stop: MyTripStop): string {
  const pending = pendingByOrder[stop.orderId];
  if (pending && (STATUS_RANK[pending] ?? 0) > (STATUS_RANK[stop.status] ?? 0)) return pending;
  return stop.status;
}

const isPendingSync = (stop: MyTripStop): boolean =>
  pendingByOrder[stop.orderId] !== undefined && effectiveStatus(stop) !== stop.status;

async function loadMyTrips(): Promise<void> {
  if (!ctx.driverSignedIn.value) return;
  try {
    const res = await ctx.api.json<{ trips: MyTrip[] }>(
      `/clients/${ctx.station.clientId.value}/transport/my-trips`,
    );
    myTrips.value = res.trips;
    // Server caught up (or the trip completed and left my-trips): prune
    // local overlays so storage never grows unbounded.
    const liveOrders = new Map(res.trips.flatMap((t) => t.stops.map((s) => [s.orderId, s])));
    for (const orderId of Object.keys(pendingByOrder)) {
      const stop = liveOrders.get(orderId);
      if (
        !stop ||
        (STATUS_RANK[stop.status] ?? 0) >= (STATUS_RANK[pendingByOrder[orderId]!] ?? 0)
      ) {
        delete pendingByOrder[orderId];
      }
    }
    for (const orderId of Object.keys(scannedByOrder)) {
      const stop = liveOrders.get(orderId);
      if (!stop || (STATUS_RANK[stop.status] ?? 0) >= STATUS_RANK['collected']!) {
        delete scannedByOrder[orderId];
      }
    }
    for (const orderId of Object.keys(arrivedByOrder)) {
      const stop = liveOrders.get(orderId);
      if (!stop || (STATUS_RANK[stop.status] ?? 0) >= STATUS_RANK['delivered']!) {
        delete arrivedByOrder[orderId];
      }
    }
  } catch {
    // Offline / stale session — keep whatever we had; next load recovers.
  }
}

// ── Reporting (offline-first: direct → queue on network failure) ──────────
const reportBusy = ref<string | null>(null);

interface ReportBody {
  reason?: string;
  method?: 'scan' | 'pin';
  scannedRefs?: string[];
  pinEntered?: string;
  ageCheck?: { method: 'id-attestation' | 'visual-override'; docType?: string };
  photoRef?: string;
  arrivedAt?: string;
}

/** true = landed or queued; false = server refused (message in `error`). */
async function submitReport(
  trip: MyTrip,
  orderId: string | null,
  action: 'collected' | 'delivered' | 'failed',
  body: ReportBody,
): Promise<boolean> {
  const base = `/clients/${ctx.station.clientId.value}/transport/my-trips/${trip.tripId}`;
  const path =
    action === 'collected' && !orderId ? `${base}/collected` : `${base}/stops/${orderId}/${action}`;
  reportBusy.value = orderId ?? trip.tripId;
  error.value = null;
  try {
    let res: Response;
    try {
      res = await ctx.api.request(path, { method: 'POST', body });
    } catch {
      // Network down — hand to the offline outbox and carry on. The server
      // verifies the evidence when it drains (deferred verification).
      await ctx.queue.enqueue({ endpoint: path, body });
      if (orderId) pendingByOrder[orderId] = action;
      else for (const s of trip.stops) pendingByOrder[s.orderId] ??= 'collected';
      return true;
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      error.value = `Failed (${res.status}): ${detail}`;
      return false;
    }
    await loadMyTrips();
    return true;
  } finally {
    reportBusy.value = null;
  }
}

// ── Collection: scan parcels per stop, PIN override per order ─────────────
const collectScanValue = ref('');
const scanBusy = ref(false);
const collectError = ref<string | null>(null);

const collectingStops = (trip: MyTrip): MyTripStop[] =>
  trip.stops.filter((s) => effectiveStatus(s) === 'assigned');

const needsCollection = (trip: MyTrip): boolean => collectingStops(trip).length > 0;

const scannedFor = (stop: MyTripStop): string[] => scannedByOrder[stop.orderId] ?? [];

const stopFullyScanned = (stop: MyTripStop): boolean =>
  stop.parcels.length > 0 && stop.parcels.every((p) => scannedFor(stop).includes(p.ref));

async function applyCollectScan(trip: MyTrip, code: string): Promise<void> {
  const value = code.trim();
  if (!value) return;
  collectError.value = null;
  const stop = collectingStops(trip).find((s) => s.parcels.some((p) => p.ref === value));
  if (!stop) {
    collectError.value = `No parcel on this trip matches '${value}'.`;
    return;
  }
  const scanned = scannedByOrder[stop.orderId] ?? [];
  if (scanned.includes(value)) {
    collectError.value = `'${value}' is already scanned.`;
    return;
  }
  scannedByOrder[stop.orderId] = [...scanned, value];
  // Every parcel of this order accounted for → the order is collected.
  if (stopFullyScanned(stop)) {
    await submitReport(trip, stop.orderId, 'collected', {
      method: 'scan',
      scannedRefs: scannedByOrder[stop.orderId]!,
    });
  }
}

function onCollectWedgeScan(trip: MyTrip): void {
  void applyCollectScan(trip, collectScanValue.value);
  collectScanValue.value = '';
}

async function cameraCollectScan(trip: MyTrip): Promise<void> {
  scanBusy.value = true;
  collectError.value = null;
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
    const { camera } = await BarcodeScanner.requestPermissions();
    if (camera !== 'granted' && camera !== 'limited') throw new Error('camera permission denied');
    const { barcodes } = await BarcodeScanner.scan();
    const code = barcodes[0]?.rawValue;
    if (code) await applyCollectScan(trip, code);
  } catch (err) {
    collectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    scanBusy.value = false;
  }
}

// Pickup-PIN override: the STORE reads the pin out when a label won't scan
// (or a loose item has no barcode). Online we verify interactively first;
// offline the entered pin rides the queued report (deferred verification).
const pinDrawer = reactive({
  open: false,
  trip: null as MyTrip | null,
  stop: null as MyTripStop | null,
  pin: '',
  checking: false,
  note: null as string | null,
});

function openPinOverride(trip: MyTrip, stop: MyTripStop): void {
  pinDrawer.trip = trip;
  pinDrawer.stop = stop;
  pinDrawer.pin = '';
  pinDrawer.note = null;
  pinDrawer.open = true;
}

async function confirmPinOverride(): Promise<void> {
  const { trip, stop } = pinDrawer;
  if (!trip || !stop || !pinDrawer.pin.trim()) return;
  pinDrawer.checking = true;
  pinDrawer.note = null;
  const pin = pinDrawer.pin.trim();
  try {
    let verified: boolean | null = null; // null = offline (deferred)
    try {
      const res = await ctx.api.request(
        `/clients/${ctx.station.clientId.value}/transport/my-trips/${trip.tripId}/stops/${stop.orderId}/verify-pin`,
        { method: 'POST', body: { kind: 'pickup', pin } },
      );
      if (res.ok) verified = ((await res.json()) as { verified: boolean }).verified;
      else if (res.status === 429) {
        pinDrawer.note = 'Too many attempts — wait a few minutes.';
        return;
      }
      // Other statuses (pin not set, …): fall through and submit; the
      // server records the deferred outcome.
    } catch {
      verified = null; // offline — deferred verification on the report
    }
    if (verified === false) {
      pinDrawer.note = 'Wrong PIN — check with store staff.';
      return;
    }
    const ok = await submitReport(trip, stop.orderId, 'collected', {
      method: 'pin',
      pinEntered: pin,
    });
    if (ok) {
      pinDrawer.open = false;
      if (verified === null) collectError.value = null;
    }
  } finally {
    pinDrawer.checking = false;
  }
}

// ── Guided stop sequence (Andrew, 2026-07-14): stops run in VROOM order —
// navigate → arrived → proof → delivered, then the next stop unlocks. ────
const effectiveProof = (stop: MyTripStop): 'none' | 'pin' | 'picture' => {
  const reqs = stop.verification?.requirements as
    | (StopVerification['requirements'] & { deliveryProof?: 'none' | 'pin' | 'picture' })
    | undefined;
  if (!reqs) return 'none';
  return reqs.deliveryProof ?? (reqs.deliveryPin ? 'pin' : 'none');
};

/** The stop the driver works NOW: first non-terminal, in route order. */
const activeStopId = (trip: MyTrip): string | null =>
  trip.stops.find((s) => effectiveStatus(s) === 'collected')?.orderId ?? null;

/** Default maps app: geo intent on device, Google Maps directions in browser. */
const mapsHref = (stop: MyTripStop): string => {
  const geo = (stop.destination as { geo?: { lat: number; lng: number } }).geo;
  const label = encodeURIComponent(stop.destination.name ?? `Stop #${stop.shortId}`);
  if (geo) {
    return ctx.isNative
      ? `geo:${geo.lat},${geo.lng}?q=${geo.lat},${geo.lng}(${label})`
      : `https://www.google.com/maps/dir/?api=1&destination=${geo.lat},${geo.lng}`;
  }
  const q = encodeURIComponent(
    [stop.destination.name, stop.destination.address?.line1, stop.destination.address?.city]
      .filter(Boolean)
      .join(', '),
  );
  return ctx.isNative ? `geo:0,0?q=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
};

function markArrived(stop: MyTripStop): void {
  arrivedByOrder[stop.orderId] = new Date().toISOString();
}

// ── Delivery: pin + age verification at the door ──────────────────────────
const DOC_TYPES = [
  { value: 'id-card', label: 'ID' },
  { value: 'drivers-license', label: 'License' },
  { value: 'passport', label: 'Passport' },
] as const;

const deliverDrawer = reactive({
  open: false,
  trip: null as MyTrip | null,
  stop: null as MyTripStop | null,
  pin: '',
  noPin: false,
  /** null = unchecked; 'offline' = could not check (deferred). */
  pinChecked: null as null | 'verified' | 'mismatch' | 'offline',
  checking: false,
  ageMethod: null as null | 'id-attestation' | 'visual-override',
  docType: 'id-card' as string,
  /** Proof-of-delivery photo (base64, no prefix) when proof = 'picture'. */
  photoBase64: null as string | null,
  photoBusy: false,
  note: null as string | null,
});
const photoInput = ref<HTMLInputElement | null>(null);

async function capturePodPhoto(): Promise<void> {
  deliverDrawer.photoBusy = true;
  deliverDrawer.note = null;
  try {
    if (ctx.isNative) {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const shot = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        quality: 55,
        width: 1280,
      });
      deliverDrawer.photoBase64 = shot.base64String ?? null;
    } else {
      photoInput.value?.click();
    }
  } catch (err) {
    deliverDrawer.note = err instanceof Error ? err.message : String(err);
  } finally {
    deliverDrawer.photoBusy = false;
  }
}

/** Browser fallback: file input → canvas-compressed JPEG base64. */
function onPhotoPicked(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    deliverDrawer.photoBase64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1] ?? null;
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

const deliverRequirements = computed(
  () =>
    deliverDrawer.stop?.verification?.requirements ?? {
      pickupPin: false,
      deliveryPin: false,
      minAge: null,
      ageVisualOverrideAllowed: false,
    },
);

function openDeliver(trip: MyTrip, stop: MyTripStop): void {
  deliverDrawer.trip = trip;
  deliverDrawer.stop = stop;
  deliverDrawer.pin = '';
  deliverDrawer.noPin = false;
  deliverDrawer.pinChecked = null;
  deliverDrawer.ageMethod = null;
  deliverDrawer.docType = 'id-card';
  deliverDrawer.photoBase64 = null;
  deliverDrawer.note = null;
  const reqs = stop.verification?.requirements;
  if (effectiveProof(stop) === 'none' && (!reqs || reqs.minAge === null)) {
    // Nothing to verify — deliver straight away, no drawer ceremony.
    void submitReport(trip, stop.orderId, 'delivered', {
      ...(arrivedByOrder[stop.orderId] ? { arrivedAt: arrivedByOrder[stop.orderId] } : {}),
    });
    return;
  }
  deliverDrawer.open = true;
}

/** Verify BEFORE handover when online — wrong pin means keep the goods. */
async function checkDeliveryPin(): Promise<void> {
  const { trip, stop } = deliverDrawer;
  if (!trip || !stop || !deliverDrawer.pin.trim()) return;
  deliverDrawer.checking = true;
  deliverDrawer.note = null;
  try {
    const res = await ctx.api.request(
      `/clients/${ctx.station.clientId.value}/transport/my-trips/${trip.tripId}/stops/${stop.orderId}/verify-pin`,
      { method: 'POST', body: { kind: 'delivery', pin: deliverDrawer.pin.trim() } },
    );
    if (res.ok) {
      const { verified } = (await res.json()) as { verified: boolean };
      deliverDrawer.pinChecked = verified ? 'verified' : 'mismatch';
      if (!verified) deliverDrawer.note = 'Wrong PIN — do not hand over. Ask again or fail the stop.';
    } else if (res.status === 429) {
      deliverDrawer.note = 'Too many attempts — wait a few minutes.';
    } else {
      deliverDrawer.pinChecked = 'offline';
    }
  } catch {
    deliverDrawer.pinChecked = 'offline';
    deliverDrawer.note = 'Offline — the PIN will be verified when the report syncs.';
  } finally {
    deliverDrawer.checking = false;
  }
}

const drawerProof = computed(() =>
  deliverDrawer.stop ? effectiveProof(deliverDrawer.stop) : 'none',
);

const canDeliver = computed(() => {
  const reqs = deliverRequirements.value;
  if (reqs.minAge !== null && deliverDrawer.ageMethod === null) return false;
  if (drawerProof.value === 'pin' && !deliverDrawer.noPin && !deliverDrawer.pin.trim())
    return false;
  if (drawerProof.value === 'picture' && !deliverDrawer.photoBase64) return false;
  return true;
});

async function confirmDeliver(): Promise<void> {
  const { trip, stop } = deliverDrawer;
  if (!trip || !stop || !canDeliver.value) return;
  const reqs = deliverRequirements.value;
  const body: ReportBody = {};
  if (drawerProof.value === 'pin' && !deliverDrawer.noPin && deliverDrawer.pin.trim()) {
    body.pinEntered = deliverDrawer.pin.trim();
  }
  if (reqs.minAge !== null && deliverDrawer.ageMethod) {
    body.ageCheck = {
      method: deliverDrawer.ageMethod,
      ...(deliverDrawer.ageMethod === 'id-attestation' ? { docType: deliverDrawer.docType } : {}),
    };
  }
  const arrivedAt = arrivedByOrder[stop.orderId];
  if (arrivedAt) body.arrivedAt = arrivedAt;
  // Picture proof: upload with a CLIENT-GENERATED ref so the evidence can
  // reference it even when both calls queue offline (FIFO: photo first).
  if (drawerProof.value === 'picture' && deliverDrawer.photoBase64) {
    const photoRef = `pod_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const uploadPath = `/clients/${ctx.station.clientId.value}/pod-photos/${photoRef}`;
    const uploadBody = { imageBase64: deliverDrawer.photoBase64, contentType: 'image/jpeg' };
    try {
      const res = await ctx.api.request(uploadPath, { method: 'PUT', body: uploadBody });
      if (!res.ok) {
        deliverDrawer.note = `Photo upload failed (${res.status}) — try again.`;
        return;
      }
    } catch {
      // Offline — the photo drains from the outbox before the report does.
      await ctx.queue.enqueue({ endpoint: uploadPath, method: 'PUT', body: uploadBody });
    }
    body.photoRef = photoRef;
  }
  const ok = await submitReport(trip, stop.orderId, 'delivered', body);
  if (ok) deliverDrawer.open = false;
}

async function failStop(trip: MyTrip, stop: MyTripStop): Promise<void> {
  const reason = window.prompt('Why did this delivery fail?');
  if (reason === null) return; // cancelled the prompt
  await submitReport(trip, stop.orderId, 'failed', {
    reason,
    ...(arrivedByOrder[stop.orderId] ? { arrivedAt: arrivedByOrder[stop.orderId] } : {}),
  });
}

/** Legacy escape: orders without parcel refs can't scan — one bulk button. */
async function bulkCollect(trip: MyTrip): Promise<void> {
  await submitReport(trip, null, 'collected', {});
}

const tripHasScannableParcels = (trip: MyTrip): boolean =>
  collectingStops(trip).some((s) => s.parcels.length > 0);

// ── Offer / claim (unchanged flow) ────────────────────────────────────────
function stopCountdown(): void {
  if (countdown) clearInterval(countdown);
  countdown = null;
}

function startCountdown(expiresAt: string): void {
  stopCountdown();
  const tick = () => {
    secondsLeft.value = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000));
    if (secondsLeft.value === 0) {
      // Hold lapsed — the reservation frees itself server-side.
      offer.value = null;
      stopCountdown();
    }
  };
  tick();
  countdown = setInterval(tick, 500);
}

async function findWork(): Promise<void> {
  busy.value = true;
  error.value = null;
  emptyReason.value = null;
  try {
    const res = await ctx.api.json<{ offers: Offer[]; reason?: string }>(
      `/clients/${ctx.station.clientId.value}/transport/offers`,
      {
        method: 'POST',
        body: anchorRef.value.trim() ? { orderReference: anchorRef.value.trim() } : {},
      },
    );
    if (res.offers.length === 0) {
      emptyReason.value = res.reason ?? 'NO_OFFERABLE_ORDERS';
      offer.value = null;
      return;
    }
    offer.value = res.offers[0]!;
    startCountdown(offer.value.expiresAt);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function claim(): Promise<void> {
  if (!offer.value) return;
  busy.value = true;
  error.value = null;
  try {
    await ctx.api.json(
      `/clients/${ctx.station.clientId.value}/transport/offers/${offer.value.groupId}/claim`,
      { method: 'POST' },
    );
    offer.value = null;
    stopCountdown();
    await loadMyTrips();
  } catch (err) {
    // 410 = the hold lapsed or someone raced us — just look again.
    offer.value = null;
    stopCountdown();
    error.value = 'That offer expired — find work again.';
    void err;
  } finally {
    busy.value = false;
  }
}

function passOffer(): void {
  // Walking away is fine — the hold lapses on its own (EPOD semantics).
  offer.value = null;
  stopCountdown();
}

// Network regain: drain queued reports, then refresh from server truth.
const onOnline = (): void => {
  void ctx.queue.flush().then(() => loadMyTrips());
};

onMounted(() => {
  void loadMyTrips();
  window.addEventListener('online', onOnline);
});
watch(ctx.driverSignedIn, () => void loadMyTrips());
onUnmounted(() => {
  stopCountdown();
  window.removeEventListener('online', onOnline);
});
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <template v-if="!ctx.driverSignedIn.value">
      <UAlert
        description="Sign in with your staff code + PIN to see claimable work."
        color="info"
        variant="soft"
      />
      <UButton to="/driver-login" block size="lg">Driver sign in</UButton>
    </template>

    <template v-else>
      <div class="rounded-xl border border-neutral-200 bg-white p-4">
        <p class="text-sm font-semibold text-neutral-800">
          {{ ctx.driver.value?.displayName ?? 'Driver' }}
        </p>
        <p class="text-xs text-neutral-500">
          Depot <span class="font-mono">{{ ctx.driver.value?.depotRef }}</span>
          <template v-if="ctx.driver.value?.defaultVehicleReg">
            · <span class="font-mono">{{ ctx.driver.value.defaultVehicleReg }}</span>
          </template>
          <template v-if="ctx.driver.value?.defaultVehicleClass">
            ({{ ctx.driver.value.defaultVehicleClass }})
          </template>
        </p>
      </div>

      <!-- Find work (optionally anchored on a typed part number). Hidden
           while a trip is OPEN — one active trip per driver; the planner
           composes multi-stop routes, drivers never self-stack. -->
      <div v-if="!offer && !hasOpenTrip" class="flex flex-col gap-2">
        <UInput
          v-model="anchorRef"
          placeholder="Part number (optional — e.g. 1024)"
          inputmode="numeric"
          class="w-full"
        />
        <UButton block size="lg" :loading="busy" @click="findWork">Find work</UButton>
        <UAlert v-if="emptyMessage" :description="emptyMessage" color="neutral" variant="soft" />
      </div>
      <UAlert
        v-if="hasOpenTrip && !offer"
        description="Finish your current trip to claim more work."
        color="info"
        variant="soft"
      />

      <!-- The reserved offer, on a countdown -->
      <div v-if="offer" class="rounded-xl border-2 border-brand-400 bg-white p-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm font-semibold text-neutral-800">
            {{ offer.stops.length }} stop trip from
            <span class="font-mono">{{ offer.originRef }}</span>
          </p>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-bold"
            :class="secondsLeft > 10 ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'"
          >
            {{ secondsLeft }}s
          </span>
        </div>
        <ol class="mb-3 flex flex-col gap-1.5">
          <li v-for="(s, i) in offer.stops" :key="s.orderId" class="flex items-baseline gap-2">
            <span class="text-xs font-bold text-neutral-400">{{ i + 1 }}</span>
            <span class="text-sm">
              <span class="font-semibold">#{{ s.shortId }}</span>
              {{ s.destination.name }}
              <span class="text-xs text-neutral-500">
                {{ s.destination.address?.line1 }}
                <template v-if="s.legKm !== null"> · {{ s.legKm.toFixed(1) }} km</template>
              </span>
            </span>
          </li>
        </ol>
        <p v-if="offer.routeKm !== null" class="mb-3 text-xs text-neutral-500">
          Route ≈ {{ offer.routeKm.toFixed(1) }} km · {{ Math.round(offer.routeMinutes ?? 0) }} min
        </p>
        <div class="flex gap-2">
          <UButton block size="lg" :loading="busy" :disabled="secondsLeft === 0" @click="claim">
            Claim trip
          </UButton>
          <UButton color="neutral" variant="soft" size="lg" @click="passOffer">Pass</UButton>
        </div>
      </div>

      <!-- My trips — SERVER state, survives restarts (claims live here) -->
      <section v-if="myTrips.length > 0" class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold text-neutral-700">My trips</h2>
        <div
          v-for="t in myTrips"
          :key="t.tripId"
          class="rounded-xl border border-emerald-300 bg-white p-4"
        >
          <p class="mb-2 text-sm font-semibold text-neutral-800">
            Collect at <span class="font-mono">{{ t.originRef }}</span>
            <span v-if="t.routeKm !== null" class="font-normal text-neutral-500">
              · ≈{{ t.routeKm.toFixed(1) }} km
            </span>
          </p>

          <!-- ══ COLLECTION: scan each bag; a fully-scanned order confirms
               itself. PIN override per order when a label won't scan. ══ -->
          <div
            v-if="needsCollection(t)"
            class="mb-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3"
          >
            <p class="mb-2 text-sm font-semibold text-brand-800">📷 Collection — scan the bags</p>
            <div v-if="tripHasScannableParcels(t)" class="mb-2 flex gap-2">
              <UInput
                v-model="collectScanValue"
                placeholder="Scan bag barcode…"
                class="flex-1 font-mono"
                size="lg"
                autocomplete="off"
                @keyup.enter="onCollectWedgeScan(t)"
              />
              <UButton
                v-if="ctx.isNative"
                size="lg"
                variant="soft"
                :loading="scanBusy"
                @click="cameraCollectScan(t)"
              >
                📷
              </UButton>
            </div>
            <UAlert
              v-if="collectError"
              class="mb-2"
              :description="collectError"
              color="warning"
              variant="soft"
            />

            <div
              v-for="s in collectingStops(t)"
              :key="`collect-${s.orderId}`"
              class="mb-2 rounded-lg bg-white p-2"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold">
                  #{{ s.shortId }}
                  <span v-if="s.parcels.length > 0" class="text-xs font-normal text-neutral-500">
                    {{ scannedFor(s).length }} / {{ s.parcels.length }} scanned
                  </span>
                </p>
                <UButton size="xs" color="neutral" variant="soft" @click="openPinOverride(t, s)">
                  Can't scan? Store PIN
                </UButton>
              </div>
              <div v-if="s.parcels.length > 0" class="mt-1.5 flex flex-wrap gap-1">
                <span
                  v-for="p in s.parcels"
                  :key="p.ref"
                  class="rounded border px-1.5 py-0.5 font-mono text-[11px]"
                  :class="
                    scannedFor(s).includes(p.ref)
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-neutral-200 bg-white text-neutral-500'
                  "
                >
                  {{ scannedFor(s).includes(p.ref) ? '✓' : '' }} {{ p.ref }}
                </span>
              </div>
            </div>

            <!-- Orders without parcel refs can't scan-match: bulk escape. -->
            <UButton
              v-if="!tripHasScannableParcels(t)"
              block
              size="lg"
              icon="i-lucide-package-check"
              :loading="reportBusy === t.tripId"
              @click="bulkCollect(t)"
            >
              Collected — leaving the store
            </UButton>
          </div>

          <!-- ══ GUIDED STOPS (Andrew, 2026-07-14): route order — navigate →
               arrived → proof → delivered; the next stop then unlocks. ══ -->
          <ol class="mt-2 flex flex-col gap-2">
            <li
              v-for="(s, i) in t.stops"
              :key="s.orderId"
              class="rounded-lg border p-2.5"
              :class="
                activeStopId(t) === s.orderId && !needsCollection(t)
                  ? 'border-brand-400 bg-brand-50/40'
                  : 'border-neutral-100'
              "
            >
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 text-sm">
                  <span class="font-semibold">{{ i + 1 }}. #{{ s.shortId }}</span>
                  {{ s.destination.name }}
                  <span class="block truncate text-xs text-neutral-500">
                    {{ s.destination.address?.line1 }}
                    <template v-if="s.verification?.requirements.minAge != null">
                      · 🔞 {{ s.verification.requirements.minAge }}+
                    </template>
                    <template v-if="effectiveProof(s) === 'pin'"> · 🔑 PIN</template>
                    <template v-if="effectiveProof(s) === 'picture'"> · 📷 photo</template>
                  </span>
                </span>
                <span class="flex shrink-0 items-center gap-1">
                  <span
                    v-if="isPendingSync(s)"
                    class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                  >
                    syncing…
                  </span>
                  <span
                    v-if="effectiveStatus(s) !== 'collected'"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="
                      effectiveStatus(s) === 'delivered'
                        ? 'bg-emerald-100 text-emerald-700'
                        : effectiveStatus(s) === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-neutral-100 text-neutral-500'
                    "
                  >
                    {{ effectiveStatus(s) === 'assigned' ? 'to collect' : effectiveStatus(s) }}
                  </span>
                  <span
                    v-else-if="activeStopId(t) !== s.orderId"
                    class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-400"
                  >
                    waiting
                  </span>
                </span>
              </div>

              <!-- The ACTIVE stop's journey: navigate → arrived → proof. -->
              <div
                v-if="
                  activeStopId(t) === s.orderId &&
                  effectiveStatus(s) === 'collected' &&
                  !needsCollection(t)
                "
                class="mt-2 flex flex-wrap items-center gap-2"
              >
                <UButton
                  size="sm"
                  variant="soft"
                  :href="mapsHref(s)"
                  target="_blank"
                  rel="noopener"
                >
                  🧭 Navigate
                </UButton>
                <UButton
                  v-if="!arrivedByOrder[s.orderId]"
                  size="sm"
                  @click="markArrived(s)"
                >
                  📍 I've arrived
                </UButton>
                <template v-else>
                  <UButton
                    size="sm"
                    color="success"
                    :loading="reportBusy === s.orderId"
                    @click="openDeliver(t, s)"
                  >
                    Delivered
                  </UButton>
                  <UButton
                    size="sm"
                    color="error"
                    variant="soft"
                    :disabled="reportBusy === s.orderId"
                    @click="failStop(t, s)"
                  >
                    Failed
                  </UButton>
                </template>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <UAlert v-if="error" :description="error" color="error" variant="soft" />

      <!-- ══ Store-PIN override (collection) ══ -->
      <UDrawer v-model:open="pinDrawer.open" title="Store PIN override">
        <template #body>
          <div class="flex flex-col gap-4 p-1">
            <p class="text-sm text-neutral-600">
              Ask store staff for the pickup PIN for
              <span class="font-semibold">#{{ pinDrawer.stop?.shortId }}</span> — they can read it
              from their station or the flightboard.
            </p>
            <UInput
              v-model="pinDrawer.pin"
              placeholder="4-digit PIN"
              inputmode="numeric"
              class="font-mono"
              size="xl"
              autocomplete="off"
              autofocus
            />
            <UAlert
              v-if="pinDrawer.note"
              :description="pinDrawer.note"
              color="warning"
              variant="soft"
            />
            <UButton
              size="xl"
              block
              :loading="pinDrawer.checking"
              :disabled="!pinDrawer.pin.trim()"
              @click="confirmPinOverride"
            >
              Confirm collection
            </UButton>
            <UButton color="neutral" variant="ghost" block @click="pinDrawer.open = false">
              Cancel
            </UButton>
          </div>
        </template>
      </UDrawer>

      <!-- ══ Delivery verification (pin + age) ══ -->
      <UDrawer v-model:open="deliverDrawer.open" title="Confirm delivery">
        <template #body>
          <div class="flex flex-col gap-4 p-1">
            <p class="text-sm text-neutral-600">
              Stop <span class="font-semibold">#{{ deliverDrawer.stop?.shortId }}</span> —
              {{ deliverDrawer.stop?.destination.name }}
            </p>

            <template v-if="drawerProof === 'picture'">
              <div>
                <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Proof photo
                </p>
                <img
                  v-if="deliverDrawer.photoBase64"
                  :src="`data:image/jpeg;base64,${deliverDrawer.photoBase64}`"
                  class="mb-2 max-h-48 w-full rounded-lg object-cover"
                  alt="Proof of delivery"
                />
                <UButton
                  size="xl"
                  block
                  variant="soft"
                  :loading="deliverDrawer.photoBusy"
                  @click="capturePodPhoto"
                >
                  {{ deliverDrawer.photoBase64 ? '📷 Retake photo' : '📷 Take proof photo' }}
                </UButton>
                <input
                  ref="photoInput"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  class="hidden"
                  @change="onPhotoPicked"
                />
              </div>
            </template>

            <template v-if="drawerProof === 'pin'">
              <div>
                <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Customer PIN
                </p>
                <div class="flex gap-2">
                  <UInput
                    v-model="deliverDrawer.pin"
                    placeholder="4-digit PIN"
                    inputmode="numeric"
                    class="flex-1 font-mono"
                    size="xl"
                    autocomplete="off"
                    :disabled="deliverDrawer.noPin"
                  />
                  <UButton
                    size="xl"
                    variant="soft"
                    :loading="deliverDrawer.checking"
                    :disabled="deliverDrawer.noPin || !deliverDrawer.pin.trim()"
                    @click="checkDeliveryPin"
                  >
                    Check
                  </UButton>
                </div>
                <p
                  v-if="deliverDrawer.pinChecked === 'verified'"
                  class="mt-1 text-xs font-semibold text-emerald-600"
                >
                  ✓ PIN verified — hand over.
                </p>
                <label class="mt-2 flex items-center gap-2 text-xs text-neutral-500">
                  <input v-model="deliverDrawer.noPin" type="checkbox" />
                  Customer can't provide the PIN (will be flagged for review)
                </label>
              </div>
            </template>

            <template v-if="deliverRequirements.minAge !== null">
              <div>
                <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Age check — {{ deliverRequirements.minAge }}+ order
                </p>
                <p class="mb-2 text-xs text-neutral-500">
                  Check the customer's ID: born
                  {{ new Date().getFullYear() - deliverRequirements.minAge }} or earlier.
                </p>
                <div class="flex gap-2">
                  <button
                    v-for="d in DOC_TYPES"
                    :key="d.value"
                    class="h-12 flex-1 rounded-lg border-2 text-sm font-semibold transition-colors"
                    :class="
                      deliverDrawer.ageMethod === 'id-attestation' && deliverDrawer.docType === d.value
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-neutral-200 bg-white text-neutral-600'
                    "
                    @click="
                      deliverDrawer.ageMethod = 'id-attestation';
                      deliverDrawer.docType = d.value;
                    "
                  >
                    {{ d.label }}
                  </button>
                </div>
                <UButton
                  v-if="deliverRequirements.ageVisualOverrideAllowed"
                  class="mt-2"
                  color="neutral"
                  :variant="deliverDrawer.ageMethod === 'visual-override' ? 'solid' : 'soft'"
                  block
                  @click="deliverDrawer.ageMethod = 'visual-override'"
                >
                  Visibly well over {{ deliverRequirements.minAge }} — no ID checked
                </UButton>
              </div>
            </template>

            <UAlert
              v-if="deliverDrawer.note"
              :description="deliverDrawer.note"
              :color="deliverDrawer.pinChecked === 'mismatch' ? 'error' : 'warning'"
              variant="soft"
            />

            <UButton
              size="xl"
              block
              :color="deliverDrawer.pinChecked === 'mismatch' ? 'error' : 'primary'"
              :disabled="!canDeliver"
              :loading="reportBusy === deliverDrawer.stop?.orderId"
              @click="confirmDeliver"
            >
              {{
                deliverDrawer.pinChecked === 'mismatch'
                  ? 'Deliver anyway (flagged)'
                  : 'Confirm delivered'
              }}
            </UButton>
            <UButton color="neutral" variant="ghost" block @click="deliverDrawer.open = false">
              Cancel
            </UButton>
          </div>
        </template>
      </UDrawer>
    </template>
  </div>
</template>
