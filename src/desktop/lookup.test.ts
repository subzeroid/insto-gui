import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { createLookupState, DEFAULT_WINDOW } from './lookup'
import { DesktopClient } from './client'
import { createMockInvoke } from './mock'
import { DesktopFailure } from './messages'
import type { LookupActivity, LookupProfile } from './dto'
import type { SavedCheck } from './workbench'

const profile = (pk: string, access: 'public' | 'private' = 'public'): LookupProfile => ({
  target_pk: pk, access,
  fields: { username: 'alice', follower_count: 1200 },
  unknown_fields: [], quota_remaining: 4211,
})
const activity = (pk: string, window: 12 | 30 | 50): LookupActivity => ({
  target_pk: pk, window, analyzed: 0,
  geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
  timeline: { hour_of_day: Array.from({ length: 24 }, () => 0), day_of_week: Array.from({ length: 7 }, () => 0), weekday_hours: Array.from({ length: 7 }, () => Array(24).fill(0)), first_post_at: null, last_post_at: null },
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
const saved = (): SavedCheck => ({
  id: 'a'.repeat(32), username: 'alice', target_pk: '7',
  captured_at: 1800000000, saved_at: 1800000001,
  profile: profile('7'), activity: activity('7', 50),
})

describe('account checks', () => {
  it('retains one monotonic start through both composite stages and busy refusals', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    try {
      const pendingProfile = deferred<LookupProfile>()
      const pendingActivity = deferred<LookupActivity>()
      const lookup = createLookupState(fake({
        lookupProfile: vi.fn().mockReturnValue(pendingProfile.promise),
        lookupActivity: vi.fn().mockReturnValue(pendingActivity.promise),
      }))
      expect(lookup.state.startedAt).toBeNull()
      const running = lookup.check('alice', true)
      expect(lookup.state.startedAt).toBe(100)
      now.mockReturnValue(200)
      expect(await lookup.check('bob', false)).toBe(false)
      expect(await lookup.lookUp('bob')).toBe(false)
      expect(await lookup.analyze(12)).toBe(false)
      expect(lookup.state.startedAt).toBe(100)
      pendingProfile.settle(profile('7'))
      await vi.waitFor(() => expect(lookup.state.activity.loading).toBe(true))
      expect(lookup.state.startedAt).toBe(100)
      pendingActivity.settle(activity('7', 30))
      expect(await running).toBe(true)
      expect(lookup.state.startedAt).toBe(100)
      expect(await lookup.check('a b', false)).toBe(false)
      expect(await lookup.lookUp('a b')).toBe(false)
      expect(lookup.state.startedAt).toBe(100)
      lookup.clear()
      expect(lookup.state.startedAt).toBeNull()
    } finally {
      now.mockRestore()
    }
  })

  it('starts standalone analysis anew only after its public fresh-profile preflight', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    try {
      const lookup = createLookupState(fake({
        lookupProfile: vi.fn().mockResolvedValueOnce(profile('7')).mockResolvedValueOnce(profile('8', 'private')),
        lookupActivity: vi.fn().mockResolvedValue(activity('7', 30)),
      }))
      expect(await lookup.analyze(30)).toBe(false)
      expect(lookup.state.startedAt).toBeNull()
      expect(await lookup.lookUp('alice')).toBe(true)
      expect(lookup.state.startedAt).toBe(100)
      now.mockReturnValue(200)
      expect(await lookup.analyze(30)).toBe(true)
      expect(lookup.state.startedAt).toBe(200)
      now.mockReturnValue(300)
      expect(await lookup.lookUp('closed.account')).toBe(true)
      expect(lookup.state.startedAt).toBe(300)
      now.mockReturnValue(400)
      expect(await lookup.analyze(50)).toBe(false)
      expect(lookup.state.startedAt).toBe(300)
      expect(lookup.restore(saved())).toBe(true)
      expect(lookup.state.startedAt).toBeNull()
      expect(await lookup.analyze(50)).toBe(false)
      expect(lookup.state.startedAt).toBeNull()
    } finally {
      now.mockRestore()
    }
  })

  it.each(['check', 'lookUp', 'analyze'] as const)('does not dispatch %s if clear runs as its start time is published', async (operation) => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    try {
      const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
      const lookupActivity = vi.fn().mockResolvedValue(activity('7', 30))
      const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
      if (operation === 'analyze') await lookup.lookUp('alice')
      lookupProfile.mockClear()
      now.mockReturnValue(200)
      const stop = watch(() => lookup.state.startedAt, (startedAt) => {
        if (startedAt !== null) lookup.clear()
      }, { flush: 'sync' })
      const running = operation === 'check' ? lookup.check('alice', true)
        : operation === 'lookUp' ? lookup.lookUp('alice') : lookup.analyze(30)
      expect(await running).toBe(false)
      stop()
      expect(lookup.state.startedAt).toBeNull()
      expect(lookup.state.checking).toBe(false)
      expect(lookup.state.username).toBeNull()
      expect(lookup.state.profile.loading).toBe(false)
      expect(lookup.state.activity.loading).toBe(false)
      expect(lookupProfile).not.toHaveBeenCalled()
      expect(lookupActivity).not.toHaveBeenCalled()
      expect(await lookup.check('bob', false)).toBe(true)
    } finally {
      now.mockRestore()
    }
  })

  it('keeps the admitted check scope in window state through refusals and reset', async () => {
    const pending = deferred<LookupProfile>()
    const lookupProfile = vi.fn().mockReturnValue(pending.promise)
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(lookup.state.includeActivity).toBe(false)
    const running = lookup.check('alice', true)
    expect(lookup.state.includeActivity).toBe(true)
    expect(lookup.state.checking).toBe(true)
    expect(await lookup.check('bob', false)).toBe(false)
    expect(lookup.state.includeActivity).toBe(true)
    lookup.clear()
    expect(lookup.state.includeActivity).toBe(true)
    expect(lookup.restore(saved())).toBe(true)
    expect(lookup.state.includeActivity).toBe(true)
    pending.settle(profile('7'))
    expect(await running).toBe(false)
    expect(lookupActivity).not.toHaveBeenCalled()
    const next = lookup.check('bob', false)
    expect(lookup.state.includeActivity).toBe(false)
    expect(await next).toBe(true)
    expect(lookupProfile.mock.calls).toEqual([['alice'], ['bob']])
  })

  it('does not dispatch a check cleared while its scope is published', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const stop = watch(() => lookup.state.includeActivity, (includeActivity) => {
      if (includeActivity) lookup.clear()
    }, { flush: 'sync' })
    expect(await lookup.check('alice', true)).toBe(false)
    stop()
    expect(lookup.state.includeActivity).toBe(true)
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.username).toBeNull()
    expect(lookup.state.profile.loading).toBe(false)
    expect(lookupProfile).not.toHaveBeenCalled()
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(await lookup.check('bob', false)).toBe(true)
  })

  it('checks only a fresh profile when posts were not requested', async () => {
    const pending = deferred<LookupProfile>()
    const lookupProfile = vi.fn().mockReturnValue(pending.promise)
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(lookup.state.checking).toBe(false)
    const running = lookup.check(' @Alice ', false)
    expect(lookup.state.checking).toBe(true)
    expect(lookup.state.profile.loading).toBe(true)
    expect(lookup.state.activity.loading).toBe(false)
    pending.settle(profile('7'))
    expect(await running).toBe(true)
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookupProfile.mock.calls).toEqual([['alice']])
    expect(lookupActivity).not.toHaveBeenCalled()
  })

  it('checks the profile before requesting posts using the selected window', async () => {
    const pendingProfile = deferred<LookupProfile>()
    const pendingActivity = deferred<LookupActivity>()
    const lookupProfile = vi.fn().mockReturnValue(pendingProfile.promise)
    const lookupActivity = vi.fn().mockReturnValue(pendingActivity.promise)
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    lookup.state.activity.window = 50
    const running = lookup.check('alice', true)
    expect(lookupActivity).not.toHaveBeenCalled()
    pendingProfile.settle(profile('7'))
    await vi.waitFor(() => expect(lookup.state.activity.loading).toBe(true))
    expect(lookup.state.profile.loading).toBe(false)
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookup.state.checking).toBe(true)
    expect(lookupProfile.mock.calls).toEqual([['alice']])
    expect(lookupActivity.mock.calls).toEqual([['7', 50]])
    pendingActivity.settle(activity('7', 50))
    expect(await running).toBe(true)
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.activity.value?.window).toBe(50)
  })

  it('keeps paid answers when a check input is invalid', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn().mockResolvedValue(activity('7', 30))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    await lookup.lookUp('alice')
    await lookup.analyze(30)
    expect(await lookup.check('a b', true)).toBe(false)
    expect(lookup.state.inputError?.code).toBe('invalid_lookup_input')
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookup.state.activity.value?.target_pk).toBe('7')
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    expect(lookupActivity).toHaveBeenCalledTimes(1)
  })

  it('stops after a failed profile and records its charge status', async () => {
    const lookupProfile = vi.fn().mockRejectedValue(new DesktopFailure('not_configured'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(await lookup.check('alice', true)).toBe(false)
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.profile.error?.code).toBe('not_configured')
    expect(lookup.state.profile.spent).toBe(false)
    expect(lookup.state.activity.loading).toBe(false)
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    expect(lookupActivity).not.toHaveBeenCalled()
  })

  it('keeps the successful profile if posts fail and does not retry', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn().mockRejectedValue(new DesktopFailure('rate_limited'))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(await lookup.check('alice', true)).toBe(false)
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookup.state.profile.error).toBeNull()
    expect(lookup.state.activity.error?.code).toBe('rate_limited')
    expect(lookup.state.activity.spent).toBe(true)
    expect(lookup.state.activity.loading).toBe(false)
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    expect(lookupActivity).toHaveBeenCalledTimes(1)
  })

  it('finishes a private profile check without paying for posts', async () => {
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('7', 'private')), lookupActivity }))
    expect(await lookup.check('alice', true)).toBe(true)
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.profile.value?.access).toBe('private')
    expect(lookup.state.activity.error?.code).toBe('target_private')
    expect(lookup.state.activity.spent).toBe(false)
    expect(lookupActivity).not.toHaveBeenCalled()
  })

  it('refuses every competing call throughout both stages and their boundary', async () => {
    const pendingProfile = deferred<LookupProfile>()
    const pendingActivity = deferred<LookupActivity>()
    const lookupProfile = vi.fn().mockReturnValue(pendingProfile.promise)
    const lookupActivity = vi.fn().mockReturnValue(pendingActivity.promise)
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const running = lookup.check('alice', true)
    const refused = async () => {
      expect(await lookup.check('bob', false)).toBe(false)
      expect(await lookup.lookUp('bob')).toBe(false)
      expect(await lookup.analyze(12)).toBe(false)
      expect(lookup.restore(saved())).toBe(false)
      expect(lookup.state.username).toBe('alice')
    }
    await refused()
    const boundary: Promise<boolean>[] = []
    let restored: boolean | undefined
    const stop = watch(() => lookup.state.profile.loading, (loading) => {
      if (loading) return
      boundary.push(lookup.check('bob', false), lookup.lookUp('bob'), lookup.analyze(12))
      restored = lookup.restore(saved())
    }, { flush: 'sync' })
    pendingProfile.settle(profile('7'))
    await vi.waitFor(() => expect(lookup.state.activity.loading).toBe(true))
    stop()
    expect(await Promise.all(boundary)).toEqual([false, false, false])
    expect(restored).toBe(false)
    await refused()
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    expect(lookupActivity.mock.calls).toEqual([['7', 30]])
    pendingActivity.settle(activity('7', 30))
    expect(await running).toBe(true)
  })

  it('refuses a composite check while either existing request kind is active', async () => {
    const pendingProfile = deferred<LookupProfile>()
    const pendingActivity = deferred<LookupActivity>()
    const lookupProfile = vi.fn().mockReturnValue(pendingProfile.promise)
    const lookupActivity = vi.fn().mockReturnValue(pendingActivity.promise)
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const reading = lookup.lookUp('alice')
    expect(await lookup.check('bob', true)).toBe(false)
    pendingProfile.settle(profile('7'))
    await reading
    const analyzing = lookup.analyze(12)
    expect(await lookup.check('bob', false)).toBe(false)
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    expect(lookupActivity).toHaveBeenCalledTimes(1)
    pendingActivity.settle(activity('7', 12))
    await analyzing
  })

  it('does not schedule posts when clear happens between stages', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const stop = watch(() => lookup.state.profile.loading, (loading) => {
      if (!loading) lookup.clear()
    }, { flush: 'sync' })
    expect(await lookup.check('alice', true)).toBe(false)
    stop()
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.username).toBeNull()
    expect(lookup.state.profile.value).toBeNull()
    expect(lookup.state.activity.value).toBeNull()
    expect(lookupActivity).not.toHaveBeenCalled()
  })

  it('keeps a check empty if it is cleared as its busy state starts', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const stop = watch(() => lookup.state.checking, (checking) => {
      if (checking) lookup.clear()
    }, { flush: 'sync' })
    expect(await lookup.check('alice', true)).toBe(false)
    stop()
    expect(lookup.state.username).toBeNull()
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.profile.loading).toBe(false)
    expect(lookup.state.profile.spent).toBe(false)
    expect(lookupProfile).not.toHaveBeenCalled()
    expect(lookupActivity).not.toHaveBeenCalled()
  })

  it.each(['username', 'fromSaved'] as const)('does not continue startup after a reset on %s', async (field) => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('8'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    if (field === 'fromSaved') lookup.restore(saved())
    const stop = watch(() => lookup.state[field], (value) => {
      if (field === 'username' ? value !== null : value === false) lookup.clear()
    }, { flush: 'sync' })
    expect(await lookup.check('alice', true)).toBe(false)
    stop()
    expect(lookup.state.username).toBeNull()
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.fromSaved).toBe(false)
    expect(lookup.state.profile.loading).toBe(false)
    expect(lookup.state.profile.spent).toBe(false)
    expect(lookup.state.activity.loading).toBe(false)
    expect(lookup.state.activity.spent).toBe(false)
    expect(lookupProfile).not.toHaveBeenCalled()
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(await lookup.check('bob', false)).toBe(true)
    expect(lookupProfile.mock.calls).toEqual([['bob']])
  })

  it('admits a check before reactive input normalization can start another paid request', async () => {
    const pending = deferred<LookupProfile>()
    const lookupProfile = vi.fn().mockReturnValue(pending.promise)
    const lookup = createLookupState(fake({ lookupProfile }))
    expect(await lookup.check('a b', false)).toBe(false)
    let nested: Promise<boolean> | undefined
    const stop = watch(() => lookup.state.inputError, (error) => {
      if (error === null) nested = lookup.check('bob', false)
    }, { flush: 'sync' })
    const running = lookup.check('alice', false)
    stop()
    expect(lookupProfile.mock.calls).toEqual([['alice']])
    expect(await nested).toBe(false)
    pending.settle(profile('7'))
    expect(await running).toBe(true)
    expect(lookup.state.username).toBe('alice')
    expect(lookup.state.checking).toBe(false)
  })

  it('refuses new checks while clear is still publishing its reset state', async () => {
    const lookupProfile = vi.fn().mockResolvedValueOnce(profile('7')).mockResolvedValueOnce(profile('8'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    let nested: Promise<boolean> | undefined
    const stopProfile = watch(() => lookup.state.profile.loading, (loading) => {
      if (!loading && lookup.state.username === 'alice') lookup.clear()
    }, { flush: 'sync' })
    const stopChecking = watch(() => lookup.state.checking, (checking) => {
      if (!checking) nested = lookup.check('bob', false)
    }, { flush: 'sync' })
    expect(await lookup.check('alice', true)).toBe(false)
    stopProfile()
    stopChecking()
    expect(await nested).toBe(false)
    expect(lookupProfile.mock.calls).toEqual([['alice']])
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(lookup.state.username).toBeNull()
    expect(lookup.state.profile.value).toBeNull()
    expect(lookup.state.profile.loading).toBe(false)
    expect(lookup.state.checking).toBe(false)
    expect(await lookup.check('bob', false)).toBe(true)
    expect(lookup.state.username).toBe('bob')
    expect(lookup.state.profile.value?.target_pk).toBe('8')
  })

  it('does not write more profile data when clear runs as its answer lands', async () => {
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('7')), lookupActivity }))
    const stop = watch(() => lookup.state.profile.value, (value) => {
      if (value !== null) lookup.clear()
    }, { flush: 'sync' })
    expect(await lookup.check('alice', true)).toBe(false)
    stop()
    expect(lookup.state.profile.at).toBeNull()
    expect(lookup.state.profile.value).toBeNull()
    expect(lookup.state.checking).toBe(false)
    expect(lookupActivity).not.toHaveBeenCalled()
  })

  it.each(['profile', 'activity'] as const)('keeps reset state empty when clearing on a %s failure', async (stage) => {
    const lookupProfile = stage === 'profile'
      ? vi.fn().mockRejectedValue(new DesktopFailure('rate_limited'))
      : vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn().mockRejectedValue(new DesktopFailure('rate_limited'))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const stop = watch(() => lookup.state[stage].error, (error) => {
      if (error !== null) lookup.clear()
    }, { flush: 'sync' })
    expect(await lookup.check('alice', true)).toBe(false)
    stop()
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.username).toBeNull()
    expect(lookup.state[stage].error).toBeNull()
    expect(lookup.state[stage].spent).toBe(false)
    expect(lookup.state[stage].loading).toBe(false)
  })

  it('ignores an activity answer after clear and restore', async () => {
    const pendingActivity = deferred<LookupActivity>()
    const lookupActivity = vi.fn().mockReturnValue(pendingActivity.promise)
    const lookup = createLookupState(fake({ lookupProfile: vi.fn().mockResolvedValue(profile('8')), lookupActivity }))
    const running = lookup.check('bob', true)
    await vi.waitFor(() => expect(lookup.state.activity.loading).toBe(true))
    lookup.clear()
    expect(lookup.state.checking).toBe(false)
    expect(lookup.state.profile.loading).toBe(false)
    expect(lookup.state.activity.loading).toBe(false)
    expect(lookup.restore(saved())).toBe(true)
    pendingActivity.settle(activity('8', 30))
    expect(await running).toBe(false)
    expect(lookup.state.fromSaved).toBe(true)
    expect(lookup.state.username).toBe('alice')
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookup.state.activity.value?.target_pk).toBe('7')
    expect(lookup.state.activity.error).toBeNull()
    expect(lookupActivity).toHaveBeenCalledTimes(1)
  })

  it.each(['success', 'failure'] as const)('does not unlock a newer check after a stale profile %s', async (outcome) => {
    const oldProfile = deferred<LookupProfile>()
    const newProfile = deferred<LookupProfile>()
    const lookupProfile = vi.fn().mockReturnValueOnce(oldProfile.promise).mockReturnValueOnce(newProfile.promise)
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const old = lookup.check('alice', true)
    lookup.clear()
    const current = lookup.check('bob', false)
    if (outcome === 'success') oldProfile.settle(profile('7'))
    else oldProfile.reject(new DesktopFailure('target_not_found'))
    expect(await old).toBe(false)
    expect(lookup.state.checking).toBe(true)
    expect(lookup.state.profile.loading).toBe(true)
    expect(lookup.state.profile.value).toBeNull()
    expect(lookup.state.profile.error).toBeNull()
    expect(await lookup.check('carol', true)).toBe(false)
    expect(await lookup.lookUp('carol')).toBe(false)
    expect(lookupActivity).not.toHaveBeenCalled()
    newProfile.settle(profile('8'))
    expect(await current).toBe(true)
    expect(lookup.state.username).toBe('bob')
    expect(lookup.state.profile.value?.target_pk).toBe('8')
    expect(lookup.state.checking).toBe(false)
  })

  it.each(['success', 'failure'] as const)('does not unlock a newer check after a stale activity %s', async (outcome) => {
    const oldActivity = deferred<LookupActivity>()
    const newProfile = deferred<LookupProfile>()
    const lookupProfile = vi.fn().mockResolvedValueOnce(profile('7')).mockReturnValueOnce(newProfile.promise)
    const lookupActivity = vi.fn().mockReturnValue(oldActivity.promise)
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    const old = lookup.check('alice', true)
    await vi.waitFor(() => expect(lookup.state.activity.loading).toBe(true))
    lookup.clear()
    const current = lookup.check('bob', false)
    if (outcome === 'success') oldActivity.settle(activity('7', 30))
    else oldActivity.reject(new DesktopFailure('rate_limited'))
    expect(await old).toBe(false)
    expect(lookup.state.checking).toBe(true)
    expect(lookup.state.profile.loading).toBe(true)
    expect(lookup.state.activity.value).toBeNull()
    expect(lookup.state.activity.error).toBeNull()
    expect(await lookup.check('carol', true)).toBe(false)
    expect(lookupActivity).toHaveBeenCalledTimes(1)
    newProfile.settle(profile('8'))
    expect(await current).toBe(true)
    expect(lookup.state.profile.value?.target_pk).toBe('8')
    expect(lookup.state.checking).toBe(false)
  })

  it('refreshes a saved profile explicitly before paying for new posts', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('8'))
    const lookupActivity = vi.fn().mockResolvedValue(activity('8', 50))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(lookup.restore(saved())).toBe(true)
    expect(await lookup.analyze(50)).toBe(false)
    expect(lookupProfile).not.toHaveBeenCalled()
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(await lookup.check('alice', true)).toBe(true)
    expect(lookup.state.fromSaved).toBe(false)
    expect(lookupProfile.mock.calls).toEqual([['alice']])
    expect(lookupActivity.mock.calls).toEqual([['8', 50]])
    expect(lookup.state.activity.value?.target_pk).toBe('8')
  })

  it('refuses new checks throughout restore publication and admits them afterward', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('8'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    let nested: Promise<boolean> | undefined
    const stop = watch(() => lookup.state.fromSaved, (fromSaved) => {
      if (fromSaved) nested = lookup.check('bob', false)
    }, { flush: 'sync' })
    expect(lookup.restore(saved())).toBe(true)
    stop()
    expect(await nested).toBe(false)
    expect(lookupProfile).not.toHaveBeenCalled()
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(lookup.state.fromSaved).toBe(true)
    expect(lookup.state.username).toBe('alice')
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookup.state.activity.value?.target_pk).toBe('7')
    expect(await lookup.check('bob', false)).toBe(true)
    expect(lookupProfile.mock.calls).toEqual([['bob']])
    expect(lookup.state.fromSaved).toBe(false)
    expect(lookup.state.username).toBe('bob')
    expect(lookup.state.profile.value?.target_pk).toBe('8')
  })

  it.each(['inputError', 'fromSaved', 'username', 'profile', 'activity'] as const)('does not restore more saved data after clear on %s', async (field) => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('8'))
    const lookupActivity = vi.fn()
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    if (field === 'inputError') await lookup.check('a b', false)
    const stop = watch(() => {
      if (field === 'profile' || field === 'activity') return lookup.state[field].value
      return lookup.state[field]
    }, (value) => {
      if (field === 'inputError' ? value === null : value) lookup.clear()
    }, { flush: 'sync' })
    expect(lookup.restore(saved())).toBe(false)
    stop()
    expect(lookup.state.fromSaved).toBe(false)
    expect(lookup.state.username).toBeNull()
    expect(lookup.state.profile.value).toBeNull()
    expect(lookup.state.profile.at).toBeNull()
    expect(lookup.state.activity.value).toBeNull()
    expect(lookup.state.checking).toBe(false)
    expect(await lookup.analyze(50)).toBe(false)
    expect(lookupProfile).not.toHaveBeenCalled()
    expect(lookupActivity).not.toHaveBeenCalled()
    expect(await lookup.check('bob', false)).toBe(true)
    expect(lookup.state.username).toBe('bob')
  })
})

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

  it('canonicalizes the typed name, whatever a paste brought with it', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookup = createLookupState(fake({ lookupProfile }))
    expect(await lookup.lookUp('@@Alice ')).toBe(true)
    expect(await lookup.lookUp(' @Alice ')).toBe(true)
    expect(lookupProfile.mock.calls).toEqual([['alice'], ['alice']])
    expect(lookup.state.username).toBe('alice')
    expect(lookup.state.inputError).toBeNull()
  })

  it('refuses a name it cannot rescue without throwing away the answer already paid for', async () => {
    const lookupProfile = vi.fn().mockResolvedValue(profile('7'))
    const lookupActivity = vi.fn().mockResolvedValue(activity('7', 30))
    const lookup = createLookupState(fake({ lookupProfile, lookupActivity }))
    expect(await lookup.lookUp('alice')).toBe(true)
    expect(await lookup.analyze(30)).toBe(true)
    // A typo costs nothing, and it must not cost the user what they bought: the
    // refusal belongs to the field, not to the account on screen.
    expect(await lookup.lookUp('a b')).toBe(false)
    expect(lookup.state.inputError?.code).toBe('invalid_lookup_input')
    expect(lookup.state.username).toBe('alice')
    expect(lookup.state.profile.value?.target_pk).toBe('7')
    expect(lookup.state.profile.error).toBeNull()
    expect(lookup.state.activity.value?.target_pk).toBe('7')
    // Nothing reached the bridge, so nothing could have been charged.
    expect(lookupProfile).toHaveBeenCalledTimes(1)
    // The next name that can be looked up takes the refusal with it.
    expect(await lookup.lookUp('bob')).toBe(true)
    expect(lookup.state.inputError).toBeNull()
    lookup.clear()
    expect(await lookup.lookUp('')).toBe(false)
    expect(lookup.state.inputError?.code).toBe('invalid_lookup_input')
    lookup.clear()
    expect(lookup.state.inputError).toBeNull()
  })

  it('decides from the failure itself whether a lookup can have been charged', async () => {
    // A code that proves the request never left this Mac clears `spent`; every
    // other one leaves it set, which is the safe side of the question.
    const free = ['not_configured', 'invalid_lookup_input', 'busy', 'closed', 'launcher',
      'runtime_manifest', 'runtime_handshake', 'home_invalid', 'home_backend_unsupported',
      'profile_ownership', 'invalid_params', 'unsupported_platform',
      // Parameter validation and the profile's admission control: refused before
      // a process is spawned, exactly like `busy`.
      'invalid_token_input', 'invalid_watch_input', 'invalid_history_input',
      'invalid_home_input', 'profile_busy'] as const
    const charged = ['transport', 'operation_timeout', 'protocol', 'outcome_unknown', 'invalid_token',
      'quota_exhausted', 'rate_limited', 'network_error', 'access_unconfirmed', 'target_not_found',
      'target_unavailable', 'provider_response_invalid'] as const
    for (const code of [...free, ...charged]) {
      const expected = !(free as readonly string[]).includes(code)
      const lookup = createLookupState(fake({
        lookupProfile: vi.fn().mockRejectedValue(new DesktopFailure(code)),
        lookupActivity: vi.fn().mockRejectedValue(new DesktopFailure(code)),
      }))
      expect(await lookup.lookUp('alice')).toBe(false)
      expect(lookup.state.profile.error?.code, code).toBe(code)
      expect(lookup.state.profile.spent, code).toBe(expected)

      const analysing = createLookupState(fake({
        lookupProfile: vi.fn().mockResolvedValue(profile('7')),
        lookupActivity: vi.fn().mockRejectedValue(new DesktopFailure(code)),
      }))
      await analysing.lookUp('alice')
      expect(await analysing.analyze(12)).toBe(false)
      expect(analysing.state.activity.spent, code).toBe(expected)
    }
  })

  it('does not claim a charge for the mock bridge refusing an unconfigured profile', async () => {
    // The end-to-end shape of a free failure: no token connected, so the core
    // refuses before it builds a provider client.
    const client = new DesktopClient(createMockInvoke({ setup: true, lookupDelayMs: 0 }))
    const lookup = createLookupState(client)
    expect(await lookup.lookUp('atlas.ferry')).toBe(false)
    expect(lookup.state.profile.error?.code).toBe('not_configured')
    expect(lookup.state.profile.spent).toBe(false)
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
