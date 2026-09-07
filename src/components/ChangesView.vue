<script setup lang="ts">
import { computed, watch as observe } from 'vue'
import type { HistoryItem } from '../desktop/dto'
import type { createHistoryState } from '../desktop/history'
import { formatCount, localTime } from '../desktop/format'
import ChangeList from './ChangeList.vue'
const props = defineProps<{ history: ReturnType<typeof createHistoryState>; filterPk: string | null }>()
// The filter is owned by the parent so retry, remount and navigation agree on it.
const emit = defineEmits<{ 'clear-filter': [] }>()
const feed = computed(() => props.history.state.feed)
// The feed outlives this component: it belongs to whichever mount read it last.
// `loadFeed` empties it before the request leaves, so issuing the first read here
// rather than from `onMounted` puts that emptying before this mount's first
// render — a remount can never paint a row the previous one left behind.
void props.history.loadFeed(props.filterPk)
observe(() => props.filterPk, pk => { void props.history.loadFeed(pk) })
function title(item: HistoryItem) {
  if (item.kind === 'baseline') return 'Первый снимок'
  if (item.kind === 'incomplete') return 'Неполное сравнение'
  if (item.kind === 'diagnostic') return 'Запись не удалось прочитать'
  return 'Изменения'
}
</script>
<template>
  <section class="changes-view">
    <h1>Изменения</h1>
    <p class="intro">Лента строится из сравнения соседних сохранённых снимков одного аккаунта. Это наблюдения между двумя временами, а не точное время действий в Instagram. Число подписчиков не раскрывает конкретных людей.</p>
    <p v-if="filterPk" class="notice">Показаны изменения только для аккаунта PK {{ filterPk }}. <button type="button" class="text-button" data-action="clear-filter" @click="emit('clear-filter')">Показать все</button></p>
    <p v-if="feed.error" role="alert" class="notice danger">{{ feed.error.message }} <button type="button" class="text-button" data-action="retry" @click="history.loadFeed(filterPk)">Повторить</button></p>
    <p v-else-if="feed.loading && !feed.loaded" role="status" class="loading">Читаем ленту…</p>
    <p v-else-if="feed.loaded && feed.items.length === 0 && feed.scanComplete" class="empty">Изменений пока нет. Лента наполнится после следующих успешных проверок.</p>
    <article v-for="item in feed.items" :key="item.kind === 'comparison' || item.kind === 'incomplete' ? `${item.newer.id}-${item.older.id}` : item.snapshot.id" class="feed-item">
      <div class="stamp">{{ title(item) }} · PK {{ item.kind === 'comparison' || item.kind === 'incomplete' ? item.newer.target_pk : item.snapshot.target_pk }} · {{ item.kind === 'comparison' || item.kind === 'incomplete' ? `${localTime(item.older.captured_at)} → ${localTime(item.newer.captured_at)}` : localTime(item.snapshot.captured_at) }}</div>
      <template v-if="item.kind === 'comparison' || item.kind === 'incomplete'">
        <ChangeList :changes="item.changes" :unknown-fields="item.unknown_fields" />
      </template>
      <p v-else-if="item.kind === 'baseline'" class="fine-print">Отправная точка истории, а не набор изменений.</p>
      <p v-else-if="item.kind === 'diagnostic'" class="fine-print">{{ item.code === 'history_oversized' ? 'Снимок превышает поддерживаемый размер.' : 'Сохранённый снимок не удалось прочитать безопасно.' }}</p>
    </article>
    <p v-if="feed.loaded && !feed.scanComplete" class="fine-print">Просмотрено кандидатов: {{ formatCount(feed.scanned) }}. <button type="button" class="text-button" data-action="more" :disabled="feed.loading" @click="history.moreFeed()">Показать дальше</button></p>
    <p v-else-if="feed.loaded && feed.items.length > 0" class="fine-print">Лента просмотрена до конца сохранённой истории.</p>
  </section>
</template>
