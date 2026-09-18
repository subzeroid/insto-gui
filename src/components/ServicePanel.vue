<script setup lang="ts">
import { computed } from 'vue'
import type { Profile } from '../desktop/client'
import { formatCount, localTime } from '../desktop/format'
import { t } from '../i18n'
const props = defineProps<{ profile: Profile; busy: boolean; stale: boolean; readonly: boolean; start: () => Promise<boolean>; stop: () => Promise<boolean>; repair: () => Promise<boolean> }>()
const titles = { unconfigured: t('service.title_unconfigured'), recovery_required: t('service.title_recovery_required'), quota_exhausted: t('service.title_quota_exhausted'), running: t('service.title_running'), stopped: t('service.title_stopped'), service_error: t('service.title_service_error') }
// R12: an unknown owner, an unknown binding or unread facts mean the app has no
// proof of what it would be changing, so no control acts — Repair included.
const disabled = computed(() => props.busy || props.stale || props.readonly)
const recovery = computed(() => props.profile.status === 'recovery_required')
const checkedAt = computed(() => props.profile.quota_checked_at === null ? t('service.no_data') : localTime(props.profile.quota_checked_at))
</script>
<template>
  <section class="service-panel">
    <div class="eyebrow">{{ t('service.eyebrow') }}</div>
    <h1>{{ titles[profile.status] }}</h1>
    <p class="intro" v-if="recovery">{{ t('service.intro_recovery') }}</p>
    <p class="intro" v-else-if="profile.status === 'quota_exhausted'">{{ t('service.intro_quota') }}</p>
    <p class="intro" v-else>{{ t('service.intro') }}</p>
    <dl class="service-facts">
      <div><dt>{{ t('service.process') }}</dt><dd>{{ profile.service_running ? t('service.process_running') : t('service.process_unconfirmed') }}</dd></div>
      <div><dt>{{ t('service.desired') }}</dt><dd>{{ profile.desired_service === 'running' ? t('service.desired_running') : profile.desired_service === 'stopped' ? t('service.desired_stopped') : t('service.desired_unknown') }}</dd></div>
      <div><dt>{{ t('service.quota') }}</dt><dd>{{ profile.quota_remaining === null ? t('service.quota_none') : formatCount(profile.quota_remaining) }}</dd></div>
    </dl>
    <p class="fine-print quota-note">{{ t('service.quota_note', { time: checkedAt }) }}</p>
    <div class="actions">
      <button class="primary" data-action="start" :disabled="disabled || recovery || !profile.configured || profile.service_running" @click="start">{{ t('service.start') }}</button>
      <button data-action="stop" :disabled="disabled || recovery || !profile.configured || (profile.desired_service === 'stopped' && !profile.service_running)" @click="stop">{{ t('service.stop') }}</button>
      <button data-action="repair" :disabled="disabled" @click="repair">{{ t('service.repair') }}</button>
    </div>
    <p class="fine-print">{{ t('service.stop_note') }}</p>
  </section>
</template>
