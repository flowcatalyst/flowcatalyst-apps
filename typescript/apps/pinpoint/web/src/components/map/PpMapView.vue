<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const props = withDefaults(
  defineProps<{
    latitude?: number;
    longitude?: number;
    zoom?: number;
    markers?: Array<{ lat: number; lon: number; label?: string; popup?: string }>;
    geojson?: string;
  }>(),
  {
    latitude: -26.2,
    longitude: 28.0,
    zoom: 12,
    markers: () => [],
    geojson: '',
  },
);

const mapContainer = ref<HTMLElement | null>(null);
let map: L.Map | null = null;
let markerLayer: L.LayerGroup | null = null;
let geojsonLayer: L.GeoJSON | null = null;

onMounted(() => {
  if (!mapContainer.value) return;

  map = L.map(mapContainer.value).setView([props.latitude, props.longitude], props.zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  updateMarkers();
  updateGeoJson();
});

onUnmounted(() => {
  map?.remove();
  map = null;
});

function updateMarkers() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();

  if (props.markers.length > 0) {
    const bounds: L.LatLngExpression[] = [];
    for (const m of props.markers) {
      const marker = L.marker([m.lat, m.lon]);
      if (m.popup) marker.bindPopup(m.popup);
      if (m.label) marker.bindTooltip(m.label);
      marker.addTo(markerLayer);
      bounds.push([m.lat, m.lon]);
    }
    if (bounds.length > 1) {
      map.fitBounds(bounds as L.LatLngBoundsExpression);
    }
  } else if (props.latitude !== -26.2 || props.longitude !== 28.0) {
    // Single point from latitude/longitude props
    L.marker([props.latitude, props.longitude]).addTo(markerLayer);
  }
}

function updateGeoJson() {
  if (!map) return;

  if (geojsonLayer) {
    map.removeLayer(geojsonLayer);
    geojsonLayer = null;
  }

  if (props.geojson) {
    try {
      const data = JSON.parse(props.geojson) as GeoJSON.GeoJsonObject;
      geojsonLayer = L.geoJSON(data, {
        style: {
          color: '#0967d2',
          weight: 2,
          fillOpacity: 0.15,
        },
      }).addTo(map);
      map.fitBounds(geojsonLayer.getBounds());
    } catch {
      // Invalid GeoJSON
    }
  }
}

watch(
  () => [props.latitude, props.longitude, props.zoom],
  () => {
    map?.setView([props.latitude, props.longitude], props.zoom);
    updateMarkers();
  },
);

watch(() => props.markers, updateMarkers, { deep: true });
watch(() => props.geojson, updateGeoJson);
</script>

<template>
  <div ref="mapContainer" class="map-container"></div>
</template>

<style scoped>
.map-container {
  width: 100%;
  height: 400px;
  border-radius: 8px;
  overflow: hidden;
}
</style>
