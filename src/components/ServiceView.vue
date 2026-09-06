<script setup lang="ts">
import type { Profile } from '../desktop/client'
import type { Overview } from '../desktop/dto'
import { localTime } from '../desktop/format'
import ServicePanel from './ServicePanel.vue'
import type { DesktopFailure } from '../desktop/messages'
defineProps<{ profile: Profile; overview: Overview | null; lastReadAt: number | null; stale: boolean; monitoringStale: boolean; readError: DesktopFailure | null; busy: boolean; refreshOverview: () => Promise<boolean>; start: () => Promise<boolean>; stop: () => Promise<boolean>; repair: () => Promise<boolean> }>()
const labels = { running: 'запущена', stopped: 'остановлена', unknown: 'неизвестно' }
</script>
<template>
  <div class="service-view">
    <ServicePanel :profile="profile" :busy="busy" :stale="stale" :start="start" :stop="stop" :repair="repair" />
    <p v-if="monitoringStale" class="notice warning" role="status">Наблюдаемое состояние устарело: последнее чтение не удалось. <button type="button" class="text-button" data-action="refresh-overview" @click="refreshOverview">Обновить</button></p>
    <dl class="service-facts">
      <div><dt>Наблюдаемое состояние службы</dt><dd>{{ overview ? labels[overview.service_state] + (monitoringStale ? ' (устарело)' : '') : 'нет данных' }}</dd></div>
      <div><dt>Ядро и база</dt><dd>{{ readError ? 'последнее чтение не удалось' : overview ? 'доступны' : 'проверяются' }}</dd></div>
      <div><dt>Последнее успешное чтение</dt><dd>{{ lastReadAt === null ? 'не выполнено' : localTime(Math.floor(lastReadAt / 1000)) }}</dd></div>
    </dl>
    <p class="fine-print">Успешность проверок аккаунтов видна по времени последней проверки каждого наблюдения, а не по состоянию процесса. Сон, выход из системы, отсутствие интернета и запрет фоновых элементов macOS ограничивают работу службы.</p>
  </div>
</template>
