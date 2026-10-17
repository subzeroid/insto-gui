<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { compareChecks, type createResearchState, type SavedCheck } from '../desktop/workbench'
import { generateReport } from '../desktop/report'
import { describeValue, fieldLabel, formatCount, localTime } from '../desktop/format'
import { safeFailure, type DesktopFailure } from '../desktop/messages'
import type { ChangeValue } from '../desktop/dto'
import { currentLocale, t } from '../i18n'

const props = defineProps<{ research: ReturnType<typeof createResearchState> }>()
const emit = defineEmits<{ open: [check: SavedCheck] }>()
const id = useId()
const view = ref<HTMLElement | null>(null)
const state = computed(() => props.research.state)
const loading = ref(false)
const pendingDeleteId = ref<string | null>(null)
const exportBusy = ref(false)
const exportError = ref<DesktopFailure | null>(null)
const exported = ref(false)
const blocked = computed(() => loading.value || state.value.busy || exportBusy.value)
const error = computed(() => exportError.value ?? state.value.error)
const firstId = ref('')
const secondId = ref('')
const first = computed(() => state.value.items.find(check => check.id === firstId.value) ?? null)
const second = computed(() => state.value.items.find(check => check.id === secondId.value) ?? null)
const comparison = computed(() => first.value && second.value && first.value.id !== second.value.id ? compareChecks(first.value, second.value) : null)
const bothAnalyzed = computed(() => first.value?.activity !== null && second.value?.activity !== null)
const commonGroups = ['hashtags', 'mentions', 'locations'] as const
const commonTitles = { hashtags: 'research.common_hashtags', mentions: 'research.common_mentions', locations: 'research.common_locations' } as const
const termLabel = (group: typeof commonGroups[number], key: string) => `${group === 'hashtags' ? '#' : group === 'mentions' ? '@' : ''}${key}`
const valueLabel = (value: ChangeValue | undefined, known: boolean) => known && value !== undefined ? describeValue(value) : t('research.unknown')
const optionLabel = (check: SavedCheck) => `@${check.username} · ${localTime(check.captured_at)}`
const coverage = (check: SavedCheck) => check.activity === null ? t('research.profile_only') : t('research.coverage', {
  count: formatCount(check.activity.analyzed), window: formatCount(check.activity.window),
})
const isoTime = (timestamp: number) => new Date(timestamp * 1000).toISOString()

