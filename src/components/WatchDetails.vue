<script setup lang="ts">
import { computed, ref, watch as observe } from 'vue'
import type { ServiceState, Watch } from '../desktop/dto'
import type { createHistoryState } from '../desktop/history'
import { MIN_INTERVAL, validInterval } from '../desktop/client'
import { t } from '../i18n'
import ConfirmBlock from './ConfirmBlock.vue'
import ProfileCard from './ProfileCard.vue'
import SnapshotHistory from './SnapshotHistory.vue'
const props = defineProps<{ watch: Watch; serviceState: ServiceState; busy: boolean; stale: boolean; history: ReturnType<typeof createHistoryState>; pause: (w: Watch) => Promise<boolean>; resume: (w: Watch) => Promise<boolean>; update: (w: Watch, interval: number) => Promise<boolean>; remove: (w: Watch) => Promise<boolean> }>()
const emit = defineEmits<{ 'show-changes': [pk: string] }>()
const disabled = computed(() => props.busy || props.stale)
// What the status line under the heading says. A never-checked watch only claims
// a check is *running* when the service is actually running and nothing has gone
// wrong yet; otherwise it says it is waiting, which is true either way.
const intro = computed(() => {
  if (props.watch.status === 'paused') return t('watches.detail_paused')
  if (!props.watch.waiting_first_check) return t('watches.detail_active')
  if (props.watch.has_error || props.serviceState !== 'running') return t('watches.detail_waiting')
  return t('watches.detail_first_check')
})
const interval = ref(String(props.watch.interval_seconds))
const confirming = ref(false)
observe(() => props.watch.user, () => { confirming.value = false; interval.value = String(props.watch.interval_seconds) })
observe(() => props.watch.interval_seconds, value => { interval.value = String(value) })
const intervalValid = computed(() => validInterval(Number(interval.value)))
async function saveInterval() { if (!disabled.value && intervalValid.value) await props.update(props.watch, Number(interval.value)) }
async function confirmRemove() { confirming.value = false; await props.remove(props.watch) }
</script>
<template>
  <section class="watch-details">
    <h2>@{{ watch.user }}</h2>
    <p class="intro">{{ intro }}</p>
    <!-- The profile is what the user came for: it sits directly under the status
         line, above the controls and the saved snapshots. -->
    <ProfileCard :profile="history.state.profile" :watch-user="watch.user" />
    <div class="actions">
      <button v-if="watch.status === 'active'" data-action="pause" :disabled="disabled" @click="pause(watch)">{{ t('watches.pause') }}</button>
      <button v-else data-action="resume" :disabled="disabled" @click="resume(watch)">{{ t('watches.resume') }}</button>
      <button data-action="remove" :disabled="disabled" @click="confirming = true">{{ t('watches.remove') }}</button>
      <!-- Opening the changes feed is a read: only a running mutation holds it back, not stale state. -->
      <button v-if="history.state.targetPk" type="button" class="text-button" data-action="changes" :disabled="busy" @click="emit('show-changes', history.state.targetPk)">{{ t('watches.changes_link') }}</button>
    </div>
    <ConfirmBlock v-if="confirming" :label="t('watches.remove_confirm_label')" :message="t('watches.remove_confirm', { user: watch.user })" :confirm-label="t('watches.remove_confirm_action')" action="remove" :busy="disabled" @confirm="confirmRemove" @cancel="confirming = false" />
    <form class="interval-form" @submit.prevent="saveInterval">
      <label for="detail-interval">{{ t('watches.interval_label') }}</label>
      <input id="detail-interval" v-model="interval" name="interval" type="number" :min="MIN_INTERVAL" step="1" :disabled="disabled" />
      <button type="submit" data-action="interval" :disabled="disabled || !intervalValid || Number(interval) === watch.interval_seconds">{{ t('watches.save_interval') }}</button>
    </form>
    <p class="fine-print">{{ t('watches.interval_note') }}</p>
    <SnapshotHistory :history="history" />
  </section>
</template>
