<script setup lang="ts">
import { computed } from 'vue'
import type { ChangeValue } from '../desktop/dto'
import type { DesktopFailure } from '../desktop/messages'
import { describeValue, fieldLabel, formatCount } from '../desktop/format'
import { t, type Key } from '../i18n'
// One card for two sources of the same tracked vocabulary: the newest saved
// snapshot of a watch, and a live lookup of any account. Both hand it `fields`;
// everything that differs between them — the landmark's name, the line under the
// card, what the account line means — is a prop, so neither source needs a card
// of its own. The card never blocks what is around it: a failed read shows its
// message in place of the card.
// `watchUser` is the account already named above the card, so the card does not
// repeat it; `caption` is the line the source dates itself with.
const props = defineProps<{
  profile: { value: { fields: Record<string, ChangeValue> } | null; loading: boolean; error: DesktopFailure | null }
  watchUser: string
  caption?: string
  label?: string
  otherNameLabel?: string
}>()

const COUNTS = ['follower_count', 'following_count', 'media_count'] as const
// A quiet badge each, shown only when the flag is true; a false flag is the
// ordinary case and says nothing worth a line.
const BADGES = [['is_verified', 'profile.badge_verified'], ['is_business', 'profile.badge_business'], ['is_private', 'profile.badge_private']] as const
// Every remaining name the core tracks, in its own declaration order, so the card
// is the whole profile rather than a subset that reads as missing data.
const TEXTS = ['biography', 'external_url', 'public_email', 'public_phone', 'business_category'] as const

const fields = computed<Record<string, ChangeValue>>(() => props.profile.value?.fields ?? {})
// A field the source carried no data for is listed in `unknown_fields` and is
// absent here: it is left out of the card rather than described as unknown.
const known = (field: string) => (Object.hasOwn(fields.value, field) ? fields.value[field] : undefined)
// The heading above already names the account, so the account line appears only
// when the answer disagrees with it — which is a rename in a saved snapshot, and
// a different name behind the same account in a lookup.
const renamedTo = computed(() => { const value = known('username'); return typeof value === 'string' && value !== props.watchUser ? value : null })
const fullName = computed(() => { const value = known('full_name'); return typeof value === 'string' && value !== '' ? value : null })
const counts = computed(() => COUNTS.map(field => ({ field, value: known(field) })).filter(row => typeof row.value === 'number') as { field: string; value: number }[])
const badges = computed(() => BADGES.filter(([field]) => known(field) === true).map(([, key]) => key as Key))
// A field that is present but empty — null or an empty string — is a field with
// nothing in it: the card leaves the row out instead of spending a line on
// "no value". What is missing is visible in what the card does not show.
const texts = computed(() => TEXTS.map(field => ({ field, value: known(field) })).filter(row => row.value !== undefined && row.value !== null && row.value !== '') as { field: string; value: ChangeValue }[])
</script>
<template>
  <section v-if="profile.error || profile.loading || profile.value" class="profile-card" :aria-label="label ?? t('profile.title')">
    <p v-if="profile.error" role="alert" class="notice danger">{{ profile.error.message }}</p>
    <p v-else-if="!profile.value" role="status" class="loading">{{ t('profile.loading') }}</p>
    <template v-else>
      <!-- Only when the two names differ, so it says which of them this one is. -->
      <p v-if="renamedTo" class="profile-user"><span class="label">{{ otherNameLabel ?? t('profile.renamed') }}</span> @{{ renamedTo }}</p>
      <p v-if="fullName" class="profile-name">{{ fullName }}</p>
      <p v-if="badges.length" class="profile-badges"><span v-for="key in badges" :key="key" class="badge">{{ t(key) }}</span></p>
      <dl v-if="counts.length" class="profile-counts">
        <div v-for="row in counts" :key="row.field"><dt>{{ fieldLabel(row.field) }}</dt><dd>{{ formatCount(row.value) }}</dd></div>
      </dl>
      <dl v-if="texts.length" class="profile-text">
        <div v-for="row in texts" :key="row.field"><dt>{{ fieldLabel(row.field) }}</dt><dd>{{ describeValue(row.value) }}</dd></div>
      </dl>
      <p v-if="caption" class="fine-print">{{ caption }}</p>
    </template>
  </section>
</template>
