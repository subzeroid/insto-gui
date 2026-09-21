<script setup lang="ts">
import { computed } from 'vue'
import type { ChangeValue, SnapshotFields } from '../desktop/dto'
import type { DesktopFailure } from '../desktop/messages'
import { describeValue, fieldLabel, formatCount, localTime } from '../desktop/format'
import { t, type Key } from '../i18n'
// The shape `history.state.profile` holds: the newest snapshot's tracked fields,
// its own loading flag and its own failure. The card never blocks the snapshot
// list or the comparison — a failed read shows its message in place of the card.
// `watchUser` is the account the details pane is already headed with, so the card
// does not repeat it.
const props = defineProps<{ profile: { value: SnapshotFields | null; loading: boolean; error: DesktopFailure | null }; watchUser: string }>()

const COUNTS = ['follower_count', 'following_count', 'media_count'] as const
// A quiet badge each, shown only when the flag is true; a false flag is the
// ordinary case and says nothing worth a line.
const BADGES = [['is_verified', 'profile.badge_verified'], ['is_business', 'profile.badge_business'], ['is_private', 'profile.badge_private']] as const
// Every remaining name the core tracks, in its own declaration order, so the card
// is the whole saved profile rather than a subset that reads as missing data.
const TEXTS = ['biography', 'external_url', 'public_email', 'public_phone', 'business_category'] as const

const fields = computed<Record<string, ChangeValue>>(() => props.profile.value?.fields ?? {})
// A field the snapshot carried no data for is listed in `unknown_fields` and is
// absent here: it is left out of the card rather than described as unknown. A
// field that is present but null is a known value and `describeValue` names it.
const known = (field: string) => (Object.hasOwn(fields.value, field) ? fields.value[field] : undefined)
// The heading above already names the selected watch, so the account line appears
// only when the snapshot disagrees with it — which is exactly a rename.
const renamedTo = computed(() => { const value = known('username'); return typeof value === 'string' && value !== props.watchUser ? value : null })
const fullName = computed(() => { const value = known('full_name'); return typeof value === 'string' && value !== '' ? value : null })
const counts = computed(() => COUNTS.map(field => ({ field, value: known(field) })).filter(row => typeof row.value === 'number') as { field: string; value: number }[])
const badges = computed(() => BADGES.filter(([field]) => known(field) === true).map(([, key]) => key as Key))
const texts = computed(() => TEXTS.filter(field => known(field) !== undefined).map(field => ({ field, value: known(field) as ChangeValue })))
</script>
<template>
  <section v-if="profile.error || profile.loading || profile.value" class="profile-card" :aria-label="t('profile.title')">
    <p v-if="profile.error" role="alert" class="notice danger">{{ profile.error.message }}</p>
    <p v-else-if="!profile.value" role="status" class="loading">{{ t('profile.loading') }}</p>
    <template v-else>
      <h3 v-if="renamedTo" class="profile-user">@{{ renamedTo }}</h3>
      <p v-if="fullName" class="profile-name">{{ fullName }}</p>
      <p v-if="badges.length" class="profile-badges"><span v-for="key in badges" :key="key" class="badge">{{ t(key) }}</span></p>
      <dl v-if="counts.length" class="profile-counts">
        <div v-for="row in counts" :key="row.field"><dt>{{ fieldLabel(row.field) }}</dt><dd>{{ formatCount(row.value) }}</dd></div>
      </dl>
      <dl v-if="texts.length" class="profile-text">
        <div v-for="row in texts" :key="row.field"><dt>{{ fieldLabel(row.field) }}</dt><dd>{{ describeValue(row.value) }}</dd></div>
      </dl>
      <p class="fine-print">{{ t('profile.as_of', { time: localTime(profile.value.snapshot.captured_at) }) }}</p>
    </template>
  </section>
</template>
