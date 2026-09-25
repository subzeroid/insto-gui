<script setup lang="ts">
import { computed } from 'vue'
import type { Change, PostDelta } from '../desktop/dto'
import { describeValue, fieldLabel, formatCount } from '../desktop/format'
import { t } from '../i18n'
const props = defineProps<{ changes: Change[]; unknownFields: string[]; posts?: PostDelta | null }>()
// Only posts newer than everything the older check saw are counted; a full
// newer window means the real number may be larger, so it reads "N or more".
const published = computed(() => props.posts?.added.length ?? 0)
const postsLine = computed(() => {
  const count = formatCount(published.value)
  return props.posts?.window_full ? t('changes.new_posts_more', { count }) : count
})
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
  <dl v-if="changes.length || published" class="changes">
    <div v-if="published" data-field="new_posts"><dt>{{ t('changes.new_posts') }}</dt><dd><span class="new">{{ postsLine }}</span></dd></div>
    <div v-for="change in changes" :key="change.field"><dt>{{ fieldLabel(change.field) }}</dt><dd v-if="MEDIA.has(change.field)"><span class="new">{{ mediaChange(change) }}</span></dd><dd v-else><span class="old">{{ describeValue(change.old) }}</span> → <span class="new">{{ describeValue(change.new) }}</span></dd></div>
  </dl>
  <p v-if="unknownFields.length" class="fine-print">{{ t('changes.unknown_fields', { fields: unknownFields.map(fieldLabel).join(', ') }) }}</p>
</template>
