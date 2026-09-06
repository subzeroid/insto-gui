<script setup lang="ts">
import { computed } from 'vue'
import type { createHistoryState } from '../desktop/history'
import { formatCount, localTime } from '../desktop/format'
import ChangeList from './ChangeList.vue'
const props = defineProps<{ history: ReturnType<typeof createHistoryState> }>()
const state = computed(() => props.history.state)
const items = computed(() => state.value.snapshots.items) // newest first
const index = (id: string | null) => items.value.findIndex(item => item.id === id)
// The pickers only offer chronologically valid partners, so a reversed pair never reaches the core.
const olderOptions = computed(() => { const i = index(state.value.pair.newerId); return i < 0 ? items.value : items.value.slice(i + 1) })
const newerOptions = computed(() => { const i = index(state.value.pair.olderId); return i < 0 ? items.value : items.value.slice(0, i) })
const unresolved = computed(() => state.value.targetPk === null && state.value.targets.pks.length > 0)
const inconclusive = computed(() => !state.value.targets.scanComplete || state.value.targets.diagnostics > 0)
function pick(which: 'older' | 'newer', id: string) {
  const older = which === 'older' ? id : state.value.pair.olderId, newer = which === 'newer' ? id : state.value.pair.newerId
  if (older !== null && newer !== null) void props.history.choosePair(older, newer)
}
</script>
<template>
  <section class="snapshot-history">
    <h3>Сохранённые снимки <button v-if="state.username" type="button" class="text-button" data-action="reload-history" :disabled="state.targets.loading" @click="history.reload()">Обновить историю</button></h3>
    <p v-if="state.targets.loading" role="status">Ищем сохранённую историю…</p>
    <p v-else-if="state.targets.error" role="alert" class="notice danger">{{ state.targets.error.message }}</p>
    <template v-else-if="state.username !== null">
      <p v-if="!state.targets.scanComplete" class="notice warning" role="status">Поиск не завершён: просмотрено {{ formatCount(state.targets.scanned) }} снимков. <button type="button" class="text-button" @click="history.continueSearch()">Продолжить поиск</button></p>
      <p v-if="state.targets.diagnostics > 0" class="fine-print">Часть сохранённых записей нельзя сопоставить с именем ({{ formatCount(state.targets.diagnostics) }}). Полнота истории не гарантируется.</p>
      <p v-if="state.targets.scanComplete && state.targets.pks.length === 0" class="empty">{{ state.targets.diagnostics === 0 ? 'Истории ещё нет. Первый снимок появится после первой успешной проверки.' : 'Совпадений не найдено, но часть сохранённых записей нельзя сопоставить с именем.' }}</p>
      <div v-if="state.targets.pks.length > 1 || unresolved" class="target-choice">
        <p v-if="state.targets.pks.length > 1">Это имя встречается в истории нескольких аккаунтов. Выберите сохранённую историю по идентификатору.</p>
        <p v-else>Найдена одна история, но {{ inconclusive ? 'поиск не завершён или часть записей не сопоставлена' : 'выбор нужно подтвердить' }}. Выберите сохранённую историю по идентификатору.</p>
        <button v-for="pk in state.targets.pks" :key="pk" type="button" :data-target="pk" :class="{ selected: pk === state.targetPk }" @click="history.chooseTarget(pk)">PK {{ pk }} · снимок {{ localTime(state.targets.newest[pk].captured_at) }}</button>
      </div>
      <template v-if="state.targetPk !== null">
        <p class="fine-print">Аккаунт PK {{ state.targetPk }}. Сравнение всегда внутри одного PK.</p>
        <p v-if="state.snapshots.loading && !state.snapshots.loaded" role="status">Читаем снимки…</p>
        <p v-else-if="state.snapshots.error" role="alert" class="notice danger">{{ state.snapshots.error.message }}</p>
        <p v-else-if="state.snapshots.loaded && state.snapshots.items.length === 0" class="empty">Ожидает первой успешной проверки.</p>
        <p v-else-if="state.snapshots.items.length === 1" class="notice">Первый снимок: {{ localTime(state.snapshots.items[0].captured_at) }}. Это отправная точка, а не список изменений.</p>
        <template v-else-if="state.snapshots.items.length >= 2">
          <div class="pair-pickers">
            <label>Раньше <select name="older" :value="state.pair.olderId ?? ''" @change="pick('older', ($event.target as HTMLSelectElement).value)"><option v-for="item in olderOptions" :key="item.id" :value="item.id">{{ localTime(item.captured_at) }}</option></select></label>
            <label>Позже <select name="newer" :value="state.pair.newerId ?? ''" @change="pick('newer', ($event.target as HTMLSelectElement).value)"><option v-for="item in newerOptions" :key="item.id" :value="item.id">{{ localTime(item.captured_at) }}</option></select></label>
          </div>
          <p v-if="state.comparison.loading" role="status">Сравниваем…</p>
          <p v-else-if="state.comparison.error" role="alert" class="notice danger">{{ state.comparison.error.message }}</p>
          <template v-else-if="state.comparison.value">
            <p class="fine-print">Наблюдение между двумя временами: {{ localTime(state.comparison.value.older.captured_at) }} и {{ localTime(state.comparison.value.newer.captured_at) }}. Это не точное время действия в Instagram.</p>
            <p v-if="state.comparison.value.changes.length === 0 && state.comparison.value.unknown_fields.length === 0" class="empty">Отслеживаемые поля не изменились.</p>
            <p v-else-if="state.comparison.value.changes.length === 0" class="notice">Сравнение неполное: у старого снимка нет данных по части полей.</p>
            <ChangeList :changes="state.comparison.value.changes" :unknown-fields="state.comparison.value.unknown_fields" />
          </template>
        </template>
        <p v-if="state.snapshots.diagnostics > 0" class="fine-print">Нечитаемых записей: {{ formatCount(state.snapshots.diagnostics) }}.</p>
        <button v-if="state.snapshots.cursor" type="button" class="text-button" :disabled="state.snapshots.loading" @click="history.moreSnapshots()">Показать ещё</button>
      </template>
    </template>
  </section>
</template>
