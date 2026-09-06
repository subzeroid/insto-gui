<script setup lang="ts">
import type { Watch } from '../desktop/dto'
import { formatCount, localTime } from '../desktop/format'
defineProps<{ items: Watch[]; selectedUser: string | null; stale: boolean }>()
const emit = defineEmits<{ select: [user: string] }>()
const stateLabel = (watch: Watch) => (watch.status === 'paused' ? 'Приостановлено' : 'Активно')
// Registration state and the last successful check are independent facts; a
// missing last_ok is never rendered as an epoch date.
const checkLabel = (watch: Watch) => (watch.waiting_first_check || watch.last_ok === null ? 'Ожидает первой проверки' : `Проверено ${localTime(watch.last_ok)}`)
const errorLabel = (watch: Watch) => (watch.consecutive_errors > 0 ? `Ошибки: ${formatCount(watch.consecutive_errors)}` : 'Есть ошибка')
function onKey(event: KeyboardEvent, user: string) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); emit('select', user) } }
</script>
<template>
  <div class="watch-list">
    <p v-if="items.length === 0" class="empty">Пока нет наблюдений. Добавьте аккаунт, чтобы служба начала сохранять снимки.</p>
    <div v-else role="listbox" aria-label="Наблюдения">
      <div v-for="watch in items" :key="watch.user" role="option" tabindex="0" :aria-selected="watch.user === selectedUser" class="watch-row" :class="{ selected: watch.user === selectedUser, stale }" @click="emit('select', watch.user)" @keydown="onKey($event, watch.user)">
        <div class="watch-user">@{{ watch.user }}</div>
        <div class="watch-meta"><span>{{ stateLabel(watch) }}</span><span>{{ checkLabel(watch) }}</span><span>Интервал {{ formatCount(watch.interval_seconds) }} с</span><span v-if="watch.has_error" class="danger-text">{{ errorLabel(watch) }}</span></div>
      </div>
    </div>
  </div>
</template>
