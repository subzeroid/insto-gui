import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import LookupView from './LookupView.vue'
import type { DesktopClient } from '../desktop/client'
import { MIN_INTERVAL } from '../desktop/client'
import type { LookupActivity, LookupProfile, Overview, Watch } from '../desktop/dto'
import { createLookupState } from '../desktop/lookup'
import type { createMonitoringState } from '../desktop/monitoring'
import { DesktopFailure } from '../desktop/messages'
import { formatCount, localTime } from '../desktop/format'
import { overview as baseOverview, watch as baseWatch } from '../desktop/fixtures'
import { t } from '../i18n'

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
  timeline: { hour_of_day: hours, day_of_week: days, first_post_at: 1_769_000_000, last_post_at: 1_770_000_000 },
  hashtags: [{ key: 'harbour', count: 3 }], mentions: [{ key: 'atlas.ferry', count: 1 }],
  locations: [{ key: 'Ferry Terminal', count: 2 }, { key: 'Birch Yard', count: 1 }],
  likes: { total: 301, average: 100.4, top_posts: [{ code: 'fer01', like_count: 150 }] },
  quota_remaining: 4210, ...over,
})
const emptyActivity = () => activity({
  analyzed: 0,
  geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
  timeline: { hour_of_day: hours.map(() => 0), day_of_week: days.map(() => 0), first_post_at: null, last_post_at: null },
  hashtags: [], mentions: [], locations: [], likes: { total: 0, average: 0, top_posts: [] },
})

interface Options {
  lookupProfile?: (user: string) => Promise<LookupProfile>
  lookupActivity?: (pk: string, window: 12 | 30 | 50) => Promise<LookupActivity>
  watches?: Watch[]
  add?: (user: string, interval: number) => Promise<boolean>
  stale?: boolean
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
  const wrapper = mount(LookupView, { props: { lookup, monitoring } })
  return { wrapper, lookup, monitoring, monitoringState: state, lookupProfile, lookupActivity, add }
}
const look = async (harness: ReturnType<typeof setup>, name = 'alice') => {
  await harness.wrapper.get('#lookup-user').setValue(name)
  await harness.wrapper.get('form').trigger('submit')
  await flushPromises()
}
const analyse = async (harness: ReturnType<typeof setup>) => {
  await harness.wrapper.get('[data-action="analyse"]').trigger('click')
  await flushPromises()
}

describe('lookup section', () => {
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
    expect(second.wrapper.get('[role="status"]').text()).toBe(t('lookup.analysing'))
    finish(activity())
    await flushPromises()
    expect(second.wrapper.get('#lookup-user').attributes('disabled')).toBeUndefined()
  })

  it('shows every failure where the click was, and says when it may already have been charged', async () => {
    const codes = ['target_not_found', 'target_private', 'target_unavailable', 'provider_response_invalid',
      'rate_limited', 'quota_exhausted', 'network_error', 'operation_timeout', 'invalid_token', 'not_configured'] as const
    for (const code of codes) {
      const harness = setup({ lookupProfile: () => Promise.reject(new DesktopFailure(code)) })
      await look(harness)
      const alert = harness.wrapper.get('[role="alert"]')
      expect(alert.text()).toBe(new DesktopFailure(code).message)
      // In place, inside the card: the section renders no banner of its own.
      expect(alert.element.closest('.profile-card')).not.toBeNull()
      // The request left, so the money may already be gone.
      expect(harness.wrapper.text()).toContain(t('lookup.may_be_charged'))
      // A failure offers nothing to analyse and nothing to watch.
      expect(harness.wrapper.find('[data-action="analyse"]').exists()).toBe(false)
      expect(harness.wrapper.find('[data-action="watch"]').exists()).toBe(false)
      harness.wrapper.unmount()
    }
    // A name refused before any request is made is not charged for, and says so
    // by not claiming otherwise.
    const refused = setup()
    await look(refused, '@@')
    expect(refused.lookupProfile).not.toHaveBeenCalled()
    expect(refused.wrapper.get('[role="alert"]').text()).toBe(new DesktopFailure('invalid_lookup_input').message)
    expect(refused.wrapper.text()).not.toContain(t('lookup.may_be_charged'))

    // A failed analysis carries the same warning, beside its own message.
    const failed = setup({ lookupActivity: () => Promise.reject(new DesktopFailure('operation_timeout')) })
    await look(failed)
    await analyse(failed)
    expect(failed.wrapper.get('.lookup-analysis [role="alert"]').text()).toBe(new DesktopFailure('operation_timeout').message)
    expect(failed.wrapper.text()).toContain(t('lookup.may_be_charged'))
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
    const blocks = () => harness.wrapper.findAll('[data-block]').map(node => node.attributes('data-block'))
    expect(blocks()).toEqual(['where', 'when', 'hashtags', 'mentions', 'likes'])
    expect(harness.wrapper.text()).toContain(t('lookup.geotagged', { tagged: '3', analyzed: '3' }))
    expect(harness.wrapper.text()).toContain(t('lookup.anchor', { place: 'Ferry Terminal', count: '2' }))
    expect(harness.wrapper.text()).toContain(t('lookup.radius', { km: '1.2' }))
    expect(harness.wrapper.text()).toContain('52.3696, 4.8842')
    expect(harness.wrapper.findAll('[data-list="places"] dt').map(node => node.text()))
      .toEqual(['Ferry Terminal52.3739, 4.8903', 'Birch Yard52.3612, 4.8721'])
    expect(harness.wrapper.findAll('.bar-chart').length).toBe(2)
    expect(harness.wrapper.text()).toContain(t('lookup.first_post', { time: localTime(1_769_000_000) }))
    expect(harness.wrapper.text()).toContain('#harbour')
    expect(harness.wrapper.text()).toContain('@atlas.ferry')
    // The average is a count of likes, so it is shown as one.
    expect(harness.wrapper.text()).toContain(t('lookup.post_code', { code: 'fer01' }))
    expect(harness.wrapper.get('[data-block="likes"]').text()).toContain('100')
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
    expect(quiet.wrapper.findAll('[data-block]').map(node => node.attributes('data-block'))).toEqual(['when', 'likes'])
    expect(quiet.wrapper.get('[data-note="analyzed"]').text()).toBe(t('lookup.analyzed', { count: '30' }))
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
