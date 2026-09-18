<script setup lang="ts">
import { t } from '../i18n'
defineProps<{ label: string; message: string; confirmLabel: string; action: string; busy: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>
<template>
  <div class="notice warning" role="alertdialog" :aria-label="label">
    <p>{{ message }}</p>
    <button type="button" class="primary" :data-action="`confirm-${action}`" :disabled="busy" @click="emit('confirm')">{{ confirmLabel }}</button>
    <button type="button" :data-action="`cancel-${action}`" @click="emit('cancel')">{{ t('confirm.cancel') }}</button>
  </div>
</template>
