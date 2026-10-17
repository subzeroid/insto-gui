<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { t } from '../i18n'
export type Section = 'watches' | 'changes' | 'lookup' | 'library' | 'service' | 'settings' | 'budget'
const props = defineProps<{ current: Section; disabled?: boolean }>()
const emit = defineEmits<{ navigate: [section: Section] }>()
const selected = computed(() => props.current === 'changes' ? 'watches' : props.current === 'service' || props.current === 'budget' ? 'settings' : props.current)
// Built per instance, not once per module: the locale is fixed before the app
// mounts, so every mount reads the labels of the locale in force for it.
const sections: { id: Section; label: string }[] = [
  { id: 'lookup', label: t('nav.lookup') },
  { id: 'watches', label: t('nav.watches') },
  { id: 'library', label: t('nav.library') },
  { id: 'settings', label: t('nav.settings') }
]
// Roving tabindex: only the selected tab is in the tab order, so keyboard
// selection has to carry focus with it or focus would be left on a tab that
// is no longer reachable.
async function select(id: Section) {
  if (props.disabled) return
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
      :disabled="disabled"
      :aria-selected="section.id === selected"
      :aria-controls="`panel-${section.id}`"
      :tabindex="!disabled && section.id === selected ? 0 : -1"
      :class="{ 'nav-settings': section.id === 'settings' }"
      @click="select(section.id)"
      @keydown.right.prevent="move(index, 1)"
      @keydown.left.prevent="move(index, -1)"
      @keydown.home.prevent="select(sections[0].id)"
      @keydown.end.prevent="select(sections[sections.length - 1].id)"
    >{{ section.label }}</button>
  </nav>
</template>
