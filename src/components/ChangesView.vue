<script setup lang="ts">
import { computed, watch as observe } from 'vue'
import type { HistoryItem } from '../desktop/dto'
import type { createHistoryState } from '../desktop/history'
import { formatCount, localTime } from '../desktop/format'
import { t } from '../i18n'
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
  if (item.kind === 'baseline') return t('changes.title_baseline')
  if (item.kind === 'incomplete') return t('changes.title_incomplete')
  if (item.kind === 'diagnostic') return t('changes.title_diagnostic')
  return t('changes.title_comparison')
}
</script>
<template>
  <section class="changes-view">
    <h1>{{ t('changes.title') }}</h1>
    <p class="intro">{{ t('changes.intro') }}</p>
    <p v-if="filterPk" class="notice">{{ t('changes.filtered', { pk: filterPk }) }} <button type="button" class="text-button" data-action="clear-filter" @click="emit('clear-filter')">{{ t('changes.show_all') }}</button></p>
    <p v-if="feed.error" role="alert" class="notice danger">{{ feed.error.message }} <button type="button" class="text-button" data-action="retry" @click="history.loadFeed(filterPk)">{{ t('changes.retry') }}</button></p>
    <p v-else-if="feed.loading && !feed.loaded" role="status" class="loading">{{ t('changes.loading') }}</p>
    <p v-else-if="feed.loaded && feed.items.length === 0 && feed.scanComplete" class="empty">{{ t('changes.empty') }}</p>
    <article v-for="item in feed.items" :key="item.kind === 'comparison' || item.kind === 'incomplete' ? `${item.newer.id}-${item.older.id}` : item.snapshot.id" class="feed-item">
      <div class="stamp">{{ title(item) }} · PK {{ item.kind === 'comparison' || item.kind === 'incomplete' ? item.newer.target_pk : item.snapshot.target_pk }} · {{ item.kind === 'comparison' || item.kind === 'incomplete' ? `${localTime(item.older.captured_at)} → ${localTime(item.newer.captured_at)}` : localTime(item.snapshot.captured_at) }}</div>
      <template v-if="item.kind === 'comparison' || item.kind === 'incomplete'">
        <ChangeList :changes="item.changes" :unknown-fields="item.unknown_fields" />
      </template>
      <p v-else-if="item.kind === 'baseline'" class="fine-print">{{ t('changes.baseline_note') }}</p>
      <p v-else-if="item.kind === 'diagnostic'" class="fine-print">{{ item.code === 'history_oversized' ? t('changes.diagnostic_oversized') : t('changes.diagnostic_corrupt') }}</p>
    </article>
    <p v-if="feed.loaded && !feed.scanComplete" class="fine-print">{{ t('changes.scanned', { count: formatCount(feed.scanned) }) }} <button type="button" class="text-button" data-action="more" :disabled="feed.loading" @click="history.moreFeed()">{{ t('changes.more') }}</button></p>
    <p v-else-if="feed.loaded && feed.items.length > 0" class="fine-print">{{ t('changes.complete') }}</p>
  </section>
</template>
