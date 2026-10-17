<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { formatCount } from '../desktop/format'
import { t } from '../i18n'

type Place = { name: string; lat: number; lng: number; count: number }
const props = defineProps<{ places: Place[] }>()
const id = useId()
const zoom = ref(1)
const selectedIndex = ref<number | null>(null)
const points = computed(() => props.places.filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lng)))
const selected = computed(() => selectedIndex.value === null ? null : points.value[selectedIndex.value] ?? null)
const wrap = (value: number, period: number) => ((value % period) + period) % period
// Equirectangular: one degree in either direction is one SVG unit. Unlike
// Mercator, both poles are representable. Longitude wraps at the date line.
const project = (place: Pick<Place, 'lat' | 'lng'>) => ({
  x: wrap(place.lng + 180, 360),
  y: 90 - Math.max(-90, Math.min(90, place.lat)),
})
const center = computed(() => {
  if (zoom.value === 1 || selected.value === null) return { x: 180, y: 90 }
  const point = project(selected.value)
  const halfHeight = 90 / zoom.value
  return { x: point.x, y: Math.max(halfHeight, Math.min(180 - halfHeight, point.y)) }
})
const viewBox = computed(() => `${center.value.x - 180 / zoom.value} ${center.value.y - 90 / zoom.value} ${360 / zoom.value} ${180 / zoom.value}`)
const projected = computed(() => points.value.map(place => {
  const point = project(place)
  // Pick the nearest copy of the longitude to this viewport. Islands on either
  // side of the date line stay beside each other when their area is enlarged.
  return { ...place, x: center.value.x + wrap(point.x - center.value.x + 180, 360) - 180, y: point.y }
}))
const label = (place: Place) => t('lookup.map_location', { name: place.name, count: formatCount(place.count) })
const select = (index: number) => { selectedIndex.value = index }
const reset = () => { zoom.value = 1 }
const activate = (event: KeyboardEvent, index: number) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    select(index)
  }
}
watch(() => props.places, () => { selectedIndex.value = null; reset() })

