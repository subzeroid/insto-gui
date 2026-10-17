import { describe, it, expect, vi } from 'vitest'
import { ResearchClient, createResearchState, compareChecks, forecastRequests, decodeUsage } from './workbench'
import { DesktopClient } from './client'
import { createMockInvoke } from './mock'

async function check(username = 'atlas.ferry', id = 'a'.repeat(32)) {
  const client = new DesktopClient(createMockInvoke({ lookupDelayMs: 0 }))
  const profile = await client.lookupProfile(username)
  const activity = await client.lookupActivity(profile.target_pk, 30)
  return { id, username, target_pk: profile.target_pk, captured_at: 1800000000, saved_at: 1800000001, profile, activity }
}

describe('saved research', () => {
  it('opens and compares saved data without invoking the provider', async () => {
    const left = await check(), right = await check('driftwood.studio', 'b'.repeat(32))
    const invoke = vi.fn().mockResolvedValue([left, right])
    const archive = createResearchState(new ResearchClient(invoke))
    await archive.refresh()
    expect(archive.state.items).toHaveLength(2)
    const result = compareChecks(left, right)
    expect(result.fields.find(field => field.field === 'username')).toBeDefined()
    expect(result.common.hashtags.length).toBeGreaterThan(0)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['research_list'])
  })
  it('keeps unknown profile fields distinct from known empty values', async () => {
    const left = await check(), right = await check()
    left.profile.unknown_fields.push('public_phone')
    delete left.profile.fields.public_phone
    right.profile.fields.public_phone = null
    const field = compareChecks(left, right).fields.find(row => row.field === 'public_phone')!
    expect(field.leftKnown).toBe(false)
    expect(field.rightKnown).toBe(true)
  })
  it('rejects a stored activity belonging to another account', async () => {
    const item = await check()
    item.activity.target_pk = '999'
    await expect(new ResearchClient(async () => [item]).list()).rejects.toMatchObject({ code: 'protocol' })
  })
  it('ignores an old profile list arriving after a profile switch', async () => {
    let resolve!: (value: unknown) => void
    const archive = createResearchState(new ResearchClient(() => new Promise(done => { resolve = done })))
    const pending = archive.refresh()
    archive.reset()
    resolve([await check()])
    await pending
    expect(archive.state.items).toEqual([])
    expect(archive.state.loaded).toBe(false)
  })
  it('reports persistence failure without discarding the current library', async () => {
    const item = await check()
    const invoke = vi.fn().mockResolvedValueOnce([item]).mockRejectedValueOnce('research_storage')
    const archive = createResearchState(new ResearchClient(invoke))
    await archive.refresh()
    await archive.remove(item.id)
    expect(archive.state.items).toHaveLength(1)
    expect(archive.state.error?.code).toBe('research_storage')
  })
})

describe('usage boundary', () => {
  it('validates UTC day/reset and daily limits without trusting arbitrary numbers', () => {
    const value = { day: '2026-10-13', used: 14, daily_limit: 100, reset_at: Date.UTC(2026, 9, 14) / 1000 }
    expect(decodeUsage(value)).toEqual(value)
    for (const patch of [{ used: -1 }, { daily_limit: 0 }, { daily_limit: 1.5 }, { reset_at: value.reset_at - 1 }, { day: '2026-02-31' }]) {
      expect(() => decodeUsage({ ...value, ...patch })).toThrow()
    }
  })
  it('forecasts only active intervals and scales with interval changes', () => {
    expect(forecastRequests([{ status: 'active', interval_seconds: 3600 }, { status: 'paused', interval_seconds: 300 }])).toBe(48)
    expect(forecastRequests([{ status: 'active', interval_seconds: 300 }])).toBe(576)
  })
})

it('rejects a heatmap whose marginal totals do not match the dated posts', async () => {
  const item = await check()
  const raw = structuredClone(item.activity)
  raw.timeline.weekday_hours = Array.from({ length: 7 }, () => Array(24).fill(0))
  const { decodeLookupActivity } = await import('./dto')
  expect(() => decodeLookupActivity(raw, raw.target_pk, raw.window)).toThrow()
})

it('accepts an exact joint weekday/hour distribution', async () => {
  const item = await check()
  const raw = structuredClone(item.activity)
  const remaining = [...raw.timeline.hour_of_day]
  raw.timeline.weekday_hours = raw.timeline.day_of_week.map(total => remaining.map((n, hour) => { const take = Math.min(total, n); total -= take; remaining[hour] -= take; return take }))
  const { decodeLookupActivity } = await import('./dto')
  expect(decodeLookupActivity(raw, raw.target_pk, raw.window).timeline.weekday_hours).toEqual(raw.timeline.weekday_hours)
})

it('restores a saved check without dispatching any paid request and clears its historical balance', async () => {
  const item = await check()
  const invoke = vi.fn()
  const { createLookupState } = await import('./lookup')
  const lookup = createLookupState(new DesktopClient(invoke))
  lookup.restore(item)
  expect(lookup.state.fromSaved).toBe(true)
  expect(lookup.state.profile.at).toBe(item.captured_at)
  expect(lookup.state.activity.value?.timeline).toEqual(item.activity.timeline)
  expect(lookup.state.profile.value?.quota_remaining).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})

it.each(['save', 'delete'])('a stale library read cannot undo a newer %s', async operation => {
  const old = await check(), fresh = await check('driftwood.studio', 'b'.repeat(32))
  let resolve!: (value: unknown) => void
  const invoke = vi.fn().mockResolvedValueOnce([old]).mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValueOnce(operation === 'save' ? fresh : true)
  const library = createResearchState(new ResearchClient(invoke))
  await library.refresh()
  const pending = library.refresh()
  if (operation === 'save') await library.save(fresh)
  else await library.remove(old.id)
  resolve([old]); await pending
  expect(library.state.items.map(item => item.id)).toEqual(operation === 'save' ? [fresh.id, old.id] : [])
})

it('requires a fresh profile before mixing new activity into a historical saved check', async () => {
  const item = await check()
  const invoke = vi.fn()
  const { createLookupState } = await import('./lookup')
  const lookup = createLookupState(new DesktopClient(invoke))
  lookup.restore(item)
  expect(await lookup.analyze(12)).toBe(false)
  expect(invoke).not.toHaveBeenCalled()
  expect(lookup.state.activity.value?.window).toBe(30)
  expect(lookup.state.profile.at).toBe(item.captured_at)
})
