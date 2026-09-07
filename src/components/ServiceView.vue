<script setup lang="ts">
import { computed, ref, watch as observe } from 'vue'
import type { Profile } from '../desktop/client'
import type { Overview } from '../desktop/dto'
import type { createServiceState } from '../desktop/service'
import { localTime } from '../desktop/format'
import ConfirmBlock from './ConfirmBlock.vue'
import ServicePanel from './ServicePanel.vue'
import type { DesktopFailure } from '../desktop/messages'
const props = defineProps<{ profile: Profile; overview: Overview | null; lastReadAt: number | null; stale: boolean; monitoringStale: boolean; readError: DesktopFailure | null; busy: boolean; service: ReturnType<typeof createServiceState>; refreshOverview: () => Promise<boolean>; refreshFacts: () => Promise<void>; start: () => Promise<boolean>; stop: () => Promise<boolean>; repair: () => Promise<boolean> }>()
const labels = { running: 'запущена', stopped: 'остановлена', unknown: 'неизвестно' }
const confirming = ref(false)
const facts = computed(() => props.service.state.facts)
const binding = computed(() => props.service.state.binding)
const readonly = computed(() => props.service.readonly())
const canMigrate = computed(() => props.service.canMigrate())
const takeover = computed(() => props.service.takeover())
const folders = { own: 'собственный каталог приложения', adopted: 'подключённая установка insto', unknown: 'не определён' }
// The three reasons a control is read-only are different situations and the user
// can act on only one of them, so they are named separately.
const readonlyReason = computed(() => {
  if (binding.value.state === 'unknown') return 'Приложение не смогло определить, с каким каталогом оно связано. Пока это не выяснено, служба доступна только для просмотра.'
  if (facts.value === null || !props.service.fresh()) return 'Состояние регистрации службы не прочитано. Пока оно неизвестно, служба доступна только для просмотра.'
  return 'Эту службу приложение не устанавливало. Оно её не меняет: управляйте ею тем же способом, каким устанавливали.'
})
// R12: a control that stops being available takes its open confirmation with it,
// so a confirmation can never outlive the state that justified it.
observe([readonly, takeover, () => props.stale], () => { if (readonly.value || !takeover.value || props.stale) confirming.value = false })
async function migrate() { confirming.value = false; await props.service.migrate() }
</script>
<template>
  <div class="service-view">
    <ServicePanel :profile="profile" :busy="busy" :stale="stale" :readonly="readonly" :start="start" :stop="stop" :repair="repair" />
    <p v-if="monitoringStale" class="notice warning" role="status">Наблюдаемое состояние устарело: последнее чтение не удалось. <button type="button" class="text-button" data-action="refresh-overview" @click="refreshOverview">Обновить</button></p>
    <dl class="service-facts">
      <div><dt>Наблюдаемое состояние службы</dt><dd>{{ overview ? labels[overview.service_state] + (monitoringStale ? ' (устарело)' : '') : 'нет данных' }}</dd></div>
      <div><dt>Ядро и база</dt><dd>{{ readError ? 'последнее чтение не удалось' : overview ? 'доступны' : 'проверяются' }}</dd></div>
      <div><dt>Последнее успешное чтение</dt><dd>{{ lastReadAt === null ? 'не выполнено' : localTime(Math.floor(lastReadAt / 1000)) }}</dd></div>
    </dl>
    <p v-if="service.state.error" class="notice warning" role="status">Не удалось прочитать регистрацию службы: {{ service.state.error.message }} <button type="button" class="text-button" data-action="refresh-facts" :disabled="busy" @click="refreshFacts">Проверить ещё раз</button></p>
    <dl v-if="facts" class="registration-facts">
      <div><dt>Регистрация службы</dt><dd>{{ facts.registration === 'owned' ? 'установлена insto' : facts.registration === 'unknown' ? 'не управляется приложением' : 'не установлена' }}</dd></div>
      <div v-if="facts.registration === 'owned'"><dt>Ядро службы</dt><dd>{{ facts.interpreter === 'current' ? 'встроенное в это приложение' : 'другое' }}{{ facts.interpreterExists === false ? ' (файл ядра отсутствует)' : '' }}</dd></div>
      <div v-if="facts.registration !== 'none'"><dt>Загружена в macOS</dt><dd>{{ facts.loaded === null ? 'неизвестно' : facts.loaded ? 'да' : 'нет' }}</dd></div>
      <div><dt>Каталог данных</dt><dd>{{ folders[binding.state] }}</dd></div>
    </dl>
    <p v-if="readonly" class="notice warning" role="status" data-note="service-readonly">{{ readonlyReason }}</p>
    <p v-else-if="facts?.settings === 'different'" class="notice warning" role="status" data-note="service-settings">Настройки зарегистрированной службы отличаются от настроек этого каталога. Приложение не меняет её автоматически: сверьте настройки и переустановите службу тем же способом, каким устанавливали.</p>
    <template v-else-if="canMigrate">
      <p class="notice" role="status">{{ takeover ? 'Служба этой установки работает на другом ядре. Приложение может взять её на себя — только по вашей команде.' : 'Служба работает на другом ядре. Переведите её на встроенное, чтобы приложение обновляло её вместе с собой.' }}</p>
      <button type="button" class="primary" data-action="migrate-service" :disabled="busy || stale || service.state.migrating" @click="takeover ? (confirming = true) : migrate()">{{ takeover ? 'Взять службу под управление приложения' : 'Перевести службу на встроенное ядро' }}</button>
    </template>
    <ConfirmBlock v-if="confirming" label="Перевод существующей службы" message="Приложение остановит службу подключённой установки и зарегистрирует её заново на встроенном ядре. Настройки и база останутся прежними. Если перевод не удастся, ядро восстановит прежнюю регистрацию." confirm-label="Взять под управление" action="takeover" :busy="busy" @confirm="migrate" @cancel="confirming = false" />
    <p class="fine-print">Успешность проверок аккаунтов видна по времени последней проверки каждого наблюдения, а не по состоянию процесса. Сон, выход из системы, отсутствие интернета и запрет фоновых элементов macOS ограничивают работу службы.</p>
  </div>
</template>
