<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { apiFetch } from "@/api/client";
import { toast } from "@/utils/errorBus";
import { getErrorMessage } from "@/utils/errors";

interface MatchingConfigDetail {
	id: string;
	scope: string;
	scope_id: string | null;
	scope_name: string | null;
	threshold: number;
	created_at: string;
	updated_at: string;
}

const route = useRoute();
const config = ref<MatchingConfigDetail | null>(null);
const loading = ref(true);
const saving = ref(false);
const editThreshold = ref(0);

onMounted(async () => {
	try {
		config.value = await apiFetch<MatchingConfigDetail>(
			`/matching-configs/${route.params["id"] as string}`,
		);
		editThreshold.value = config.value.threshold * 100;
	} catch {
		// handled by global error toast
	} finally {
		loading.value = false;
	}
});

async function handleSave() {
	if (!config.value) return;
	saving.value = true;
	try {
		await apiFetch(`/matching-configs/${config.value.id}`, {
			method: "PUT",
			body: JSON.stringify({ threshold: editThreshold.value / 100 }),
		});
		config.value.threshold = editThreshold.value / 100;
		toast.success("Saved", "Matching threshold updated.");
	} catch (e) {
		toast.error("Failed to save", getErrorMessage(e, "Unknown error"));
	} finally {
		saving.value = false;
	}
}
</script>

<template>
  <div class="page-container" style="max-width: 600px;">
    <ProgressSpinner v-if="loading" style="display: flex; justify-content: center; padding: 48px;" />

    <template v-else-if="config">
      <div class="page-header">
        <div>
          <h1 class="page-title">Matching Config</h1>
          <p class="page-subtitle">
            {{ config.scope }}{{ config.scope_name ? ` — ${config.scope_name}` : '' }}
          </p>
        </div>
        <Tag
          :value="config.scope"
          :severity="config.scope === 'GLOBAL' ? 'info' : config.scope === 'CLIENT' ? 'warn' : 'success'"
        />
      </div>

      <div class="fc-card">
        <div style="margin-bottom: 24px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">
            Matching Threshold: {{ editThreshold.toFixed(0) }}%
          </label>
          <Slider v-model="editThreshold" :min="0" :max="100" :step="1" class="w-full" />
          <p style="font-size: 13px; color: #64748b; margin-top: 8px;">
            Locations must score above this threshold to be considered a match.
          </p>
        </div>

        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <Button
            label="Save"
            :loading="saving"
            @click="handleSave"
          />
        </div>
      </div>
    </template>
  </div>
</template>
