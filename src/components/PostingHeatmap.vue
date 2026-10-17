<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { formatCount, weekdayNames } from '../desktop/format'
import { t } from '../i18n'

const props = defineProps<{ values: number[][] }>()
const id = useId()
const days = weekdayNames('short')
const dayNames = weekdayNames('long')
const hours = Array.from({ length: 24 }, (_, hour) => hour)
const pad = (hour: number) => String(hour).padStart(2, '0')
// The bridge supplies 7 × 24 counts. Filling a missing bin with zero also keeps
// this chart safe while its parent replaces a sample; no dates are inferred.
const bins = computed(() => Array.from({ length: 7 }, (_, day) => hours.map(hour => {
  const value = props.values[day]?.[hour]
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
})))
const maximum = computed(() => Math.max(0, ...bins.value.flat()))
const level = (count: number) => count === 0 ? 0 : Math.ceil(count / maximum.value * 4)
const label = (day: number, hour: number) => t('lookup.heatmap_cell', {
  day: dayNames[day], hour: pad(hour), next: pad((hour + 1) % 24), count: formatCount(bins.value[day][hour]),
})
const focusedIndex = ref(0)
const activeIndex = ref<number | null>(null)
const activeLabel = computed(() => activeIndex.value === null ? '' : label(Math.floor(activeIndex.value / 24), activeIndex.value % 24))
const inspect = (index: number) => { activeIndex.value = index }
const focus = (index: number) => { focusedIndex.value = index; inspect(index) }
function navigate(event: KeyboardEvent, day: number, hour: number) {
  let nextDay = day
  let nextHour = hour
  switch (event.key) {
    case 'ArrowLeft': nextHour = Math.max(0, hour - 1); break
    case 'ArrowRight': nextHour = Math.min(23, hour + 1); break
    case 'ArrowUp': nextDay = Math.max(0, day - 1); break
    case 'ArrowDown': nextDay = Math.min(6, day + 1); break
    case 'Home': nextHour = 0; if (event.ctrlKey || event.metaKey) nextDay = 0; break
    case 'End': nextHour = 23; if (event.ctrlKey || event.metaKey) nextDay = 6; break
    default: return
  }
  event.preventDefault()
  const nextIndex = nextDay * 24 + nextHour
  const button = event.currentTarget as HTMLButtonElement
  button.closest('table')?.querySelector<HTMLButtonElement>(`[data-cell="${nextIndex}"]`)?.focus()
}
watch(() => props.values, () => { focusedIndex.value = 0; activeIndex.value = null })
</script>
<template>
  <figure class="posting-heatmap">
    <figcaption>{{ t('lookup.heatmap_title') }}</figcaption>
    <p :id="`${id}-note`" class="heatmap-note">{{ t('lookup.heatmap_note') }}</p>
    <p v-if="maximum === 0" class="heatmap-empty">{{ t('lookup.heatmap_empty') }}</p>
    <template v-else>
      <table role="grid" :aria-describedby="`${id}-note`">
        <caption class="visually-hidden">{{ t('lookup.heatmap_title') }}</caption>
        <colgroup><col class="day-column"><col v-for="hour in hours" :key="hour"></colgroup>
        <thead>
          <tr><td /><th v-for="hour in hours" :key="hour" scope="col"><span :class="{ 'visually-hidden': hour % 6 !== 0 && hour !== 23 }">{{ pad(hour) }}</span></th></tr>
        </thead>
        <tbody>
          <tr v-for="(day, dayIndex) in days" :key="dayIndex">
            <th scope="row">{{ day }}</th>
            <td v-for="hour in hours" :key="hour">
              <button type="button" class="heatmap-cell" :data-cell="dayIndex * 24 + hour" :data-level="level(bins[dayIndex][hour])"
                :aria-label="label(dayIndex, hour)" :aria-describedby="activeIndex === dayIndex * 24 + hour ? `${id}-tooltip` : undefined"
                :tabindex="focusedIndex === dayIndex * 24 + hour ? 0 : -1"
                @focus="focus(dayIndex * 24 + hour)" @mouseenter="inspect(dayIndex * 24 + hour)"
                @click="focus(dayIndex * 24 + hour)" @keydown="navigate($event, dayIndex, hour)" />
            </td>
          </tr>
        </tbody>
      </table>
      <div class="heatmap-footer">
        <div class="heatmap-legend"><span>{{ t('lookup.heatmap_less') }}</span><i v-for="value in [0, 1, 2, 3, 4]" :key="value" :data-level="value" aria-hidden="true" /><span>{{ t('lookup.heatmap_more') }}</span></div>
        <p v-if="activeLabel" :id="`${id}-tooltip`" class="heatmap-detail" role="tooltip">{{ activeLabel }}</p>
        <p v-else class="heatmap-detail" aria-hidden="true">UTC</p>
      </div>
    </template>
  </figure>
