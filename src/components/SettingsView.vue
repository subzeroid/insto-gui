<script setup lang="ts">
import { computed, ref, watch as observe } from 'vue'
import type { Binding } from '../desktop/client'
import type { createHomeState } from '../desktop/home'
import type { createServiceState } from '../desktop/service'
import { LOCALES, currentLocale, saveLocale, t, type Locale } from '../i18n'
import ConfirmBlock from './ConfirmBlock.vue'
import HomeAdoption from './HomeAdoption.vue'
import SetupPanel from './SetupPanel.vue'
const props = withDefaults(defineProps<{ busy: boolean; stale: boolean; configured: boolean; recovery: boolean; serviceRunning: boolean; coreVersion: string | null; buildId: string | null; service: ReturnType<typeof createServiceState>; home: ReturnType<typeof createHomeState>; binding: Binding; replace: (token: string) => Promise<boolean>; uninstall: () => Promise<boolean>; openTokenPage: () => Promise<void>; reload?: () => void }>(), { reload: () => window.location.reload() })
const replacing = ref(false)
const confirming = ref(false)
const readonly = computed(() => props.service.readonly())
const canUninstall = computed(() => props.service.canUninstall())
// The one refusal that is not read-only: the app owns nothing here, the user's CLI
// does, and removing it is not the app's to offer.
const adoptedService = computed(() => props.binding.state === 'adopted' && props.service.state.facts?.registration === 'owned' && props.service.state.facts.interpreter === 'other')
// Recovery serializes with token replacement and service removal (spec section 4);
// R12 adds the read-only rule. Either one closes an open form or confirmation
// instead of leaving a control that would refuse itself.
observe([() => props.recovery, readonly, canUninstall], () => {
  if (props.recovery) replacing.value = false
  if (props.recovery || readonly.value || !canUninstall.value) confirming.value = false
})
// Languages are named in themselves, so the list reads the same in either locale.
const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский' }
const language = currentLocale()
// `t` is not reactive: the choice is saved and the window reloads into it. If the
// choice cannot be saved, a reload would change nothing, so none happens.
function chooseLanguage(value: string) {
  const locale = LOCALES.find(item => item === value)
  if (locale === undefined || locale === language) return
  if (saveLocale(locale)) props.reload()
}
async function replace(token: string) { const ok = await props.replace(token); if (ok) replacing.value = false; return ok }
async function disable() { confirming.value = false; await props.uninstall() }
</script>
<template>
  <section class="settings-view">
    <h1>{{ t('settings.title') }}</h1>
    <div class="settings-row"><span>{{ t('settings.access') }}</span><button type="button" class="text-button" data-action="replace" :disabled="busy || stale || !configured || recovery" :aria-expanded="replacing" @click="replacing = !replacing">{{ replacing ? t('settings.close') : t('settings.replace') }}</button></div>
    <SetupPanel v-if="replacing" replace :busy="busy || stale" :connect="replace" :open-token-page="openTokenPage" />
    <div class="settings-row"><span>{{ t('settings.uninstall_row') }}</span><button type="button" class="text-button" data-action="uninstall" :disabled="busy || stale || !configured || confirming || recovery || !canUninstall" @click="confirming = true">{{ t('settings.uninstall') }}</button></div>
    <!-- The Trash explanation is offered up front, not only inside the confirmation. -->
    <p class="fine-print">{{ t('settings.trash_note', { running: serviceRunning ? t('settings.trash_note_running') : '' }) }}</p>
    <p v-if="adoptedService" class="notice warning" role="status">{{ t('settings.adopted_service') }}</p>
    <p v-else-if="readonly" class="notice warning" role="status">{{ t('settings.readonly') }}</p>
    <ConfirmBlock v-if="confirming" :label="t('settings.uninstall_confirm_label')" :message="t('settings.uninstall_confirm')" :confirm-label="t('settings.uninstall_confirm_action')" action="uninstall" :busy="busy" @confirm="disable" @cancel="confirming = false" />
    <dl class="service-facts">
      <div><dt>{{ t('settings.core') }}</dt><dd>{{ coreVersion ?? t('settings.core_none') }}</dd></div>
      <div><dt>{{ t('settings.build') }}</dt><dd class="mono">{{ buildId ? buildId.slice(0, 16) : t('settings.build_none') }}</dd></div>
    </dl>
    <div class="settings-row"><label for="language">{{ t('settings.language') }}</label><select id="language" name="language" :value="language" @change="chooseLanguage(($event.target as HTMLSelectElement).value)"><option v-for="locale in LOCALES" :key="locale" :value="locale">{{ LANGUAGE_NAMES[locale] }}</option></select></div>
    <p class="fine-print">{{ t('settings.language_note') }}</p>
    <HomeAdoption :home="home" :binding="binding" :busy="busy || stale" :disabled="recovery" />
  </section>
</template>
