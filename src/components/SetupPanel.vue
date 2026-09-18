<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { validToken } from '../desktop/client'
import { safeFailure } from '../desktop/messages'
import { t } from '../i18n'
const props = defineProps<{ busy: boolean; replace?: boolean; connect: (token: string) => Promise<boolean>; openTokenPage: () => Promise<void> }>()
const token = ref('')
const visible = ref(false)
const pending = ref(false)
const linkError = ref('')
const busy = computed(() => props.busy || pending.value)
async function submit() {
  if (busy.value || !validToken(token.value)) return
  pending.value = true
  const candidate = token.value
  token.value = ''; visible.value = false
  try { await props.connect(candidate) } finally { pending.value = false }
}
async function openTokenPage() {
  linkError.value = ''
  try { await props.openTokenPage() } catch (error) { linkError.value = safeFailure(error).message }
}
onBeforeUnmount(() => { token.value = ''; visible.value = false })
</script>
<template>
  <section class="setup-panel">
    <div class="eyebrow">{{ replace ? t('setup.eyebrow_replace') : t('setup.eyebrow') }}</div>
    <h1 v-if="!replace">{{ t('setup.title') }}<br><span class="muted">{{ t('setup.title_muted') }}</span></h1>
    <h2 v-else>{{ t('setup.replace_title') }}</h2>
    <p class="intro">{{ replace ? t('setup.replace_intro') : t('setup.intro') }}</p>
    <form @submit.prevent="submit">
      <label for="hiker-token">{{ t('setup.token_label') }}</label>
      <div class="token-field">
        <input id="hiker-token" v-model="token" :type="visible ? 'text' : 'password'" autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" :disabled="busy" maxlength="4096" :placeholder="t('setup.token_placeholder')" aria-describedby="token-note" />
        <button type="button" class="visibility" :aria-label="visible ? t('setup.hide_token') : t('setup.show_token')" :aria-pressed="visible" :disabled="busy" @click="visible = !visible">{{ visible ? t('setup.hide') : t('setup.show') }}</button>
      </div>
      <div class="field-footer"><span id="token-note">{{ t('setup.token_note') }}</span><button type="button" class="text-button" :disabled="busy" @click="openTokenPage">{{ t('setup.token_page') }}</button></div>
      <button type="submit" class="primary full" :disabled="busy || !validToken(token)">{{ busy ? t('setup.checking') : replace ? t('setup.save_token') : t('setup.connect') }}</button>
    </form>
    <p v-if="linkError" role="alert" class="notice danger">{{ linkError }}</p>
    <p class="fine-print">{{ replace ? t('setup.replace_note') : t('setup.connect_note') }}</p>
  </section>
</template>
