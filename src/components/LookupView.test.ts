import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import LookupView from './LookupView.vue'
import LookupActivityComponent from './LookupActivity.vue'
import type { DesktopClient } from '../desktop/client'
import { MIN_INTERVAL } from '../desktop/client'
import type { LookupActivity, LookupProfile, Overview, Watch } from '../desktop/dto'
import { createLookupState } from '../desktop/lookup'
import type { createMonitoringState } from '../desktop/monitoring'
import { DesktopFailure } from '../desktop/messages'
import { formatCount, localTime } from '../desktop/format'
import { overview as baseOverview, watch as baseWatch } from '../desktop/fixtures'
import { t } from '../i18n'
import { ResearchClient, createResearchState, type SaveInput, type SavedCheck } from '../desktop/workbench'

const profile = (over: Partial<LookupProfile> = {}): LookupProfile => ({
  target_pk: '7', access: 'public',
  fields: {
    username: 'alice', full_name: 'Alice Harbour', biography: 'Night ferries and harbour light.',
    external_url: null, is_verified: false, is_business: false, is_private: false,
    follower_count: 18507, following_count: 809, media_count: 423,
    public_email: null, public_phone: null, business_category: null,
  },
  unknown_fields: [], quota_remaining: 4211, ...over,
})
const hours = Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 2 : hour === 20 ? 1 : 0))
const days = [1, 0, 2, 0, 0, 0, 0]
const activity = (over: Partial<LookupActivity> = {}): LookupActivity => ({
  target_pk: '7', window: 30, analyzed: 3,
  geo: {
    geotagged: 3,
    anchor: { name: 'Ferry Terminal', lat: 52.3739, lng: 4.8903, count: 2 },
    centroid: { lat: 52.3696, lng: 4.8842 }, radius_km: 1.2345,
    places: [{ name: 'Ferry Terminal', lat: 52.3739, lng: 4.8903, count: 2 }, { name: 'Birch Yard', lat: 52.3612, lng: 4.8721, count: 1 }],
  },
  timeline: { hour_of_day: hours, day_of_week: days, weekday_hours: days.map((count, day) => hours.map((_, hour) => day === 0 && hour === 20 ? 1 : day === 2 && hour === 9 ? count : 0)), first_post_at: 1_769_000_000, last_post_at: 1_770_000_000 },
  hashtags: [{ key: 'harbour', count: 3 }], mentions: [{ key: 'atlas.ferry', count: 1 }],
  locations: [{ key: 'Ferry Terminal', count: 2 }, { key: 'Birch Yard', count: 1 }],
  likes: { total: 301, average: 100.4, top_posts: [{ code: 'fer01', like_count: 150 }] },
  quota_remaining: 4210, ...over,
})
const emptyActivity = () => activity({
  analyzed: 0,
  geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
  timeline: { hour_of_day: hours.map(() => 0), day_of_week: days.map(() => 0), weekday_hours: Array.from({ length: 7 }, () => Array(24).fill(0)), first_post_at: null, last_post_at: null },
  hashtags: [], mentions: [], locations: [], likes: { total: 0, average: 0, top_posts: [] },
})

interface Options {
  lookupProfile?: (user: string) => Promise<LookupProfile>
  lookupActivity?: (pk: string, window: 12 | 30 | 50) => Promise<LookupActivity>
  watches?: Watch[]
  add?: (user: string, interval: number) => Promise<boolean>
  stale?: boolean
  research?: ReturnType<typeof createResearchState>
  attachTo?: boolean
}
// The real lookup state against a stub of the only two calls it makes, and a
// stand-in for the monitoring state holding just what this section reads of it.
function setup(options: Options = {}) {
  const lookupProfile = vi.fn(options.lookupProfile ?? (() => Promise.resolve(profile())))
  const lookupActivity = vi.fn(options.lookupActivity ?? (() => Promise.resolve(activity())))
  const lookup = createLookupState({ lookupProfile, lookupActivity } as unknown as DesktopClient)
  const state = reactive({
    overview: { ...baseOverview, watches: options.watches ?? [] } as Overview | null,
    busy: false, stale: options.stale ?? false, error: null as DesktopFailure | null,
  })
  const add = vi.fn(options.add ?? ((user: string) => {
    state.overview!.watches = [...state.overview!.watches, { ...baseWatch, user }]
    return Promise.resolve(true)
  }))
  const monitoring = { state, add } as unknown as ReturnType<typeof createMonitoringState>
  const wrapper = mount(LookupView, { attachTo: options.attachTo ? document.body : undefined, props: { lookup, monitoring, research: options.research } })
  return { wrapper, lookup, monitoring, monitoringState: state, lookupProfile, lookupActivity, add }
}
const look = async (harness: ReturnType<typeof setup>, name = 'alice') => {
  await harness.wrapper.get('#lookup-user').setValue(name)
  await harness.wrapper.get('form').trigger('submit')
  await flushPromises()
}
const blocks = (harness: ReturnType<typeof setup>) =>
  harness.wrapper.findAll('[data-block]').map(node => node.attributes('data-block'))
const analyse = async (harness: ReturnType<typeof setup>) => {
  await harness.wrapper.get('[data-action="analyse"]').trigger('click')
  await flushPromises()
}
const resultTab = async (harness: ReturnType<typeof setup>, tab: 'overview' | 'activity' | 'geography' | 'terms') => {
  await harness.wrapper.get(`[data-action="result-tab-${tab}"]`).trigger('click')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const savedCheck = (check: SaveInput): SavedCheck => ({ ...check, id: 'a'.repeat(32), saved_at: check.captured_at })
function researchClient(options: { save?: (check: SaveInput) => Promise<SavedCheck>; export?: () => Promise<boolean> } = {}) {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'research_list') return []
    if (command === 'research_save') {
      const check = args!.check as SaveInput
      return options.save ? options.save(check) : savedCheck(check)
    }
    if (command === 'research_export') return options.export ? options.export() : true
    throw new DesktopFailure('internal_error')
  })
  return { research: createResearchState(new ResearchClient(invoke)), invoke }
}

