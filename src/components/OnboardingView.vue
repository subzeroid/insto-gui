<script setup lang="ts">
import type { Binding } from '../desktop/client'
import type { createHomeState } from '../desktop/home'
import { texts, type DesktopFailure } from '../desktop/messages'
import HomeAdoption from './HomeAdoption.vue'
import SetupPanel from './SetupPanel.vue'
defineProps<{ busy: boolean; stale: boolean; error: DesktopFailure | null; home: ReturnType<typeof createHomeState>; binding: Binding; connect: (token: string) => Promise<boolean>; openTokenPage: () => Promise<void>; refresh: () => Promise<void> }>()
</script>
<template>
  <section class="onboarding-view">
    <div v-if="error" class="notice danger" role="alert">{{ error.message }}</div>
    <div v-if="stale" class="notice warning" role="status">Данные устарели. Изменения заблокированы до обновления. <button type="button" class="text-button" data-action="refresh-setup" :aria-label="texts.refresh_setup_label" :disabled="busy" @click="refresh">Обновить</button></div>
    <SetupPanel :busy="busy || stale" :connect="connect" :open-token-page="openTokenPage" />
    <p class="fine-print">Токен нужен только для новой установки. Если insto уже настроен в терминале, подключите его папку ниже — токен вводить не придётся.</p>
    <HomeAdoption :home="home" :binding="binding" :busy="busy || stale" :disabled="false" />
  </section>
</template>
