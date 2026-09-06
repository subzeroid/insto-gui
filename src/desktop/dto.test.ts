import { describe, expect, it } from 'vitest'
import { decodeComparison, decodeHistoryPage, decodeOverview, decodeWatch, decodeWatchPage, CHANGE_KINDS, SNAPSHOT_KINDS, TARGET_KINDS } from './dto'

export const watch = { user: 'alice', status: 'active', interval_seconds: 300, last_ok: null, waiting_first_check: true, has_error: false, consecutive_errors: 0, revision: 'a'.repeat(64) }
export const overview = { configured: true, desired_service: 'running', service_state: 'unknown', quota_remaining: 8, quota_checked_at: 100, watches: [watch], next_cursor: null }
const snap = (id: string, pk: string, at: number) => ({ id, target_pk: pk, captured_at: at })
const page = (items: unknown[], cursor: string | null = null, scanned = items.length) => ({ items, next_cursor: cursor, scan_complete: cursor === null, scanned })

describe('bridge decoders', () => {
  it('accepts canonical watches and overviews', () => {
    expect(decodeWatch(watch)).toEqual(watch)
    expect(decodeOverview(overview).watches).toHaveLength(1)
    expect(decodeOverview({ ...overview, configured: false, desired_service: null, quota_remaining: null, quota_checked_at: null, watches: [] }).configured).toBe(false)
    expect(decodeWatchPage({ items: [watch, { ...watch, user: 'bob' }], next_cursor: 'w1.Ym9i' }).next_cursor).toBe('w1.Ym9i')
  })
  it('rejects inconsistent or unsafe watch data', () => {
    for (const bad of [
      { ...watch, user: 'Alice' }, { ...watch, interval_seconds: 299 }, { ...watch, last_ok: 5 }, { ...watch, waiting_first_check: false },
      { ...watch, consecutive_errors: 2 ** 53 }, { ...watch, revision: 'zz' }, { ...watch, status: 'deleted' }, { ...watch, last_error: 'TOKEN_SENTINEL' },
    ]) expect(() => decodeWatch(bad)).toThrow(expect.objectContaining({ code: 'protocol' }))
    for (const bad of [
      { ...overview, service_state: 'healthy' }, { ...overview, quota_remaining: null }, { ...overview, configured: false },
      { ...overview, watches: [watch, watch] }, { ...overview, next_cursor: 'bad cursor' }, { ...overview, secret: 'x' },
    ]) expect(() => decodeOverview(bad)).toThrow(expect.objectContaining({ code: 'protocol' }))
  })
  it('validates history pages by kind, order and filter', () => {
    const targets = page([{ kind: 'target', target_pk: '8', snapshot: snap('3', '8', 3) }, { kind: 'target', target_pk: '7', snapshot: snap('2', '7', 2) }, { kind: 'diagnostic', snapshot: snap('1', '9', 1), code: 'history_identity_unknown' }])
    expect(decodeHistoryPage(targets, TARGET_KINDS).items).toHaveLength(3)
    expect(() => decodeHistoryPage({ ...targets, items: [targets.items[1], targets.items[0]] }, TARGET_KINDS)).toThrow()
    expect(() => decodeHistoryPage({ ...targets, scan_complete: false }, TARGET_KINDS)).toThrow()
    expect(() => decodeHistoryPage(targets, SNAPSHOT_KINDS)).toThrow()
    expect(() => decodeHistoryPage(page([{ kind: 'target', target_pk: '9', snapshot: snap('3', '8', 3) }]), TARGET_KINDS)).toThrow()
    const list = page([{ kind: 'snapshot', snapshot: snap('2', '7', 2) }], 'abc')
    expect(decodeHistoryPage(list, SNAPSHOT_KINDS, '7', 1).scan_complete).toBe(false)
    expect(() => decodeHistoryPage(list, SNAPSHOT_KINDS, '8')).toThrow()
    expect(() => decodeHistoryPage(list, SNAPSHOT_KINDS, '7', 0)).toThrow()
    expect(() => decodeHistoryPage(page([{ kind: 'snapshot', snapshot: snap('9223372036854775808', '7', 2) }]), SNAPSHOT_KINDS)).toThrow()
  })
  it('bounds change values and comparison identity', () => {
    // compare_snapshots data has no inner kind (the IPC envelope carries it); feed items do.
    const bare = { older: snap('1', '7', 1), newer: snap('2', '7', 2), changes: [{ field: 'follower_count', old: 1, new: 2 }, { field: 'biography', old: null, new: 'x' }], unknown_fields: [] }
    const comparison = { kind: 'comparison', ...bare }
    expect(decodeComparison(bare).changes).toHaveLength(2)
    expect(decodeComparison({ ...bare, changes: [], unknown_fields: ['full_name'] }).unknown_fields).toEqual(['full_name'])
    expect(decodeComparison({ ...bare, older: snap('1', '7', 2) }).older.id).toBe('1')
    for (const bad of [
      { ...bare, changes: [{ field: 'follower_count', old: 1.5, new: 2 }] },
      { ...bare, changes: [{ field: 'follower_count', old: -1, new: 2 }] },
      { ...bare, changes: [{ field: 'follower_count', old: 2 ** 53, new: 2 }] },
      { ...bare, changes: [{ field: 'follower_count', old: {}, new: 2 }] },
      { ...bare, changes: [{ field: 'Follower Count', old: 1, new: 2 }] },
      { ...bare, newer: snap('2', '8', 2) }, { ...bare, newer: snap('2', '7', 0) }, comparison, { ...bare, note: 'RAW' },
    ]) expect(() => decodeComparison(bad)).toThrow()
    const feed = page([{ kind: 'incomplete', older: snap('2', '7', 2), newer: snap('3', '7', 3), changes: [], unknown_fields: ['full_name'] }, comparison, { kind: 'baseline', snapshot: snap('1', '7', 1) }])
    expect(decodeHistoryPage(feed, CHANGE_KINDS).items.map(item => item.kind)).toEqual(['incomplete', 'comparison', 'baseline'])
    expect(() => decodeHistoryPage(page([{ ...comparison, changes: [] }]), CHANGE_KINDS)).toThrow()
    expect(() => decodeHistoryPage(page([{ kind: 'diagnostic', snapshot: snap('1', '7', 1), code: 'history_identity_unknown' }]), CHANGE_KINDS)).toThrow()
  })
})
