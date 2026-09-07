import { describe, expect, it } from 'vitest'
import { HOME_REASONS, RESPONSE_PATH_LIMIT, decodeBinding, decodeComparison, decodeHistoryPage, decodeHomeReport, decodeOverview, decodeServiceFacts, decodeWatch, decodeWatchPage, CHANGE_KINDS, SNAPSHOT_KINDS, TARGET_KINDS } from './dto'
import { messages } from './messages'
import { adoptedBinding, current, expandedPath, facts, foreign, homeAdoptable, homeCliOwned, homeInvalidConfig, homeMissing, homeNotPrivate, homeRejected, homeSchemaMismatch, homeUnsupportedBackend, ownBinding, serviceForeign, serviceNone, serviceNoneStopped, serviceOwnedCurrent, serviceOwnedOther, serviceRejected, unknownBinding, unregistered, wire } from './fixtures'

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
  it('decodes every service-inspection shape the core can return', () => {
    // R8 1-5, straight from `registration_facts`.
    expect(decodeServiceFacts(serviceNone)).toEqual({ registration: 'none', interpreter: null, interpreterExists: null, loaded: null, settings: null })
    expect(decodeServiceFacts(serviceNoneStopped).loaded).toBe(false)
    expect(decodeServiceFacts(serviceForeign).registration).toBe('unknown')
    // The wire and the decoded fixtures are two spellings of one shape.
    for (const [decoded, sent] of [[facts, serviceOwnedOther], [current, serviceOwnedCurrent], [unregistered, serviceNoneStopped], [foreign, serviceForeign]] as const) {
      expect(wire(decoded)).toEqual(sent)
      expect(decodeServiceFacts(sent)).toEqual(decoded)
    }
    // launchctl can be unreachable: `loaded` may be null for any registration.
    expect(decodeServiceFacts({ ...serviceOwnedOther, loaded: null }).loaded).toBeNull()
    expect(decodeServiceFacts({ ...serviceForeign, loaded: null }).loaded).toBeNull()
    // R8 6, plus the type and key rules.
    for (const bad of [
      ...serviceRejected,
      { ...serviceOwnedOther, registration: 'foreign' }, { ...serviceOwnedOther, interpreter: 'legacy' },
      { ...serviceOwnedOther, settings: 'unknown' }, { ...serviceOwnedOther, interpreter_exists: null },
      { ...serviceOwnedOther, interpreter_exists: 'yes' }, { ...serviceOwnedOther, python: '/usr/bin/python3' },
      { registration: 'owned' },
    ]) expect(() => decodeServiceFacts(bad)).toThrow(expect.objectContaining({ code: 'protocol' }))
  })
  it('decodes every home report the core can return', () => {
    // R8 7-12.
    expect(decodeHomeReport(homeAdoptable)).toEqual(homeAdoptable)
    expect(decodeHomeReport(homeMissing).reason).toBe('home_invalid')
    expect(decodeHomeReport(homeNotPrivate).registration).toBe('unknown')
    // An invalid configuration still names the backend it parsed …
    expect(decodeHomeReport(homeInvalidConfig).backend).toBe('hikerapi')
    // … and a readable one may name a backend outside the three known ones.
    expect(decodeHomeReport(homeUnsupportedBackend).backend).toBeNull()
    expect(decodeHomeReport({ ...homeUnsupportedBackend, backend: 'aiograpi' }).adoptable).toBe(false)
    expect(decodeHomeReport(homeSchemaMismatch).reason).toBe('schema_mismatch')
    expect(decodeHomeReport(homeCliOwned).adoptable).toBe(true)
    // A database that does not exist yet is still adoptable.
    expect(decodeHomeReport({ ...homeAdoptable, database: 'missing' }).adoptable).toBe(true)
    // Another desktop root's own profile: refused while looking otherwise fine.
    expect(decodeHomeReport({ ...homeAdoptable, adoptable: false, reason: 'home_invalid' }).adoptable).toBe(false)
    // R9: the core expands `~`, so a response path may exceed the 1024-byte
    // request bound. It must still be absolute, and the bound is bytes.
    expect(decodeHomeReport({ ...homeAdoptable, path: expandedPath }).path).toBe(expandedPath)
    expect(HOME_REASONS.every(reason => Object.hasOwn(messages, reason))).toBe(true)
    for (const bad of [
      ...homeRejected,
      { ...homeAdoptable, config: 'unreadable' }, { ...homeAdoptable, database: 'locked' },
      { ...homeAdoptable, process: 'zombie' }, { ...homeAdoptable, registration: 'theirs' },
      { ...homeAdoptable, reason: 'because' },
      { ...homeAdoptable, config: 'missing', backend: 'hikerapi' },  // missing never names a backend
      { ...homeAdoptable, registration: 'owned', interpreter: null },
      { ...homeAdoptable, registration: 'none', loaded: true, process: 'running' },
      { ...homeAdoptable, backend: 'fake' }, { ...homeAdoptable, database: 'schema_mismatch' },
      { ...homeAdoptable, path: 'relative/.insto' }, { ...homeAdoptable, path: '' },
      { ...homeAdoptable, path: '/a\0b' },
      { ...homeAdoptable, path: `/${'ä'.repeat(RESPONSE_PATH_LIMIT / 2)}` },  // 4097 bytes, 2049 characters
      { ...homeAdoptable, owner_uid: 501 },
    ]) expect(() => decodeHomeReport(bad)).toThrow(expect.objectContaining({ code: 'protocol' }))
  })
  it('decodes the binding report and pairs the home with the adopted state', () => {
    expect(decodeBinding(ownBinding)).toEqual({ state: 'own', home: null })
    expect(decodeBinding(adoptedBinding)).toEqual({ state: 'adopted', home: '/Users/x/.insto' })
    expect(decodeBinding(unknownBinding)).toEqual({ state: 'unknown', home: null })
    expect(decodeBinding({ state: 'adopted', home: expandedPath }).home).toBe(expandedPath)
    for (const bad of [
      { state: 'adopted', home: null },                 // adopted always names its home
      { state: 'own', home: '/Users/x/.insto' },        // and no other state ever does
      { state: 'unknown', home: '/Users/x/.insto' },
      { state: 'foreign', home: null }, { state: 'adopted', home: 'relative/.insto' },
      { state: 'adopted', home: '' }, { state: 'adopted', home: '/a\0b' },
      { state: 'adopted', home: `/${'ä'.repeat(RESPONSE_PATH_LIMIT / 2)}` },
      { state: 'own' }, { state: 'own', home: null, uid: 501 },
    ]) expect(() => decodeBinding(bad)).toThrow(expect.objectContaining({ code: 'protocol' }))
  })
  it('accepts a configured overview whose quota is not yet known', () => {
    // The two quota fields are written together (`new_state`), so an adopted home
    // reports both null until its next credential check. Both-or-neither is the
    // rule; the old `(quota !== null) !== configured` rejected every such overview.
    expect(decodeOverview({ ...overview, quota_remaining: null, quota_checked_at: null }).quota_remaining).toBeNull()
    expect(decodeOverview({ ...overview, quota_remaining: 0 }).quota_remaining).toBe(0)
    for (const bad of [
      { ...overview, quota_checked_at: null },
      { ...overview, configured: false, desired_service: null, watches: [], next_cursor: null, quota_checked_at: null },
    ]) expect(() => decodeOverview(bad)).toThrow(expect.objectContaining({ code: 'protocol' }))
  })
})
