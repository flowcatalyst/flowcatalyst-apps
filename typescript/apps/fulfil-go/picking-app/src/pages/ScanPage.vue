<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();
const scanned = ref<string | null>(null);
const manual = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

/** The pick list: barcode value matched against job ids for the scaffold. */
const match = computed(() =>
  scanned.value ? ctx.jobs.jobs.value.find((j) => j.id === scanned.value) : undefined,
);

/**
 * MLKit scanner is native-only; loaded dynamically so it never enters the
 * web bundle path. Browser dev falls back to the manual entry field below.
 */
async function scan(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
    const { camera } = await BarcodeScanner.requestPermissions();
    if (camera !== 'granted' && camera !== 'limited') {
      throw new Error('camera permission denied');
    }
    const { barcodes } = await BarcodeScanner.scan();
    scanned.value = barcodes[0]?.rawValue ?? null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function applyManual(): void {
  scanned.value = manual.value.trim() || null;
}

async function confirmPick(): Promise<void> {
  if (!match.value) return;
  // Offline-queued like every mobile mutation: accept when newly assigned,
  // complete when the pick was already accepted.
  if (match.value.status === 'assigned') await ctx.jobs.accept(match.value.id);
  else if (match.value.status === 'accepted') await ctx.jobs.complete(match.value.id);
  scanned.value = null;
  manual.value = '';
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <UButton v-if="ctx.isNative" size="xl" block :loading="busy" @click="scan">
      Scan barcode
    </UButton>
    <template v-else>
      <p class="text-sm text-neutral-500">
        Browser dev mode — camera scanning runs on-device. Enter a job id manually:
      </p>
      <div class="flex gap-2">
        <UInput v-model="manual" placeholder="job_…" class="flex-1" />
        <UButton variant="soft" @click="applyManual">Apply</UButton>
      </div>
    </template>

    <UAlert v-if="error" :description="error" color="error" variant="soft" />

    <template v-if="scanned">
      <UAlert
        v-if="!match"
        :title="`No pick found for '${scanned}'`"
        color="warning"
        variant="soft"
      />
      <UCard v-else>
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate font-medium">{{ match.title }}</p>
            <p class="text-sm text-neutral-500">{{ match.status }}</p>
          </div>
          <UButton
            v-if="match.status === 'assigned' || match.status === 'accepted'"
            @click="confirmPick"
          >
            {{ match.status === 'assigned' ? 'Start pick' : 'Confirm pick' }}
          </UButton>
        </div>
      </UCard>
    </template>
  </div>
</template>
