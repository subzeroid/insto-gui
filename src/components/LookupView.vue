<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MIN_INTERVAL } from '../desktop/client'
import { LOOKUP_WINDOWS, type LookupWindow } from '../desktop/dto'
import type { createLookupState } from '../desktop/lookup'
import type { createMonitoringState } from '../desktop/monitoring'
import { formatCount, localTime } from '../desktop/format'
import { t, currentLocale } from '../i18n'
import type { createResearchState, SavedCheck, SaveInput } from '../desktop/workbench'
import { generateReport } from '../desktop/report'
import { safeFailure } from '../desktop/messages'
import LookupActivity from './LookupActivity.vue'
import ProfileCard from './ProfileCard.vue'
import ScanProgress from './ScanProgress.vue'
// The one section of the window that spends money on purpose. Two rules follow
// from that and shape everything here: nothing leaves for the provider without a
// click, and the price of each click is written under it before it is pressed.
//
// The result lives in `lookup`, which the window owns, so leaving the tab and
// coming back shows the same answer without paying for it again. Only the typed
// name is local — and it starts from the name already looked up, so the field
// agrees with what is on screen.
const props = defineProps<{
  research?: ReturnType<typeof createResearchState>
  lookup: ReturnType<typeof createLookupState>
  monitoring: ReturnType<typeof createMonitoringState>
}>()
const emit = defineEmits<{ 'open-watch': [user: string] }>()
const state = computed(() => props.lookup.state)
const typed = ref(props.lookup.state.username ?? '')
const includeActivity = computed({ get: () => state.value.includeActivity, set: value => { state.value.includeActivity = value } })
const resultTab = ref<'overview' | 'activity' | 'geography' | 'terms'>('overview')
const resultTabs = ['overview', 'activity', 'geography', 'terms'] as const
const recent = computed(() => props.research?.state.loaded ? props.research.state.items.slice(0, 5) : [])
watch(() => state.value.profile.value, () => { resultTab.value = 'overview' })
const adding = ref(false)
const exporting = ref(false), exportError = ref(''), exported = ref(false), justSaved = ref(false), saveError = ref('')
const savedInput = computed<SaveInput | null>(() => {
  const current = props.lookup.state
  if (!current.username || !current.profile.value || current.profile.at === null) return null
  return { username: current.username, target_pk: current.profile.value.target_pk, captured_at: current.profile.at, profile: current.profile.value, activity: current.activity.value }
})
let feedbackGeneration = 0, alive = true
watch([savedInput, typed, () => props.research], () => {
  feedbackGeneration++
  justSaved.value = false; exported.value = false; saveError.value = ''; exportError.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => { alive = false; feedbackGeneration++ })
const currentFeedback = (expected: number) => alive && expected === feedbackGeneration
async function saveCheck() {
  const research = props.research, check = savedInput.value
  if (!research || !check || busy.value || exporting.value) return
  const expected = feedbackGeneration
  justSaved.value = false; saveError.value = ''
  try {
    const saved = await research.save(check)
    if (currentFeedback(expected)) { justSaved.value = saved; saveError.value = saved ? '' : research.state.error?.message ?? '' }
  } catch (error) { if (currentFeedback(expected)) saveError.value = safeFailure(error).message }
}
async function exportCheck(format: 'html' | 'json') {
  const research = props.research, check = savedInput.value
  if (!research || !check || busy.value || exporting.value) return
  const expected = feedbackGeneration
  exporting.value = true; exportError.value = ''; exported.value = false
  try {
    const saved = await research.export(`insto-${check.username.slice(0, 60)}-${check.captured_at}.${format}`, format === 'html' ? generateReport(check, undefined, currentLocale()) : JSON.stringify({ version: 1, check }, null, 2))
    if (currentFeedback(expected)) exported.value = saved
  } catch (error) { if (currentFeedback(expected)) exportError.value = safeFailure(error).message }
  finally { if (alive) exporting.value = false }
}
const addError = ref('')
// A second paid request of either kind is ignored while one is out (the host
// admits one at a time), so the field and both buttons are disabled rather than
// left as controls that silently do nothing.
const busy = computed(() => state.value.checking || state.value.profile.loading || state.value.activity.loading)
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
  if (state.value.fromSaved || state.value.checking) return null
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

// `check` canonicalizes the typed name itself and refuses one no rule can
// rescue, with the same account-name rule the Add account form states, so this
// form neither repeats that rule nor keeps a second copy of it.
async function submit() {
  if (busy.value) return
  addError.value = ''
  await props.lookup.check(typed.value, includeActivity.value)
}
function openRecent(check: SavedCheck) {
  if (busy.value || !props.lookup.restore(check)) return
  typed.value = check.username
  addError.value = ''
}
function resultKey(event: KeyboardEvent, index: number) {
  if (busy.value) return
  const next = event.key === 'ArrowRight' ? (index + 1) % resultTabs.length
    : event.key === 'ArrowLeft' ? (index + resultTabs.length - 1) % resultTabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? resultTabs.length - 1 : null
  if (next === null) return
  event.preventDefault()
  resultTab.value = resultTabs[next]!
  const list = (event.currentTarget as HTMLElement).parentElement
  list?.querySelector<HTMLButtonElement>(`[data-action="result-tab-${resultTab.value}"]`)?.focus()
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
  <section class="lookup-view" :class="{ 'has-result': found || busy }">
    <header class="lookup-heading">
      <h1>{{ t('lookup.title') }}</h1>
      <p v-if="!found && !busy" class="intro">{{ t('lookup.intro') }}</p>
    </header>
    <form class="lookup-form" @submit.prevent="submit">
      <label for="lookup-user">{{ t('lookup.user_label') }}</label>
      <div class="lookup-entry">
        <input
          id="lookup-user" v-model="typed" name="user" autocomplete="off" autocapitalize="off" autocorrect="off"
          :spellcheck="false" :disabled="busy" maxlength="257" placeholder="@username"
          @input="state.inputError = null"
        />
        <button type="submit" class="primary" data-action="run-check" :disabled="busy">{{ state.activity.loading ? t('lookup.analysing') : state.profile.loading ? t('lookup.looking') : t('lookup.action') }}</button>
      </div>
      <p v-if="state.inputError" role="alert" class="notice danger" data-note="input-refused">{{ state.inputError.message }}</p>
      <fieldset class="scope-presets" :disabled="busy">
        <legend>{{ t('lookup.scope_label') }}</legend>
        <label :class="{ selected: !includeActivity }"><input v-model="includeActivity" type="radio" name="scope" :value="false" :disabled="busy" data-action="scope-profile">{{ t('lookup.scope_profile') }}</label>
        <label :class="{ selected: includeActivity }"><input v-model="includeActivity" type="radio" name="scope" :value="true" :disabled="busy" data-action="scope-full">{{ t('lookup.scope_full') }}</label>
      </fieldset>
      <div class="lookup-cost">
        <p class="fine-print" data-note="request-cost">{{ includeActivity ? t('lookup.cost_full_short') : t('lookup.cost_profile_short') }}</p>
        <details class="request-details">
          <summary data-action="cost-details">{{ t('lookup.cost_details') }}</summary>
          <p class="fine-print">{{ t('lookup.cost_profile') }}</p>
          <p v-if="includeActivity" class="fine-print">{{ t('lookup.cost_activity') }}</p>
        </details>
      </div>
      <div class="lookup-options-row">
        <details v-if="!isPrivate" class="lookup-options">
          <summary data-action="scan-options">{{ t('lookup.options') }}</summary>
          <label for="lookup-window">{{ t('lookup.window_label') }}</label>
          <select id="lookup-window" name="window" :value="state.activity.window" :disabled="busy" @change="choose(($event.target as HTMLSelectElement).value)">
            <option v-for="option in LOOKUP_WINDOWS" :key="option" :value="option">{{ t('lookup.window_option', { count: option }) }}</option>
          </select>
        </details>
        <button v-if="state.username !== null" type="button" class="text-button" data-action="clear-lookup" :disabled="busy" @click="clear">{{ t('lookup.clear') }}</button>
      </div>
    </form>

    <ScanProgress v-if="busy" :phase="state.activity.loading ? 'activity' : 'profile'" :username="state.username ?? typed" :window="state.activity.window" :include-activity="includeActivity || state.activity.loading" :started-at="state.startedAt ?? undefined" />
    <section v-if="!found && !busy && recent.length" class="recent-checks" :aria-label="t('research.title')">
      <h2>{{ t('research.title') }}</h2>
      <div class="recent-list">
        <button v-for="check in recent" :key="check.id" type="button" data-action="open-recent" @click="openRecent(check)">
          <span>@{{ check.username }}</span><span class="fine-print">{{ t('research.capture', { time: localTime(check.captured_at) }) }}</span>
        </button>
      </div>
    </section>
    <p v-if="state.fromSaved && state.profile.at !== null" class="notice" data-note="saved-origin">{{ t('research.from_saved', { time: localTime(state.profile.at) }) }}</p>
    <h2 v-if="found">@{{ state.username }}</h2>
    <ProfileCard
      v-if="!state.profile.loading || found"
      :profile="state.profile" :watch-user="state.username ?? ''" :caption="caption"
      :label="t('lookup.result_label')" :other-name-label="t('lookup.other_name')"
    />
    <p v-if="state.profile.error && state.profile.spent" class="fine-print" data-note="may-be-charged">{{ t('lookup.may_be_charged') }}</p>

    <template v-if="found">
      <div class="account-actions">
        <button v-if="research" type="button" data-action="save-check" :disabled="busy || research.state.busy || exporting" @click="saveCheck">{{ research.state.busy ? t('research.saving') : t('research.save') }}</button>
        <template v-if="watched">
          <span class="fine-print">{{ t('lookup.already_watched') }}</span>
          <button type="button" class="text-button" data-action="open-watch" :disabled="busy" @click="emit('open-watch', state.username!)">{{ t('lookup.open_watch') }}</button>
        </template>
        <button v-else type="button" data-action="watch" :disabled="!canWatch || busy" @click="watchAccount">{{ adding ? t('lookup.watch_adding') : t('lookup.watch_action') }}</button>
        <details v-if="research" class="export-menu">
          <summary data-action="export-menu">{{ exporting ? t('research.exporting') : t('lookup.export_menu') }}</summary>
          <div class="export-choices">
            <button type="button" data-action="export-html" :disabled="busy || exporting" @click="exportCheck('html')">{{ t('research.export') }}</button>
            <button type="button" data-action="export-json" :disabled="busy || exporting" @click="exportCheck('json')">{{ t('research.export_json') }}</button>
          </div>
        </details>
      </div>
      <p v-if="justSaved" class="notice" role="status">{{ t('research.saved') }}</p>
      <p v-if="exported" class="notice" role="status">{{ t('research.exported') }}</p>
      <p v-if="exportError || saveError" class="notice danger" role="alert">{{ exportError || saveError }}</p>
      <p v-if="addError" role="alert" class="notice danger">{{ addError }}</p>
      <p v-if="!watched" class="fine-print watch-note">{{ t('lookup.watch_note', { seconds: MIN_INTERVAL }) }}</p>

      <p v-if="isPrivate" class="notice warning" data-note="private">{{ t('lookup.private_notice') }}</p>
      <section v-else class="lookup-analysis">
        <div v-if="!state.activity.value || state.fromSaved" class="analysis-invitation">
          <h3>{{ t('lookup.analysis_title') }}</h3>
          <p v-if="state.fromSaved" class="notice">{{ t('research.refresh_before_analysis') }}</p>
          <p v-else-if="!busy" class="fine-print">{{ t('lookup.no_activity') }}</p>
          <button type="button" data-action="analyse" :disabled="busy || state.fromSaved" @click="analyse">{{ state.activity.loading ? t('lookup.analysing') : t('lookup.analyse') }}</button>
          <span class="fine-print" data-note="activity-request-cost">{{ t('lookup.cost_activity_short') }}</span>
          <details class="request-details">
            <summary>{{ t('lookup.cost_details') }}</summary>
            <p class="fine-print">{{ t('lookup.cost_activity') }}</p>
          </details>
        </div>
        <template v-if="state.activity.error">
          <p role="alert" class="notice danger">{{ state.activity.error.message }}</p>
          <p v-if="state.activity.spent" class="fine-print" data-note="may-be-charged">{{ t('lookup.may_be_charged') }}</p>
        </template>
        <template v-if="state.activity.value && !busy">
          <div class="result-tabs" role="tablist" :aria-label="t('lookup.results_label')">
            <button v-for="(tab, index) in resultTabs" :id="`lookup-tab-${tab}`" :key="tab" type="button" role="tab" :data-action="`result-tab-${tab}`"
              :aria-selected="resultTab === tab" aria-controls="lookup-result-panel" :tabindex="resultTab === tab ? 0 : -1"
              @click="resultTab = tab" @keydown="resultKey($event, index)">{{ t(`lookup.results_${tab}`) }}</button>
          </div>
          <div id="lookup-result-panel" class="lookup-result-panel" role="tabpanel" :aria-labelledby="`lookup-tab-${resultTab}`" tabindex="0">
            <p v-if="analysisNote" class="fine-print coverage-note" data-note="analyzed">{{ analysisNote }}</p>
            <LookupActivity :activity="state.activity.value" :section="resultTab" />
          </div>
        </template>
      </section>
      <p v-if="quota !== null" class="fine-print" data-note="quota">{{ t('lookup.quota_after', { count: formatCount(quota) }) }}</p>
    </template>
  </section>
</template>

<style scoped>
.lookup-heading h1{margin-bottom:12px}.lookup-heading .intro{max-width:620px;margin-bottom:28px}
.lookup-form{border:1px solid #34303e;border-radius:16px;padding:27px 28px;background:#16131d;gap:13px;margin-bottom:32px}
.lookup-entry{display:flex;gap:11px}.lookup-entry input{flex:1;min-width:0;font-size:18px;padding:15px 17px}.lookup-entry .primary{min-width:120px;font-size:14px}
.scope-presets{display:flex;gap:7px;align-items:center;flex-wrap:wrap;border:0;padding:0;margin:6px 0 0}.scope-presets legend{font-size:11px;color:#aca0b8;margin-bottom:9px}.scope-presets label{display:flex;align-items:center;gap:8px;padding:8px 12px;margin:0;border:1px solid #393041;border-radius:7px;color:#aa9cb5;font-size:12px;cursor:pointer}.scope-presets label.selected{border-color:#9d528d;background:#302032;color:#eed2e5}.scope-presets input{accent-color:#d46bb0;width:13px;height:13px;margin:0;padding:0}.scope-presets:disabled label{cursor:default;opacity:.6}
.lookup-cost{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}.lookup-cost>.fine-print{margin:0;color:#b8a4c1}.request-details{font-size:11px;color:#a895b7}.request-details summary,.lookup-options summary{cursor:pointer;width:fit-content;line-height:1.7}.request-details p{max-width:590px;margin:8px 0}.lookup-options-row{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.lookup-options{font-size:11px;color:#a895b7;flex:1}.lookup-options label{display:block;margin:12px 0 6px}.lookup-options select{font-size:12px;padding:7px 10px}.lookup-options-row .text-button{font-size:11px;padding:0;line-height:1.7}
.has-result .lookup-heading h1{font-size:20px;margin-bottom:16px}.has-result .lookup-form{padding:16px 19px;gap:9px;margin-bottom:26px}.has-result .lookup-entry input{font-size:14px;padding:10px 13px}.has-result .lookup-entry .primary{font-size:12px;min-width:104px}.has-result .scope-presets{margin:0}.has-result .scope-presets legend{margin-bottom:6px}.has-result .scope-presets label{padding:6px 10px;font-size:11px}
.has-result :deep(.profile-card){padding:16px 19px;margin:14px 0}.has-result :deep(.profile-name){font-size:17px}.has-result :deep(.profile-text){margin-bottom:8px}.account-actions{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin:13px 0}.account-actions>button{font-size:11px;padding:8px 12px}.watch-note{margin:7px 0 0;font-size:10px}.export-menu{position:relative;font-size:11px;color:#c6b3cc}.export-menu summary{cursor:pointer;border:1px solid #3d3446;border-radius:7px;padding:8px 12px}.export-choices{position:absolute;z-index:2;top:calc(100% + 6px);right:0;min-width:185px;background:#211a2a;border:1px solid #55415e;border-radius:9px;padding:6px;box-shadow:0 9px 25px #0007}.export-choices button{width:100%;text-align:left;border:0;background:transparent;padding:10px 11px;font-size:11px}
.lookup-analysis{align-items:stretch;gap:12px;margin-top:22px;padding-top:20px}.analysis-invitation{display:flex;flex-wrap:wrap;align-items:center;gap:11px 16px}.analysis-invitation h3,.analysis-invitation>p{width:100%;margin:0}.analysis-invitation>button{font-size:12px}.result-tabs{display:flex;border-bottom:1px solid #372e40;gap:3px;overflow-x:auto;padding-bottom:1px}.result-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:11px 14px;color:#a396b4;font-size:12px;white-space:nowrap}.result-tabs button[aria-selected=true]{border-bottom-color:#dc79b6;color:#f0c9e1}.lookup-result-panel{min-width:0}.coverage-note{margin:1px 0 17px;font-size:11px;line-height:1.7}
.recent-checks h2{font-size:13px;color:#b6a7c1;margin-bottom:12px}.recent-list{display:flex;flex-direction:column;gap:6px}.recent-list button{display:flex;justify-content:space-between;gap:15px;background:transparent;text-align:left;border-color:#302938;font-size:12px}.recent-list .fine-print{margin:0;font-size:10px}
@media(max-width:560px){.lookup-form{padding:20px 17px}.lookup-entry{flex-wrap:wrap}.lookup-entry input{width:100%}.lookup-entry .primary{width:100%;padding:12px}.has-result .lookup-entry{flex-wrap:nowrap}.has-result .lookup-entry .primary{width:auto}.lookup-cost{gap:4px 12px}.result-tabs button{padding:10px 11px;font-size:11px}.recent-list button{flex-direction:column;gap:3px}.has-result .lookup-form{padding:14px}}
</style>
