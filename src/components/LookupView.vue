<script setup lang="ts">
import { computed, ref } from 'vue'
import { MIN_INTERVAL } from '../desktop/client'
import { LOOKUP_WINDOWS, type LookupWindow } from '../desktop/dto'
import type { createLookupState } from '../desktop/lookup'
import type { createMonitoringState } from '../desktop/monitoring'
import { formatCount, localTime } from '../desktop/format'
import { t } from '../i18n'
import LookupActivity from './LookupActivity.vue'
import ProfileCard from './ProfileCard.vue'
// The one section of the window that spends money on purpose. Two rules follow
// from that and shape everything here: nothing leaves for the provider without a
// click, and the price of each click is written under it before it is pressed.
//
// The result lives in `lookup`, which the window owns, so leaving the tab and
// coming back shows the same answer without paying for it again. Only the typed
// name is local — and it starts from the name already looked up, so the field
// agrees with what is on screen.
const props = defineProps<{
  lookup: ReturnType<typeof createLookupState>
  monitoring: ReturnType<typeof createMonitoringState>
}>()
const emit = defineEmits<{ 'open-watch': [user: string] }>()
const state = computed(() => props.lookup.state)
const typed = ref(props.lookup.state.username ?? '')
const adding = ref(false)
const addError = ref('')
// A second paid request of either kind is ignored while one is out (the host
// admits one at a time), so the field and both buttons are disabled rather than
// left as controls that silently do nothing.
const busy = computed(() => state.value.profile.loading || state.value.activity.loading)
const found = computed(() => state.value.profile.value)
// The analysis is refused for a private account before any request is made, so
// the button for it is not offered at all.
const isPrivate = computed(() => found.value?.access === 'private')
const caption = computed(() => (state.value.profile.at === null ? '' : t('lookup.as_of', { time: localTime(state.value.profile.at) })))
// Only the last paid answer can speak for the balance, and only if it came back
// carrying one. An analysis that failed after it may have been charged, and one
// that answered without a balance, both leave the profile's number out of date —
// so the line is not shown at all rather than shown as "after this lookup".
const quota = computed(() => {
  const activity = state.value.activity
  // A running analysis resets the part, so a repeat one would fall back to the
  // profile's number — which the previous analysis has already made too high.
  if (activity.loading) return null
  if (activity.error !== null && activity.spent) return null
  if (activity.value !== null) return activity.value.quota_remaining
  return found.value?.quota_remaining ?? null
})
const watched = computed(() => state.value.username !== null && (props.monitoring.state.overview?.watches.some(item => item.user === state.value.username) ?? false))
// Adding a watch is a mutation of the local database, with the same guards the
// Watches section applies to one.
const canWatch = computed(() => !adding.value && !props.monitoring.state.busy && !props.monitoring.state.stale && props.monitoring.state.overview !== null)
// `analyzed` is the number of posts actually read. It is smaller than the window
// both for a short account and for one that reached the paid-page ceiling, and
// in neither case does it prove there is nothing more — so it is said plainly
// rather than presented as the window that was asked for.
const analysisNote = computed(() => {
  const value = state.value.activity.value
  if (value === null || value.analyzed === 0) return ''
  return value.analyzed < value.window
    ? t('lookup.analyzed_short', { analyzed: formatCount(value.analyzed), window: formatCount(value.window) })
    : t('lookup.analyzed', { count: formatCount(value.analyzed) })
})

