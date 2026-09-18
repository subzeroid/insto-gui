<script setup lang="ts">
import { computed, ref, watch as observe } from 'vue'
import type { Profile } from '../desktop/client'
import type { Overview } from '../desktop/dto'
import type { createServiceState } from '../desktop/service'
import { localTime } from '../desktop/format'
import { t } from '../i18n'
import ConfirmBlock from './ConfirmBlock.vue'
import ServicePanel from './ServicePanel.vue'
import type { DesktopFailure } from '../desktop/messages'
const props = defineProps<{ profile: Profile; overview: Overview | null; lastReadAt: number | null; stale: boolean; monitoringStale: boolean; readError: DesktopFailure | null; busy: boolean; service: ReturnType<typeof createServiceState>; refreshOverview: () => Promise<boolean>; refreshFacts: () => Promise<void>; start: () => Promise<boolean>; stop: () => Promise<boolean>; repair: () => Promise<boolean> }>()
const labels = { running: t('service.state_running'), stopped: t('service.state_stopped'), unknown: t('service.state_unknown') }
const confirming = ref(false)
const facts = computed(() => props.service.state.facts)
const binding = computed(() => props.service.state.binding)
const readonly = computed(() => props.service.readonly())
const canMigrate = computed(() => props.service.canMigrate())
const takeover = computed(() => props.service.takeover())
const folders = { own: t('service.folder_own'), adopted: t('service.folder_adopted'), unknown: t('service.folder_unknown') }
// The three reasons a control is read-only are different situations and the user
// can act on only one of them, so they are named separately.
const readonlyReason = computed(() => {
  if (binding.value.state === 'unknown') return t('service.readonly_binding')
  if (facts.value === null || !props.service.fresh()) return t('service.readonly_facts')
  return t('service.readonly_foreign')
})
// R12: a control that stops being available takes its open confirmation with it,
// so a confirmation can never outlive the state that justified it.
observe([readonly, takeover, () => props.stale], () => { if (readonly.value || !takeover.value || props.stale) confirming.value = false })
async function migrate() { confirming.value = false; await props.service.migrate() }
</script>
<template>
  <div class="service-view">
    <ServicePanel :profile="profile" :busy="busy" :stale="stale" :readonly="readonly" :start="start" :stop="stop" :repair="repair" />
    <p v-if="monitoringStale" class="notice warning" role="status">{{ t('service.monitoring_stale') }} <button type="button" class="text-button" data-action="refresh-overview" :aria-label="t('service.refresh_overview_label')" @click="refreshOverview">{{ t('app.refresh') }}</button></p>
    <dl class="service-facts">
      <div><dt>{{ t('service.observed') }}</dt><dd>{{ overview ? labels[overview.service_state] + (monitoringStale ? t('service.stale_suffix') : '') : t('service.no_data') }}</dd></div>
      <div><dt>{{ t('service.core_database') }}</dt><dd>{{ readError ? t('service.read_failed') : overview ? t('service.available') : t('service.checking') }}</dd></div>
      <div><dt>{{ t('service.last_read') }}</dt><dd>{{ lastReadAt === null ? t('format.never') : localTime(Math.floor(lastReadAt / 1000)) }}</dd></div>
    </dl>
    <p v-if="service.state.error" class="notice warning" role="status">{{ t('service.facts_error', { message: service.state.error.message }) }} <button type="button" class="text-button" data-action="refresh-facts" :disabled="busy" @click="refreshFacts">{{ t('service.check_again') }}</button></p>
    <dl v-if="facts" class="registration-facts">
      <div><dt>{{ t('service.registration') }}</dt><dd>{{ facts.registration === 'owned' ? t('service.registration_owned') : facts.registration === 'unknown' ? t('service.registration_unknown') : t('service.registration_none') }}</dd></div>
      <div v-if="facts.registration === 'owned'"><dt>{{ t('service.interpreter') }}</dt><dd>{{ facts.interpreter === 'current' ? t('service.interpreter_current') : t('service.interpreter_other') }}{{ facts.interpreterExists === false ? t('service.interpreter_missing') : '' }}</dd></div>
      <div v-if="facts.registration !== 'none'"><dt>{{ t('service.loaded') }}</dt><dd>{{ facts.loaded === null ? t('service.state_unknown') : facts.loaded ? t('format.yes') : t('format.no') }}</dd></div>
      <div><dt>{{ t('service.folder') }}</dt><dd>{{ folders[binding.state] }}</dd></div>
    </dl>
    <p v-if="readonly" class="notice warning" role="status" data-note="service-readonly">{{ readonlyReason }}</p>
    <p v-else-if="facts?.settings === 'different'" class="notice warning" role="status" data-note="service-settings">{{ t('service.settings_different') }}</p>
    <template v-else-if="canMigrate">
      <p class="notice" role="status">{{ takeover ? t('service.takeover_notice') : t('service.migrate_notice') }}</p>
      <button type="button" class="primary" data-action="migrate-service" :disabled="busy || stale || service.state.migrating" @click="takeover ? (confirming = true) : migrate()">{{ takeover ? t('service.takeover_action') : t('text.service_migrate_action') }}</button>
    </template>
    <ConfirmBlock v-if="confirming" :label="t('service.takeover_confirm_label')" :message="t('service.takeover_confirm')" :confirm-label="t('service.takeover_confirm_action')" action="takeover" :busy="busy" @confirm="migrate" @cancel="confirming = false" />
    <p class="fine-print">{{ t('service.note') }}</p>
  </div>
</template>
