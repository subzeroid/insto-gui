<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { DesktopClient } from '../desktop/client'
import { forecastRequests, type Usage } from '../desktop/workbench'
import { safeFailure } from '../desktop/messages'
import { formatCount, localTime } from '../desktop/format'
import { t } from '../i18n'
const props = defineProps<{ client: DesktopClient; watches: readonly { status: string; interval_seconds: number }[]; incomplete: boolean }>()
const usage = ref<Usage | null>(null), draft = ref(''), busy = ref(false), error = ref(''), saved = ref(false)
let alive = true
onBeforeUnmount(() => { alive = false })
const forecast = computed(() => forecastRequests(props.watches))
const exhausted = computed(() => usage.value?.daily_limit != null && usage.value.used >= usage.value.daily_limit)
const exceeds = computed(() => usage.value?.daily_limit != null && forecast.value > usage.value.daily_limit)
async function refresh() {
  if (busy.value) return
  busy.value = true; error.value = ''; saved.value = false
  try { const value = await props.client.inspectUsage(); if (alive) { usage.value = value; draft.value = value.daily_limit === null ? '' : String(value.daily_limit) } }
  catch (e) { if (alive) error.value = safeFailure(e).message }
  finally { if (alive) busy.value = false }
}
async function apply() {
  if (busy.value) return
  const input = draft.value.trim()
  const limit = input === '' ? null : /^\d+$/.test(input) ? Number(input) : NaN
  error.value = ''; saved.value = false
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000)) { error.value = t('usage.invalid'); return }
  busy.value = true
  try { const value = await props.client.configureUsage(limit); if (alive) { usage.value = value; saved.value = true } }
  catch (e) { if (alive) error.value = safeFailure(e).message }
  finally { if (alive) busy.value = false }
}
onMounted(refresh)
</script>
<template>
  <section class="budget-panel" aria-labelledby="budget-title">
    <h2 id="budget-title">{{ t('usage.title') }}</h2>
    <p class="intro">{{ t('usage.intro') }}</p>
    <dl v-if="usage" class="profile-counts"><div><dt>{{ t('usage.today') }}</dt><dd>{{ formatCount(usage.used) }}<span v-if="usage.daily_limit !== null"> / {{ formatCount(usage.daily_limit) }}</span></dd></div></dl>
    <p v-if="usage" class="fine-print">{{ t('usage.reset', { time: localTime(usage.reset_at) }) }}</p>
    <p v-if="exhausted" class="notice warning" role="status">{{ t('usage.at_limit') }}</p>
    <form @submit.prevent="apply">
      <label for="daily-limit">{{ t('usage.limit') }}</label>
      <input id="daily-limit" v-model="draft" inputmode="numeric" type="text" maxlength="7" :disabled="busy || !usage" :placeholder="t('usage.unlimited')" @input="saved = false; error = ''" />
      <p class="fine-print">{{ t('usage.unlimited_hint') }}</p>
      <div class="budget-actions"><button type="submit" :disabled="busy || !usage">{{ t('usage.save') }}</button><button type="button" class="text-button" :aria-label="t('usage.refresh')" :disabled="busy" @click="refresh">{{ t('app.refresh') }}</button></div>
    </form>
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <p v-if="saved" class="notice" role="status">{{ t('usage.saved') }}</p>
    <p>{{ t('usage.forecast', { count: formatCount(forecast) }) }}</p>
    <p v-if="exceeds" class="notice warning">{{ t('usage.forecast_over') }}</p>
    <p v-if="incomplete" class="fine-print">{{ t('usage.partial_forecast') }}</p>
    <p class="fine-print">{{ t('usage.forecast_note') }}</p>
    <p class="fine-print">{{ t('usage.note') }}</p>
  </section>
</template>
<style scoped>
.budget-panel{margin-top:2rem;padding-top:1.4rem;border-top:1px solid #70778955}.budget-actions{display:flex;gap:1rem;align-items:center;margin-top:.8rem}.budget-panel input{max-width:18rem}
</style>