// `lookUp` canonicalizes the typed name itself and refuses one no rule can
// rescue, with the same account-name rule the Add account form states, so this
// form neither repeats that rule nor keeps a second copy of it.
async function submit() {
  if (busy.value) return
  addError.value = ''
  await props.lookup.lookUp(typed.value)
}
function choose(raw: string) {
  const window = Number(raw) as LookupWindow
  // The chosen window is a setting, not a result: it is kept where the result is
  // kept, so it survives leaving the tab, a new account and Clear.
  if (LOOKUP_WINDOWS.includes(window)) state.value.activity.window = window
}
async function analyse() {
  if (busy.value) return
  await props.lookup.analyze(state.value.activity.window)
}
function clear() {
  props.lookup.clear()
  typed.value = ''
  addError.value = ''
}
async function watchAccount() {
  const user = state.value.username
  if (user === null || !canWatch.value) return
  adding.value = true
  addError.value = ''
  try {
    // The refusals of the watch list — three active watches, an existing watch —
    // are shown here, where the click was, and not as a banner in another tab.
    if (await props.monitoring.add(user, MIN_INTERVAL)) emit('open-watch', user)
    else addError.value = props.monitoring.state.error?.message ?? ''
  } finally { adding.value = false }
}
</script>
<template>
  <section class="lookup-view">
    <h1>{{ t('lookup.title') }}</h1>
    <p class="intro">{{ t('lookup.intro') }}</p>
    <form class="lookup-form" @submit.prevent="submit">
      <label for="lookup-user">{{ t('lookup.user_label') }}</label>
      <input
        id="lookup-user" v-model="typed" name="user" autocomplete="off" autocapitalize="off" autocorrect="off"
        :spellcheck="false" :disabled="busy" maxlength="257" placeholder="@username"
        @input="state.inputError = null"
      />
      <!-- A name that cannot be looked up is refused here, beside the field it
           was typed in: it costs nothing, and it leaves the paid answer below
           exactly where it was. -->
      <p v-if="state.inputError" role="alert" class="notice danger" data-note="input-refused">{{ state.inputError.message }}</p>
      <div class="lookup-buttons">
        <button type="submit" class="primary" :disabled="busy">{{ state.profile.loading ? t('lookup.looking') : t('lookup.action') }}</button>
        <button v-if="state.username !== null" type="button" class="text-button" data-action="clear-lookup" :disabled="busy" @click="clear">{{ t('lookup.clear') }}</button>
      </div>
      <p class="fine-print">{{ t('lookup.cost_profile') }}</p>
    </form>

    <h2 v-if="found">@{{ state.username }}</h2>
    <ProfileCard
      :profile="state.profile" :watch-user="state.username ?? ''" :caption="caption"
      :label="t('lookup.result_label')" :other-name-label="t('lookup.other_name')"
    />
    <p v-if="state.profile.error && state.profile.spent" class="fine-print" data-note="may-be-charged">{{ t('lookup.may_be_charged') }}</p>

    <template v-if="found">
      <div class="lookup-watch">
        <template v-if="watched">
          <span>{{ t('lookup.already_watched') }}</span>
          <button type="button" class="text-button" data-action="open-watch" @click="emit('open-watch', state.username!)">{{ t('lookup.open_watch') }}</button>
        </template>
        <button v-else type="button" data-action="watch" :disabled="!canWatch || busy" @click="watchAccount">{{ adding ? t('lookup.watch_adding') : t('lookup.watch_action') }}</button>
      </div>
      <p v-if="addError" role="alert" class="notice danger">{{ addError }}</p>
      <p v-if="!watched" class="fine-print">{{ t('lookup.watch_note', { seconds: MIN_INTERVAL }) }}</p>

      <p v-if="isPrivate" class="notice warning" data-note="private">{{ t('lookup.private_notice') }}</p>
      <section v-else class="lookup-analysis">
        <h3>{{ t('lookup.analysis_title') }}</h3>
        <label for="lookup-window">{{ t('lookup.window_label') }}</label>
        <select id="lookup-window" name="window" :value="state.activity.window" :disabled="busy" @change="choose(($event.target as HTMLSelectElement).value)">
          <option v-for="option in LOOKUP_WINDOWS" :key="option" :value="option">{{ t('lookup.window_option', { count: option }) }}</option>
        </select>
        <div class="lookup-buttons">
          <button type="button" class="primary" data-action="analyse" :disabled="busy" @click="analyse">{{ state.activity.loading ? t('lookup.analysing') : t('lookup.analyse') }}</button>
        </div>
        <p class="fine-print">{{ t('lookup.cost_activity') }}</p>
        <template v-if="state.activity.error">
          <p role="alert" class="notice danger">{{ state.activity.error.message }}</p>
          <p v-if="state.activity.spent" class="fine-print" data-note="may-be-charged">{{ t('lookup.may_be_charged') }}</p>
        </template>
        <p v-else-if="state.activity.loading" role="status" class="loading">{{ t('lookup.analysing') }}</p>
        <template v-else-if="state.activity.value">
          <p v-if="analysisNote" class="fine-print" data-note="analyzed">{{ analysisNote }}</p>
          <LookupActivity :activity="state.activity.value" />
        </template>
      </section>

      <p v-if="quota !== null" class="fine-print" data-note="quota">{{ t('lookup.quota_after', { count: formatCount(quota) }) }}</p>
    </template>
  </section>
</template>
