<script setup lang="ts">
import { computed, ref, watch as observe } from 'vue'
import type { Binding } from '../desktop/client'
import type { createHomeState } from '../desktop/home'
import ConfirmBlock from './ConfirmBlock.vue'
// The block runs the selection and shows its reason; it never carries the
// outcome onward. A successful adoption unmounts it, so anything routed through
// its lifetime would be lost — `createHomeState` reports the outcome instead.
const props = defineProps<{ home: ReturnType<typeof createHomeState>; binding: Binding; busy: boolean; disabled: boolean }>()
const confirming = ref<'adopt' | 'release' | null>(null)
const state = computed(() => props.home.state)
const checked = computed(() => state.value.checked)
const adopted = computed(() => props.binding.state === 'adopted')
// An inspection in flight blocks the field, the check and the adoption: the single
// `checked` slot must not change under a decision the user is making.
const blocked = computed(() => props.busy || props.disabled || state.value.checking)
const backends = { hikerapi: 'HikerAPI', aiograpi: 'вход по логину (aiograpi)', fake: 'тестовый источник' }
const databases = { ok: 'готова', missing: 'будет создана', schema_mismatch: 'несовместимый формат', unreadable: 'недоступна' }
const registrations = { none: 'служба не установлена', owned: 'служба insto установлена', unknown: 'служба не управляется приложением' }
const reasons = {
  home_invalid: 'Каталог нельзя использовать безопасно: он должен принадлежать вам и быть закрыт для других пользователей.',
  home_backend_unsupported: 'Эта установка настроена не на HikerAPI. Приложение работает только с HikerAPI.',
  schema_mismatch: 'База этой установки в несовместимом формате. Данные не изменены.',
  storage_error: 'Не удалось прочитать базу этой установки.',
}
// Every keystroke goes through `edit`, which clears the checked report: what the
// user sees checked is always the path the selection would use.
function edit(event: Event) { props.home.edit((event.target as HTMLInputElement).value) }
// Anything that changes the decision under an open confirmation closes it, rather
// than leaving a button that would refuse itself.
observe([checked, () => props.disabled, adopted], () => { confirming.value = null })
async function adopt() { confirming.value = null; await props.home.adopt() }
async function release() { confirming.value = null; await props.home.release() }
</script>
<template>
  <section class="home-adoption">
    <h3>Существующая установка insto</h3>
    <p class="fine-print">Если вы уже пользовались insto в терминале, приложение может работать с той же папкой: наблюдения, история и токен останутся на месте.</p>
    <label class="home-path">Путь к каталогу insto
      <input type="text" spellcheck="false" autocapitalize="off" autocomplete="off" data-field="home-path" :value="state.path" :disabled="blocked" @input="edit">
    </label>
    <button type="button" data-action="check-home" :disabled="blocked" @click="home.check()">Проверить</button>
    <p v-if="state.error" class="notice danger" role="alert">{{ state.error.message }}</p>
    <template v-if="checked">
      <dl class="home-report">
        <div><dt>Путь</dt><dd>{{ checked.report.path }}</dd></div>
        <div><dt>Источник данных</dt><dd>{{ checked.report.backend ? backends[checked.report.backend] : 'не определён' }}</dd></div>
        <div><dt>База</dt><dd>{{ databases[checked.report.database] }}</dd></div>
        <div><dt>Служба</dt><dd>{{ registrations[checked.report.registration] }}<template v-if="checked.report.registration === 'owned'">, её ядро — {{ checked.report.interpreter === 'current' ? 'встроенное в это приложение' : 'другое' }}, {{ checked.report.process === 'running' ? 'сейчас работает' : checked.report.process === 'stopped' ? 'сейчас остановлена' : 'состояние неизвестно' }}</template></dd></div>
        <div><dt>Итог</dt><dd>{{ checked.report.adoptable ? 'можно подключить' : checked.report.reason ? reasons[checked.report.reason] : 'подключение недоступно' }}</dd></div>
      </dl>
      <p v-if="checked.report.registration === 'unknown'" class="notice" role="status">Службой этой установки управляет не приложение. Она продолжит работать сама по себе.</p>
      <button v-if="checked.report.adoptable && !adopted" type="button" class="primary" data-action="adopt-home" :disabled="blocked" @click="confirming = 'adopt'">Подключить</button>
    </template>
    <template v-if="adopted">
      <p class="fine-print">Сейчас приложение работает с каталогом {{ binding.home }}.</p>
      <button type="button" data-action="release-home" :disabled="busy || disabled" @click="confirming = 'release'">Вернуться к собственному профилю</button>
    </template>
    <ConfirmBlock v-if="confirming === 'adopt' && checked" label="Подключение существующей установки" :message="`Приложение начнёт работать с каталогом ${checked.path}. Наблюдения, история и служба текущего профиля останутся на диске без изменений, но приложение перестанет их показывать.`" confirm-label="Подключить" action="adopt" :busy="busy" @confirm="adopt" @cancel="confirming = null" />
    <ConfirmBlock v-if="confirming === 'release'" label="Возврат к собственному профилю" message="Приложение вернётся к собственному каталогу. Подключённая установка останется без изменений: её служба продолжит работать сама по себе." confirm-label="Вернуться" action="release" :busy="busy" @confirm="release" @cancel="confirming = null" />
  </section>
</template>
