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
    // The chosen window is a setting, not a result: it survives both `clear()`
    // and a new account, so the selector never jumps under the user.
    expect(lookup.state.activity.window).toBe(30)
    expect(lookupProfile.mock.calls).toEqual([['alice']])
  })

  it('canonicalizes the typed name and refuses one the core would reject', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookup = createLookupState(fake({ lookupProfile }))
    expect(await lookup.lookUp('@@Alice ')).toBe(true)
    expect(lookupProfile.mock.calls).toEqual([['alice']])
    expect(lookup.state.username).toBe('alice')
    // A name no canonicalization can rescue never reaches the bridge, so it
    // cannot be charged for. The rule is the client's, which is the core's:
    // a leading `@` and trailing space go, a leading space does not.
    expect(await lookup.lookUp('a b')).toBe(false)
    expect(lookup.state.username).toBe('a b')
    expect(await lookup.lookUp(' @alice')).toBe(false)
    expect(lookup.state.profile.error?.code).toBe('invalid_lookup_input')
    expect(lookup.state.profile.spent).toBe(false)
    expect(lookup.state.profile.value).toBeNull()
    expect(lookupProfile).toHaveBeenCalledTimes(1)
  })

  it('records the failure of each kind separately and never retries', async () => {
    const lookupProfile = vi.fn().mockRejectedValue(new DesktopFailure('target_not_found'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(await lookup.lookUp('ghost')).toBe(false)
    expect(lookup.state.profile.error?.code).toBe('target_not_found')
    expect(lookup.state.profile.loading).toBe(false)
    // The request went out, so it may already have been charged.
    expect(lookup.state.profile.spent).toBe(true)
    // No profile means no pk to analyse, so nothing is spent.
    expect(await lookup.analyze(12)).toBe(false)
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(lookupProfile).toHaveBeenCalledTimes(1)

    const failing = vi.fn().mockRejectedValue(new DesktopFailure('rate_limited'))
    const second = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('7')), lookupActivity: failing }))
    await second.lookUp('alice')
    expect(await second.analyze(50)).toBe(false)
    expect(second.state.activity.error?.code).toBe('rate_limited')
    expect(second.state.activity.spent).toBe(true)
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
    // is already certain never reaches the provider — and is never labelled as
    // possibly charged.
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(lookup.state.activity.error?.code).toBe('target_private')
    expect(lookup.state.activity.spent).toBe(false)
    expect(lookup.state.activity.value).toBeNull()
  })

  it('keeps the two kinds mutually exclusive: one paid request at a time', async () => {
    const pending = deferred<LookupProfile>()
    const lookupProfile = vi.fn().mockReturnValue(pending.promise)
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const running = lookup.lookUp('alice')
    expect(lookup.state.profile.loading).toBe(true)
    // A second click of either kind is ignored while a request is out: the host
    // admits one network read at a time, and a queued second one would sit for
    // up to seventy seconds.
    expect(await lookup.lookUp('alice')).toBe(false)
    expect(await lookup.analyze(12)).toBe(false)
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    expect(lookupActivity).not.toHaveBeenCalled()
    pending.settle(profile('7'))
    expect(await running).toBe(true)

    const slow = deferred<LookupActivity>()
    const analysing = vi.fn().mockReturnValue(slow.promise)
    const profiles = vi.fn().mockResolvedValue(profile('7'))
    const second = createLookupState(fake({ lookupProfile: profiles, lookupActivity: analysing }))
    await second.lookUp('alice')
    const analysis = second.analyze(50)
    // …and the other way round: looking up another account while an analysis is
    // still out is ignored, so two paid requests are never in flight together.
    expect(await second.analyze(12)).toBe(false)
    expect(await second.lookUp('bob')).toBe(false)
    expect(analysing).toHaveBeenCalledTimes(1)
    expect(profiles).toHaveBeenCalledTimes(1)
    expect(second.state.username).toBe('alice')
    slow.settle(activity('7', 50))
    expect(await analysis).toBe(true)
  })

  it('never leaves one account\'s analysis under another account\'s name', async () => {
    const lookupProfile = vi.fn()
      .mockResolvedValueOnce(profile('7'))
      .mockResolvedValueOnce(profile('8'))
    const lookupActivity = vi.fn().mockResolvedValue(activity('7', 30))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    await lookup.lookUp('alice')
    expect(await lookup.analyze(30)).toBe(true)
    expect(lookup.state.activity.value?.target_pk).toBe('7')
    expect(await lookup.lookUp('bob')).toBe(true)
    expect(lookup.state.username).toBe('bob')
    expect(lookup.state.profile.value?.target_pk).toBe('8')
    // Alice's analysis is gone the moment Bob's name is looked up.
    expect(lookup.state.activity.value).toBeNull()
    expect(lookup.state.activity.error).toBeNull()
    expect(lookup.state.activity.window).toBe(30)
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

  it('drops an analysis in flight when the section is cleared', async () => {
    const slow = deferred<LookupActivity>()
    const lookupActivity = vi.fn().mockReturnValue(slow.promise)
    const lookup = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('7')), lookupActivity }))
    await lookup.lookUp('alice')
    const analysis = lookup.analyze(50)
    lookup.clear()
    // Clearing releases the guard, so the next account can be looked up at once.
    expect(await lookup.lookUp('bob')).toBe(true)
    slow.settle(activity('7', 50))
    expect(await analysis).toBe(false)
    expect(lookup.state.activity.value).toBeNull()
    expect(lookup.state.activity.loading).toBe(false)
  })
})