</template>
<style scoped>
.posting-heatmap {
  --heatmap-text: #d3dde9;
  --heatmap-muted: #8995a4;
  --heatmap-empty: #1c2933;
  --heatmap-one: #345967;
  --heatmap-two: #477c8c;
  --heatmap-three: #72a6b6;
  --heatmap-four: #b1d9e4;
  --heatmap-focus: #e2f4fa;
  margin: 23px 0 10px;
  min-width: 0;
  color: var(--heatmap-text);
}
@supports (color: light-dark(white, black)) {
  .posting-heatmap {
    --heatmap-text: light-dark(#263a45, #d3dde9);
    --heatmap-muted: light-dark(#586d79, #8995a4);
    --heatmap-empty: light-dark(#e5eef1, #1c2933);
    --heatmap-one: light-dark(#b9d9e2, #345967);
    --heatmap-two: light-dark(#7fb4c5, #477c8c);
    --heatmap-three: light-dark(#43869e, #72a6b6);
    --heatmap-four: light-dark(#1d586f, #b1d9e4);
    --heatmap-focus: light-dark(#0d3545, #e2f4fa);
  }
}
figcaption { font-size: 11px; font-weight: 600; }
.heatmap-note, .heatmap-empty { font-size: 11px; color: var(--heatmap-muted); line-height: 1.6; margin: 7px 0 10px; }
table { width: 100%; table-layout: fixed; border-spacing: 3px; margin: 0 -3px; }
.day-column { width: 34px; }
th { padding: 0; color: var(--heatmap-muted); font-size: 10px; font-weight: 400; line-height: 18px; }
tbody th { text-align: left; }
thead th { font-size: 9px; position: relative; }
td { padding: 0; }
.heatmap-cell { display: block; width: 100%; min-width: 0; height: 20px; padding: 0; border: 0; border-radius: 3px; transition: none; }
[data-level="0"] { background: var(--heatmap-empty); }
[data-level="1"] { background: var(--heatmap-one); }
[data-level="2"] { background: var(--heatmap-two); }
[data-level="3"] { background: var(--heatmap-three); }
[data-level="4"] { background: var(--heatmap-four); }
.heatmap-cell:hover, .heatmap-cell:focus-visible { outline: 2px solid var(--heatmap-focus); outline-offset: 1px; position: relative; z-index: 1; }
.heatmap-cell:hover:not(:disabled) { background: var(--heatmap-focus); }
.heatmap-footer { margin-top: 9px; }
.heatmap-legend { display: flex; justify-content: flex-end; align-items: center; gap: 4px; color: var(--heatmap-muted); font-size: 9px; }
.heatmap-legend span:first-child { margin-right: 3px; }
.heatmap-legend span:last-child { margin-left: 3px; }
.heatmap-legend i { display: block; width: 9px; height: 9px; border-radius: 2px; }
.heatmap-detail { min-height: 19px; margin: 8px 0 0; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 400px) { table { border-spacing: 2px; margin-left: -2px; } .day-column { width: 29px; } .heatmap-cell { height: 18px; border-radius: 2px; } }
</style>
