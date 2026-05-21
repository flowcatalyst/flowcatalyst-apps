<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { apiFetch } from "@/api/client";
import { useClientStore } from "@/stores/client";
import { toast } from "@/utils/errorBus";
import { getErrorMessage } from "@/utils/errors";

const router = useRouter();
const clientStore = useClientStore();
const saving = ref(false);
const clientId = computed(() => clientStore.selectedClientId);

const layerTypeOptions = [
	{ label: "Radius", value: "RADIUS" },
	{ label: "Polygon", value: "POLYGON" },
	{ label: "Point", value: "POINT" },
];

const form = ref({
	code: "",
	name: "",
	layerType: "RADIUS" as string,
	radius: 1000 as number | null,
});

async function handleSubmit() {
	saving.value = true;
	try {
		if (!clientId.value) return;
		const result = await apiFetch<{ id: string }>(`/clients/${clientId.value}/layers`, {
			method: "POST",
			body: JSON.stringify(form.value),
		});
		toast.success("Layer Created", `Layer "${form.value.name}" has been created.`);
		await router.push(`/layers/${result.id}`);
	} catch (e) {
		toast.error("Failed to create layer", getErrorMessage(e, "Unknown error"));
	} finally {
		saving.value = false;
	}
}
</script>

<template>
  <div class="page-container" style="max-width: 800px;">
    <div class="page-header">
      <div>
        <h1 class="page-title">New Layer</h1>
        <p class="page-subtitle">Define a geographic region</p>
      </div>
    </div>

    <div class="fc-card">
      <form @submit.prevent="handleSubmit">
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label for="code" style="display: block; margin-bottom: 6px; font-weight: 500;">Code</label>
            <InputText
              id="code"
              v-model="form.code"
              placeholder="e.g. delivery-zones"
              class="w-full"
              required
            />
            <small style="color: #64748b;">Unique identifier. Cannot be changed after creation.</small>
          </div>

          <div>
            <label for="name" style="display: block; margin-bottom: 6px; font-weight: 500;">Name</label>
            <InputText
              id="name"
              v-model="form.name"
              placeholder="Enter layer name"
              class="w-full"
              required
            />
          </div>

          <div>
            <label for="layer_type" style="display: block; margin-bottom: 6px; font-weight: 500;">Type</label>
            <Select
              id="layer_type"
              v-model="form.layerType"
              :options="layerTypeOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
          </div>

          <div v-if="form.layerType === 'RADIUS'">
            <label style="display: block; margin-bottom: 6px; font-weight: 500;">Default Radius (meters)</label>
            <InputNumber v-model="form.radius" :min="1" :max="100000" suffix=" m" class="w-full" />
            <small style="color: #64748b;">All features in this layer will use this radius.</small>
          </div>

          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <Button
              label="Cancel"
              severity="secondary"
              @click="router.back()"
            />
            <Button
              label="Create Layer"
              type="submit"
              :loading="saving"
            />
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
