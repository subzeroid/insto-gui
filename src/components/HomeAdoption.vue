<script setup lang="ts">
import { computed, ref, watch as observe } from 'vue'
import type { Binding } from '../desktop/client'
import type { createHomeState } from '../desktop/home'
import { t } from '../i18n'
import ConfirmBlock from './ConfirmBlock.vue'
// The block runs the selection and shows its reason; it never carries the
// outcome onward. A successful adoption unmounts it, so anything routed through
// its lifetime would be lost — `createHomeState` reports the outcome instead.
const props = defineProps<{ home: ReturnType<typeof createHomeState>; binding: Binding; busy: boolean; disabled: boolean }>()
const confirming = ref<'adopt' | 'release' | null>(null)
const state = computed(() => props.home.state)
const checked = computed(() => state.value.checked)
const adopted = computed(() => props.binding.state === 'adopted')
// An inspection in flight blocks the field, the check and the adoption: the single
// `checked` slot must not change under a decision the user is making.
const blocked = computed(() => props.busy || props.disabled || state.value.checking)
const backends = { hikerapi: t('home.backend_hikerapi'), aiograpi: t('home.backend_aiograpi'), fake: t('home.backend_fake') }
const databases = { ok: t('home.database_ok'), missing: t('home.database_missing'), schema_mismatch: t('home.database_schema_mismatch'), unreadable: t('home.database_unreadable') }
const registrations = { none: t('home.registration_none'), owned: t('home.registration_owned'), unknown: t('home.registration_unknown') }
const reasons = {
  home_invalid: t('home.reason_home_invalid'),
  home_backend_unsupported: t('home.reason_home_backend_unsupported'),
  schema_mismatch: t('home.reason_schema_mismatch'),
  storage_error: t('home.reason_storage_error'),
}
// Every keystroke goes through `edit`, which clears the checked report: what the
// user sees checked is always the path the selection would use.
function edit(event: Event) { props.home.edit((event.target as HTMLInputElement).value) }
// Anything that changes the decision under an open confirmation closes it, rather
// than leaving a button that would refuse itself.
observe([checked, () => props.disabled, adopted], () => { confirming.value = null })
async function adopt() { confirming.value = null; await props.home.adopt() }
async function release() { confirming.value = null; await props.home.release() }
</script>
<template>
  <section class="home-adoption">
    <h3>{{ t('text.home_title') }}</h3>
    <p class="fine-print">{{ t('home.intro') }}</p>
    <label class="home-path">{{ t('text.home_path_label') }}
      <input type="text" spellcheck="false" autocapitalize="off" autocomplete="off" data-field="home-path" :value="state.path" :disabled="blocked" @input="edit">
    </label>
    <button type="button" data-action="check-home" :disabled="blocked" @click="home.check()">{{ t('text.home_check_action') }}</button>
    <p v-if="state.error" class="notice danger" role="alert">{{ state.error.message }}</p>
    <template v-if="checked">
      <dl class="home-report">
        <div><dt>{{ t('home.field_path') }}</dt><dd>{{ checked.report.path }}</dd></div>
        <div><dt>{{ t('home.field_backend') }}</dt><dd>{{ checked.report.backend ? backends[checked.report.backend] : t('home.backend_unknown') }}</dd></div>
        <div><dt>{{ t('home.field_database') }}</dt><dd>{{ databases[checked.report.database] }}</dd></div>
        <div><dt>{{ t('home.field_service') }}</dt><dd>{{ registrations[checked.report.registration] }}<template v-if="checked.report.registration === 'owned'">{{ t('home.interpreter', { core: checked.report.interpreter === 'current' ? t('service.interpreter_current') : t('service.interpreter_other'), process: checked.report.process === 'running' ? t('home.process_running') : checked.report.process === 'stopped' ? t('home.process_stopped') : t('home.process_unknown') }) }}</template></dd></div>
        <div><dt>{{ t('home.field_result') }}</dt><dd>{{ checked.report.adoptable ? t('home.adoptable') : checked.report.reason ? reasons[checked.report.reason] : t('home.not_adoptable') }}</dd></div>
      </dl>
      <p v-if="checked.report.registration === 'unknown'" class="notice" role="status">{{ t('text.home_unknown_owner') }}</p>
      <button v-if="checked.report.adoptable && !adopted" type="button" class="primary" data-action="adopt-home" :disabled="blocked" @click="confirming = 'adopt'">{{ t('text.home_adopt_action') }}</button>
    </template>
    <template v-if="adopted">
      <p class="fine-print">{{ t('home.bound', { home: binding.home ?? '' }) }}</p>
      <button type="button" data-action="release-home" :disabled="busy || disabled" @click="confirming = 'release'">{{ t('text.home_release_action') }}</button>
    </template>
    <ConfirmBlock v-if="confirming === 'adopt' && checked" :label="t('home.adopt_confirm_label')" :message="t('home.adopt_confirm', { path: checked.path })" :confirm-label="t('text.home_adopt_action')" action="adopt" :busy="busy" @confirm="adopt" @cancel="confirming = null" />
    <ConfirmBlock v-if="confirming === 'release'" :label="t('home.release_confirm_label')" :message="t('home.release_confirm')" :confirm-label="t('home.release_confirm_action')" action="release" :busy="busy" @confirm="release" @cancel="confirming = null" />
  </section>
</template>
