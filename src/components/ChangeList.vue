<script setup lang="ts">
import type { Change } from '../desktop/dto'
import { describeValue, fieldLabel } from '../desktop/format'
defineProps<{ changes: Change[]; unknownFields: string[] }>()
</script>
<template>
  <dl v-if="changes.length" class="changes">
    <div v-for="change in changes" :key="change.field"><dt>{{ fieldLabel(change.field) }}</dt><dd><span class="old">{{ describeValue(change.old) }}</span> → <span class="new">{{ describeValue(change.new) }}</span></dd></div>
  </dl>
  <p v-if="unknownFields.length" class="fine-print">Поля без данных в старом снимке (неизвестно): {{ unknownFields.map(fieldLabel).join(', ') }}.</p>
</template>
