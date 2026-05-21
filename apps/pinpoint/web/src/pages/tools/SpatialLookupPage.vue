<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { apiFetch } from "@/api/client";
import { useClientStore } from "@/stores/client";
import { toast } from "@/utils/errorBus";
import { getErrorMessage } from "@/utils/errors";

interface LookupFeature {
	layerId: string;
	layerCode: string;
	layerName: string;
	layerType: string;
	featureId: string;
	featureLabel: string;
	distanceMeters: number | null;
	properties: Record<string, string>;
}

interface LookupResponse {
	latitude: number;
	longitude: number;
	results: LookupFeature[];
}

interface Layer {
	id: string;
	code: string;
	name: string;
	layerType: string;
}

const clientStore = useClientStore();
const clientId = computed(() => clientStore.selectedClientId);

const lat = ref<number | null>(null);
const lon = ref<number | null>(null);
const layers = ref<Layer[]>([]);
const selectedLayerCodes = ref<string[]>([]);
const loading = ref(false);
const results = ref<LookupFeature[]>([]);
const lookupCoords = ref<{ lat: number; lon: number } | null>(null);

async function loadLayers() {
	if (!clientId.value) return;
	try {
		const resp = await apiFetch<{ items: Layer[] }>(`/clients/${clientId.value}/layers`);
		layers.value = resp.items;
	} catch { /* optional */ }
}

onMounted(loadLayers);
watch(clientId, loadLayers);

function onMapClick(data: { lat: number; lon: number }) {
	lat.value = data.lat;
	lon.value = data.lon;
}

async function handleLookup() {
	if (!clientId.value || lat.value == null || lon.value == null) return;
	loading.value = true;
	results.value = [];
	try {
		const body: Record<string, unknown> = {
			latitude: lat.value,
			longitude: lon.value,
		};
		if (selectedLayerCodes.value.length > 0) body["layerCodes"] = selectedLayerCodes.value;

		const resp = await apiFetch<LookupResponse>(
			`/clients/${clientId.value}/spatial-lookup`,
			{ method: "POST", body: JSON.stringify(body) },
		);
		results.value = resp.results;
		lookupCoords.value = { lat: resp.latitude, lon: resp.longitude };
		if (resp.results.length === 0) {
			toast.info("No Results", "No layer features found at this location.");
		}
	} catch (e) {
		toast.error("Lookup failed", getErrorMessage(e, "Unknown error"));
	} finally {
		loading.value = false;
	}
}
</script>

<template>
  <div class="page-container" style="max-width: 1100px;">
    <div class="page-header">
      <div>
        <h1 class="page-title">Spatial Lookup</h1>
        <p class="page-subtitle">
          {{ clientStore.selectedClient?.name ?? 'Select a client' }} — Find layer features at a coordinate
        </p>
      </div>
    </div>

    <div v-if="!clientId" class="fc-card" style="text-align: center; padding: 48px;">
      <i class="pi pi-building" style="font-size: 48px; color: #bcccdc;"></i>
      <p style="color: #64748b; margin-top: 16px;">Select a client first</p>
      <RouterLink to="/clients" style="color: #0967d2;">Go to Clients</RouterLink>
    </div>

    <template v-else>
      <div class="fc-card" style="margin-bottom: 16px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Latitude</label>
            <InputNumber v-model="lat" :min-fraction-digits="1" :max-fraction-digits="8" class="w-full" placeholder="-26.2041" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Longitude</label>
            <InputNumber v-model="lon" :min-fraction-digits="1" :max-fraction-digits="8" class="w-full" placeholder="28.0473" />
          </div>
          <div style="display: flex; align-items: flex-end;">
            <Button
              label="Lookup"
              icon="pi pi-search"
              :loading="loading"
              :disabled="lat == null || lon == null"
              @click="handleLookup"
            />
          </div>
        </div>
        <div v-if="layers.length > 0" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Layers (optional — leave empty for all)</label>
          <MultiSelect
            v-model="selectedLayerCodes"
            :options="layers"
            option-label="name"
            option-value="code"
            filter
            filter-placeholder="Search layers..."
            display="chip"
            placeholder="All Layers"
            class="w-full"
          />
        </div>
        <div>
          <label style="display: block; margin-bottom: 6px; font-weight: 500; font-size: 13px;">Click map to set coordinates</label>
          <PpLayerEditor
            mode="point"
            :center-lat="lat ?? -26.2"
            :center-lon="lon ?? 28.0"
            @point-change="onMapClick"
          />
        </div>
      </div>

      <!-- Results -->
      <div v-if="results.length > 0" class="fc-card">
        <h3 style="margin: 0 0 12px; font-size: 16px; color: #243b53;">
          <i class="pi pi-sitemap" style="margin-right: 8px;"></i>
          Results
          <Tag :value="String(results.length)" severity="info" style="margin-left: 8px;" />
        </h3>
        <DataTable :value="results" size="small">
          <Column field="layerName" header="Layer">
            <template #body="{ data }">
              <RouterLink :to="`/layers/${(data as LookupFeature).layerId}`" class="link">
                {{ (data as LookupFeature).layerName }}
              </RouterLink>
              <span style="color: #94a3b8; font-size: 12px; margin-left: 4px;">({{ (data as LookupFeature).layerCode }})</span>
            </template>
          </Column>
          <Column field="featureLabel" header="Feature" />
          <Column field="layerType" header="Type">
            <template #body="{ data }">
              <Tag :value="(data as LookupFeature).layerType" size="small" />
            </template>
          </Column>
          <Column header="Distance">
            <template #body="{ data }">
              <span v-if="(data as LookupFeature).distanceMeters != null">
                {{ Math.round((data as LookupFeature).distanceMeters!) }} m
              </span>
              <span v-else style="color: #94a3b8;">Contains</span>
            </template>
          </Column>
          <Column header="Properties">
            <template #body="{ data }">
              <div v-for="(val, key) in (data as LookupFeature).properties" :key="key" style="font-size: 13px;">
                <strong>{{ key }}:</strong> {{ val }}
              </div>
              <span v-if="Object.keys((data as LookupFeature).properties).length === 0" style="color: #94a3b8;">—</span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>
</template>

<style scoped>
.link {
  color: #0967d2;
  text-decoration: none;
  font-weight: 500;
}
.link:hover {
  text-decoration: underline;
}
</style>
