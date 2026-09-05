<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { validToken } from '../desktop/client'
import { safeFailure } from '../desktop/messages'
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
    <div class="eyebrow">{{ replace ? 'ДОСТУП К API' : 'НАЧНЁМ С ПОДКЛЮЧЕНИЯ' }}</div>
    <h1 v-if="!replace">Ваши наблюдения.<br><span class="muted">На вашем Mac.</span></h1>
    <h2 v-else>Заменить токен</h2>
    <p class="intro">{{ replace ? 'Новый токен проверяется до замены действующего.' : 'Ядро уже внутри приложения. Подключите HikerAPI — без Python, команд и дополнительных установок.' }}</p>
    <form @submit.prevent="submit">
      <label for="hiker-token">Токен HikerAPI</label>
      <div class="token-field">
        <input id="hiker-token" v-model="token" :type="visible ? 'text' : 'password'" autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" :disabled="busy" maxlength="4096" placeholder="Вставьте токен доступа" aria-describedby="token-note" />
        <button type="button" class="visibility" :aria-label="visible ? 'Скрыть токен' : 'Показать токен'" :aria-pressed="visible" :disabled="busy" @click="visible = !visible">{{ visible ? 'Скрыть' : 'Показать' }}</button>
      </div>
      <div class="field-footer"><span id="token-note">Хранится в защищённом профиле на этом Mac.</span><button type="button" class="text-button" :disabled="busy" @click="openTokenPage">Где взять токен ↗</button></div>
      <button type="submit" class="primary full" :disabled="busy || !validToken(token)">{{ busy ? 'Проверяем доступ…' : replace ? 'Сохранить токен' : 'Подключить и начать' }}</button>
    </form>
    <p v-if="linkError" role="alert" class="notice danger">{{ linkError }}</p>
    <p class="fine-print">{{ replace ? 'Работающая служба применит новый токен после перезапуска. Остановленная служба останется остановленной.' : 'Приложение включит фоновую службу: она работает после закрытия окна и расходует лимит HikerAPI при проверке добавленных аккаунтов.' }}</p>
  </section>
</template>
