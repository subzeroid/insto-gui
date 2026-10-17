<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '../i18n'
const props = defineProps<{ phase: 'profile' | 'activity'; username: string; window: number; includeActivity?: boolean; startedAt?: number }>()
const elapsed = ref(0)
const mountedAt = performance.now()
const updateElapsed = () => { elapsed.value = Math.max(0, Math.floor((performance.now() - (props.startedAt ?? mountedAt)) / 1000)) }
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  updateElapsed()
  timer = setInterval(updateElapsed, 1000)
})
watch(() => props.startedAt, updateElapsed)
onBeforeUnmount(() => clearInterval(timer))
const clock = computed(() => `${String(Math.floor(elapsed.value / 60)).padStart(2, '0')}:${String(elapsed.value % 60).padStart(2, '0')}`)
const title = computed(() => props.phase === 'profile' ? t('scan.profile_title') : t('scan.activity_title'))
const detail = computed(() => props.phase === 'profile' ? t('scan.profile_detail') : t('scan.activity_detail', { count: props.window }))
</script>
<template>
  <section class="scan-progress" :data-phase="phase" aria-label="OSINT scan">
    <div class="scan-grid" aria-hidden="true"><div class="scan-line" /></div>
    <div class="scan-top"><span class="scan-kicker"><i aria-hidden="true" />OSINT SCAN</span><span class="scan-clock" aria-hidden="true">{{ t('scan.elapsed') }} <time data-elapsed aria-hidden="true">{{ clock }}</time></span></div>
    <div class="scan-body">
      <div class="scan-radar" aria-hidden="true"><span class="radar-sweep" /><span class="radar-cross" /><span class="radar-target" /></div>
      <div class="scan-copy"><div role="status" aria-live="polite" aria-atomic="true"><h3>{{ title }}</h3><p>{{ detail }}</p></div><p class="scan-target"><span>{{ t('scan.target') }}</span> @{{ username }}</p></div>
    </div>
    <div class="scan-stages" aria-hidden="true"><span data-stage="profile" :data-state="phase === 'activity' ? 'complete' : 'active'"><i>{{ phase === 'activity' ? '✓' : '›' }}</i>{{ t('scan.stage_profile') }}</span><template v-if="includeActivity || phase === 'activity'"><span class="stage-join">/</span><span data-stage="activity" :data-state="phase === 'activity' ? 'active' : 'pending'"><i>›</i>{{ t('scan.stage_activity') }}</span></template></div>
    <div class="scan-journal"><span class="journal-prefix" aria-hidden="true">&gt;_</span><span>{{ elapsed >= 20 ? t('scan.slow') : t('scan.waiting') }}</span></div>
    <div class="scan-source">{{ t('scan.channel') }}</div>
  </section>
</template>
<style scoped>
.scan-progress{position:relative;isolation:isolate;overflow:hidden;border:1px solid #693d71;border-radius:16px;padding:23px 25px;margin:24px 0;background:linear-gradient(130deg,#1d1326,#10121d 70%);box-shadow:0 0 50px #b92f9e09;font-family:inherit}
.scan-grid{position:absolute;z-index:-1;inset:0;background-image:linear-gradient(#b26ad00b 1px,transparent 1px),linear-gradient(90deg,#b26ad00b 1px,transparent 1px);background-size:22px 22px;mask-image:linear-gradient(90deg,#000,transparent)}
.scan-line{height:2px;position:absolute;inset:0 0 auto;background:linear-gradient(90deg,transparent,#ff91d090,transparent);box-shadow:0 0 18px #e440a170;animation:scan-line 3.8s linear infinite}
.scan-top{display:flex;justify-content:space-between;gap:15px;font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1.8px;color:#da8ac7}
.scan-kicker{display:flex;align-items:center;gap:9px;font-weight:600}.scan-kicker i{width:6px;height:6px;background:#f182bf;border-radius:50%;box-shadow:0 0 10px #ef75b755}
.scan-clock{color:#a595b4;letter-spacing:.2px;white-space:nowrap}.scan-clock time{margin-left:7px;color:#e4d2ec;font-variant-numeric:tabular-nums}
.scan-body{display:flex;align-items:center;gap:22px;margin:24px 0}.scan-copy{min-width:0}.scan-copy h3{font-size:19px;letter-spacing:-.3px;margin:0 0 7px;line-height:1.3;font-weight:570;color:#f2eaf5}.scan-copy p{margin:0;font-size:12px;line-height:1.65;color:#ac9ebc}.scan-copy .scan-target{margin-top:12px;color:#e5bfdc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.scan-target span{color:#8e809f;margin-right:8px;font-size:11px}
.scan-radar{position:relative;overflow:hidden;width:76px;height:76px;flex-shrink:0;border:1px solid #91548a60;border-radius:50%;background:radial-gradient(circle,transparent 29%,#ae5a9e40 30%,transparent 31%,transparent 59%,#ae5a9e40 60%,transparent 61%)}
.radar-sweep{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 240deg,#bb469c05 240deg,#e774bd44 355deg,#e985c991 360deg);animation:radar-turn 5s linear infinite}.radar-cross{position:absolute;inset:0;background:linear-gradient(90deg,transparent 49.5%,#b2689c40 49.5% 50.5%,transparent 50.5%),linear-gradient(transparent 49.5%,#b2689c40 49.5% 50.5%,transparent 50.5%)}.radar-target{position:absolute;width:5px;height:5px;left:48px;top:25px;background:#f3acd4;border-radius:50%;box-shadow:0 0 9px #e594c480}
.scan-stages{display:flex;align-items:center;gap:13px;flex-wrap:wrap;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#887992}.scan-stages>span[data-state]{display:flex;align-items:center;gap:7px}.scan-stages i{font-style:normal}.scan-stages [data-state=active]{color:#efabd6}.scan-stages [data-state=complete]{color:#9abdaf}.stage-join{color:#56475f}
.scan-journal{display:flex;gap:11px;align-items:flex-start;border-top:1px solid #b776bd20;padding-top:15px;margin-top:20px;font:11px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#ac9ab8}.journal-prefix{color:#e57bb9;white-space:nowrap}.scan-source{font-size:10px;color:#8c7b9c;margin-top:10px}
@keyframes scan-line{from{transform:translateY(-4px)}to{transform:translateY(330px)}}@keyframes radar-turn{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.scan-line{animation:none;display:none}.radar-sweep{animation:none;opacity:.55}}
@media(max-width:560px){.scan-progress{padding:19px 18px}.scan-body{gap:15px;margin:21px 0}.scan-radar{width:58px;height:58px}.radar-target{left:36px;top:18px}.scan-copy h3{font-size:16px}.scan-copy p{font-size:11px}.scan-top{letter-spacing:1px;font-size:9px}.scan-clock{letter-spacing:0}.scan-stages{font-size:10px;gap:10px}}
</style>
