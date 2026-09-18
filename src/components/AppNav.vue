<script setup lang="ts">
import { nextTick } from 'vue'
import { t } from '../i18n'
export type Section = 'watches' | 'changes' | 'service' | 'settings'
defineProps<{ current: Section }>()
const emit = defineEmits<{ navigate: [section: Section] }>()
// Built per instance, not once per module: the locale is fixed before the app
// mounts, so every mount reads the labels of the locale in force for it.
const sections: { id: Section; label: string }[] = [
  { id: 'watches', label: t('nav.watches') },
  { id: 'changes', label: t('nav.changes') },
  { id: 'service', label: t('nav.service') },
  { id: 'settings', label: t('nav.settings') }
]
// Roving tabindex: only the selected tab is in the tab order, so keyboard
// selection has to carry focus with it or focus would be left on a tab that
// is no longer reachable.
async function select(id: Section) {
  emit('navigate', id)
  await nextTick()
  document.getElementById(`tab-${id}`)?.focus()
}
function move(index: number, step: number) {
  void select(sections[(index + step + sections.length) % sections.length].id)
}
</script>
<template>
  <nav class="app-nav" role="tablist" :aria-label="t('nav.aria')">
    <button
      v-for="(section, index) in sections"
      :id="`tab-${section.id}`"
      :key="section.id"
      type="button"
      role="tab"
      :aria-selected="section.id === current"
      :aria-controls="`panel-${section.id}`"
      :tabindex="section.id === current ? 0 : -1"
      @click="emit('navigate', section.id)"
      @keydown.right.prevent="move(index, 1)"
      @keydown.left.prevent="move(index, -1)"
      @keydown.home.prevent="select(sections[0].id)"
      @keydown.end.prevent="select(sections[sections.length - 1].id)"
    >{{ section.label }}</button>
  </nav>
</template>
