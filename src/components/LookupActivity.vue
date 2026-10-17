<script setup lang="ts">
import { computed } from 'vue'
import type { LookupActivity as Activity, Place } from '../desktop/dto'
import { formatCount, formatDecimal, localTime, weekdayNames } from '../desktop/format'
import { t } from '../i18n'
import BarChart from './BarChart.vue'
import GeoMap from './GeoMap.vue'
import PostingHeatmap from './PostingHeatmap.vue'
// What one analysis of one window of recent posts says. The optional section
// selects a presentation of the same value; it never fetches more data. And
// every number is introduced by how many posts it was counted from: `analyzed`
// is the truth about the window, and it can be smaller than the window asked
// for both for a short account and for one that hit the paid-page ceiling.
//
// Nothing in here is a link. A place, a hashtag, a mention and a post code are
// text the provider answered with; turning any of them into a destination would
// invent a claim the analysis does not make.
const props = withDefaults(defineProps<{ activity: Activity; section?: 'all' | 'overview' | 'activity' | 'geography' | 'terms' }>(), { section: 'all' })
const shows = (section: 'activity' | 'geography' | 'terms') => props.section === 'all' || props.section === section

const geo = computed(() => props.activity.geo)
const likes = computed(() => props.activity.likes)
const timeline = computed(() => props.activity.timeline)
const hasTimeline = computed(() => timeline.value.first_post_at !== null && timeline.value.last_post_at !== null)
const topHashtags = computed(() => {
  const max = Math.max(0, ...props.activity.hashtags.map(term => term.count))
  return max === 0 ? t('lookup.summary_none') : props.activity.hashtags.filter(term => term.count === max).map(term => `#${term.key}`).join(', ')
})
const peakHours = computed(() => {
  const max = Math.max(0, ...timeline.value.hour_of_day)
  return !hasTimeline.value || max === 0 ? t('lookup.summary_none') : timeline.value.hour_of_day.flatMap((count, hour) => count === max ? [t('lookup.hour_label', { hour: String(hour).padStart(2, '0') })] : []).join(', ')
})
const hourLabels = Array.from({ length: 24 }, (_, hour) => t('lookup.hour_label', { hour: String(hour).padStart(2, '0') }))
// Only every sixth hour is printed under the axis: twenty-four numbers in the
// width of the column would be unreadable, and the sentence under the chart
// names the busiest ones anyway.
const hourTicks = Array.from({ length: 24 }, (_, hour) => (hour % 6 === 0 ? String(hour) : ''))
const dayLabels = weekdayNames('long')
const dayTicks = weekdayNames('short')
// The two sides count different things. `geo.places` (and `geo.geotagged`, and
// the anchor) count only posts whose payload carried GPS; `locations` counts
// every post that names a place, which the core says is often many more. So the
// list is `locations` — the whole of what was paid for — and the geometry is
// shown separately, each saying which population it counts.
//
// Joining them is a lookup by name, and the names are not identical on the two
// sides: `geo.places[].name` is the raw `location_name`, `locations[].key` is
// that name stripped. And `geo.places` buckets by place pk where there is one,
// so two entries can share a displayed name — nothing here can tell which of
// them a counted post belongs to, and a wrong coordinate is worse than none.
const coordinates = computed(() => {
  const byName = new Map<string, Place | null>()
  for (const place of geo.value.places) {
    const key = place.name.trim()
    byName.set(key, byName.has(key) ? null : place)
  }
  return byName
})
// A coordinate is written with a dot in both languages: the locale separator
// would print "52,3739, 4,8903" in Russian, which is four numbers and no pair.
// The radius below is a measurement, not a coordinate, and keeps the separator.
const coordinatePair = (lat: number, lng: number) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`
const places = computed(() => props.activity.locations.map(term => {
  const known = coordinates.value.get(term.key) ?? null
  return { name: term.key, count: term.count, at: known === null ? null : coordinatePair(known.lat, known.lng) }
}))
</script>
<template>
  <div class="lookup-activity">
    <p v-if="activity.analyzed === 0" class="empty" data-block="empty">{{ t('lookup.analyzed_none') }}</p>
    <section v-else-if="section === 'overview'" class="sample-overview" data-block="overview">
      <dl class="summary-grid">
        <div><dt>{{ t('lookup.summary_posts') }}</dt><dd>{{ formatCount(activity.analyzed) }}</dd><small>{{ t('research.coverage', { count: formatCount(activity.analyzed), window: formatCount(activity.window) }) }}</small></div>
        <div><dt>{{ t('lookup.summary_geo') }}</dt><dd>{{ formatCount(geo.geotagged) }} / {{ formatCount(activity.analyzed) }}</dd></div>
        <div><dt>{{ t('lookup.summary_likes') }}</dt><dd>{{ formatCount(Math.round(likes.average)) }}</dd></div>
        <div><dt>{{ t('lookup.summary_hashtag') }}</dt><dd class="summary-text">{{ topHashtags }}</dd></div>
        <div><dt>{{ t('lookup.summary_hour') }}</dt><dd class="summary-text">{{ peakHours }}</dd></div>
      </dl>
      <p class="fine-print">{{ t('lookup.geo_note') }}</p>
    </section>
    <template v-else>
      <p v-if="section === 'geography' && geo.geotagged === 0" class="empty" data-block="geography-empty">{{ t('lookup.map_empty') }}</p>
      <section v-if="shows('geography') && geo.geotagged > 0" class="result-block" data-block="where">
        <h4>{{ t('lookup.where_title') }}</h4>
        <p class="fine-print block-note">{{ t('lookup.geo_note') }}</p>
        <GeoMap :places="geo.places" />
        <p>{{ t('lookup.geotagged', { tagged: formatCount(geo.geotagged), analyzed: formatCount(activity.analyzed) }) }}</p>
        <p v-if="geo.anchor">{{ t('lookup.anchor', { place: geo.anchor.name, count: formatCount(geo.anchor.count) }) }}</p>
        <p v-if="geo.radius_km !== null">{{ t('lookup.radius', { km: formatDecimal(geo.radius_km, 1) }) }}</p>
        <p v-if="geo.centroid">{{ t('lookup.centroid', { lat: geo.centroid.lat.toFixed(4), lng: geo.centroid.lng.toFixed(4) }) }}</p>
      </section>

      <!-- Its own block, and its own population: an account whose posts name
           places without ever carrying GPS has no geometry above and still gets
           the list it paid for. -->
      <section v-if="shows('geography') && places.length" class="result-block" data-block="places">
        <h4>{{ t('lookup.places_title') }}</h4>
        <p class="fine-print block-note">{{ t('lookup.places_note') }}</p>
        <dl class="term-list" data-list="places">
          <div v-for="place in places" :key="place.name">
            <dt>{{ place.name }}<span v-if="place.at" class="term-note">{{ place.at }}</span></dt>
            <dd>{{ formatCount(place.count) }}</dd>
          </div>
        </dl>
      </section>

      <p v-if="section === 'activity' && !hasTimeline" class="empty" data-block="activity-empty">{{ t('lookup.heatmap_empty') }}</p>
      <section v-if="shows('activity') && hasTimeline" class="result-block" data-block="when">
        <h4>{{ t('lookup.when_title') }}</h4>
        <PostingHeatmap :values="timeline.weekday_hours" />
        <BarChart :title="t('lookup.hours_title')" :values="timeline.hour_of_day" :labels="hourLabels" :ticks="hourTicks" />
        <BarChart :title="t('lookup.days_title')" :values="timeline.day_of_week" :labels="dayLabels" :ticks="dayTicks" />
        <p class="fine-print">
          {{ t('lookup.first_post', { time: localTime(timeline.first_post_at!) }) }}<br>
          {{ t('lookup.last_post', { time: localTime(timeline.last_post_at!) }) }}<br>
          {{ t('lookup.times_note') }}
        </p>
      </section>

      <p v-if="section === 'terms' && !activity.hashtags.length && !activity.mentions.length" class="empty" data-block="terms-empty">{{ t('lookup.results_empty') }}</p>
      <section v-if="shows('terms') && activity.hashtags.length" class="result-block" data-block="hashtags">
        <h4>{{ t('lookup.hashtags_title') }}</h4>
        <dl class="term-list">
          <div v-for="term in activity.hashtags" :key="term.key"><dt>#{{ term.key }}</dt><dd>{{ formatCount(term.count) }}</dd></div>
        </dl>
      </section>

      <section v-if="shows('terms') && activity.mentions.length" class="result-block" data-block="mentions">
        <h4>{{ t('lookup.mentions_title') }}</h4>
        <dl class="term-list">
          <div v-for="term in activity.mentions" :key="term.key"><dt>@{{ term.key }}</dt><dd>{{ formatCount(term.count) }}</dd></div>
        </dl>
      </section>

      <section v-if="shows('activity')" class="result-block" data-block="likes">
        <h4>{{ t('lookup.likes_title') }}</h4>
        <dl class="profile-counts">
          <div><dt>{{ t('lookup.likes_total') }}</dt><dd>{{ formatCount(likes.total) }}</dd></div>
          <div><dt>{{ t('lookup.likes_average') }}</dt><dd>{{ formatCount(Math.round(likes.average)) }}</dd></div>
        </dl>
        <h5 v-if="likes.top_posts.length">{{ t('lookup.top_posts_title') }}</h5>
        <dl v-if="likes.top_posts.length" class="term-list" data-list="top-posts">
          <div v-for="post in likes.top_posts" :key="post.code"><dt>{{ t('lookup.post_code', { code: post.code }) }}</dt><dd>{{ formatCount(post.like_count) }}</dd></div>
        </dl>
      </section>
    </template>
  </div>
</template>

<style scoped>
.summary-grid>div:last-child{grid-column:span 2}
.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#352b3d;border:1px solid #352b3d;border-radius:10px;overflow:hidden;margin:0 0 12px}.summary-grid>div{background:#18141f;padding:17px 18px;min-width:0}.summary-grid dt{font-size:10px;color:#aa9bb5;margin-bottom:9px;line-height:1.6}.summary-grid dd{margin:0;font-size:23px;color:#ece1f1;font-variant-numeric:tabular-nums;line-height:1.3}.summary-grid small{display:block;font-size:9px;color:#a593b3;margin-top:7px;line-height:1.6}.summary-grid .summary-text{font-size:13px;line-height:1.65;overflow-wrap:anywhere}.sample-overview>.fine-print{font-size:10px;line-height:1.7;margin:0}.lookup-activity>.empty{border:1px dashed #43364e;border-radius:9px;padding:19px 21px;font-size:12px;line-height:1.7;color:#ad9aba}
@media(max-width:560px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.summary-grid>div{padding:14px}.summary-grid dd{font-size:20px}.summary-grid .summary-text{font-size:12px}}
</style>
