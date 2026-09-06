<script setup lang="ts">
import { ref, watch as observe } from 'vue'
import ConfirmBlock from './ConfirmBlock.vue'
import SetupPanel from './SetupPanel.vue'
const props = defineProps<{ busy: boolean; stale: boolean; configured: boolean; recovery: boolean; serviceRunning: boolean; coreVersion: string | null; buildId: string | null; replace: (token: string) => Promise<boolean>; stop: () => Promise<boolean>; openTokenPage: () => Promise<void> }>()
const replacing = ref(false)
const confirming = ref(false)
// Token replacement is serialized with recovery (spec section 4): the form closes if recovery starts while it is open.
observe(() => props.recovery, recovery => { if (recovery) replacing.value = false })
async function replace(token: string) { const ok = await props.replace(token); if (ok) replacing.value = false; return ok }
async function disable() { confirming.value = false; await props.stop() }
</script>
<template>
  <section class="settings-view">
    <h1>Настройки</h1>
    <div class="settings-row"><span>Доступ к HikerAPI</span><button type="button" class="text-button" data-action="replace" :disabled="busy || stale || !configured || recovery" :aria-expanded="replacing" @click="replacing = !replacing">{{ replacing ? 'Закрыть' : 'Заменить токен' }}</button></div>
    <SetupPanel v-if="replacing" replace :busy="busy || stale" :connect="replace" :open-token-page="openTokenPage" />
    <div class="settings-row"><span>Фоновая служба перед удалением приложения</span><button type="button" class="text-button" data-action="uninstall" :disabled="busy || stale || !configured || confirming" @click="confirming = true">Отключить фоновую службу</button></div>
    <!-- The Trash explanation is offered up front, not only inside the confirmation. -->
    <p class="fine-print">Перенос приложения в Корзину сам по себе не отключает установленную службу{{ serviceRunning ? ' — её процесс сейчас запущен' : '' }}. Отключите её здесь перед удалением приложения.</p>
    <ConfirmBlock v-if="confirming" label="Отключение фоновой службы" message="Служба будет отключена и не запустится при следующем открытии приложения. История снимков и токен сохранятся. Перенос приложения в Корзину сам по себе не отключает установленную службу." confirm-label="Отключить" action="uninstall" :busy="busy" @confirm="disable" @cancel="confirming = false" />
    <dl class="service-facts">
      <div><dt>Встроенное ядро</dt><dd>{{ coreVersion ?? 'не подготовлено' }}</dd></div>
      <div><dt>Идентификатор сборки</dt><dd class="mono">{{ buildId ? buildId.slice(0, 16) : 'нет данных' }}</dd></div>
    </dl>
    <p class="fine-print">Подключение существующей установки insto и обновление ядра появятся в следующей версии.</p>
  </section>
</template>
