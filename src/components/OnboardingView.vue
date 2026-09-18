<script setup lang="ts">
import type { Binding } from '../desktop/client'
import type { createHomeState } from '../desktop/home'
import type { DesktopFailure } from '../desktop/messages'
import { t } from '../i18n'
import HomeAdoption from './HomeAdoption.vue'
import SetupPanel from './SetupPanel.vue'
defineProps<{ busy: boolean; stale: boolean; error: DesktopFailure | null; home: ReturnType<typeof createHomeState>; binding: Binding; connect: (token: string) => Promise<boolean>; openTokenPage: () => Promise<void>; refresh: () => Promise<void> }>()
</script>
<template>
  <section class="onboarding-view">
    <div v-if="error" class="notice danger" role="alert">{{ error.message }}</div>
    <div v-if="stale" class="notice warning" role="status">{{ t('setup.stale') }} <button type="button" class="text-button" data-action="refresh-setup" :aria-label="t('text.refresh_setup_label')" :disabled="busy" @click="refresh">{{ t('app.refresh') }}</button></div>
    <SetupPanel :busy="busy || stale" :connect="connect" :open-token-page="openTokenPage" />
    <p class="fine-print">{{ t('setup.token_hint') }}</p>
    <HomeAdoption :home="home" :binding="binding" :busy="busy || stale" :disabled="false" />
  </section>
</template>
