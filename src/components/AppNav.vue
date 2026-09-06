<script setup lang="ts">
export type Section = 'watches' | 'changes' | 'service' | 'settings'
defineProps<{ current: Section }>()
const emit = defineEmits<{ navigate: [section: Section] }>()
const sections: { id: Section; label: string }[] = [{ id: 'watches', label: 'Наблюдения' }, { id: 'changes', label: 'Изменения' }, { id: 'service', label: 'Служба' }, { id: 'settings', label: 'Настройки' }]
</script>
<template>
  <nav class="app-nav" role="tablist" aria-label="Разделы">
    <button v-for="section in sections" :key="section.id" type="button" role="tab" :aria-selected="section.id === current" @click="emit('navigate', section.id)">{{ section.label }}</button>
  </nav>
</template>