describe('lookup research feedback', () => {
  it('keeps successful save and export feedback for the unchanged check', async () => {
    const archive = researchClient()
    const harness = setup(archive)
    try {
      await look(harness)
      await harness.wrapper.get('[data-action="save-check"]').trigger('click'); await flushPromises()
      expect(harness.wrapper.text()).toContain(t('research.saved'))
      expect(archive.research.state.items[0].username).toBe('alice')
      await harness.wrapper.get('[data-action="export-html"]').trigger('click'); await flushPromises()
      expect(harness.wrapper.text()).toContain(t('research.exported'))
      expect(archive.invoke.mock.calls.find(([command]) => command === 'research_export')![1]!.filename).toMatch(/^insto-alice-.*\.html$/)
    } finally { harness.wrapper.unmount() }
  })

  it.each(['lookup', 'analysis', 'input'] as const)('does not attach a delayed save to a changed %s', async change => {
    const pending = deferred<void>()
    const archive = researchClient({ save: async check => { await pending.promise; return savedCheck(check) } })
    const harness = setup(archive)
    try {
      await look(harness)
      await harness.wrapper.get('[data-action="save-check"]').trigger('click'); await flushPromises()
      if (change === 'lookup') await look(harness, 'bob')
      else if (change === 'analysis') await analyse(harness)
      else await harness.wrapper.get('#lookup-user').setValue('bob')
      pending.resolve(); await flushPromises()
      expect(archive.research.state.items[0].username).toBe('alice')
      expect(harness.wrapper.text()).not.toContain(t('research.saved'))
    } finally { pending.resolve(); harness.wrapper.unmount() }
  })

  it('shows a current save failure but does not attach a delayed failure to another lookup', async () => {
    const pending = deferred<void>()
    const archive = researchClient({ save: async () => { await pending.promise; throw new DesktopFailure('research_storage') } })
    const harness = setup(archive)
    try {
      await look(harness)
      await harness.wrapper.get('[data-action="save-check"]').trigger('click'); await flushPromises()
      await look(harness, 'bob')
      pending.resolve(); await flushPromises()
      expect(archive.research.state.error?.code).toBe('research_storage')
      expect(harness.wrapper.find('[role="alert"]').exists()).toBe(false)
      await harness.wrapper.get('[data-action="save-check"]').trigger('click'); await flushPromises()
      expect(harness.wrapper.get('[role="alert"]').text()).toBe(new DesktopFailure('research_storage').message)
    } finally { pending.resolve(); harness.wrapper.unmount() }
  })

  it.each(['success', 'failure'] as const)('does not attach delayed export %s to another lookup', async outcome => {
    const pending = deferred<boolean>()
    const archive = researchClient({ export: () => pending.promise })
    const harness = setup(archive)
    try {
      await look(harness)
      await harness.wrapper.get('[data-action="export-json"]').trigger('click'); await flushPromises()
      await look(harness, 'bob')
      if (outcome === 'success') pending.resolve(true)
      else pending.reject(new DesktopFailure('research_storage'))
      await flushPromises()
      expect(harness.wrapper.text()).not.toContain(t('research.exported'))
      expect(harness.wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(harness.wrapper.get('[data-action="export-json"]').attributes('disabled')).toBeUndefined()
    } finally { pending.resolve(false); harness.wrapper.unmount() }
  })

  it.each(['save', 'export'] as const)('does not update %s feedback after the bound view unmounts', async action => {
    const pending = deferred<void>()
    const archive = researchClient({
      save: async check => { await pending.promise; return savedCheck(check) },
      export: async () => { await pending.promise; return true },
    })
    const harness = setup(archive)
    await look(harness)
    await harness.wrapper.get(`[data-action="${action === 'save' ? 'save-check' : 'export-html'}"]`).trigger('click'); await flushPromises()
    const feedback = harness.wrapper.vm as unknown as { justSaved: boolean; exported: boolean }
    harness.wrapper.unmount()
    pending.resolve(); await flushPromises()
    expect(feedback.justSaved).toBe(false)
    expect(feedback.exported).toBe(false)
  })
})

describe('lookup section', () => {
  it('defaults to a profile check, with a short price and expandable request details', async () => {
    const archive = researchClient()
    const harness = setup(archive)
    expect((harness.wrapper.get('[data-action="scope-profile"]').element as HTMLInputElement).checked).toBe(true)
    expect((harness.wrapper.get('[data-action="scope-full"]').element as HTMLInputElement).checked).toBe(false)
    expect(harness.wrapper.get('[data-note="request-cost"]').text()).toBe(t('lookup.cost_profile_short'))
    expect(harness.wrapper.get('[data-action="cost-details"]').element.closest('details')?.open).toBe(false)
    expect(harness.wrapper.text()).toContain(t('lookup.cost_profile'))
    expect((harness.wrapper.get('#lookup-window').element as HTMLSelectElement).value).toBe('30')
    expect(archive.invoke).not.toHaveBeenCalled()
    const check = vi.spyOn(harness.lookup, 'check')
    await look(harness, '@Alice ')
    expect(check).toHaveBeenCalledExactlyOnceWith('@Alice ', false)
    expect(harness.lookupActivity).not.toHaveBeenCalled()
    expect(harness.wrapper.classes()).toContain('has-result')
    harness.wrapper.unmount()
  })

  it('runs one profile and one activity stage for the explicitly chosen full check', async () => {
    const first = deferred<LookupProfile>(), second = deferred<LookupActivity>()
    const harness = setup({ lookupProfile: () => first.promise, lookupActivity: () => second.promise })
    try {
      await harness.wrapper.get('[data-action="scope-full"]').setValue(true)
      await harness.wrapper.get('#lookup-window').setValue('12')
      expect(harness.wrapper.get('[data-note="request-cost"]').text()).toBe(t('lookup.cost_full_short'))
      expect(harness.lookupProfile).not.toHaveBeenCalled()
      expect(harness.lookupActivity).not.toHaveBeenCalled()
      await harness.wrapper.get('#lookup-user').setValue('alice')
      await harness.wrapper.get('form').trigger('submit')
      await harness.wrapper.get('form').trigger('submit')
      expect(harness.lookupProfile.mock.calls).toEqual([['alice']])
      expect(harness.wrapper.classes()).toContain('has-result')
      expect(harness.wrapper.find('.intro').exists()).toBe(false)
      expect(harness.wrapper.get('.scan-progress').attributes('data-phase')).toBe('profile')
      expect(harness.wrapper.find('[data-stage="activity"]').exists()).toBe(true)
      expect(harness.wrapper.get('[data-action="scope-profile"]').attributes('disabled')).toBeDefined()
      first.resolve(profile()); await flushPromises()
      expect(harness.lookupActivity.mock.calls).toEqual([['7', 12]])
      expect(harness.wrapper.get('.scan-progress').attributes('data-phase')).toBe('activity')
      expect(harness.wrapper.text()).toContain('Alice Harbour')
      await harness.wrapper.get('form').trigger('submit')
      expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
      second.resolve(activity({ window: 12 })); await flushPromises()
      expect(harness.wrapper.find('.scan-progress').exists()).toBe(false)
      expect(harness.wrapper.find('[data-block="overview"]').exists()).toBe(true)
    } finally { first.resolve(profile()); second.resolve(activity()); harness.wrapper.unmount() }
  })

  it('keeps the full scope, pending posts and elapsed time when reopened during a check', async () => {
    vi.useFakeTimers()
    const first = deferred<LookupProfile>(), second = deferred<LookupActivity>()
    const harness = setup({ lookupProfile: () => first.promise, lookupActivity: () => second.promise })
    let reopened: typeof harness.wrapper | undefined
    let left = false
    try {
      await harness.wrapper.get('[data-action="scope-full"]').setValue(true)
      await harness.wrapper.get('#lookup-user').setValue('alice')
      await harness.wrapper.get('form').trigger('submit')
      const startedAt = harness.lookup.state.startedAt
      await vi.advanceTimersByTimeAsync(7_000)
      harness.wrapper.unmount(); left = true
      await vi.advanceTimersByTimeAsync(4_000)
      reopened = mount(LookupView, { props: { lookup: harness.lookup, monitoring: harness.monitoring } })
      await reopened.vm.$nextTick()
      expect.soft((reopened.get('[data-action="scope-full"]').element as HTMLInputElement).checked).toBe(true)
      expect.soft(reopened.find('[data-stage="activity"][data-state="pending"]').exists()).toBe(true)
      expect.soft(reopened.get('[data-elapsed]').text()).toBe('00:11')
      expect(harness.lookup.state.startedAt).toBe(startedAt)
      expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
      expect(harness.lookupActivity).not.toHaveBeenCalled()
      first.resolve(profile()); await vi.advanceTimersByTimeAsync(0)
      expect(reopened.get('.scan-progress').attributes('data-phase')).toBe('activity')
      expect(reopened.get('[data-elapsed]').text()).toBe('00:11')
      expect(harness.lookupActivity).toHaveBeenCalledTimes(1)
      second.resolve(activity()); await vi.advanceTimersByTimeAsync(0)
      expect(reopened.find('.scan-progress').exists()).toBe(false)
    } finally {
      first.resolve(profile()); second.resolve(activity())
      reopened?.unmount()
      if (!left) harness.wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps the profile when the second stage fails and skips posts for private full checks', async () => {
    const archive = researchClient()
    const failed = setup({ ...archive, lookupActivity: () => Promise.reject(new DesktopFailure('operation_timeout')) })
    await failed.wrapper.get('[data-action="scope-full"]').setValue(true)
    await look(failed)
    expect(failed.wrapper.text()).toContain('Alice Harbour')
    expect(failed.wrapper.get('.lookup-analysis [role="alert"]').text()).toBe(new DesktopFailure('operation_timeout').message)
    expect(failed.wrapper.find('[data-note="quota"]').exists()).toBe(false)
    await failed.wrapper.get('[data-action="save-check"]').trigger('click'); await flushPromises()
    expect(archive.research.state.items[0].profile.fields.full_name).toBe('Alice Harbour')
    expect(archive.research.state.items[0].activity).toBe(null)
    const privateCheck = setup({ lookupProfile: () => Promise.resolve(profile({ access: 'private' })) })
    await privateCheck.wrapper.get('[data-action="scope-full"]').setValue(true)
    await look(privateCheck)
    expect(privateCheck.wrapper.text()).toContain('Alice Harbour')
    expect(privateCheck.wrapper.get('[data-note="private"]').text()).toBe(t('lookup.private_notice'))
    expect(privateCheck.lookupActivity).not.toHaveBeenCalled()
    failed.wrapper.unmount(); privateCheck.wrapper.unmount()
  })

  it('uses the same fetched sample for every result tab and supports roving keyboard focus', async () => {
    const harness = setup({ attachTo: true })
    try {
      await harness.wrapper.get('[data-action="scope-full"]').setValue(true)
      await look(harness)
      const overview = harness.wrapper.get('[data-action="result-tab-overview"]')
      expect(overview.attributes('aria-selected')).toBe('true')
      expect(overview.attributes('tabindex')).toBe('0')
      expect(harness.wrapper.get('[data-block="overview"]').text()).toContain(t('research.coverage', { count: '3', window: '30' }))
      expect(harness.wrapper.get('[data-block="overview"]').text()).toContain('#harbour')
      expect(harness.wrapper.get('[data-block="overview"]').text()).toContain('09:00 UTC')
      expect(harness.wrapper.find('.geo-map').exists()).toBe(false)
      ;(overview.element as HTMLElement).focus()
      await overview.trigger('keydown', { key: 'ArrowRight' })
      const activityTab = harness.wrapper.get('[data-action="result-tab-activity"]')
      expect(activityTab.attributes('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(activityTab.element)
      expect(harness.wrapper.find('[data-block="when"]').exists()).toBe(true)
      expect(harness.wrapper.find('[data-block="where"]').exists()).toBe(false)
      await activityTab.trigger('keydown', { key: 'End' })
      expect(harness.wrapper.get('[data-action="result-tab-terms"]').attributes('tabindex')).toBe('0')
      expect(harness.wrapper.text()).toContain('@atlas.ferry')
      await harness.wrapper.get('[data-action="result-tab-geography"]').trigger('click')
      expect(harness.wrapper.find('[data-block="where"]').exists()).toBe(true)
      await harness.wrapper.get('[data-action="result-tab-geography"]').trigger('keydown', { key: 'Home' })
      expect(overview.attributes('aria-selected')).toBe('true')
      await overview.trigger('keydown', { key: 'ArrowLeft' })
      expect(harness.wrapper.get('[data-action="result-tab-terms"]').attributes('aria-selected')).toBe('true')
      expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
      expect(harness.lookupActivity).toHaveBeenCalledTimes(1)
    } finally { harness.wrapper.unmount() }
  })

  it('shows explicit empty sections for a sample with no dated posts, geotags or terms', async () => {
    const sample = emptyActivity()
    sample.analyzed = 3
    const harness = setup({ lookupActivity: () => Promise.resolve(sample) })
    await harness.wrapper.get('[data-action="scope-full"]').setValue(true)
    await look(harness)
    expect(harness.wrapper.get('[data-block="overview"]').text()).toContain(t('lookup.summary_none'))
    await harness.wrapper.get('[data-action="result-tab-activity"]').trigger('click')
    expect(harness.wrapper.text()).toContain(t('lookup.heatmap_empty'))
    await harness.wrapper.get('[data-action="result-tab-geography"]').trigger('click')
    expect(harness.wrapper.text()).toContain(t('lookup.map_empty'))
    await harness.wrapper.get('[data-action="result-tab-terms"]').trigger('click')
    expect(harness.wrapper.text()).toContain(t('lookup.results_empty'))
    expect(harness.lookupActivity).toHaveBeenCalledTimes(1)
    harness.wrapper.unmount()
  })

  it('reopens only already loaded recent checks locally and requires a fresh profile before analysis', async () => {
    const archive = researchClient()
    const check = savedCheck({ username: 'alice', target_pk: '7', captured_at: 1_770_000_000, profile: profile(), activity: activity() })
    archive.research.state.items = [check]
    archive.research.state.loaded = true
    const harness = setup(archive)
    await harness.wrapper.get('#lookup-user').setValue('bob')
    await harness.wrapper.get('[data-action="open-recent"]').trigger('click')
    expect((harness.wrapper.get('#lookup-user').element as HTMLInputElement).value).toBe('alice')
    expect(harness.wrapper.get('[data-note="saved-origin"]').text()).toBe(t('research.from_saved', { time: localTime(check.captured_at) }))
    expect(harness.wrapper.get('[data-action="analyse"]').attributes('disabled')).toBeDefined()
    expect(harness.wrapper.text()).toContain(t('research.refresh_before_analysis'))
    expect(harness.wrapper.find('[data-note="quota"]').exists()).toBe(false)
    await harness.wrapper.get('[data-action="analyse"]').trigger('click')
    await harness.wrapper.get('[data-action="result-tab-geography"]').trigger('click')
    expect(harness.lookupProfile).not.toHaveBeenCalled()
    expect(harness.lookupActivity).not.toHaveBeenCalled()
    expect(archive.invoke).not.toHaveBeenCalled()
    await look(harness)
    expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
    expect(harness.wrapper.find('[data-note="saved-origin"]').exists()).toBe(false)
    harness.wrapper.unmount()
  })

  it('says what a lookup costs before it is pressed, and pays only on submit', async () => {
    const harness = setup()
    expect(harness.wrapper.text()).toContain(t('lookup.cost_profile'))
    expect(harness.wrapper.text()).toContain(t('lookup.intro'))
    // Opening the section spends nothing: not one call has left.
    expect(harness.lookupProfile).not.toHaveBeenCalled()
    await look(harness)
    expect(harness.lookupProfile.mock.calls).toEqual([['alice']])
    expect(harness.wrapper.get('h2').text()).toBe('@alice')
    expect(harness.wrapper.get('.profile-card').attributes('aria-label')).toBe(t('lookup.result_label'))
    expect(harness.wrapper.text()).toContain('Alice Harbour')
    expect(harness.wrapper.text()).toContain(formatCount(18507))
    expect(harness.wrapper.text()).toContain(t('lookup.quota_after', { count: formatCount(4211) }))
    // The analysis is a second, separate decision with a price of its own.
    expect(harness.lookupActivity).not.toHaveBeenCalled()
    expect(harness.wrapper.get('[data-note="activity-request-cost"]').text()).toBe(t('lookup.cost_activity_short'))
    expect(harness.wrapper.text()).toContain(t('lookup.cost_activity'))
  })

  it('submits the form the way Enter does, and canonicalizes the typed name', async () => {
    const harness = setup()
    const submit = harness.wrapper.get('form button[type="submit"]')
    expect(submit.text()).toBe(t('lookup.action'))
    await look(harness, '@Alice ')
    // The rule is the state module's, which is the one the Add account form uses.
    expect(harness.lookupProfile.mock.calls).toEqual([['alice']])
  })

  it('sends one request for two clicks, and disables every control while one is out', async () => {
    let settle: (value: LookupProfile) => void = () => {}
    const harness = setup({ lookupProfile: () => new Promise<LookupProfile>(resolve => { settle = resolve }) })
    await harness.wrapper.get('#lookup-user').setValue('alice')
    await harness.wrapper.get('form').trigger('submit')
    await harness.wrapper.get('form').trigger('submit')
    expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
    expect(harness.wrapper.get('#lookup-user').attributes('disabled')).toBeDefined()
    expect(harness.wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(harness.wrapper.get('form button[type="submit"]').text()).toBe(t('lookup.looking'))
    settle(profile())
    await flushPromises()
    expect(harness.wrapper.get('#lookup-user').attributes('disabled')).toBeUndefined()

    // The same while the analysis is out: the field and both buttons are held.
    let finish: (value: LookupActivity) => void = () => {}
    const second = setup({ lookupActivity: () => new Promise<LookupActivity>(resolve => { finish = resolve }) })
    await look(second)
    await second.wrapper.get('[data-action="analyse"]').trigger('click')
    await second.wrapper.get('[data-action="analyse"]').trigger('click')
    expect(second.lookupActivity).toHaveBeenCalledTimes(1)
    expect(second.wrapper.get('#lookup-user').attributes('disabled')).toBeDefined()
    expect(second.wrapper.get('[data-action="analyse"]').attributes('disabled')).toBeDefined()
    expect(second.wrapper.get('#lookup-window').attributes('disabled')).toBeDefined()
    // Every control on the screen says the same thing while a request is out.
    expect(second.wrapper.get('[data-action="watch"]').attributes('disabled')).toBeDefined()
    expect(second.wrapper.get('.scan-progress [role="status"]').text()).toContain(t('scan.activity_title'))
    finish(activity())
    await flushPromises()
    expect(second.wrapper.get('#lookup-user').attributes('disabled')).toBeUndefined()
  })

  it('shows every failure where the click was, and says when it may already have been charged', async () => {
    const charged = ['target_not_found', 'target_private', 'target_unavailable', 'provider_response_invalid',
      'rate_limited', 'quota_exhausted', 'network_error', 'operation_timeout', 'invalid_token', 'transport'] as const
    // These prove the request never left this Mac, so the warning would be a
    // lie in the expensive direction.
    const free = ['not_configured', 'busy', 'closed', 'launcher', 'runtime_handshake', 'unsupported_platform'] as const
    for (const code of [...charged, ...free]) {
      const harness = setup({ lookupProfile: () => Promise.reject(new DesktopFailure(code)) })
      await look(harness)
      const alert = harness.wrapper.get('[role="alert"]')
      expect(alert.text(), code).toBe(new DesktopFailure(code).message)
      // In place, inside the card: the section renders no banner of its own.
      expect(alert.element.closest('.profile-card'), code).not.toBeNull()
      const paid = (charged as readonly string[]).includes(code)
      expect(harness.wrapper.text().includes(t('lookup.may_be_charged')), code).toBe(paid)
      // A failure offers nothing to analyse and nothing to watch.
      expect(harness.wrapper.find('[data-action="analyse"]').exists()).toBe(false)
      expect(harness.wrapper.find('[data-action="watch"]').exists()).toBe(false)
      harness.wrapper.unmount()
    }

    // A failed analysis carries the same warning, beside its own message, and
    // drops it for a failure that cost nothing.
    const failed = setup({ lookupActivity: () => Promise.reject(new DesktopFailure('operation_timeout')) })
    await look(failed)
    await analyse(failed)
    expect(failed.wrapper.get('.lookup-analysis [role="alert"]').text()).toBe(new DesktopFailure('operation_timeout').message)
    expect(failed.wrapper.text()).toContain(t('lookup.may_be_charged'))
    const refusedAnalysis = setup({ lookupActivity: () => Promise.reject(new DesktopFailure('not_configured')) })
    await look(refusedAnalysis)
    await analyse(refusedAnalysis)
    expect(refusedAnalysis.wrapper.get('.lookup-analysis [role="alert"]').text()).toBe(new DesktopFailure('not_configured').message)
    expect(refusedAnalysis.wrapper.text()).not.toContain(t('lookup.may_be_charged'))
  })

  it('refuses a mistyped name beside the field and keeps what was paid for', async () => {
    const harness = setup()
    await look(harness)
    await analyse(harness)
    await look(harness, 'a b')
    expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
    const refusal = harness.wrapper.get('[data-note="input-refused"]')
    expect(refusal.text()).toBe(new DesktopFailure('invalid_lookup_input').message)
    expect(refusal.attributes('role')).toBe('alert')
    // Nothing was charged for it, and the answer that was charged for is intact.
    expect(harness.wrapper.text()).not.toContain(t('lookup.may_be_charged'))
    expect(harness.wrapper.get('h2').text()).toBe('@alice')
    expect(harness.wrapper.text()).toContain('Alice Harbour')
    expect(harness.wrapper.find('[data-block="overview"]').exists()).toBe(true)
    // Editing the field takes the refusal away; so does a name that works.
    await harness.wrapper.get('#lookup-user').setValue('bo')
    expect(harness.wrapper.find('[data-note="input-refused"]').exists()).toBe(false)
    await look(harness, 'bob')
    expect(harness.lookupProfile.mock.calls).toEqual([['alice'], ['bob']])
  })

  it('does not offer to analyse a private account', async () => {
    const harness = setup({ lookupProfile: () => Promise.resolve(profile({ access: 'private', fields: { ...profile().fields, is_private: true } })) })
    await look(harness)
    // The profile is public knowledge and is shown; its posts are not.
    expect(harness.wrapper.text()).toContain('Alice Harbour')
    expect(harness.wrapper.get('[data-note="private"]').text()).toBe(t('lookup.private_notice'))
    expect(harness.wrapper.find('[data-action="analyse"]').exists()).toBe(false)
    expect(harness.wrapper.find('#lookup-window').exists()).toBe(false)
    expect(harness.lookupActivity).not.toHaveBeenCalled()
    // Watching it is still a reasonable thing to want.
    expect(harness.wrapper.find('[data-action="watch"]').exists()).toBe(true)
  })

  it('analyses the chosen window, on a click and never before it', async () => {
    const harness = setup()
    await look(harness)
    const select = harness.wrapper.get('#lookup-window')
    expect((select.element as HTMLSelectElement).value).toBe('30')
    expect(select.findAll('option').map(option => option.text()))
      .toEqual([12, 30, 50].map(count => t('lookup.window_option', { count })))
    await select.setValue('12')
    // Choosing a window is not a purchase.
    expect(harness.lookupActivity).not.toHaveBeenCalled()
    await analyse(harness)
    expect(harness.lookupActivity.mock.calls).toEqual([['7', 12]])
  })

  it('shows every block the analysis has something for, and hides the rest', async () => {
    const harness = setup()
    await look(harness)
    await analyse(harness)
    expect(blocks(harness)).toEqual(['overview'])
    await resultTab(harness, 'geography')
    expect(blocks(harness)).toEqual(['where', 'places'])
    expect(harness.wrapper.text()).toContain(t('lookup.geotagged', { tagged: '3', analyzed: '3' }))
    expect(harness.wrapper.text()).toContain(t('lookup.anchor', { place: 'Ferry Terminal', count: '2' }))
    expect(harness.wrapper.text()).toContain(t('lookup.radius', { km: '1.2' }))
    expect(harness.wrapper.text()).toContain('52.3696, 4.8842')
    expect(harness.wrapper.findAll('[data-list="places"] dt').map(node => node.text()))
      .toEqual(['Ferry Terminal52.3739, 4.8903', 'Birch Yard52.3612, 4.8721'])
    // The disclaimer stands above the numbers it qualifies, not after them.
    const where = harness.wrapper.get('[data-block="where"]')
    expect(where.get('p').text()).toBe(t('lookup.geo_note'))
    // The places list is its own block now, with its own heading and its own
    // one-line note about which posts it counts.
    const placesBlock = harness.wrapper.get('[data-block="places"]')
    expect(placesBlock.get('h4').text()).toBe(t('lookup.places_title'))
    expect(placesBlock.get('p').text()).toBe(t('lookup.places_note'))
    expect(where.findAll('h5')).toHaveLength(0)
    await resultTab(harness, 'activity')
    expect(blocks(harness)).toEqual(['when', 'likes'])
    expect(harness.wrapper.get('[data-block="likes"]').findAll('h5').map(node => node.text())).toEqual([t('lookup.top_posts_title')])
    expect(harness.wrapper.findAll('.bar-chart').length).toBe(2)
    // An hour reads as a time, and the day chart says which zone it counts in.
    expect(harness.wrapper.text()).toContain(t('lookup.chart_item', { label: t('lookup.hour_label', { hour: '09' }), count: '2' }))
    expect(harness.wrapper.text()).toContain(t('lookup.days_title'))
    expect(harness.wrapper.text()).toContain(t('lookup.times_note'))
    expect(harness.wrapper.text()).toContain(t('lookup.first_post', { time: localTime(1_769_000_000) }))
    // The average is a count of likes, so it is shown as one.
    expect(harness.wrapper.text()).toContain(t('lookup.post_code', { code: 'fer01' }))
    expect(harness.wrapper.get('[data-block="likes"]').text()).toContain('100')
    await resultTab(harness, 'terms')
    expect(blocks(harness)).toEqual(['hashtags', 'mentions'])
    expect(harness.wrapper.text()).toContain('#harbour')
    expect(harness.wrapper.text()).toContain('@atlas.ferry')
    // The window asked for was larger than what could be read, and it says so.
    expect(harness.wrapper.get('[data-note="analyzed"]').text())
      .toBe(t('lookup.analyzed_short', { analyzed: '3', window: '30' }))
    expect(harness.wrapper.text()).toContain(t('lookup.quota_after', { count: formatCount(4210) }))

    // An account with no geotags, no hashtags and no mentions keeps the blocks
    // that do have something and drops the ones that do not.
    const quiet = setup({ lookupActivity: () => Promise.resolve(activity({
      analyzed: 30,
      geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
      hashtags: [], mentions: [], locations: [],
    })) })
    await look(quiet)
    await analyse(quiet)
    await resultTab(quiet, 'activity')
    expect(blocks(quiet)).toEqual(['when', 'likes'])
    expect(quiet.wrapper.get('[data-note="analyzed"]').text()).toBe(t('lookup.analyzed', { count: '30' }))
  })

  it('shows a balance only when the last paid answer vouches for it', async () => {
    // A failed analysis that may already have been charged leaves the profile's
    // number out of date, so it is not shown as the balance "after this lookup".
    const failed = setup({ lookupActivity: () => Promise.reject(new DesktopFailure('operation_timeout')) })
    await look(failed)
    expect(failed.wrapper.get('[data-note="quota"]').text()).toBe(t('lookup.quota_after', { count: formatCount(4211) }))
    await analyse(failed)
    expect(failed.wrapper.find('[data-note="quota"]').exists()).toBe(false)

    // A refusal that cost nothing leaves the profile's number true.
    const free = setup({ lookupActivity: () => Promise.reject(new DesktopFailure('not_configured')) })
    await look(free)
    await analyse(free)
    expect(free.wrapper.get('[data-note="quota"]').text()).toBe(t('lookup.quota_after', { count: formatCount(4211) }))

    // An analysis that answered without a balance cannot vouch for one either.
    const silent = setup({ lookupActivity: () => Promise.resolve(activity({ quota_remaining: null })) })
    await look(silent)
    await analyse(silent)
    expect(silent.wrapper.find('[data-note="quota"]').exists()).toBe(false)

    // A profile the provider answered without a balance shows no line at all.
    const unknown = setup({ lookupProfile: () => Promise.resolve(profile({ quota_remaining: null })) })
    await look(unknown)
    expect(unknown.wrapper.find('[data-note="quota"]').exists()).toBe(false)

    // And nothing is shown while an analysis is running: a second one would
    // otherwise fall back to a number the first has already made too high.
    let finish: (value: LookupActivity) => void = () => {}
    const running = setup({ lookupActivity: () => new Promise<LookupActivity>(resolve => { finish = resolve }) })
    await look(running)
    expect(running.wrapper.find('[data-note="quota"]').exists()).toBe(true)
    await running.wrapper.get('[data-action="analyse"]').trigger('click')
    expect(running.wrapper.find('[data-note="quota"]').exists()).toBe(false)
    finish(activity({ quota_remaining: 4209 }))
    await flushPromises()
    expect(running.wrapper.get('[data-note="quota"]').text()).toBe(t('lookup.quota_after', { count: formatCount(4209) }))
  })

  it('keeps the geometry and the places list apart, because they count different posts', async () => {
    // Posts that name a place and carry no GPS: the core counts them in
    // `locations` and skips them in the geo fingerprint. There is no geometry to
    // show, and the list the user paid for must still be there.
    const namesOnly = setup({ lookupActivity: () => Promise.resolve(activity({
      analyzed: 12,
      geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
      locations: [{ key: 'Ferry Terminal', count: 7 }, { key: 'Birch Yard', count: 3 }],
    })) })
    await look(namesOnly)
    await analyse(namesOnly)
    await resultTab(namesOnly, 'geography')
    expect(blocks(namesOnly)).toEqual(['geography-empty', 'places'])
    expect(namesOnly.wrapper.find('[data-block="where"]').exists()).toBe(false)
    expect(namesOnly.wrapper.get('[data-block="places"]').get('h4').text()).toBe(t('lookup.places_title'))
    expect(namesOnly.wrapper.get('[data-block="places"]').get('p').text()).toBe(t('lookup.places_note'))
    expect(namesOnly.wrapper.findAll('[data-list="places"] dt').map(node => node.text())).toEqual(['Ferry Terminal', 'Birch Yard'])
    expect(namesOnly.wrapper.findAll('[data-list="places"] dd').map(node => node.text())).toEqual(['7', '3'])
    // Nothing invents a coordinate for a place that came without one.
    expect(namesOnly.wrapper.find('.term-note').exists()).toBe(false)

    // Mixed: 3 of the 12 posts carry coordinates, 9 name a place. The same place
    // therefore has two counts, and each sentence says which one it is showing.
    const mixed = setup({ lookupActivity: () => Promise.resolve(activity({
      analyzed: 12,
      locations: [{ key: 'Ferry Terminal', count: 7 }, { key: 'Birch Yard', count: 2 }],
    })) })
    await look(mixed)
    await analyse(mixed)
    await resultTab(mixed, 'geography')
    const where = mixed.wrapper.get('[data-block="where"]')
    expect(where.text()).toContain(t('lookup.geotagged', { tagged: '3', analyzed: '12' }))
    expect(where.text()).toContain(t('lookup.anchor', { place: 'Ferry Terminal', count: '2' }))
    // The anchor's 2 is the posts with coordinates; the list's 7 is the posts
    // that name it. The geometry's anchor must not use the name-only count.
    expect(where.text()).not.toContain(t('lookup.anchor', { place: 'Ferry Terminal', count: '7' }))
    expect(mixed.wrapper.findAll('[data-list="places"] dd').map(node => node.text())).toEqual(['7', '2'])
  })

  it('shows a coordinate only when one place of that name carried it', async () => {
    const geo = activity().geo
    // The provider's own name is unstripped; the term list has stripped it. The
    // two are the same place, and the row gets its coordinates.
    const padded = setup({ lookupActivity: () => Promise.resolve(activity({
      geo: { ...geo, places: [{ name: ' Ferry Terminal ', lat: 52.3739, lng: 4.8903, count: 2 }, { name: 'Birch Yard', lat: 52.3612, lng: 4.8721, count: 1 }] },
    })) })
    await look(padded)
    await analyse(padded)
    await resultTab(padded, 'geography')
    expect(padded.wrapper.findAll('[data-list="places"] dt').map(node => node.text()))
      .toEqual(['Ferry Terminal52.3739, 4.8903', 'Birch Yard52.3612, 4.8721'])

    // Two buckets under one displayed name (two place ids): nothing here can say
    // which of them a counted post belongs to, so the row shows no coordinates.
    const duplicated = setup({ lookupActivity: () => Promise.resolve(activity({
      geo: { ...geo, places: [{ name: 'Ferry Terminal', lat: 52.3739, lng: 4.8903, count: 1 }, { name: 'Ferry Terminal ', lat: 1.5, lng: 2.5, count: 1 }] },
    })) })
    await look(duplicated)
    await analyse(duplicated)
    await resultTab(duplicated, 'geography')
    expect(duplicated.wrapper.findAll('[data-list="places"] dt').map(node => node.text()))
      .toEqual(['Ferry Terminal', 'Birch Yard'])
  })

  it('has one honest empty state when no posts could be read', async () => {
    const harness = setup({ lookupActivity: () => Promise.resolve(emptyActivity()) })
    await look(harness)
    await analyse(harness)
    expect(harness.wrapper.findAll('[data-block]').map(node => node.attributes('data-block'))).toEqual(['empty'])
    expect(harness.wrapper.get('[data-block="empty"]').text()).toBe(t('lookup.analyzed_none'))
    // No second sentence about a window that read nothing.
    expect(harness.wrapper.find('[data-note="analyzed"]').exists()).toBe(false)
    expect(harness.wrapper.find('.bar-chart').exists()).toBe(false)
  })

  it('never turns anything the provider said into a link', async () => {
    const harness = setup({ lookupProfile: () => Promise.resolve(profile({ fields: { ...profile().fields, external_url: 'https://example.com/alice', biography: '<b>ferries</b> https://example.com' } })) })
    await look(harness)
    await analyse(harness)
    expect(harness.wrapper.find('a').exists()).toBe(false)
    expect(harness.wrapper.find('img').exists()).toBe(false)
    // The bio is printed, not interpreted: the markup in it is text.
    expect(harness.wrapper.text()).toContain('<b>ferries</b>')
    expect(harness.wrapper.html()).not.toContain('<b>ferries</b>')
  })

  it('adds the account to the watches and opens it there', async () => {
    const harness = setup()
    await look(harness)
    expect(harness.wrapper.text()).toContain(t('lookup.watch_note', { seconds: MIN_INTERVAL }))
    await harness.wrapper.get('[data-action="watch"]').trigger('click')
    await flushPromises()
    expect(harness.add.mock.calls).toEqual([['alice', MIN_INTERVAL]])
    expect(harness.wrapper.emitted('open-watch')).toEqual([['alice']])
    // The overview now holds it, so the section stops offering to add it again.
    expect(harness.wrapper.find('[data-action="watch"]').exists()).toBe(false)
    expect(harness.wrapper.text()).toContain(t('lookup.already_watched'))
    await harness.wrapper.get('[data-action="open-watch"]').trigger('click')
    expect(harness.wrapper.emitted('open-watch')).toEqual([['alice'], ['alice']])
  })

  it('shows an account that is already watched as watched, without adding it again', async () => {
    const harness = setup({ watches: [{ ...baseWatch, user: 'alice' }] })
    await look(harness)
    expect(harness.wrapper.text()).toContain(t('lookup.already_watched'))
    expect(harness.wrapper.find('[data-action="watch"]').exists()).toBe(false)
    expect(harness.wrapper.text()).not.toContain(t('lookup.watch_note', { seconds: MIN_INTERVAL }))
    expect(harness.add).not.toHaveBeenCalled()
  })

  it('reports a refused watch in place and stays where it is', async () => {
    const harness = setup({ add: () => Promise.resolve(false) })
    await look(harness)
    harness.monitoringState.error = new DesktopFailure('watch_limit')
    await harness.wrapper.get('[data-action="watch"]').trigger('click')
    await flushPromises()
    expect(harness.wrapper.get('[role="alert"]').text()).toBe(new DesktopFailure('watch_limit').message)
    expect(harness.wrapper.emitted('open-watch')).toBeUndefined()
    // The result of the lookup is untouched: it was paid for.
    expect(harness.wrapper.text()).toContain('Alice Harbour')
  })

  it('keeps the paid result and the chosen window across leaving the section', async () => {
    const harness = setup()
    await look(harness)
    await harness.wrapper.get('#lookup-window').setValue('12')
    await analyse(harness)
    harness.wrapper.unmount()
    // The window's own state outlives the component, so coming back shows the
    // same answer and sends nothing.
    const again = mount(LookupView, { props: { lookup: harness.lookup, monitoring: harness.monitoring } })
    expect((again.get('#lookup-user').element as HTMLInputElement).value).toBe('alice')
    expect((again.get('#lookup-window').element as HTMLSelectElement).value).toBe('12')
    expect(again.text()).toContain('Alice Harbour')
    expect(again.find('[data-block="overview"]').exists()).toBe(true)
    await again.get('[data-action="result-tab-geography"]').trigger('click')
    expect(again.find('[data-block="where"]').exists()).toBe(true)
    expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
    expect(harness.lookupActivity).toHaveBeenCalledTimes(1)
  })

  it('forgets the result on Clear, and keeps the chosen window', async () => {
    const harness = setup()
    await look(harness)
    await harness.wrapper.get('#lookup-window').setValue('50')
    await analyse(harness)
    await harness.wrapper.get('[data-action="clear-lookup"]').trigger('click')
    expect(harness.wrapper.find('.profile-card').exists()).toBe(false)
    expect(harness.wrapper.find('[data-block]').exists()).toBe(false)
    expect(harness.wrapper.find('h2').exists()).toBe(false)
    expect((harness.wrapper.get('#lookup-user').element as HTMLInputElement).value).toBe('')
    expect(harness.wrapper.find('[data-action="clear-lookup"]').exists()).toBe(false)
    // Nothing was re-read to clear it: the result only ever lived in memory.
    expect(harness.lookupProfile).toHaveBeenCalledTimes(1)
    await look(harness, 'bob')
    expect((harness.wrapper.get('#lookup-window').element as HTMLSelectElement).value).toBe('50')
  })
})

describe('activity sample presentation', () => {
  it('preserves the complete direct presentation when no section is selected', () => {
    const wrapper = mount(LookupActivityComponent, { props: { activity: activity() } })
    expect(wrapper.findAll('[data-block]').map(node => node.attributes('data-block'))).toEqual(['where', 'places', 'when', 'hashtags', 'mentions', 'likes'])
    wrapper.unmount()
  })

  it('shows tied busiest hours and hashtags without inventing a single winner', () => {
    const sample = activity()
    sample.timeline.hour_of_day[20] = 2
    sample.hashtags = [{ key: 'harbour', count: 3 }, { key: 'ferry', count: 3 }]
    const wrapper = mount(LookupActivityComponent, { props: { activity: sample, section: 'overview' } })
    expect(wrapper.text()).toContain('#harbour, #ferry')
    expect(wrapper.text()).toContain('09:00 UTC, 20:00 UTC')
    wrapper.unmount()
  })
})