async function refresh() {
  if (blocked.value) return
  loading.value = true
  exportError.value = null
  exported.value = false
  try { await props.research.refresh() }
  catch (failure) { exportError.value = safeFailure(failure) }
  finally { loading.value = false }
}
async function requestDelete(check: SavedCheck) {
  if (blocked.value) return
  pendingDeleteId.value = check.id
  exportError.value = null
  exported.value = false
  await nextTick()
  view.value?.querySelector<HTMLButtonElement>('[data-action="cancel-delete"]')?.focus()
}
async function cancelDelete() {
  const deletedId = pendingDeleteId.value
  pendingDeleteId.value = null
  await nextTick()
  view.value?.querySelector<HTMLButtonElement>(`[data-check="${deletedId}"] [data-action="delete"]`)?.focus()
}
async function remove(check: SavedCheck) {
  if (blocked.value || pendingDeleteId.value !== check.id) return
  await props.research.remove(check.id)
  if (!state.value.items.some(item => item.id === check.id)) {
    pendingDeleteId.value = null
    await nextTick()
    view.value?.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.focus()
  }
}
async function exportCheck(check: SavedCheck, format: 'html' | 'json', other?: SavedCheck) {
  if (blocked.value) return
  exportBusy.value = true
  exportError.value = null
  exported.value = false
  try {
    const stem = other
      ? `insto-comparison-${check.username.slice(0, 32)}-${other.username.slice(0, 32)}-${check.id.slice(0, 8)}-${other.id.slice(0, 8)}`
      : `insto-${check.username.slice(0, 48)}-${check.captured_at}-${check.id.slice(0, 8)}`
    const contents = format === 'json' ? JSON.stringify(check, null, 2) : generateReport(check, other, currentLocale())
    // A dismissed native save panel returns false. It is neither an export nor
    // an error, and must clear an earlier export's success message.
    exported.value = await props.research.export(`${stem}.${format}`, contents)
  } catch (failure) { exportError.value = safeFailure(failure) }
  finally { exportBusy.value = false }
}
watch(() => state.value.items.map(check => check.id), ids => {
  if (!ids.includes(firstId.value)) firstId.value = ''
  if (!ids.includes(secondId.value)) secondId.value = ''
  if (pendingDeleteId.value !== null && !ids.includes(pendingDeleteId.value)) pendingDeleteId.value = null
})
onMounted(refresh)
</script>
<template>
  <section ref="view" class="saved-checks-view" :aria-labelledby="`${id}-title`">
    <div class="saved-heading">
      <h2 :id="`${id}-title`">{{ t('research.title') }}</h2>
      <button type="button" data-action="refresh" :disabled="blocked" @click="refresh">{{ t('research.refresh') }}</button>
    </div>
    <p class="saved-intro">{{ t('research.intro') }}</p>
    <p v-if="loading" class="saved-status" role="status">{{ t('research.loading') }}</p>
    <p v-if="error" class="saved-error" role="alert">{{ error.message }}</p>
    <p v-if="exportBusy" class="saved-status" role="status">{{ t('research.exporting') }}</p>
    <p v-if="exported" class="saved-status exported" role="status" data-export-status>{{ t('research.exported') }}</p>
    <p v-if="state.loaded && !loading && state.items.length === 0" class="saved-empty">{{ t('research.empty') }}</p>
    <template v-if="state.items.length">
      <p class="saved-count">{{ t('research.count', { count: formatCount(state.items.length) }) }}</p>
      <div class="saved-list">
        <article v-for="check in state.items" :key="check.id" class="saved-card" :data-check="check.id" :aria-labelledby="`${id}-${check.id}`">
          <h3 :id="`${id}-${check.id}`">@{{ check.username }}</h3>
          <div class="saved-meta">
            <time :datetime="isoTime(check.captured_at)">{{ t('research.capture', { time: localTime(check.captured_at) }) }}</time>
            <time :datetime="isoTime(check.saved_at)">{{ t('research.saved_at', { time: localTime(check.saved_at) }) }}</time>
          </div>
          <p class="saved-coverage">{{ coverage(check) }}</p>
          <div class="saved-actions">
            <button type="button" class="saved-open" data-action="open" :disabled="state.busy" @click="emit('open', check)">{{ t('research.open') }}</button>
            <button type="button" data-action="export-html" :disabled="blocked" @click="exportCheck(check, 'html')">{{ t('research.export') }}</button>
            <button type="button" data-action="export-json" :disabled="blocked" @click="exportCheck(check, 'json')">{{ t('research.export_json') }}</button>
            <button type="button" class="saved-delete" data-action="delete" :disabled="blocked" :aria-expanded="pendingDeleteId === check.id" @click="requestDelete(check)">{{ t('research.delete') }}</button>
          </div>
          <div v-if="pendingDeleteId === check.id" class="saved-confirm" role="alertdialog" :aria-label="t('research.delete_confirm')" @keydown.esc.prevent="cancelDelete">
            <p>{{ t('research.delete_confirm') }} <strong>@{{ check.username }}</strong><br>{{ t('research.capture', { time: localTime(check.captured_at) }) }}</p>
            <div class="saved-actions">
              <button type="button" class="saved-delete" data-action="confirm-delete" :disabled="blocked" @click="remove(check)">{{ t('research.delete') }}</button>
              <button type="button" data-action="cancel-delete" :disabled="state.busy" @click="cancelDelete">{{ t('research.cancel') }}</button>
            </div>
          </div>
        </article>
      </div>
      <section v-if="state.items.length >= 2" class="saved-compare" :aria-labelledby="`${id}-compare-title`">
        <h3 :id="`${id}-compare-title`">{{ t('research.compare_title') }}</h3>
        <p class="saved-intro">{{ t('research.compare_note') }}</p>
        <div class="saved-pickers">
          <label :for="`${id}-first`">{{ t('research.left') }}
            <select :id="`${id}-first`" v-model="firstId" name="first-check">
              <option value="">{{ t('research.choose') }}</option>
              <option v-for="check in state.items" :key="check.id" :value="check.id" :disabled="check.id === secondId">{{ optionLabel(check) }}</option>
            </select>
          </label>
          <label :for="`${id}-second`">{{ t('research.right') }}
            <select :id="`${id}-second`" v-model="secondId" name="second-check">
              <option value="">{{ t('research.choose') }}</option>
              <option v-for="check in state.items" :key="check.id" :value="check.id" :disabled="check.id === firstId">{{ optionLabel(check) }}</option>
            </select>
          </label>
        </div>
        <div v-if="comparison && first && second" class="saved-comparison" data-comparison>
          <div class="comparison-heading">
            <h3>{{ t('research.comparison') }}</h3>
            <button type="button" data-action="export-comparison" :disabled="blocked" @click="exportCheck(first, 'html', second)">{{ t('research.export_comparison') }}</button>
          </div>
          <div class="comparison-coverage">
            <div><strong>{{ t('research.left') }} · @{{ first.username }}</strong><time :datetime="isoTime(first.captured_at)">{{ t('research.capture', { time: localTime(first.captured_at) }) }}</time><p>{{ coverage(first) }}</p></div>
            <div><strong>{{ t('research.right') }} · @{{ second.username }}</strong><time :datetime="isoTime(second.captured_at)">{{ t('research.capture', { time: localTime(second.captured_at) }) }}</time><p>{{ coverage(second) }}</p></div>
          </div>
          <h4>{{ t('research.differences') }}</h4>
          <p v-if="comparison.fields.length === 0" class="saved-empty">{{ t('research.same_fields') }}</p>
          <table v-else class="comparison-fields">
            <caption class="visually-hidden">{{ t('research.differences') }}</caption>
            <thead><tr><th scope="col">{{ t('research.field') }}</th><th scope="col">{{ t('research.left') }}</th><th scope="col">{{ t('research.right') }}</th></tr></thead>
            <tbody><tr v-for="row in comparison.fields" :key="row.field" :data-field="row.field"><th scope="row">{{ fieldLabel(row.field) }}</th><td>{{ valueLabel(row.left, row.leftKnown) }}</td><td>{{ valueLabel(row.right, row.rightKnown) }}</td></tr></tbody>
          </table>
          <p v-if="!bothAnalyzed" class="saved-incomplete">{{ t('research.comparison_unavailable') }}</p>
          <template v-else>
            <section v-for="group in commonGroups" :key="group" class="comparison-common" :data-common="group">
              <h4>{{ t(commonTitles[group]) }}</h4>
              <p v-if="comparison.common[group].length === 0" class="saved-empty">{{ t('research.no_common') }}</p>
              <table v-else>
                <caption class="visually-hidden">{{ t(commonTitles[group]) }}</caption>
                <thead><tr><th scope="col">{{ t(commonTitles[group]) }}</th><th scope="col">{{ t('research.left') }}</th><th scope="col">{{ t('research.right') }}</th></tr></thead>
                <tbody><tr v-for="term in comparison.common[group]" :key="term.key"><th scope="row">{{ termLabel(group, term.key) }}</th><td>{{ formatCount(term.left) }}</td><td>{{ formatCount(term.right) }}</td></tr></tbody>
              </table>
            </section>
          </template>
        </div>
      </section>
    </template>
  </section>
