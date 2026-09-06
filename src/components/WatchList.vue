<script setup lang="ts">
import type { Watch } from '../desktop/dto'
import { localTime } from '../desktop/format'
defineProps<{ items: Watch[]; selectedUser: string | null; stale: boolean }>()
const emit = defineEmits<{ select: [user: string] }>()
const stateLabel = (watch: Watch) => (watch.status === 'paused' ? 'Приостановлено' : 'Активно')
// Registration state and the last successful check are independent facts.
const checkLabel = (watch: Watch) => (watch.waiting_first_check ? 'Ожидает первой проверки' : `Проверено ${localTime(watch.last_ok ?? 0)}`)
function onKey(event: KeyboardEvent, user: string) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); emit('select', user) } }
</script>
<template>
  <div class="watch-list" role="listbox" aria-label="Наблюдения">
    <p v-if="items.length === 0" class="empty">Пока нет наблюдений. Добавьте аккаунт, чтобы служба начала сохранять снимки.</p>
    <div v-for="watch in items" :key="watch.user" role="option" tabindex="0" :aria-selected="watch.user === selectedUser" class="watch-row" :class="{ selected: watch.user === selectedUser, stale }" @click="emit('select', watch.user)" @keydown="onKey($event, watch.user)">
      <div class="watch-user">@{{ watch.user }}</div>
      <div class="watch-meta"><span>{{ stateLabel(watch) }}</span><span>{{ checkLabel(watch) }}</span><span>Интервал {{ watch.interval_seconds }} с</span><span v-if="watch.has_error" class="danger-text">Ошибки: {{ watch.consecutive_errors }}</span></div>
    </div>
  </div>
</template>
