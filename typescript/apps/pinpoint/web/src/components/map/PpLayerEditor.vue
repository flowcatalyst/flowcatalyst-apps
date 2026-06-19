<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const props = withDefaults(
  defineProps<{
    mode?: 'radius' | 'polygon' | 'point' | '';
    centerLat?: number;
    centerLon?: number;
    radius?: number;
    geojson?: string;
    readonly?: boolean;
  }>(),
  {
    mode: '',
    centerLat: -26.2,
    centerLon: 28.0,
    radius: 1000,
    geojson: '',
    readonly: false,
  },
);

const emit = defineEmits<{
  radiusChange: [payload: { lat: number; lon: number; radius: number }];
  polygonChange: [payload: { geojson: string }];
  pointChange: [payload: { lat: number; lon: number }];
}>();

const mapContainer = ref<HTMLElement | null>(null);
let map: L.Map | null = null;
let circle: L.Circle | null = null;
let pointMarker: L.Marker | null = null;
let polygon: L.Polygon | null = null;
let geojsonLayer: L.GeoJSON | null = null;
const polygonPoints = ref<L.LatLng[]>([]);
const tempMarkers: L.Marker[] = [];

onMounted(() => {
  if (!mapContainer.value) return;

  map = L.map(mapContainer.value).setView([props.centerLat, props.centerLon], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  initializeMode();

  if (!props.readonly) {
    map.on('click', handleMapClick);
    map.on('dblclick', handleMapDblClick);
  }

  // Leaflet needs repeated size recalc when inside dialogs/animations
  const resizeInterval = setInterval(() => {
    if (map) {
      map.invalidateSize();
      const container = map.getContainer();
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        clearInterval(resizeInterval);
      }
    }
  }, 200);
  setTimeout(() => clearInterval(resizeInterval), 3000);
});

onUnmounted(() => {
  map?.remove();
  map = null;
});

function initializeMode() {
  if (!map) return;
  clearDrawing();

  // Show existing point marker
  if (props.mode === 'point' && props.centerLat !== -26.2 && props.centerLon !== 28.0) {
    pointMarker = L.marker([props.centerLat, props.centerLon]).addTo(map);
    map.setView([props.centerLat, props.centerLon], 14);
  }

  // Show existing radius if center coordinates were provided (not default)
  if (props.mode === 'radius' && props.centerLat !== -26.2 && props.centerLon !== 28.0) {
    circle = L.circle([props.centerLat, props.centerLon], {
      radius: props.radius,
      color: '#0967d2',
      fillOpacity: 0.15,
    }).addTo(map);
    map.fitBounds(circle.getBounds());
  }

  if (props.geojson) {
    try {
      const data = JSON.parse(props.geojson) as GeoJSON.GeoJsonObject;
      geojsonLayer = L.geoJSON(data, {
        style: { color: '#0967d2', weight: 2, fillOpacity: 0.15 },
      }).addTo(map);
      map.fitBounds(geojsonLayer.getBounds());
    } catch {
      // Invalid GeoJSON
    }
  }
}

function clearDrawing() {
  if (circle) {
    map?.removeLayer(circle);
    circle = null;
  }
  if (pointMarker) {
    map?.removeLayer(pointMarker);
    pointMarker = null;
  }
  if (polygon) {
    map?.removeLayer(polygon);
    polygon = null;
  }
  if (geojsonLayer) {
    map?.removeLayer(geojsonLayer);
    geojsonLayer = null;
  }
  for (const m of tempMarkers) {
    map?.removeLayer(m);
  }
  tempMarkers.length = 0;
  polygonPoints.value = [];
}

function handleMapClick(e: L.LeafletMouseEvent) {
  if (props.readonly || !map) return;

  if (props.mode === 'point') {
    if (pointMarker) map.removeLayer(pointMarker);
    pointMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);
    emit('pointChange', { lat: e.latlng.lat, lon: e.latlng.lng });
  } else if (props.mode === 'radius') {
    if (circle) map.removeLayer(circle);
    circle = L.circle([e.latlng.lat, e.latlng.lng], {
      radius: props.radius,
      color: '#0967d2',
      fillOpacity: 0.15,
    }).addTo(map);
    emit('radiusChange', {
      lat: e.latlng.lat,
      lon: e.latlng.lng,
      radius: props.radius,
    });
  } else if (props.mode === 'polygon') {
    polygonPoints.value.push(e.latlng);
    const marker = L.marker(e.latlng, {
      icon: L.divIcon({ className: 'polygon-vertex', iconSize: [10, 10] }),
    }).addTo(map);
    tempMarkers.push(marker);

    if (polygon) map.removeLayer(polygon);
    if (polygonPoints.value.length >= 2) {
      polygon = L.polygon(polygonPoints.value, {
        color: '#0967d2',
        weight: 2,
        fillOpacity: 0.15,
        dashArray: '5,5',
      }).addTo(map);
    }
  }
}

function handleMapDblClick(e: L.LeafletMouseEvent) {
  if (props.readonly || !map || props.mode !== 'polygon') return;
  e.originalEvent.preventDefault();

  if (polygonPoints.value.length >= 3) {
    if (polygon) map.removeLayer(polygon);
    polygon = L.polygon(polygonPoints.value, {
      color: '#0967d2',
      weight: 2,
      fillOpacity: 0.15,
    }).addTo(map);

    for (const m of tempMarkers) {
      map.removeLayer(m);
    }
    tempMarkers.length = 0;

    const geojsonData = polygon.toGeoJSON();
    emit('polygonChange', { geojson: JSON.stringify(geojsonData.geometry) });
  }
}

watch(
  () => props.mode,
  () => {
    initializeMode();
  },
);

watch(
  () => props.radius,
  (newRadius) => {
    if (circle && map) {
      circle.setRadius(newRadius);
      emit('radiusChange', {
        lat: circle.getLatLng().lat,
        lon: circle.getLatLng().lng,
        radius: newRadius,
      });
    }
  },
);
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

<style>
.polygon-vertex {
  background: #0967d2;
  border: 2px solid white;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
</style>
