<script setup lang="ts">
import { computed } from 'vue'
import type { Profile } from '../desktop/client'
const props = defineProps<{ profile: Profile; busy: boolean; stale: boolean; start: () => Promise<boolean>; stop: () => Promise<boolean>; repair: () => Promise<boolean> }>()
const titles = { unconfigured: 'Доступ не настроен', recovery_required: 'Нужно восстановление', quota_exhausted: 'Лимит исчерпан', running: 'Служба запущена', stopped: 'Служба остановлена', service_error: 'Нужно проверить службу' }
const disabled = computed(() => props.busy || props.stale)
const recovery = computed(() => props.profile.status === 'recovery_required')
const checkedAt = computed(() => {
  if (props.profile.quota_checked_at === null) return 'нет данных'
  const date = new Date(props.profile.quota_checked_at * 1000)
  return Number.isNaN(date.getTime()) ? 'дата недоступна' : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
})
</script>
<template>
  <section class="service-panel">
    <div class="eyebrow">ЛОКАЛЬНАЯ СЛУЖБА</div>
    <h1>{{ titles[profile.status] }}</h1>
    <p class="intro" v-if="recovery">Предыдущее изменение нужно завершить безопасно. Восстановление не требует повторного ввода сохранённого токена.</p>
    <p class="intro" v-else-if="profile.status === 'quota_exhausted'">Доступ настроен, но новые проверки недоступны до пополнения HikerAPI.</p>
    <p class="intro" v-else>Фоновый процесс не зависит от окна приложения. Его запуск сам по себе не подтверждает успешные проверки аккаунтов.</p>
    <dl class="service-facts">
      <div><dt>Процесс на этом Mac</dt><dd>{{ profile.service_running ? 'Служба запущена' : 'Запуск не подтверждён' }}</dd></div>
      <div><dt>Сохранённое состояние</dt><dd>{{ profile.desired_service === 'running' ? 'Включена' : profile.desired_service === 'stopped' ? 'Остановлена' : 'Не определено' }}</dd></div>
      <div><dt>Остаток HikerAPI</dt><dd>{{ profile.quota_remaining === null ? 'Нет данных' : profile.quota_remaining.toLocaleString('ru-RU') }}</dd></div>
    </dl>
    <p class="fine-print quota-note">Остаток на момент последней проверки токена: {{ checkedAt }}. Это не текущий баланс.</p>
    <div class="actions">
      <button class="primary" data-action="start" :disabled="disabled || recovery || !profile.configured || profile.service_running" @click="start">Запустить</button>
      <button data-action="stop" :disabled="disabled || recovery || !profile.configured || (profile.desired_service === 'stopped' && !profile.service_running)" @click="stop">Остановить</button>
      <button data-action="repair" :disabled="disabled" @click="repair">Восстановить</button>
    </div>
    <p class="fine-print">Остановка сохраняет историю и токен. При следующем открытии приложения служба не включается автоматически.</p>
  </section>
</template>
