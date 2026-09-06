<script setup lang="ts">
import { computed, ref } from 'vue'
import { MIN_INTERVAL, canonicalUsername, validInterval } from '../desktop/client'
import { messages } from '../desktop/messages'
const props = defineProps<{ busy: boolean; add: (user: string, interval: number) => Promise<boolean> }>()
const user = ref('')
const interval = ref(String(MIN_INTERVAL))
const pending = ref(false)
const localError = ref('')
const busy = computed(() => props.busy || pending.value)
async function submit() {
  if (busy.value) return
  const canonical = canonicalUsername(user.value)
  const seconds = Number(interval.value)
  if (canonical === null || !validInterval(seconds)) { localError.value = messages.invalid_watch_input; return }
  localError.value = ''; pending.value = true
  try { if (await props.add(canonical, seconds)) { user.value = ''; interval.value = String(MIN_INTERVAL) } } finally { pending.value = false }
}
</script>
<template>
  <form class="add-watch" @submit.prevent="submit">
    <h2>Добавить аккаунт</h2>
    <label for="watch-user">Имя пользователя Instagram</label>
    <input id="watch-user" v-model="user" name="user" autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" :disabled="busy" maxlength="257" placeholder="@username" @input="localError = ''" />
    <label for="watch-interval">Интервал проверки, секунд</label>
    <input id="watch-interval" v-model="interval" name="interval" type="number" inputmode="numeric" :min="MIN_INTERVAL" step="1" :disabled="busy" @input="localError = ''" />
    <p v-if="localError" role="alert" class="notice danger">{{ localError }}</p>
    <button type="submit" class="primary" :disabled="busy">{{ pending ? 'Сохраняем…' : 'Добавить аккаунт' }}</button>
    <p class="fine-print">Каждая проверка расходует лимит HikerAPI. Не более трёх активных наблюдений; минимальный интервал {{ MIN_INTERVAL }} секунд. Первый снимок соберёт служба; регистрация не делает пробный запрос.</p>
  </form>
</template>