// Original, deliberately simplified continental silhouettes, in lon/lat.
// They provide context, not borders or a claim of precise coastline geometry.
// No map service, downloaded tiles, or third-party geometry is involved.
const outlines: [number, number][][] = [
  [[-168, 72], [-150, 70], [-130, 56], [-125, 49], [-124, 41], [-117, 32], [-105, 22], [-88, 20], [-82, 9], [-77, 8], [-81, 22], [-80, 26], [-70, 45], [-59, 51], [-65, 59], [-85, 66], [-104, 72], [-130, 72]],
  [[-73, 60], [-55, 59], [-42, 65], [-20, 76], [-30, 83], [-52, 83], [-65, 76]],
  [[-81, 12], [-71, 11], [-60, 6], [-50, 0], [-35, -5], [-39, -20], [-52, -33], [-65, -55], [-74, -50], [-76, -25], [-81, -5]],
  [[-11, 36], [-10, 44], [-1, 49], [-5, 58], [7, 58], [10, 70], [25, 71], [31, 60], [43, 68], [66, 72], [100, 77], [130, 71], [160, 69], [180, 65], [180, 50], [155, 50], [142, 44], [137, 35], [120, 25], [108, 16], [104, 2], [97, 8], [83, 21], [78, 8], [68, 24], [56, 25], [43, 12], [34, 30], [25, 38], [14, 40], [3, 42]],
  [[-17, 35], [-5, 36], [10, 37], [25, 31], [34, 30], [43, 12], [51, 12], [43, -12], [35, -22], [20, -35], [12, -30], [10, -8], [-5, 5], [-17, 15]],
  [[113, -22], [115, -34], [130, -35], [138, -38], [151, -34], [153, -25], [146, -16], [136, -12], [126, -14]],
  [[48, -13], [51, -16], [47, -25], [44, -23]],
  [[130, 32], [136, 34], [141, 41], [145, 44], [141, 34], [134, 31]],
  [[-8, 50], [-6, 58], [-3, 59], [1, 52]],
  [[96, 5], [107, -6], [115, -8], [105, -8]],
  [[109, 6], [118, 7], [119, -3], [110, -4]],
  [[131, -3], [148, -6], [151, -10], [139, -9]],
  [[173, -35], [178, -38], [174, -42], [167, -47], [166, -45], [172, -40]],
  [[-180, -74], [-140, -70], [-100, -74], [-60, -64], [-40, -73], [0, -70], [50, -68], [100, -65], [150, -73], [180, -74], [180, -90], [-180, -90]],
]
const land = outlines.map(outline => outline.map(([lng, lat]) => `${lng + 180},${90 - lat}`).join(' '))
const longitudes = [0, 60, 120, 180, 240, 300, 360]
const latitudes = [30, 60, 90, 120, 150]
</script>
<template>
  <figure class="geo-map">
    <figcaption :id="`${id}-title`">{{ t('lookup.map_title') }}</figcaption>
    <p :id="`${id}-description`" class="map-description">{{ t('lookup.map_description') }}</p>
    <p v-if="!points.length" class="map-empty">{{ t('lookup.map_empty') }}</p>
    <template v-else>
      <div class="map-frame">
        <svg :viewBox="viewBox" role="group" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-description`">
          <g v-for="offset in [-360, 0, 360]" :key="offset" :transform="`translate(${offset} 0)`" aria-hidden="true">
            <g class="map-grid">
              <line v-for="x in longitudes" :key="`lng-${x}`" :x1="x" :x2="x" y1="0" y2="180" />
              <line v-for="y in latitudes" :key="`lat-${y}`" x1="0" x2="360" :y1="y" :y2="y" :class="{ equator: y === 90 }" />
            </g>
            <polygon v-for="(outline, index) in land" :key="index" class="map-land" :points="outline" />
          </g>
          <g v-for="(point, index) in projected" :key="index" class="map-location" :class="{ selected: index === selectedIndex }"
            role="button" tabindex="0" :aria-label="label(point)" :aria-pressed="index === selectedIndex"
            @click="select(index)" @keydown="activate($event, index)" @focus="select(index)">
            <title>{{ label(point) }}</title>
            <circle class="map-hit" :cx="point.x" :cy="point.y" :r="18 / zoom" />
            <circle class="map-ring" :cx="point.x" :cy="point.y" :r="7 / zoom" />
            <circle class="map-dot" :cx="point.x" :cy="point.y" :r="3.4 / zoom" />
          </g>
        </svg>
        <div class="map-controls">
          <button type="button" data-action="zoom-in" :aria-label="t('lookup.map_zoom_in')" :title="t('lookup.map_zoom_in')" :disabled="zoom >= 8" @click="zoom *= 2">+</button>
          <button type="button" data-action="zoom-out" :aria-label="t('lookup.map_zoom_out')" :title="t('lookup.map_zoom_out')" :disabled="zoom <= 1" @click="zoom /= 2">−</button>
          <button type="button" data-action="reset" class="map-reset" @click="reset">{{ t('lookup.map_reset') }}</button>
        </div>
      </div>
      <div class="map-picker">
        <label :for="`${id}-location`">{{ t('lookup.map_selection_hint') }}</label>
        <select :id="`${id}-location`" v-model="selectedIndex">
          <option :value="null" disabled>{{ t('lookup.map_selection_hint') }}</option>
          <option v-for="(point, index) in points" :key="index" :value="index">{{ label(point) }} · {{ point.lat.toFixed(4) }}, {{ point.lng.toFixed(4) }}</option>
        </select>
      </div>
      <p class="map-selection" role="status">{{ selected ? label(selected) : t('lookup.map_selection_hint') }}</p>
    </template>
  </figure>
</template>
<style scoped>
.geo-map {
  --map-water: #111922;
  --map-land: #293c46;
  --map-line: #2b3a46;
  --map-text: #d3dde9;
  --map-muted: #8995a4;
  --map-accent: #a9d0dc;
  margin: 22px 0 4px;
  min-width: 0;
  color: var(--map-text);
}
@supports (color: light-dark(white, black)) {
  .geo-map {
    --map-water: light-dark(#eff5f7, #111922);
    --map-land: light-dark(#ccdce0, #293c46);
    --map-line: light-dark(#d3e1e6, #2b3a46);
    --map-text: light-dark(#263a45, #d3dde9);
    --map-muted: light-dark(#586d79, #8995a4);
    --map-accent: light-dark(#246b81, #a9d0dc);
  }
}
figcaption { font-size: 11px; font-weight: 600; }
.map-description, .map-empty, .map-selection { font-size: 11px; line-height: 1.6; color: var(--map-muted); margin: 7px 0 10px; }
.map-frame { position: relative; overflow: hidden; border: 1px solid var(--map-line); border-radius: 8px; background: var(--map-water); }
svg { display: block; width: 100%; aspect-ratio: 2; overflow: hidden; }
.map-grid line { stroke: var(--map-line); stroke-width: .5; vector-effect: non-scaling-stroke; }
.map-grid .equator { stroke-dasharray: 3 3; }
.map-land { fill: var(--map-land); stroke: var(--map-water); stroke-width: .65; vector-effect: non-scaling-stroke; }
.map-location { cursor: pointer; outline: none; }
.map-hit { fill: transparent; }
.map-dot { fill: var(--map-accent); stroke: var(--map-water); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.map-ring { fill: none; stroke: var(--map-accent); stroke-width: 1; opacity: 0; vector-effect: non-scaling-stroke; }
.map-location:hover .map-ring, .map-location.selected .map-ring { opacity: .65; }
.map-location:focus-visible .map-ring { opacity: 1; stroke-width: 2; }
.map-controls { display: flex; align-items: center; gap: 3px; padding: 7px; border-top: 1px solid var(--map-line); }
.map-controls button { min-width: 34px; min-height: 32px; padding: 4px 8px; border: 1px solid var(--map-line); background: var(--map-water); color: var(--map-text); border-radius: 5px; font-size: 16px; line-height: 20px; }
.map-controls button:hover:not(:disabled) { background: var(--map-land); }
.map-controls button:focus-visible { outline: 2px solid var(--map-accent); outline-offset: 2px; }
.map-controls .map-reset { font-size: 10px; margin-left: auto; }
.map-picker { display: grid; gap: 6px; margin-top: 12px; }
.map-picker label { color: var(--map-muted); font-size: 10px; line-height: 1.5; }
.map-picker select { width: 100%; min-width: 0; max-width: 100%; min-height: 36px; padding: 7px 9px; border: 1px solid var(--map-line); border-radius: 6px; background: var(--map-water); color: var(--map-text); font: inherit; font-size: 11px; }
.map-picker select:focus-visible { outline: 2px solid var(--map-accent); outline-offset: 2px; }
.map-selection { color: var(--map-text); min-height: 18px; overflow-wrap: anywhere; margin-bottom: 0; }
</style>
