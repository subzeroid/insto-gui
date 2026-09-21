<script setup lang="ts">
import { computed } from 'vue'
import { formatCount } from '../desktop/format'
import { t } from '../i18n'
// A bar chart in plain CSS: no library, no canvas, no image. Bars are scaled to
// the tallest one, so the picture is about shape, not about absolute height —
// the numbers themselves are in the line under it.
//
// `labels` names every bar in full and carries the meaning for anyone who does
// not see the bars; `ticks` is what is printed under the axis, where an empty
// string means a bar that is not labelled because the axis would be unreadable.
// The bars are `aria-hidden` on purpose: the sentence below them says the same
// thing in words, and reading out twenty-four unlabelled boxes says nothing.
const props = defineProps<{ title: string; values: number[]; labels: string[]; ticks: string[] }>()
const TOP = 3
const max = computed(() => Math.max(0, ...props.values))
const height = (value: number) => (max.value === 0 ? '0%' : `${(value / max.value) * 100}%`)
// Count descending, then in the order of the axis, which is what a reader looks
// for: the busiest hours and days, named and counted.
const summary = computed(() => {
  const ranked = props.values
    .map((count, index) => ({ count, index }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, TOP)
  if (ranked.length === 0) return ''
  const items = ranked.map(item => t('lookup.chart_item', { label: props.labels[item.index], count: formatCount(item.count) }))
  return t('lookup.chart_top', { items: items.join(', ') })
})
</script>
<template>
  <figure class="bar-chart">
    <figcaption>{{ title }}</figcaption>
    <div class="bars" aria-hidden="true">
      <div v-for="(value, index) in values" :key="index" class="bar-slot">
        <div class="bar" :style="{ height: height(value) }" />
      </div>
    </div>
    <div class="bar-ticks" aria-hidden="true">
      <span v-for="(tick, index) in ticks" :key="index">{{ tick }}</span>
    </div>
    <p v-if="summary" class="fine-print chart-alt">{{ summary }}</p>
  </figure>
</template>
