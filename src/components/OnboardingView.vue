<script setup lang="ts">
import { ref } from 'vue'
import type { Binding } from '../desktop/client'
import type { createHomeState } from '../desktop/home'
import type { DesktopFailure } from '../desktop/messages'
import { t } from '../i18n'
import HomeAdoption from './HomeAdoption.vue'
import SetupPanel from './SetupPanel.vue'
defineProps<{ busy: boolean; stale: boolean; error: DesktopFailure | null; home: ReturnType<typeof createHomeState>; binding: Binding; connect: (token: string) => Promise<boolean>; openTokenPage: () => Promise<void>; refresh: () => Promise<void> }>()
// A new user only needs the token form. Connecting an existing CLI folder stays
// possible from here, but behind one quiet line: shown by default it reads as a
// second, unexplained way in.
const showCli = ref(false)
</script>
<template>
  <section class="onboarding-view">
    <div v-if="error" class="notice danger" role="alert">{{ error.message }}</div>
    <div v-if="stale" class="notice warning" role="status">{{ t('setup.stale') }} <button type="button" class="text-button" data-action="refresh-setup" :aria-label="t('text.refresh_setup_label')" :disabled="busy" @click="refresh">{{ t('app.refresh') }}</button></div>
    <SetupPanel :busy="busy || stale" :connect="connect" :open-token-page="openTokenPage" />
    <p class="fine-print cli-toggle"><button type="button" class="text-button" data-action="show-home-adoption" :aria-expanded="showCli" @click="showCli = !showCli">{{ t('setup.cli_toggle') }}</button></p>
    <HomeAdoption v-if="showCli" :home="home" :binding="binding" :busy="busy || stale" :disabled="false" />
  </section>
</template>
