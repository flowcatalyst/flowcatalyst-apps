<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { QueueItem } from '@fulfil-go/mobile-kit';
import type { PrinterDto } from '@fulfil-go/shared';
import { useAppCtx } from '../context.js';
import { printZpl } from '../print/print.js';

const ctx = useAppCtx();
const router = useRouter();
const dead = ref<readonly QueueItem[]>([]);

async function refreshDead(): Promise<void> {
  dead.value = await ctx.queue.listDead();
}
onMounted(() => {
  void refreshDead();
  ctx.queue.onChange(() => void refreshDead());
});

// ── Station printer (docs/bag-label-printing.md): the registry is store
// equipment; the STATION picks its printer here, like the store binding.
// Listing needs a picker session (the server scopes it to the token's store).
const printers = ref<readonly PrinterDto[]>([]);
const printerError = ref<string | null>(null);
const printerNotice = ref<string | null>(null);
const testBusy = ref(false);

async function loadPrinters(): Promise<void> {
  printerError.value = null;
  if (!ctx.signedIn.value || !ctx.station.configured()) return;
  try {
    const res = await ctx.api.json<{ printers: PrinterDto[] }>(
      `/clients/${ctx.station.clientId.value}/printers`,
    );
    printers.value = res.printers.filter((p) => p.active);
  } catch (err) {
    printerError.value = err instanceof Error ? err.message : String(err);
  }
}
onMounted(() => void loadPrinters());
watch(ctx.signedIn, () => void loadPrinters());

const printerItems = computed(() =>
  printers.value.map((p) => ({ label: `${p.name} — ${p.host}:${p.port}`, value: p.id })),
);
const selectedPrinter = computed({
  get: () => (ctx.station.printerId.value.length > 0 ? ctx.station.printerId.value : undefined),
  set: (id: string | undefined) => {
    const printer = printers.value.find((p) => p.id === id);
    ctx.station.printerId.value = printer?.id ?? '';
    ctx.station.printerName.value = printer?.name ?? '';
  },
});

async function testPrint(): Promise<void> {
  testBusy.value = true;
  printerError.value = null;
  printerNotice.value = null;
  try {
    const printer = printers.value.find((p) => p.id === ctx.station.printerId.value) ?? null;
    await printZpl(
      printer ? { host: printer.host, port: printer.port } : null,
      '^XA^CI28^PW600^LL300^FO40,60^A0N,60,60^FDfulfil-go^FS^FO40,140^A0N,40,40^FDstation test label^FS^XZ',
    );
    printerNotice.value = 'Test label sent.';
  } catch (err) {
    printerError.value = err instanceof Error ? err.message : String(err);
  } finally {
    testBusy.value = false;
  }
}

async function exit(): Promise<void> {
  await ctx.exit();
  await router.push('/login');
}
</script>

<template>
  <div class="flex flex-col gap-6 p-4">
    <section class="flex flex-col gap-3">
      <h2 class="font-semibold">Station</h2>
      <p class="text-xs text-neutral-500">
        This station is bound to one store — set once by an admin. (Manual stand-in for device
        enrollment; see pick-context-auth.md.)
      </p>
      <UFormField label="Client id">
        <UInput v-model="ctx.station.clientId.value" placeholder="clt_…" class="w-full font-mono" />
      </UFormField>
      <UFormField label="Store ref">
        <UInput
          v-model="ctx.station.storeRef.value"
          placeholder="store-001"
          class="w-full font-mono"
        />
      </UFormField>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="font-semibold">Label printer</h2>
      <p class="text-xs text-neutral-500">
        Bag labels print to this station's printer (registered under Stores → Printers in
        management). In browser dev, delivery goes via Zebra Browser Print's local agent instead.
      </p>
      <UAlert v-if="printerError" :description="printerError" color="error" variant="soft" />
      <UAlert v-if="printerNotice" :description="printerNotice" color="success" variant="soft" />
      <template v-if="ctx.signedIn.value">
        <UFormField label="Printer">
          <USelect
            v-model="selectedPrinter"
            :items="printerItems"
            placeholder="Choose the station's printer…"
            class="w-full"
          />
        </UFormField>
        <div class="flex gap-2">
          <UButton variant="soft" :loading="testBusy" @click="testPrint">Print test label</UButton>
          <UButton color="neutral" variant="ghost" @click="loadPrinters">Refresh list</UButton>
        </div>
      </template>
      <p v-else class="text-xs text-neutral-400">
        Sign in to choose a printer — the list is scoped to this station's store.
        <template v-if="ctx.station.printerName.value">
          Currently bound: <span class="font-mono">{{ ctx.station.printerName.value }}</span
          >.
        </template>
      </p>
    </section>

    <section v-if="dead.length > 0" class="flex flex-col gap-2">
      <h2 class="font-semibold">Failed submissions</h2>
      <UCard v-for="item in dead" :key="item.id">
        <div class="flex items-center justify-between gap-2 text-sm">
          <div class="min-w-0">
            <p class="truncate font-mono">{{ item.method }} {{ item.endpoint }}</p>
            <p class="truncate text-xs text-neutral-500">{{ item.lastError }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <UButton size="xs" variant="soft" @click="ctx.queue.retryDead(item.id)">Retry</UButton>
            <UButton size="xs" color="error" variant="soft" @click="ctx.queue.discardDead(item.id)">
              Discard
            </UButton>
          </div>
        </div>
      </UCard>
    </section>

    <section v-if="ctx.signedIn.value" class="flex flex-col gap-2">
      <h2 class="font-semibold">Session</h2>
      <p class="text-xs text-neutral-500">
        Signed in as <span class="font-mono">{{ ctx.pickerId.value }}</span>
      </p>
      <UButton color="neutral" variant="soft" block @click="exit">Exit — end my session</UButton>
    </section>
    <UButton v-else variant="soft" block to="/login">Go to sign in</UButton>
  </div>
</template>
