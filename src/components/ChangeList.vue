<script setup lang="ts">
import type { Change } from '../desktop/dto'
import { describeValue, fieldLabel } from '../desktop/format'
import { t } from '../i18n'
defineProps<{ changes: Change[]; unknownFields: string[] }>()
// The core reports pictures as opaque hashes: two of them side by side tell a
// person nothing, so a picture change is named rather than spelled out.
const MEDIA = new Set(['avatar', 'banner'])
function mediaChange(change: Change): string {
  if (change.old === null) return t('changes.media_added')
  if (change.new === null) return t('changes.media_removed')
  return t('changes.media_replaced')
}
</script>
<template>
  <dl v-if="changes.length" class="changes">
    <div v-for="change in changes" :key="change.field"><dt>{{ fieldLabel(change.field) }}</dt><dd v-if="MEDIA.has(change.field)"><span class="new">{{ mediaChange(change) }}</span></dd><dd v-else><span class="old">{{ describeValue(change.old) }}</span> → <span class="new">{{ describeValue(change.new) }}</span></dd></div>
  </dl>
  <p v-if="unknownFields.length" class="fine-print">{{ t('changes.unknown_fields', { fields: unknownFields.map(fieldLabel).join(', ') }) }}</p>
</template>
