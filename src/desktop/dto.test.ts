import { describe, expect, it } from 'vitest'
import { HOME_REASONS, LOOKUP_FIELDS, RESPONSE_PATH_LIMIT, decodeBinding, decodeComparison, decodeHistoryPage, decodeHomeReport, decodeLookupActivity, decodeLookupProfile, decodeOverview, decodeServiceFacts, decodeSnapshotFields, decodeWatch, decodeWatchPage, CHANGE_KINDS, SNAPSHOT_KINDS, TARGET_KINDS } from './dto'
import { ERROR_CODES } from './messages'
import { adoptedBinding, current, expandedPath, facts, foreign, homeAdoptable, homeCliOwned, homeInvalidConfig, homeMissing, homeNotPrivate, homeRejected, homeSchemaMismatch, homeUnsupportedBackend, ownBinding, serviceForeign, serviceNone, serviceNoneStopped, serviceOwnedCurrent, serviceOwnedOther, serviceRejected, unknownBinding, unregistered, wire } from './fixtures'

export const watch = { user: 'alice', status: 'active', interval_seconds: 300, last_ok: null, waiting_first_check: true, has_error: false, consecutive_errors: 0, revision: 'a'.repeat(64) }
export const overview = { configured: true, desired_service: 'running', service_state: 'unknown', quota_remaining: 8, quota_checked_at: 100, watches: [watch], next_cursor: null }
const snap = (id: string, pk: string, at: number) => ({ id, target_pk: pk, captured_at: at })
const page = (items: unknown[], cursor: string | null = null, scanned = items.length) => ({ items, next_cursor: cursor, scan_complete: cursor === null, scanned })
// Distinct names the `FIELD` pattern accepts — lowercase letters, no digits.
const names = (count: number) => Array.from({ length: count }, (_, index) => String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26)))

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
  it('accepts one snapshot\'s fields and refuses anything else', () => {
    // The example from the core's own documentation of `snapshots.read`.
    const example = {
      snapshot: { id: '4102', target_pk: '51884219307', captured_at: 1770000000 },
      fields: {
        username: 'atlas.ferry', full_name: 'Atlas Ferry', biography: 'Night ferries and harbour light.',
        external_url: null, is_verified: false, is_business: false, is_private: false,
        follower_count: 18507, following_count: 809, media_count: 423, avatar: 'a'.repeat(64), banner: null,
      },
      unknown_fields: [],
    }
    const decoded = decodeSnapshotFields(example)
    expect(decoded.fields.follower_count).toBe(18507)
    expect(decoded.fields.external_url).toBeNull()
    expect(decoded.snapshot.id).toBe('4102')
    // A tracked field with no data is named instead of carrying a value.
    const { username, ...rest } = example.fields
    expect(username).toBe('atlas.ferry')
    expect(decodeSnapshotFields({ ...example, fields: rest, unknown_fields: ['username'] }).unknown_fields).toEqual(['username'])
    expect(decodeSnapshotFields({ ...example, fields: {} , unknown_fields: [] }).fields).toEqual({})
    for (const bad of [
      { ...example, note: 'RAW' },                                             // an extra key
      { snapshot: example.snapshot, fields: example.fields },                   // a missing key
      { ...example, kind: 'snapshot_fields' },                                  // the envelope's kind is not in the data
      { ...example, fields: { ...example.fields, follower_count: 1.5 } },
      { ...example, fields: { ...example.fields, follower_count: -1 } },
      { ...example, fields: { ...example.fields, follower_count: 2 ** 53 } },
      { ...example, fields: { ...example.fields, follower_count: {} } },
      { ...example, fields: { ...example.fields, 'Follower Count': 1 } },
      { ...example, fields: [] },
      { ...example, unknown_fields: ['Full Name'] },
      { ...example, unknown_fields: ['username'] },                             // known and unknown at once
      { ...example, unknown_fields: {} },
      { ...example, snapshot: { id: '0', target_pk: '7', captured_at: 1 } },
      // `FIELD` matches `__proto__`; it must be refused as a duplicate rather than
      // silently swallowed by the prototype chain.
      { ...example, fields: JSON.parse('{"__proto__": 1}'), unknown_fields: ['__proto__'] },
      // The two collections are bounded at 64 entries each.
      { ...example, fields: Object.fromEntries(names(65).map(name => [name, 1])), unknown_fields: [] },
      { ...example, unknown_fields: names(65) },
    ]) expect(() => decodeSnapshotFields(bad)).toThrow()
    // Accepted, and an own property rather than a write into the prototype chain.
    const hostile = decodeSnapshotFields({ ...example, fields: JSON.parse('{"__proto__": "x"}'), unknown_fields: [] })
    expect(Object.hasOwn(hostile.fields, '__proto__')).toBe(true)
    expect(Object.keys(hostile.fields)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf({}).toString).toBeTypeOf('function')
    // Exactly 64 of each is still fine.
    expect(Object.keys(decodeSnapshotFields({ ...example, fields: Object.fromEntries(names(64).map(name => [name, 1])), unknown_fields: [] }).fields)).toHaveLength(64)
    expect(decodeSnapshotFields({ ...example, unknown_fields: names(64) }).unknown_fields).toHaveLength(64)
  })
  it('bounds change values and comparison identity', () => {
    // compare_snapshots data has no inner kind (the IPC envelope carries it); feed items do.
    const bare = { older: snap('1', '7', 1), newer: snap('2', '7', 2), changes: [{ field: 'follower_count', old: 1, new: 2 }, { field: 'biography', old: null, new: 'x' }], unknown_fields: [], posts: null }
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
    const feed = page([{ kind: 'incomplete', older: snap('2', '7', 2), newer: snap('3', '7', 3), changes: [], unknown_fields: ['full_name'], posts: null }, comparison, { kind: 'baseline', snapshot: snap('1', '7', 1) }])
    expect(decodeHistoryPage(feed, CHANGE_KINDS).items.map(item => item.kind)).toEqual(['incomplete', 'comparison', 'baseline'])
    expect(() => decodeHistoryPage(page([{ ...comparison, changes: [] }]), CHANGE_KINDS)).toThrow()
    expect(() => decodeHistoryPage(page([{ kind: 'diagnostic', snapshot: snap('1', '7', 1), code: 'history_identity_unknown' }]), CHANGE_KINDS)).toThrow()
  })
  it('decodes the posts published between two snapshots and lets them alone make a feed item', () => {
    const bare = { older: snap('1', '7', 1), newer: snap('2', '7', 2), changes: [], unknown_fields: [], posts: { added: ['3000000000000000002', '3000000000000000001'], window_full: false } }
    expect(decodeComparison(bare).posts).toEqual(bare.posts)
    expect(decodeComparison({ ...bare, posts: null }).posts).toBeNull()
    const full = Array.from({ length: 64 }, (_, index) => String(index + 1))
    expect(decodeComparison({ ...bare, posts: { added: full, window_full: true } }).posts?.added).toHaveLength(64)
    for (const posts of [
      { added: ['01'], window_full: false },           // not a canonical pk
      { added: ['1_2'], window_full: false },          // a media id, not a pk
      { added: [1], window_full: false },
      { added: ['2', '2'], window_full: false },       // repeated
      { added: [], window_full: true },                // a full window of nothing
      { added: ['2'], window_full: 'yes' },
      { added: ['2'] },
      { added: ['2'], window_full: false, removed: [] },
      { added: [...full, '65'], window_full: true },
      [],
    ]) expect(() => decodeComparison({ ...bare, posts }), JSON.stringify(posts)).toThrow()
    // A core that predates `posts` is refused, not read as "no new posts".
    const { posts: _posts, ...legacy } = bare
    expect(() => decodeComparison(legacy)).toThrow()
    // A new post alone makes a feed comparison; nothing at all still does not.
    expect(decodeHistoryPage(page([{ kind: 'comparison', ...bare }]), CHANGE_KINDS).items[0]).toMatchObject({ kind: 'comparison', changes: [], posts: bare.posts })
    for (const posts of [null, { added: [], window_full: false }]) expect(() => decodeHistoryPage(page([{ kind: 'comparison', ...bare, posts }]), CHANGE_KINDS)).toThrow()
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
    expect(HOME_REASONS.every(reason => (ERROR_CODES as readonly string[]).includes(reason))).toBe(true)
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
  it('accepts the live profile a lookup answers with and refuses anything else', () => {
    // The example from the core's own fake-backend test of `lookup.profile`.
    const example = {
      target_pk: '17841400000000001', access: 'public',
      fields: {
        username: 'alice', full_name: 'Alice Example', biography: 'bio line',
        external_url: 'https://example.test/alice', is_verified: true, is_business: false,
        is_private: false, follower_count: 1200, following_count: 300, media_count: 87,
        public_email: 'alice@example.test', public_phone: null, business_category: null,
      },
      unknown_fields: [] as string[], quota_remaining: 4211,
    }
    const decoded = decodeLookupProfile(example)
    expect(decoded.access).toBe('public')
    expect(decoded.fields.follower_count).toBe(1200)
    expect(decoded.fields.public_phone).toBeNull()
    expect(Object.keys(decoded.fields)).toEqual([...LOOKUP_FIELDS])
    // A live lookup never carries the stored avatar or banner hash.
    expect(Object.hasOwn(decoded.fields, 'avatar')).toBe(false)
    expect(decodeLookupProfile({ ...example, access: 'private' }).access).toBe('private')
    // A tracked field the provider cannot supply is named, never invented.
    const { business_category: _dropped, ...rest } = example.fields
    const sparse = decodeLookupProfile({ ...example, fields: rest, unknown_fields: ['business_category'] })
    expect(sparse.unknown_fields).toEqual(['business_category'])
    expect(Object.hasOwn(sparse.fields, 'business_category')).toBe(false)
    for (const bad of [
      { ...example, target_pk: '017841400000000001' }, { ...example, target_pk: '0' },
      { ...example, target_pk: 17841400000000001 }, { ...example, access: 'followed' },
      { ...example, access: null }, { ...example, quota_remaining: -1 },
      { ...example, quota_remaining: 1.5 },
      // A name is a value or an unknown, never both and never neither.
      { ...example, unknown_fields: ['username'] },
      { ...example, unknown_fields: ['pronouns'] },
      { ...example, fields: rest },
      { ...example, fields: rest, unknown_fields: ['business_category', 'business_category'] },
      { ...example, fields: { ...example.fields, avatar: null } },
      { ...example, unknown_fields: ['Business_Category'] },
      // Value typing per name: a text field may be absent, a flag and a count never.
      { ...example, fields: { ...example.fields, username: 7 } },
      { ...example, fields: { ...example.fields, is_verified: 'true' } },
      { ...example, fields: { ...example.fields, is_verified: null } },
      { ...example, fields: { ...example.fields, follower_count: null } },
      { ...example, fields: { ...example.fields, follower_count: -1 } },
      { ...example, fields: { ...example.fields, follower_count: 2 ** 53 } },
      // The core's own character bounds, measured in code points.
      { ...example, fields: { ...example.fields, biography: 'b'.repeat(2049) } },
      { ...example, fields: { ...example.fields, public_phone: '7'.repeat(65) } },
      { ...example, fields: { ...example.fields, username: '☃'.repeat(256) } },
      { ...example, secret: 'TOKEN_SENTINEL' },
    ]) expect(() => decodeLookupProfile(bad)).toThrow(expect.objectContaining({ code: 'protocol' }))
    // Exactly the bound is accepted, and it is characters, not UTF-16 units.
    expect(decodeLookupProfile({ ...example, fields: { ...example.fields, username: '☃'.repeat(255) } }).fields.username).toHaveLength(255)
  })
  it('accepts the activity a lookup answers with and refuses anything else', () => {
    // The example from the core's own fake-backend test of `lookup.activity`.
    const cafe = { name: 'Cafe Zero', lat: 52.37, lng: 4.89, count: 2 }
    const museum = { name: 'Museum', lat: 52.36, lng: 4.88, count: 1 }
    const example = {
      target_pk: '17841400000000001', window: 50, analyzed: 4,
      geo: {
        geotagged: 3, anchor: cafe, centroid: { lat: 52.36666666666667, lng: 4.886666666666667 },
        radius_km: 0.869, places: [cafe, museum],
      },
      timeline: {
        hour_of_day: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        day_of_week: [0, 1, 1, 1, 1, 0, 0], first_post_at: 1789468200, last_post_at: 1789727400,
      },
      hashtags: [{ key: 'ams', count: 2 }, { key: 'coffee', count: 2 }],
      mentions: [{ key: 'bob', count: 2 }],
      locations: [{ key: 'Cafe Zero', count: 2 }, { key: 'Museum', count: 1 }],
      likes: {
        total: 100, average: 25,
        top_posts: [{ code: 'code3', like_count: 40 }, { code: 'code1', like_count: 30 }, { code: 'code2', like_count: 20 }, { code: 'code0', like_count: 10 }],
      },
      quota_remaining: 4208,
    }
    const decoded = decodeLookupActivity(example, '17841400000000001', 50)
    expect(decoded.analyzed).toBe(4)
    expect(decoded.geo.anchor).toEqual(cafe)
    expect(decoded.geo.radius_km).toBe(0.869)
    expect(decoded.timeline.hour_of_day[10]).toBe(4)
    expect(decoded.likes.top_posts).toHaveLength(4)
    expect(decoded.locations[0].key).toBe('Cafe Zero')
    // An account with nothing to analyse answers the same shape.
    const empty = {
      ...example, target_pk: '7', window: 12, analyzed: 0,
      geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
      timeline: { hour_of_day: Array.from({ length: 24 }, () => 0), day_of_week: Array.from({ length: 7 }, () => 0), first_post_at: null, last_post_at: null },
      hashtags: [], mentions: [], locations: [],
      likes: { total: 0, average: 0, top_posts: [] }, quota_remaining: null,
    }
    expect(decodeLookupActivity(empty, '7', 12).geo.anchor).toBeNull()
    const geo = (over: Record<string, unknown>) => ({ ...example, geo: { ...example.geo, ...over } })
    const likes = (over: Record<string, unknown>) => ({ ...example, likes: { ...example.likes, ...over } })
    const time = (over: Record<string, unknown>) => ({ ...example, timeline: { ...example.timeline, ...over } })
    for (const bad of [
      // The pk and the window are echoed, so a different answer is refused.
      { ...example, target_pk: '7' }, { ...example, window: 30 }, { ...example, analyzed: 51 },
      { ...example, analyzed: -1 }, { ...example, kind: 'lookup_activity' },
      // Geotagged posts are a part of those inspected; the listed places are a
      // part of the geotagged ones, ordered by count descending.
      geo({ geotagged: 5 }), geo({ geotagged: 2 }),
      geo({ places: [museum, cafe] }),
      geo({ places: [{ ...cafe, count: 0 }], anchor: { ...cafe, count: 0 } }),
      geo({ anchor: null }), geo({ anchor: museum }), geo({ centroid: null }),
      geo({ radius_km: null }), geo({ radius_km: -1 }), geo({ radius_km: '0.869' }),
      geo({ anchor: { ...cafe, lat: 92 }, places: [{ ...cafe, lat: 92 }, museum] }),
      geo({ anchor: { ...cafe, lng: -181 }, places: [{ ...cafe, lng: -181 }, museum] }),
      geo({ places: Array.from({ length: 11 }, (_, index) => ({ name: `p${index}`, lat: 1, lng: 1, count: 1 })) }),
      geo({ anchor: { ...cafe, name: 'p'.repeat(121) } }),
      geo({ empty: false }),
      // Exactly 24 and exactly 7 buckets, counting the same posts.
      time({ hour_of_day: Array.from({ length: 23 }, () => 0) }),
      time({ day_of_week: [0, 1, 1, 1, 1, 0, 0, 0] }),
      time({ day_of_week: [0, 1, 1, 1, 0, 0, 0] }),
      time({ first_post_at: null }), time({ last_post_at: null }),
      time({ first_post_at: 1789727401 }), time({ last_post_at: 253402300800 }),
      // Counted terms: descending, ties by key ascending, never empty.
      { ...example, hashtags: [{ key: 'coffee', count: 2 }, { key: 'ams', count: 2 }] },
      { ...example, mentions: [{ key: 'bob', count: 0 }] },
      { ...example, mentions: [{ key: '', count: 2 }] },
      { ...example, mentions: [{ key: 'k'.repeat(121), count: 2 }] },
      { ...example, locations: Array.from({ length: 21 }, (_, index) => ({ key: `t${String(index).padStart(2, '0')}`, count: 1 })) },
      // The top-liked list is as long as the window, up to five.
      likes({ top_posts: example.likes.top_posts.slice(0, 3) }),
      likes({ top_posts: [{ code: 'code0', like_count: 10 }, { code: 'code3', like_count: 40 }, { code: 'code1', like_count: 30 }, { code: 'code2', like_count: 20 }] }),
      likes({ top_posts: example.likes.top_posts.map(post => ({ ...post, code: 'c'.repeat(65) })) }),
      likes({ average: -1 }), likes({ average: '25' }), likes({ total: -100 }),
    ]) expect(() => decodeLookupActivity(bad, '17841400000000001', 50)).toThrow(expect.objectContaining({ code: 'protocol' }))
    // The accepting side of the three bounds: exactly 120 characters of place
    // name and term key, exactly 64 of post code, measured in code points. An
    // off-by-one the other way would refuse an answer already paid for.
    const bounded = decodeLookupActivity({
      ...example,
      geo: { ...example.geo, anchor: { ...cafe, name: '☃'.repeat(120) }, places: [{ ...cafe, name: '☃'.repeat(120) }, museum] },
      mentions: [{ key: 'k'.repeat(120), count: 2 }],
      likes: { ...example.likes, top_posts: example.likes.top_posts.map(post => ({ ...post, code: 'c'.repeat(64) })) },
    }, '17841400000000001', 50)
    expect([...bounded.geo.places[0].name]).toHaveLength(120)
    expect(bounded.mentions[0].key).toHaveLength(120)
    expect(bounded.likes.top_posts[0].code).toHaveLength(64)
    // The two float ceilings the host applies, on both sides.
    expect(decodeLookupActivity(geo({ radius_km: 20100 }), '17841400000000001', 50).geo.radius_km).toBe(20100)
    expect(decodeLookupActivity(likes({ average: Number.MAX_SAFE_INTEGER }), '17841400000000001', 50).likes.average).toBe(Number.MAX_SAFE_INTEGER)
    for (const bad of [geo({ radius_km: 20100.001 }), likes({ average: Number.MAX_SAFE_INTEGER + 2 })]) {
      expect(() => decodeLookupActivity(bad, '17841400000000001', 50)).toThrow(expect.objectContaining({ code: 'protocol' }))
    }
    // Nothing inspected means nothing liked, and nowhere to have been.
    for (const bad of [
      { ...empty, likes: { ...empty.likes, total: 1 } },
      { ...empty, likes: { ...empty.likes, average: 1 } },
      { ...empty, likes: { ...empty.likes, top_posts: [{ code: 'c', like_count: 0 }] } },
      { ...empty, geo: { ...empty.geo, radius_km: 0 } },
      { ...empty, timeline: { ...empty.timeline, first_post_at: 1 } },
    ]) expect(() => decodeLookupActivity(bad, '7', 12)).toThrow(expect.objectContaining({ code: 'protocol' }))
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
