<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { DesktopClient, type Invoke } from './desktop/client'
import { createDesktopState } from './desktop/state'
import SetupPanel from './components/SetupPanel.vue'
import ServicePanel from './components/ServicePanel.vue'
const props = defineProps<{ invokeCommand?: Invoke }>()
const client = new DesktopClient(props.invokeCommand ?? invoke)
const ui = createDesktopState(client)
const { state } = ui
const replacing = ref(false)
onMounted(ui.initialize)
onBeforeUnmount(ui.dispose)
async function replace(token: string) { const success = await ui.replace(token); if (success) replacing.value = false; return success }
</script>
<template>
  <div class="app-shell">
    <header class="app-header"><div class="brand"><span class="brand-mark" aria-hidden="true">i</span>insto</div><span class="build-label">Локальная сборка · P1</span></header>
    <main>
      <section v-if="state.phase === 'preparing'" class="loading-panel" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"/><div class="eyebrow">ВСЁ НУЖНОЕ УЖЕ ВНУТРИ</div><h1>Готовим ядро</h1><p class="intro">Проверяем встроенные файлы и создаём защищённую копию. Это не требует загрузок из интернета.</p></section>
      <section v-else-if="state.phase === 'failed'" class="loading-panel"><div class="eyebrow">ПОДГОТОВКА НЕ ЗАВЕРШЕНА</div><h1>Нужно повторить проверку</h1><p class="notice danger" role="alert">{{ state.error?.message }}</p><button class="primary" :disabled="state.busy" @click="ui.initialize">Повторить</button></section>
      <template v-else-if="state.phase === 'ready' && state.profile">
        <div v-if="state.error" class="notice danger" role="alert">{{ state.error.message }}</div>
        <div v-if="state.stale" class="notice warning" role="status">Данные устарели. Последнее обновление: {{ state.lastReadAt ? new Date(state.lastReadAt).toLocaleTimeString('ru-RU') : 'не выполнено' }}. Изменения заблокированы до обновления.</div>
        <p v-else-if="state.outcomeUnknown" class="notice" role="status">Текущее состояние перечитано и показано ниже. Операция не повторялась автоматически.</p>
        <SetupPanel v-if="state.profile.status === 'unconfigured'" :busy="state.busy || state.stale" :connect="ui.configure" :open-token-page="() => client.openTokenPage()" />
        <template v-else>
          <ServicePanel :profile="state.profile" :busy="state.busy" :stale="state.stale" :start="ui.start" :stop="ui.stop" :repair="ui.repair" />
          <div class="settings-row" v-if="state.profile.configured"><span>Доступ к HikerAPI</span><button class="text-button" :disabled="state.busy || state.stale || state.profile.status === 'recovery_required'" :aria-expanded="replacing" @click="replacing = !replacing">{{ replacing ? 'Закрыть' : 'Заменить токен' }}</button></div>
          <SetupPanel v-if="replacing" replace :busy="state.busy || state.stale" :connect="replace" :open-token-page="() => client.openTokenPage()" />
        </template>
        <div class="refresh-row"><span>{{ state.busy ? 'Дождитесь завершения операции…' : 'Состояние читается локально, без запросов HikerAPI.' }}</span><button class="text-button" :disabled="state.busy" @click="ui.refresh">Обновить</button></div>
      </template>
    </main>
    <footer><span class="status-dot" aria-hidden="true"/>{{ state.runtime ? `Встроенное ядро ${state.runtime.core_version}` : 'Самостоятельное приложение для macOS' }}<span class="footer-note">Настройка и служба · экраны аккаунтов ещё в разработке</span></footer>
  </div>
</template>