</template>
<style scoped>
.saved-checks-view {
  --saved-bg: #131a23;
  --saved-bg-hover: #25303d;
  --saved-border: #303b48;
  --saved-text: #d3dde9;
  --saved-muted: #8995a4;
  --saved-accent: #a9d0dc;
  --saved-danger: #e2b4b6;
  --saved-warning: #d4c193;
  max-width: 760px;
  margin: 0 auto;
  color: var(--saved-text);
}
@supports (color: light-dark(white, black)) {
  .saved-checks-view {
    --saved-bg: light-dark(#f6f9fa, #131a23);
    --saved-bg-hover: light-dark(#e4edf1, #25303d);
    --saved-border: light-dark(#cdd9e0, #303b48);
    --saved-text: light-dark(#263a45, #d3dde9);
    --saved-muted: light-dark(#586d79, #8995a4);
    --saved-accent: light-dark(#246b81, #a9d0dc);
    --saved-danger: light-dark(#a23942, #e2b4b6);
    --saved-warning: light-dark(#826220, #d4c193);
  }
}
.saved-heading, .comparison-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
h2 { font-size: 21px; margin: 0; }
h3 { font-size: 15px; font-weight: 600; line-height: 1.5; margin: 0; overflow-wrap: anywhere; }
h4 { font-size: 12px; font-weight: 600; margin: 22px 0 8px; }
.saved-intro, .saved-empty, .saved-status, .saved-error, .saved-incomplete { font-size: 12px; line-height: 1.65; margin: 12px 0 18px; }
.saved-intro, .saved-empty { color: var(--saved-muted); }
.saved-count { font-size: 11px; color: var(--saved-muted); margin: 22px 0 10px; }
.saved-list { display: grid; gap: 12px; }
.saved-card { padding: 16px 18px; border: 1px solid var(--saved-border); border-radius: 9px; min-width: 0; }
.saved-meta { display: flex; flex-wrap: wrap; gap: 3px 20px; margin-top: 6px; font-size: 10px; color: var(--saved-muted); line-height: 1.6; }
.saved-coverage { font-size: 11px; line-height: 1.6; margin: 8px 0 12px; color: var(--saved-accent); }
.saved-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
button { background: var(--saved-bg); border: 1px solid var(--saved-border); color: var(--saved-text); font-size: 11px; line-height: 18px; padding: 7px 10px; border-radius: 6px; }
button:hover:not(:disabled) { background: var(--saved-bg-hover); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--saved-accent); outline-offset: 3px; }
.saved-open { border-color: var(--saved-accent); color: var(--saved-accent); }
.saved-delete { color: var(--saved-danger); }
.saved-confirm, .saved-error, .saved-incomplete { padding: 12px 14px; border: 1px solid var(--saved-border); border-radius: 7px; background: var(--saved-bg); }
.saved-confirm { margin-top: 14px; color: var(--saved-warning); font-size: 12px; line-height: 1.7; }
.saved-confirm p { margin: 0 0 10px; overflow-wrap: anywhere; }
.saved-error { color: var(--saved-danger); }
.saved-incomplete { color: var(--saved-warning); }
.exported { color: var(--saved-accent); }
.saved-compare { margin-top: 30px; padding-top: 24px; border-top: 1px solid var(--saved-border); }
.saved-pickers, .comparison-coverage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.saved-pickers label { display: flex; flex-direction: column; gap: 7px; min-width: 0; color: var(--saved-muted); font-size: 11px; }
select { width: 100%; min-width: 0; background: var(--saved-bg); color: var(--saved-text); border: 1px solid var(--saved-border); border-radius: 7px; padding: 10px 8px; font: inherit; }
.saved-comparison { margin-top: 24px; }
.comparison-coverage { margin-top: 18px; font-size: 11px; line-height: 1.65; }
.comparison-coverage > div { min-width: 0; overflow-wrap: anywhere; }
.comparison-coverage strong, .comparison-coverage time { display: block; }
.comparison-coverage strong { font-weight: 550; }
.comparison-coverage time { color: var(--saved-muted); font-size: 10px; margin-top: 4px; }
.comparison-coverage p { margin: 5px 0 0; color: var(--saved-accent); }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; line-height: 1.6; }
th, td { padding: 9px 8px; border-bottom: 1px solid var(--saved-border); text-align: left; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
th { font-weight: 500; }
thead th { color: var(--saved-muted); font-size: 10px; }
th:first-child { width: 40%; padding-left: 0; }
td:last-child, th:last-child { padding-right: 0; }
.comparison-common td { font-variant-numeric: tabular-nums; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 500px) { .saved-pickers, .comparison-coverage { grid-template-columns: minmax(0, 1fr); } .saved-card { padding: 14px; } th, td { padding: 8px 5px; } }
</style>
