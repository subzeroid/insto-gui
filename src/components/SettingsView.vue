<script setup lang="ts">
import { computed, ref, watch as observe } from 'vue'
import type { Binding } from '../desktop/client'
import type { createHomeState } from '../desktop/home'
import type { createServiceState } from '../desktop/service'
import ConfirmBlock from './ConfirmBlock.vue'
import HomeAdoption from './HomeAdoption.vue'
import SetupPanel from './SetupPanel.vue'
const props = defineProps<{ busy: boolean; stale: boolean; configured: boolean; recovery: boolean; serviceRunning: boolean; coreVersion: string | null; buildId: string | null; service: ReturnType<typeof createServiceState>; home: ReturnType<typeof createHomeState>; binding: Binding; replace: (token: string) => Promise<boolean>; uninstall: () => Promise<boolean>; openTokenPage: () => Promise<void> }>()
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
async function replace(token: string) { const ok = await props.replace(token); if (ok) replacing.value = false; return ok }
async function disable() { confirming.value = false; await props.uninstall() }
</script>
<template>
  <section class="settings-view">
    <h1>Настройки</h1>
    <div class="settings-row"><span>Доступ к HikerAPI</span><button type="button" class="text-button" data-action="replace" :disabled="busy || stale || !configured || recovery" :aria-expanded="replacing" @click="replacing = !replacing">{{ replacing ? 'Закрыть' : 'Заменить токен' }}</button></div>
    <SetupPanel v-if="replacing" replace :busy="busy || stale" :connect="replace" :open-token-page="openTokenPage" />
    <div class="settings-row"><span>Фоновая служба перед удалением приложения</span><button type="button" class="text-button" data-action="uninstall" :disabled="busy || stale || !configured || confirming || recovery || !canUninstall" @click="confirming = true">Отключить фоновую службу</button></div>
    <!-- The Trash explanation is offered up front, not only inside the confirmation. -->
    <p class="fine-print">Перенос приложения в Корзину сам по себе не отключает установленную службу{{ serviceRunning ? ' — её процесс сейчас запущен' : '' }}. Отключите её здесь перед удалением приложения.</p>
    <p v-if="adoptedService" class="notice warning" role="status">Эта служба принадлежит подключённой установке insto и работает на её ядре. Приложение её не удаляет: сначала возьмите её под управление в разделе «Служба» или отключите тем же способом, каким устанавливали.</p>
    <p v-else-if="readonly" class="notice warning" role="status">Состояние регистрации службы приложению неизвестно, поэтому доступен только просмотр. Откройте раздел «Служба» и проверьте регистрацию ещё раз.</p>
    <ConfirmBlock v-if="confirming" label="Отключение фоновой службы" message="Регистрация службы будет удалена, и служба не запустится при следующем открытии приложения. Настройки, история снимков и токен сохранятся. Перенос приложения в Корзину сам по себе не отключает установленную службу." confirm-label="Отключить" action="uninstall" :busy="busy" @confirm="disable" @cancel="confirming = false" />
    <dl class="service-facts">
      <div><dt>Встроенное ядро</dt><dd>{{ coreVersion ?? 'не подготовлено' }}</dd></div>
      <div><dt>Идентификатор сборки</dt><dd class="mono">{{ buildId ? buildId.slice(0, 16) : 'нет данных' }}</dd></div>
    </dl>
    <HomeAdoption :home="home" :binding="binding" :busy="busy || stale" :disabled="recovery" />
  </section>
</template>
