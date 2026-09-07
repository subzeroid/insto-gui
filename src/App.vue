<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch as observe } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { DesktopClient, type Invoke } from './desktop/client'
import { createDesktopState } from './desktop/state'
import { createMonitoringState } from './desktop/monitoring'
import { createHistoryState } from './desktop/history'
import { createServiceState, type ServiceNotice } from './desktop/service'
import { createHomeState, type SelectOutcome } from './desktop/home'
import { texts } from './desktop/messages'
import AppNav, { type Section } from './components/AppNav.vue'
import OnboardingView from './components/OnboardingView.vue'
import WatchesView from './components/WatchesView.vue'
import ChangesView from './components/ChangesView.vue'
import ServiceView from './components/ServiceView.vue'
import SettingsView from './components/SettingsView.vue'
const props = defineProps<{ invokeCommand?: Invoke }>()
const client = new DesktopClient(props.invokeCommand ?? invoke)
const ui = createDesktopState(client)
const monitoring = createMonitoringState(client)
const history = createHistoryState(client)
// One service state and one home state for the window: onboarding, the service
// section and Settings must agree on the same binding, the same facts and the same
// checked report.
const service = createServiceState(client, ui)
const home = createHomeState(client, ui, { invalidate, settled: afterSelection })
const { state } = ui
const section = ref<Section>('watches')
const feedFilter = ref<string | null>(null)
const booted = ref(false)
const selecting = ref(false)
const selectionUncertain = ref(false)
const NOTICE_TEXT: Record<ServiceNotice, string> = {
  migrated: texts.service_migrated,
  migration_rolled_back: texts.service_migration_rolled_back,
  migration_recovery: texts.service_migration_recovery,
  migration_uncertain: texts.service_migration_uncertain,
}
const migrationNotice = computed(() => service.state.notice === null ? null : NOTICE_TEXT[service.state.notice])
// R10: a binding the app cannot use is the one thing that must stay reachable when
// initialization failed. `own` never offers it — there is nothing to release.
const canRelease = computed(() => state.phase === 'failed' && service.state.binding.state !== 'own')
async function boot() {
  await ui.initialize()
  // The binding is a host-local read that answers whenever preparation completed,
  // so it is read even when the core inspection failed: the failure screen decides
  // on it. The registration facts need a working bridge and a configured profile.
  if (state.phase === 'ready' && state.profile?.configured) {
    await service.inspect()
    await service.autoMigrateOnce()
  } else await service.refreshBinding()
  booted.value = true
}
// R11: everything scoped to the bound home dies before the selection IPC leaves,
// so a response arriving from the previous home has nothing left to repopulate.
// `selecting` holds the poll watcher off until the new binding has been proved.
function invalidate() {
  selecting.value = true
  monitoring.reset()
  history.resetHome()
  feedFilter.value = null
  service.clear()
}
async function afterSelection(outcome: SelectOutcome) {
  // `initialize` clears the global error banner, so an uncertain outcome needs a
  // notice of its own or it would vanish without a trace.
  selectionUncertain.value = outcome === 'uncertain'
  if (outcome === 'uncertain') {
    // The binding itself is in doubt: it is re-read first, initialization starts
    // over from it, and polling resumes only once that has proved the profile.
    await service.refreshBinding()
    await ui.initialize()
    if (state.phase === 'ready') await service.refreshFacts()
  } else {
    // Only a selection that actually happened moves the user; a refusal changed
    // nothing and leaves them on the screen that carries the reason.
    if (outcome === 'selected') { await ui.initialize(); section.value = 'watches' }
    // A refusal changed nothing either way, but the invalidation cleared the facts.
    if (state.phase === 'ready') await service.inspect()
  }
  selecting.value = false
}
async function releaseFromFailure() {
  invalidate()
  selectionUncertain.value = false
  await ui.releaseBinding()
  await service.refreshBinding()
  if (state.phase === 'ready' && state.profile?.configured) await service.refreshFacts()
  section.value = 'watches'
  selecting.value = false
}
onMounted(boot)
onBeforeUnmount(() => { monitoring.dispose(); service.dispose(); ui.dispose() })
observe(() => booted.value && !selecting.value && state.phase === 'ready' && state.profile?.configured === true, on => { if (on) monitoring.start(); else monitoring.stop() })
// A profile that needs attention (recovery, failed start) opens the service
// section, so a configured-but-broken setup never hides behind another tab.
const attention = computed(() => state.profile?.status === 'recovery_required' || state.profile?.status === 'service_error')
observe(attention, needed => { if (needed) section.value = 'service' })
// A migration that did not simply succeed is about the service: show it where it
// can be acted on.
observe(() => service.state.notice, notice => { if (notice !== null && notice !== 'migrated') section.value = 'service' })
function showChanges(pk: string) { feedFilter.value = pk; section.value = 'changes' }
// R7: every profile mutation re-reads the registration facts. Reconcile (not
// refresh) for the overview: a service action must not acknowledge an uncertain
// watch outcome on the user's behalf.
const connect = (token: string) => service.afterMutation(() => ui.configure(token))
const replaceToken = (token: string) => service.afterMutation(() => ui.replace(token))
async function serviceAction(action: () => Promise<boolean>) { const ok = await service.afterMutation(action); await monitoring.reconcile(); return ok }
</script>
<template>
  <div class="app-shell">
    <header class="app-header"><div class="brand"><span class="brand-mark" aria-hidden="true">i</span>insto</div><span class="build-label">Локальная сборка · G2</span></header>
    <AppNav v-if="state.phase === 'ready' && state.profile?.configured" :current="section" @navigate="section = $event" />
    <main>
      <section v-if="state.phase === 'preparing'" class="loading-panel" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"/><div class="eyebrow">ВСЁ НУЖНОЕ УЖЕ ВНУТРИ</div><h1>Готовим ядро</h1><p class="intro">Проверяем встроенные файлы и создаём защищённую копию. Это не требует загрузок из интернета.</p></section>
      <section v-else-if="state.phase === 'failed'" class="loading-panel">
        <div class="eyebrow">ПОДГОТОВКА НЕ ЗАВЕРШЕНА</div>
        <h1>Нужно повторить проверку</h1>
        <p class="notice danger" role="alert">{{ state.error?.message }}</p>
        <button class="primary" :disabled="state.busy" @click="boot">Повторить</button>
        <template v-if="canRelease">
          <p class="fine-print">{{ texts.binding_release_explain }}</p>
          <button type="button" data-action="release-binding" :disabled="state.busy" @click="releaseFromFailure">Вернуться к собственному профилю</button>
        </template>
      </section>
      <template v-else-if="state.phase === 'ready' && state.profile">
        <!-- A selection whose outcome nobody can name concerns both screens, so the
             notice sits above the configured / unconfigured split. -->
        <p v-if="selectionUncertain" class="notice warning" role="status" data-note="selection-uncertain">Результат подключения каталога неизвестен: изменение могло примениться, а могло и нет. Проверьте в разделе «Настройки», с каким каталогом сейчас работает приложение.</p>
        <OnboardingView v-if="!state.profile.configured" :busy="state.busy" :stale="state.stale" :error="state.error" :home="home" :binding="service.state.binding" :connect="connect" :open-token-page="() => client.openTokenPage()" :refresh="ui.refresh" />
        <template v-else>
          <!-- Setup/service state is global: its errors and recovery needs show on every section. -->
          <div v-if="state.error" class="notice danger" role="alert">{{ state.error.message }}</div>
          <div v-if="state.stale" class="notice warning" role="status">Состояние настройки устарело. Изменения службы заблокированы до обновления. <button type="button" class="text-button" data-action="refresh-setup" aria-label="Обновить состояние настройки" :disabled="state.busy" @click="ui.refresh">Обновить</button></div>
          <p v-else-if="state.outcomeUnknown" class="notice" role="status">Текущее состояние перечитано и показано ниже. Операция не повторялась автоматически.</p>
          <p v-if="migrationNotice" class="notice" :class="{ warning: service.state.notice !== 'migrated' }" role="status">{{ migrationNotice }}</p>
          <p v-if="attention && section !== 'service'" class="notice warning" role="status">Служба требует внимания. <button type="button" class="text-button" data-action="open-service" @click="section = 'service'">Открыть раздел «Служба»</button></p>
          <div v-if="section === 'watches'" id="panel-watches" role="tabpanel" aria-labelledby="tab-watches">
            <WatchesView :monitoring="monitoring" :history="history" @show-changes="showChanges" />
          </div>
          <div v-else-if="section === 'changes'" id="panel-changes" role="tabpanel" aria-labelledby="tab-changes">
            <ChangesView :history="history" :filter-pk="feedFilter" @clear-filter="feedFilter = null" />
          </div>
          <div v-else-if="section === 'service'" id="panel-service" role="tabpanel" aria-labelledby="tab-service">
            <ServiceView :profile="state.profile" :overview="monitoring.state.overview" :last-read-at="monitoring.state.lastReadAt" :stale="state.stale" :monitoring-stale="monitoring.state.stale" :read-error="monitoring.state.readError" :busy="state.busy" :service="service" :refresh-overview="monitoring.refresh" :refresh-facts="service.refreshFacts" :start="() => serviceAction(ui.start)" :stop="() => serviceAction(ui.stop)" :repair="() => serviceAction(ui.repair)" />
            <div class="refresh-row"><span>Состояние читается локально, без запросов HikerAPI.</span><button class="text-button" data-action="refresh-service" aria-label="Обновить состояние службы" :disabled="state.busy" @click="ui.refresh">Обновить</button></div>
          </div>
          <div v-else id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
            <SettingsView :busy="state.busy" :stale="state.stale" :configured="state.profile.configured" :recovery="state.profile.status === 'recovery_required'" :service-running="state.profile.service_running" :core-version="state.runtime?.core_version ?? null" :build-id="state.runtime?.build_id ?? null" :service="service" :home="home" :binding="service.state.binding" :replace="replaceToken" :uninstall="service.uninstall" :open-token-page="() => client.openTokenPage()" />
          </div>
        </template>
      </template>
    </main>
    <footer><span class="status-dot" aria-hidden="true"/>{{ state.runtime ? `Встроенное ядро ${state.runtime.core_version}` : 'Самостоятельное приложение для macOS' }}<span class="footer-note">Локальные данные · без запросов HikerAPI из окна</span></footer>
  </div>
</template>
