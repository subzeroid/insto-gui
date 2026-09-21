import { describe, expect, it, vi } from 'vitest'
import { createLookupState, DEFAULT_WINDOW } from './lookup'
import type { DesktopClient } from './client'
import { DesktopFailure } from './messages'
import type { LookupActivity, LookupProfile } from './dto'

const profile = (pk: string, access: 'public' | 'private' = 'public'): LookupProfile => ({
  target_pk: pk, access,
  fields: { username: 'alice', follower_count: 1200 },
  unknown_fields: [], quota_remaining: 4211,
})
const activity = (pk: string, window: 12 | 30 | 50): LookupActivity => ({
  target_pk: pk, window, analyzed: 0,
  geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
  timeline: { hour_of_day: Array.from({ length: 24 }, () => 0), day_of_week: Array.from({ length: 7 }, () => 0), first_post_at: null, last_post_at: null },
  hashtags: [], mentions: [], locations: [],
  likes: { total: 0, average: 0, top_posts: [] },
  quota_remaining: 4210,
})
// Only the two lookup calls are ever made, so a stub of those two is the whole
// client this module needs.
const fake = (parts: Partial<Pick<DesktopClient, 'lookupProfile' | 'lookupActivity'>>) => parts as unknown as DesktopClient
const deferred = <T>() => {
  let settle: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, fail) => { settle = resolve; reject = fail })
  return { promise, settle, reject }
}

describe('lookup state', () => {
  it('holds a profile and then an analysis, and forgets both on clear', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn().mockResolvedValue(activity('7', 30))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(lookup.state.activity.window).toBe(DEFAULT_WINDOW)
    expect(await lookup.lookUp('alice')).toBe(true)
    expect(lookup.state.username).toBe('alice')
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookup.state.profile.loading).toBe(false)
    expect(await lookup.analyze(30)).toBe(true)
    expect(lookup.state.activity.window).toBe(30)
    expect(lookup.state.activity.value?.window).toBe(30)
    expect(lookupActivity.mock.calls).toEqual([['7', 30]])
    // Results stay in memory: nothing is re-read and nothing is persisted.
    lookup.clear()
    expect(lookup.state.username).toBeNull()
    expect(lookup.state.profile.value).toBeNull()
    expect(lookup.state.activity.value).toBeNull()
    expect(lookup.state.activity.window).toBe(DEFAULT_WINDOW)
    expect(lookupProfile.mock.calls).toEqual([['alice']])
  })

  it('records the failure of each kind separately and never retries', async () => {
    const lookupProfile = vi.fn().mockRejectedValue(new DesktopFailure('target_not_found'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(await lookup.lookUp('ghost')).toBe(false)
    expect(lookup.state.profile.error?.code).toBe('target_not_found')
    expect(lookup.state.profile.loading).toBe(false)
    // No profile means no pk to analyse, so nothing is spent.
    expect(await lookup.analyze(12)).toBe(false)
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(lookupProfile).toHaveBeenCalledTimes(1)

    const failing = vi.fn().mockRejectedValue(new DesktopFailure('rate_limited'))
    const second = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('7')), lookupActivity: failing }))
    await second.lookUp('alice')
    expect(await second.analyze(50)).toBe(false)
    expect(second.state.activity.error?.code).toBe('rate_limited')
    // The profile is still readable; only the analysis failed.
    expect(second.state.profile.value?.target_pk).toBe('7')
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('refuses to pay for the analysis of a private account', async () => {
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('7', 'private')), lookupActivity }))
    await lookup.lookUp('closed.account')
    expect(lookup.state.profile.value?.access).toBe('private')
    expect(await lookup.analyze(50)).toBe(false)
    // The core cannot tell a private account from an empty one, so a refusal that
    // is already certain never reaches the provider.
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(lookup.state.activity.error?.code).toBe('target_private')
    expect(lookup.state.activity.value).toBeNull()
  })

  it('ignores a second click while a request of the same kind is in flight', async () => {
    const first = deferred<LookupProfile>()
    const lookupProfile = vi.fn().mockReturnValue(first.promise)
    const lookup = createLookupState(fake({ lookupProfile }))
    const pending = lookup.lookUp('alice')
    expect(lookup.state.profile.loading).toBe(true)
    expect(await lookup.lookUp('alice')).toBe(false)
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    first.settle(profile('7'))
    expect(await pending).toBe(true)

    const pendingActivity = deferred<LookupActivity>()
    const lookupActivity = vi.fn().mockReturnValue(pendingActivity.promise)
    const second = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('7')), lookupActivity }))
    await second.lookUp('alice')
    const running = second.analyze(50)
    expect(await second.analyze(12)).toBe(false)
    expect(lookupActivity).toHaveBeenCalledTimes(1)
    pendingActivity.settle(activity('7', 50))
    expect(await running).toBe(true)
  })

  it('never lands a late answer under another account', async () => {
    const slow = deferred<LookupProfile>()
    const lookupProfile = vi.fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(profile('8'))
    const lookup = createLookupState(fake({ lookupProfile }))
    const first = lookup.lookUp('alice')
    // The first request is still in flight; clearing drops it.
    lookup.clear()
    expect(await lookup.lookUp('bob')).toBe(true)
    expect(lookup.state.profile.value?.target_pk).toBe('8')
    slow.settle(profile('7'))
    expect(await first).toBe(false)
    expect(lookup.state.username).toBe('bob')
    expect(lookup.state.profile.value?.target_pk).toBe('8')

    // The same rule for a failure: a late error never overwrites the new state.
    const late = deferred<LookupProfile>()
    const second = createLookupState(fake({
      lookupProfile: vi.fn().mockReturnValueOnce(late.promise).mockResolvedValueOnce(profile('9')),
    }))
    const dropped = second.lookUp('alice')
    second.clear()
    await second.lookUp('carol')
    late.reject(new DesktopFailure('target_not_found'))
    expect(await dropped).toBe(false)
    expect(second.state.profile.error).toBeNull()
    expect(second.state.profile.value?.target_pk).toBe('9')
  })

  it('drops an analysis in flight when another account is looked up', async () => {
    const slow = deferred<LookupActivity>()
    const lookupActivity = vi.fn().mockReturnValue(slow.promise)
    const lookupProfile = vi.fn()
      .mockResolvedValueOnce(profile('7'))
      .mockResolvedValueOnce(profile('8'))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    await lookup.lookUp('alice')
    const analysis = lookup.analyze(50)
    expect(await lookup.lookUp('bob')).toBe(true)
    slow.settle(activity('7', 50))
    expect(await analysis).toBe(false)
    // Bob's pane must never show Alice's analysis.
    expect(lookup.state.activity.value).toBeNull()
    expect(lookup.state.activity.loading).toBe(false)
  })
})
