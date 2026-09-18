<script setup lang="ts">
import { computed } from 'vue'
import type { createHistoryState } from '../desktop/history'
import { formatCount, localTime } from '../desktop/format'
import { t } from '../i18n'
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
    <h3>{{ t('history.title') }} <button v-if="state.username" type="button" class="text-button" data-action="reload-history" :disabled="state.targets.loading" @click="history.reload()">{{ t('history.reload') }}</button></h3>
    <p v-if="state.targets.loading" role="status">{{ t('history.searching') }}</p>
    <p v-else-if="state.targets.error" role="alert" class="notice danger">{{ state.targets.error.message }}</p>
    <template v-else-if="state.username !== null">
      <p v-if="!state.targets.scanComplete" class="notice warning" role="status">{{ t('history.scan_incomplete', { count: formatCount(state.targets.scanned) }) }} <button type="button" class="text-button" @click="history.continueSearch()">{{ t('history.continue') }}</button></p>
      <p v-if="state.targets.diagnostics > 0" class="fine-print">{{ t('history.diagnostics', { count: formatCount(state.targets.diagnostics) }) }}</p>
      <p v-if="state.targets.scanComplete && state.targets.pks.length === 0" class="empty">{{ state.targets.diagnostics === 0 ? t('history.empty') : t('history.empty_unmatched') }}</p>
      <div v-if="state.targets.pks.length > 1 || unresolved" class="target-choice">
        <p v-if="state.targets.pks.length > 1">{{ t('history.multiple_targets') }}</p>
        <p v-else>{{ t('history.single_target', { reason: inconclusive ? t('history.reason_inconclusive') : t('history.reason_confirm') }) }}</p>
        <button v-for="pk in state.targets.pks" :key="pk" type="button" :data-target="pk" :class="{ selected: pk === state.targetPk }" @click="history.chooseTarget(pk)">{{ t('history.target', { pk, time: localTime(state.targets.newest[pk].captured_at) }) }}</button>
      </div>
      <template v-if="state.targetPk !== null">
        <p class="fine-print">{{ t('history.target_note', { pk: state.targetPk }) }}</p>
        <p v-if="state.snapshots.loading && !state.snapshots.loaded" role="status">{{ t('history.loading') }}</p>
        <p v-else-if="state.snapshots.error" role="alert" class="notice danger">{{ state.snapshots.error.message }}</p>
        <p v-else-if="state.snapshots.loaded && state.snapshots.items.length === 0" class="empty">{{ t('history.waiting') }}</p>
        <p v-else-if="state.snapshots.items.length === 1" class="notice">{{ t('history.first', { time: localTime(state.snapshots.items[0].captured_at) }) }}</p>
        <template v-else-if="state.snapshots.items.length >= 2">
          <div class="pair-pickers">
            <label>{{ t('history.older') }} <select name="older" :value="state.pair.olderId ?? ''" @change="pick('older', ($event.target as HTMLSelectElement).value)"><option v-for="item in olderOptions" :key="item.id" :value="item.id">{{ localTime(item.captured_at) }}</option></select></label>
            <label>{{ t('history.newer') }} <select name="newer" :value="state.pair.newerId ?? ''" @change="pick('newer', ($event.target as HTMLSelectElement).value)"><option v-for="item in newerOptions" :key="item.id" :value="item.id">{{ localTime(item.captured_at) }}</option></select></label>
          </div>
          <p v-if="state.comparison.loading" role="status">{{ t('history.comparing') }}</p>
          <p v-else-if="state.comparison.error" role="alert" class="notice danger">{{ state.comparison.error.message }}</p>
          <template v-else-if="state.comparison.value">
            <p class="fine-print">{{ t('history.between', { older: localTime(state.comparison.value.older.captured_at), newer: localTime(state.comparison.value.newer.captured_at) }) }}</p>
            <p v-if="state.comparison.value.changes.length === 0 && state.comparison.value.unknown_fields.length === 0" class="empty">{{ t('history.no_changes') }}</p>
            <p v-else-if="state.comparison.value.changes.length === 0" class="notice">{{ t('history.incomplete') }}</p>
            <ChangeList :changes="state.comparison.value.changes" :unknown-fields="state.comparison.value.unknown_fields" />
          </template>
        </template>
        <p v-if="state.snapshots.diagnostics > 0" class="fine-print">{{ t('history.unreadable', { count: formatCount(state.snapshots.diagnostics) }) }}</p>
        <button v-if="state.snapshots.cursor" type="button" class="text-button" :disabled="state.snapshots.loading" @click="history.moreSnapshots()">{{ t('history.more') }}</button>
      </template>
    </template>
  </section>
</template>
