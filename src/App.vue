<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch as observe } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { DesktopClient, type Invoke } from './desktop/client'
import { createDesktopState } from './desktop/state'
import { createMonitoringState } from './desktop/monitoring'
import { createHistoryState } from './desktop/history'
import AppNav, { type Section } from './components/AppNav.vue'
import SetupPanel from './components/SetupPanel.vue'
import WatchesView from './components/WatchesView.vue'
import ChangesView from './components/ChangesView.vue'
import ServiceView from './components/ServiceView.vue'
import SettingsView from './components/SettingsView.vue'
const props = defineProps<{ invokeCommand?: Invoke }>()
const client = new DesktopClient(props.invokeCommand ?? invoke)
const ui = createDesktopState(client)
const monitoring = createMonitoringState(client)
const history = createHistoryState(client)
const { state } = ui
const section = ref<Section>('watches')
const feedFilter = ref<string | null>(null)
onMounted(ui.initialize)
onBeforeUnmount(() => { monitoring.dispose(); ui.dispose() })
observe(() => state.phase === 'ready' && state.profile?.configured === true, configured => { if (configured) monitoring.start(); else monitoring.stop() })
// A profile that needs attention (recovery, failed start) opens the service
// section, so a configured-but-broken setup never hides behind another tab.
const attention = computed(() => state.profile?.status === 'recovery_required' || state.profile?.status === 'service_error')
observe(attention, needed => { if (needed) section.value = 'service' })
function showChanges(pk: string) { feedFilter.value = pk; section.value = 'changes' }
// Reconcile (not refresh): a service action must not acknowledge an uncertain watch outcome on the user's behalf.
async function serviceAction(action: () => Promise<boolean>) { const ok = await action(); await monitoring.reconcile(); return ok }
</script>
<template>
  <div class="app-shell">
    <header class="app-header"><div class="brand"><span class="brand-mark" aria-hidden="true">i</span>insto</div><span class="build-label">Локальная сборка · G1</span></header>
    <AppNav v-if="state.phase === 'ready' && state.profile?.configured" :current="section" @navigate="section = $event" />
    <main>
      <section v-if="state.phase === 'preparing'" class="loading-panel" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"/><div class="eyebrow">ВСЁ НУЖНОЕ УЖЕ ВНУТРИ</div><h1>Готовим ядро</h1><p class="intro">Проверяем встроенные файлы и создаём защищённую копию. Это не требует загрузок из интернета.</p></section>
      <section v-else-if="state.phase === 'failed'" class="loading-panel"><div class="eyebrow">ПОДГОТОВКА НЕ ЗАВЕРШЕНА</div><h1>Нужно повторить проверку</h1><p class="notice danger" role="alert">{{ state.error?.message }}</p><button class="primary" :disabled="state.busy" @click="ui.initialize">Повторить</button></section>
      <template v-else-if="state.phase === 'ready' && state.profile">
        <template v-if="!state.profile.configured">
          <div v-if="state.error" class="notice danger" role="alert">{{ state.error.message }}</div>
          <div v-if="state.stale" class="notice warning" role="status">Данные устарели. Изменения заблокированы до обновления. <button type="button" class="text-button" :disabled="state.busy" @click="ui.refresh">Обновить</button></div>
          <SetupPanel :busy="state.busy || state.stale" :connect="ui.configure" :open-token-page="() => client.openTokenPage()" />
        </template>
        <template v-else>
          <!-- Setup/service state is global: its errors and recovery needs show on every section. -->
          <div v-if="state.error" class="notice danger" role="alert">{{ state.error.message }}</div>
          <div v-if="state.stale" class="notice warning" role="status">Состояние настройки устарело. Изменения службы заблокированы до обновления. <button type="button" class="text-button" :disabled="state.busy" @click="ui.refresh">Обновить</button></div>
          <p v-else-if="state.outcomeUnknown" class="notice" role="status">Текущее состояние перечитано и показано ниже. Операция не повторялась автоматически.</p>
          <p v-if="attention && section !== 'service'" class="notice warning" role="status">Служба требует внимания. <button type="button" class="text-button" data-action="open-service" @click="section = 'service'">Открыть раздел «Служба»</button></p>
          <WatchesView v-if="section === 'watches'" :monitoring="monitoring" :history="history" @show-changes="showChanges" />
          <ChangesView v-else-if="section === 'changes'" :history="history" :filter-pk="feedFilter" @clear-filter="feedFilter = null" />
          <template v-else-if="section === 'service'">
            <ServiceView :profile="state.profile" :overview="monitoring.state.overview" :last-read-at="monitoring.state.lastReadAt" :stale="state.stale" :monitoring-stale="monitoring.state.stale" :read-error="monitoring.state.readError" :busy="state.busy" :refresh-overview="monitoring.refresh" :start="() => serviceAction(ui.start)" :stop="() => serviceAction(ui.stop)" :repair="() => serviceAction(ui.repair)" />
            <div class="refresh-row"><span>Состояние читается локально, без запросов HikerAPI.</span><button class="text-button" :disabled="state.busy" @click="ui.refresh">Обновить</button></div>
          </template>
          <template v-else>
            <SettingsView :busy="state.busy" :stale="state.stale" :configured="state.profile.configured" :recovery="state.profile.status === 'recovery_required'" :desired-service="state.profile.desired_service" :service-running="state.profile.service_running" :core-version="state.runtime?.core_version ?? null" :build-id="state.runtime?.build_id ?? null" :replace="ui.replace" :stop="() => serviceAction(ui.stop)" :open-token-page="() => client.openTokenPage()" />
          </template>
        </template>
      </template>
    </main>
    <footer><span class="status-dot" aria-hidden="true"/>{{ state.runtime ? `Встроенное ядро ${state.runtime.core_version}` : 'Самостоятельное приложение для macOS' }}<span class="footer-note">Локальные данные · без запросов HikerAPI из окна</span></footer>
  </div>
</template>
