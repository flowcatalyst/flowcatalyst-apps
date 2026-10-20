<script setup lang="ts">
/**
 * Requests per period — a single-series column chart (plain SVG). One series,
 * so no legend: the card title names it. Hover or focus a period for its exact
 * requests and errors; the breakdown table below is the table view.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface UsagePoint {
  readonly start: string;
  readonly label: string;
  readonly title: string;
  readonly requests: number;
  readonly errors: number;
}

const props = defineProps<{ points: readonly UsagePoint[] }>();
const emit = defineEmits<{ select: [point: UsagePoint] }>();

const HEIGHT = 240;
const M = { top: 12, right: 8, bottom: 28, left: 48 };
const MAX_BAR = 24;

const root = ref<HTMLDivElement | null>(null);
const width = ref(640);
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!root.value) return;
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = Math.max(240, entry.contentRect.width);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const innerW = computed(() => width.value - M.left - M.right);
const innerH = HEIGHT - M.top - M.bottom;

/** A round axis maximum and 4 ticks (1-2-5 steps). */
const scale = computed(() => {
  const peak = Math.max(0, ...props.points.map((p) => p.requests));
  if (peak === 0) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = peak / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const steps = Math.max(1, Math.ceil(peak / step));
  return { max: step * steps, ticks: Array.from({ length: steps + 1 }, (_, i) => i * step) };
});

const y = (v: number) => M.top + innerH - (v / scale.value.max) * innerH;

const band = computed(() => innerW.value / Math.max(1, props.points.length));
const barW = computed(() => Math.max(2, Math.min(MAX_BAR, band.value * 0.6)));
/** Show every k-th label so labels (~64px each) never collide. */
const labelEvery = computed(() =>
  Math.max(1, Math.ceil(props.points.length / Math.max(1, Math.floor(innerW.value / 64)))),
);

/** Column path: square at the baseline, 4px rounded data-end. */
function barPath(i: number, value: number): string {
  if (value <= 0) return '';
  const x = M.left + i * band.value + (band.value - barW.value) / 2;
  const top = y(value);
  const base = y(0);
  const r = Math.min(4, barW.value / 2, base - top);
  const w = barW.value;
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

const hovered = ref<number | null>(null);
const tooltip = computed(() => {
  if (hovered.value === null) return null;
  const point = props.points[hovered.value];
  if (!point) return null;
  const cx = M.left + (hovered.value + 0.5) * band.value;
  const flip = cx > width.value - 180;
  return {
    point,
    left: flip ? cx - 12 : cx + 12,
    flip,
    top: Math.max(M.top, y(point.requests) - 8),
  };
});

const fmt = new Intl.NumberFormat('en-GB');
const summary = computed(() => {
  const total = props.points.reduce((n, p) => n + p.requests, 0);
  return `Requests per period: ${fmt.format(total)} in total across ${props.points.length} periods.`;
});
</script>

<template>
  <div ref="root" class="usage-chart">
    <svg :width="width" :height="HEIGHT" role="img" :aria-label="summary">
      <!-- recessive grid + y axis labels -->
      <g v-for="t in scale.ticks" :key="t">
        <line
          :x1="M.left"
          :x2="M.left + innerW"
          :y1="y(t)"
          :y2="y(t)"
          :class="t === 0 ? 'baseline' : 'grid'"
        />
        <text
          :x="M.left - 8"
          :y="y(t)"
          class="axis-label"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ fmt.format(t) }}
        </text>
      </g>
      <!-- columns -->
      <path
        v-for="(p, i) in points"
        :key="p.start"
        :d="barPath(i, p.requests)"
        class="bar"
        :class="{ dim: hovered !== null && hovered !== i }"
      />
      <!-- x labels -->
      <template v-for="(p, i) in points" :key="`l-${p.start}`">
        <text
          v-if="i % labelEvery === 0"
          :x="M.left + (i + 0.5) * band"
          :y="HEIGHT - 8"
          class="axis-label"
          text-anchor="middle"
        >
          {{ p.label }}
        </text>
      </template>
      <!-- hit targets: the whole band, taller than the mark -->
      <rect
        v-for="(p, i) in points"
        :key="`h-${p.start}`"
        :x="M.left + i * band"
        :y="M.top"
        :width="band"
        :height="innerH"
        class="hit"
        tabindex="0"
        :aria-label="`${p.title}: ${fmt.format(p.requests)} requests, ${fmt.format(p.errors)} errors`"
        @mouseenter="hovered = i"
        @mouseleave="hovered = null"
        @focus="hovered = i"
        @blur="hovered = null"
        @click="emit('select', p)"
        @keydown.enter="emit('select', p)"
      />
    </svg>
    <div
      v-if="tooltip"
      class="tip"
      :class="{ flip: tooltip.flip }"
      :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }"
    >
      <div class="tip-title">{{ tooltip.point.title }}</div>
      <div class="tip-row">
        <span class="swatch" /> Requests <strong>{{ fmt.format(tooltip.point.requests) }}</strong>
      </div>
      <div class="tip-row muted">
        Errors <strong>{{ fmt.format(tooltip.point.errors) }}</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.usage-chart {
  --series-1: #2a78d6;
  --text-secondary: #52514e;
  --text-primary: #0b0b0b;
  --grid: #ecebe7;
  --axis: #c9c8c2;
  --tip-surface: #ffffff;
  --tip-border: #e2e8f0;
  position: relative;
  width: 100%;
}
:global(.dark-mode) .usage-chart {
  --series-1: #3987e5;
  --text-secondary: #c3c2b7;
  --text-primary: #f0efec;
  --grid: #2b2b29;
  --axis: #4a4a46;
  --tip-surface: #1a1a19;
  --tip-border: #3a3a37;
}
svg {
  display: block;
  overflow: visible;
}
.grid {
  stroke: var(--grid);
  stroke-width: 1;
}
.baseline {
  stroke: var(--axis);
  stroke-width: 1;
}
.axis-label {
  fill: var(--text-secondary);
  font-size: 11px;
}
.bar {
  fill: var(--series-1);
  transition: opacity 120ms;
}
.bar.dim {
  opacity: 0.45;
}
.hit {
  fill: transparent;
  cursor: pointer;
  outline: none;
}
.hit:focus-visible {
  stroke: var(--series-1);
  stroke-width: 2;
}
.tip {
  position: absolute;
  pointer-events: none;
  transform: translateY(-100%);
  background: var(--tip-surface);
  border: 1px solid var(--tip-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-primary);
  box-shadow: 0 4px 12px rgb(0 0 0 / 8%);
  white-space: nowrap;
  z-index: 2;
}
.tip.flip {
  transform: translate(-100%, -100%);
}
.tip-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tip-row strong {
  margin-left: auto;
  padding-left: 12px;
}
.muted {
  color: var(--text-secondary);
}
.swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--series-1);
}
</style>
