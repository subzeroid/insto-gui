<script setup lang="ts">
import { computed, onUnmounted, watch as observe } from 'vue'
import type { createHistoryState } from '../desktop/history'
import type { createMonitoringState } from '../desktop/monitoring'
import { localTime } from '../desktop/format'
import { t } from '../i18n'
import AddWatchForm from './AddWatchForm.vue'
import WatchDetails from './WatchDetails.vue'
import WatchList from './WatchList.vue'
const props = defineProps<{ monitoring: ReturnType<typeof createMonitoringState>; history: ReturnType<typeof createHistoryState> }>()
const emit = defineEmits<{ 'show-changes': [pk: string] }>()
const state = computed(() => props.monitoring.state)
const items = computed(() => state.value.overview?.watches ?? [])
const busy = computed(() => state.value.busy)
// History follows the selected user; a new successful check (last_ok) means a new
// snapshot may exist, so the same selection reloads its history. Two sources are
// compared element-wise, so a poll that changes neither leaves the history alone.
observe([() => props.monitoring.selected.value?.user ?? null, () => props.monitoring.selected.value?.last_ok ?? null], ([user], [previousUser]) => {
  if (user === null) props.history.reset()
  else if (previousUser !== user || props.history.state.username !== user) void props.history.load(user)
  else void props.history.reload()
})
function select(user: string) {
  if (user === state.value.selectedUser) void props.history.reload()
  else props.monitoring.select(user)
}
// The service checks a newly added account right away, so the window watches for
// that first snapshot instead of leaving an empty pane until the next interval.
// Both reads are local — reading the overview and the saved history makes no
// HikerAPI request.
const FIRST_CHECK_POLL_MS = 5000
const awaitingFirstCheck = computed(() => {
  const selected = props.monitoring.selected.value
  return selected !== null && selected.status === 'active' && (selected.waiting_first_check || selected.last_ok === null)
    && props.history.state.snapshots.items.length === 0
})
let firstCheckTimer: ReturnType<typeof setInterval> | null = null
function stopFirstCheckPoll() { if (firstCheckTimer !== null) { clearInterval(firstCheckTimer); firstCheckTimer = null } }
async function pollFirstCheck() {
  const before = props.monitoring.selected.value
  if (before === null) return
  const { user, last_ok: lastOk } = before
  await props.monitoring.reconcile()
  const after = props.monitoring.selected.value
  // A check that landed changes `last_ok`, and the selection watcher above already
  // reloads the history for that; only an unchanged overview needs this read.
  if (after !== null && after.user === user && after.last_ok === lastOk) await props.history.reload()
}
// The timer exists exactly while the condition holds: a paused, removed, checked
// or deselected watch clears it, and so does unmounting.
observe(awaitingFirstCheck, waiting => {
  stopFirstCheckPoll()
  if (waiting) firstCheckTimer = setInterval(() => { void pollFirstCheck() }, FIRST_CHECK_POLL_MS)
}, { immediate: true })
onUnmounted(stopFirstCheckPoll)
</script>
<template>
  <section class="watches-view">
    <div v-if="state.error" class="notice danger" role="alert">{{ state.error.message }}</div>
    <div v-if="state.stale" class="notice warning" role="status">{{ t('watches.stale', { time: state.lastReadAt === null ? t('format.never') : localTime(Math.floor(state.lastReadAt / 1000)) }) }} <button type="button" class="text-button" data-action="refresh-watches" :aria-label="t('watches.refresh_label')" :disabled="state.loading" @click="monitoring.refresh()">{{ t('app.refresh') }}</button></div>
    <p v-else-if="state.outcomeUnknown" class="notice" role="status">{{ t('watches.outcome_unknown') }}</p>
    <p v-if="state.readError && !state.overview" role="alert" class="notice danger">{{ state.readError.message }} <button type="button" class="text-button" @click="monitoring.refresh()">{{ t('watches.retry') }}</button></p>
    <p v-else-if="!state.overview" role="status" class="loading">{{ t('watches.loading') }}</p>
    <div v-else class="split">
      <div class="pane list-pane">
        <p v-if="state.overview.next_cursor !== null" class="fine-print">{{ t('watches.truncated') }}</p>
        <WatchList :items="items" :selected-user="state.selectedUser" :stale="state.stale" @select="select" />
        <AddWatchForm :busy="busy || state.stale" :add="monitoring.add" />
      </div>
      <div class="pane details-pane">
        <WatchDetails v-if="monitoring.selected.value" :watch="monitoring.selected.value" :busy="busy" :stale="state.stale" :history="history" :pause="monitoring.pause" :resume="monitoring.resume" :update="monitoring.update" :remove="monitoring.remove" @show-changes="pk => emit('show-changes', pk)" />
        <p v-else class="empty">{{ t('watches.no_selection') }}</p>
      </div>
    </div>
  </section>
</template>
