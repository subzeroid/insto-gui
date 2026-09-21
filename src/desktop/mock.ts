/**
 * Dev-only stand-in for the Tauri bridge, so the desktop UI can be opened in a
 * plain browser (`?mock=1`) for UI work and screenshots without the Rust host,
 * the staged runtime or a HikerAPI token.
 *
 * Every payload below is written in the wire shape `dto.ts` decodes — the mock is
 * useless as a screenshot source the moment it answers something the real client
 * would refuse, so `mock.test.ts` boots it through `DesktopClient` and reads each
 * section. The accounts, identifiers and hashes are invented; nothing here comes
 * from a real profile, a real credential or a real filesystem.
 */
import { CORE_VERSION, type Invoke, type Profile } from './client'
import { LOOKUP_FIELDS, LOOKUP_WINDOWS, itemSnapshot, type Change, type ChangeValue, type Comparison, type HistoryItem, type HomeReport, type LookupWindow, type Overview, type Snapshot, type Watch, type WatchStatus } from './dto'
import { DesktopFailure } from './messages'

const envelope = (kind: string, data: unknown) => ({ kind, data })

// A small deterministic hex source: revisions, build ids and avatar hashes have
// to look like the real thing and stay identical between runs, so a screenshot
// taken twice is the same picture.
function hex(seed: string, length: number): string {
  let state = 2166136261 >>> 0
  for (let index = 0; index < seed.length; index++) state = Math.imul(state ^ seed.charCodeAt(index), 16777619) >>> 0
  let out = ''
  while (out.length < length) {
    state = Math.imul(state ^ (out.length + 0x9e37), 16777619) >>> 0
    out += state.toString(16).padStart(8, '0')
  }
  return out.slice(0, length)
}

const HOUR = 3600
const DAY = 24 * HOUR
// A fixed instant the demo history is written against, so every run renders the
// same dates. 2026-03-09, in UTC.
const NOW = 1_773_216_000

interface DemoStep {
  /** Seconds before `NOW` this snapshot was captured. */
  ago: number
  /** What the previous snapshot compares to; ignored for the first (baseline) step. */
  changes: Change[]
  /** Fields the older snapshot carried no data for — these make an `incomplete` item. */
  unknown?: string[]
}
type Fields = Record<string, ChangeValue>
interface DemoAccount {
  user: string
  pk: string
  status: WatchStatus
  interval: number
  errors: number
  /** The absolute tracked values of the first snapshot; later ones apply the steps. */
  profile: Fields
  steps: DemoStep[]
}

// Six invented accounts: three active (the core's cap), three paused, one of the
// active ones failing its checks and one registration that has never been checked.
const ACCOUNTS: DemoAccount[] = [
  {
    user: 'atlas.ferry', pk: '51884219307', status: 'active', interval: 900, errors: 0,
    profile: {
      username: 'atlas.ferry', full_name: 'Atlas Ferry', biography: 'Night ferries and harbour light.',
      external_url: null, is_verified: false, is_business: false, is_private: false,
      follower_count: 18_204, following_count: 812, media_count: 418,
      avatar: hex('atlas-avatar-before', 16), banner: null,
    },
    steps: [
      { ago: 6 * DAY, changes: [] },
      { ago: 4 * DAY + 3 * HOUR, changes: [
        { field: 'follower_count', old: 18_204, new: 18_431 },
        { field: 'media_count', old: 418, new: 420 },
      ] },
      { ago: 2 * DAY + 5 * HOUR, changes: [
        { field: 'follower_count', old: 18_431, new: 18_392 },
        { field: 'following_count', old: 812, new: 806 },
        { field: 'biography', old: 'Night ferries and harbour light.', new: 'Night ferries, harbour light, slow film.' },
      ] },
      { ago: 2 * HOUR + 12 * 60, changes: [
        { field: 'follower_count', old: 18_392, new: 18_507 },
        { field: 'following_count', old: 806, new: 809 },
        { field: 'media_count', old: 420, new: 423 },
        { field: 'avatar', old: hex('atlas-avatar-before', 16), new: hex('atlas-avatar-after', 16) },
        { field: 'external_url', old: null, new: 'https://example.com/atlas-ferry' },
      ] },
    ],
  },
  {
    user: 'birchwood.press', pk: '42007731885', status: 'active', interval: 1800, errors: 2,
    profile: {
      username: 'birchwood.press', full_name: 'Birchwood Press', biography: 'A small press: zines and risographs.',
      external_url: 'https://example.com/birchwood', is_verified: false, is_business: false, is_private: false,
      follower_count: 5_602, following_count: 214, media_count: 138,
      avatar: hex('birchwood-avatar', 16), banner: null,
    },
    steps: [
      { ago: 9 * DAY, changes: [] },
      { ago: 5 * DAY + 7 * HOUR, changes: [
        { field: 'follower_count', old: 5_602, new: 5_664 },
        { field: 'full_name', old: 'Birchwood Press', new: 'Birchwood Press · zine' },
      ] },
      { ago: 21 * HOUR, changes: [
        { field: 'follower_count', old: 5_664, new: 5_651 },
        { field: 'is_business', old: false, new: true },
      ] },
    ],
  },
  {
    user: 'cobalt.harbor', pk: '73915402266', status: 'paused', interval: 3600, errors: 0,
    profile: {
      username: 'cobalt.harbor', full_name: 'Cobalt Harbor', biography: 'Cranes, containers, cold light.',
      external_url: 'https://example.com/cobalt-harbor', is_verified: false, is_business: true, is_private: false,
      follower_count: 96_310, following_count: 341, media_count: 1_204,
      public_email: 'press@example.com', public_phone: null, business_category: 'Shipping & Freight',
      avatar: hex('cobalt-avatar', 16), banner: hex('cobalt-banner-before', 16),
    },
    steps: [
      { ago: 14 * DAY, changes: [] },
      { ago: 11 * DAY + 2 * HOUR, changes: [
        { field: 'follower_count', old: 96_310, new: 97_002 },
        { field: 'is_verified', old: false, new: true },
      ] },
      { ago: 8 * DAY + 4 * HOUR, changes: [
        { field: 'follower_count', old: 97_002, new: 96_874 },
        { field: 'banner', old: hex('cobalt-banner-before', 16), new: hex('cobalt-banner-after', 16) },
      ], unknown: ['external_url'] },
    ],
  },
  {
    user: 'driftwood.studio', pk: '68420117534', status: 'active', interval: 600, errors: 0,
    profile: {
      username: 'driftwood.studio', full_name: 'Driftwood Studio', biography: 'Driftwood joinery, small batches.',
      external_url: null, is_verified: false, is_business: true, is_private: false,
      follower_count: 2_418, following_count: 187, media_count: 91,
      avatar: hex('driftwood-avatar', 16), banner: null,
    },
    steps: [
      { ago: 3 * DAY + 6 * HOUR, changes: [] },
      { ago: 1 * DAY + 9 * HOUR, changes: [
        { field: 'follower_count', old: 2_418, new: 2_455 },
        { field: 'media_count', old: 91, new: 93 },
      ] },
      { ago: 3 * HOUR + 40 * 60, changes: [
        { field: 'follower_count', old: 2_455, new: 2_471 },
        { field: 'biography', old: 'Driftwood joinery, small batches.', new: 'Driftwood joinery. Commissions open.' },
      ] },
    ],
  },
  {
    user: 'emberline.co', pk: '30551886472', status: 'paused', interval: 7200, errors: 0,
    profile: {
      username: 'emberline.co', full_name: 'Emberline', biography: 'Slow ceramics from a cold studio.',
      external_url: 'https://example.com/emberline', is_verified: true, is_business: false, is_private: false,
      follower_count: 44_190, following_count: 1_204, media_count: 612,
      avatar: hex('emberline-avatar', 16), banner: hex('emberline-banner', 16),
    },
    steps: [
      { ago: 20 * DAY, changes: [] },
      { ago: 16 * DAY + 5 * HOUR, changes: [
        { field: 'following_count', old: 1_204, new: 1_180 },
      ] },
      { ago: 12 * DAY + 11 * HOUR, changes: [
        { field: 'follower_count', old: 44_190, new: 43_905 },
        { field: 'is_private', old: false, new: true },
      ] },
    ],
  },
  // Registered, never checked yet: the "waiting for the first check" row.
  {
    user: 'fernwood.labs', pk: '85206643719', status: 'paused', interval: 1200, errors: 0,
    profile: {
      username: 'fernwood.labs', full_name: 'Fernwood Labs', biography: 'Field notes from a wet forest.',
      external_url: null, is_verified: false, is_business: false, is_private: false,
      follower_count: 806, following_count: 132, media_count: 24,
      avatar: hex('fernwood-avatar', 16), banner: null,
    },
    steps: [],
  },
]

// Snapshot ids ascend with capture time across every account, the way a shared
// storage sequence does, so the feed's ordering key is never ambiguous.
const SNAPSHOT_IDS = new Map<string, string>()
ACCOUNTS
  .flatMap(account => account.steps.map(step => ({ key: `${account.pk}|${step.ago}`, ago: step.ago })))
  .sort((a, b) => b.ago - a.ago)
  .forEach((entry, index) => SNAPSHOT_IDS.set(entry.key, String(100_000 + index)))

/** Oldest first, aligned with `steps`. */
const snapshotsOf = (account: DemoAccount): Snapshot[] =>
  account.steps.map(step => ({ id: SNAPSHOT_IDS.get(`${account.pk}|${step.ago}`)!, target_pk: account.pk, captured_at: NOW - step.ago }))

const SNAPSHOTS = new Map<string, Snapshot[]>(ACCOUNTS.map(account => [account.pk, snapshotsOf(account)]))
const BY_PK = new Map<string, DemoAccount>(ACCOUNTS.map(account => [account.pk, account]))
const BY_USER = new Map<string, DemoAccount>(ACCOUNTS.map(account => [account.user, account]))

// The history page order: newest first, ties broken by the ascending id, which is
// exactly the key `decodeHistoryPage` checks.
const newestFirst = (a: Snapshot, b: Snapshot) => b.captured_at - a.captured_at || Number(b.id) - Number(a.id)

const FEED: HistoryItem[] = ACCOUNTS.flatMap(account => {
  const snapshots = SNAPSHOTS.get(account.pk)!
  if (snapshots.length === 0) return []
  const items: HistoryItem[] = [{ kind: 'baseline', snapshot: snapshots[0] }]
  for (let index = 1; index < snapshots.length; index++) {
    const step = account.steps[index]
    const body: Comparison = { older: snapshots[index - 1], newer: snapshots[index], changes: step.changes, unknown_fields: step.unknown ?? [] }
    // An `incomplete` item is exactly a comparison whose older snapshot lacked
    // some fields; a plain `comparison` never carries unknown fields.
    items.push(body.unknown_fields.length > 0 ? { kind: 'incomplete', ...body } : { kind: 'comparison', ...body })
  }
  return items
}).sort((a, b) => newestFirst(itemSnapshot(a), itemSnapshot(b)))

const TOTAL_SNAPSHOTS = ACCOUNTS.reduce((sum, account) => sum + account.steps.length, 0)

// What `snapshots.read` answers for one snapshot: the baseline with every later
// step's `new` value applied, so a single read and a comparison of the same two
// snapshots always agree. The mock's `unknown` marks what the *older* side of a
// comparison lacked, so it is that older snapshot's missing data.
function fieldsAt(account: DemoAccount, index: number): { fields: Fields; unknown: string[] } {
  const fields: Fields = { ...account.profile }
  for (let step = 1; step <= index; step++) for (const change of account.steps[step].changes) fields[change.field] = change.new
  const unknown = account.steps[index + 1]?.unknown ?? []
  for (const field of unknown) delete fields[field]
  return { fields, unknown: [...unknown] }
}

// A plausible, deterministic profile for an account added in the demo window.
function inventedProfile(user: string): Fields {
  const spread = (salt: string, span: number) => parseInt(hex(`${user}:${salt}`, 6), 16) % span
  return {
    username: user,
    full_name: user.split('.').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
    biography: 'Added in the demo window; this is the first saved snapshot.',
    external_url: null, is_verified: false, is_business: false, is_private: false,
    public_email: null, public_phone: null, business_category: null,
    follower_count: 1_200 + spread('followers', 40_000),
    following_count: 80 + spread('following', 900),
    media_count: 12 + spread('media', 500),
    avatar: hex(`${user}-avatar`, 16), banner: null,
  }
}

// A pair the user picked by hand is not always an adjacent one, so the changes
// between two arbitrary snapshots are folded: the oldest value on one side, the
// newest on the other, and a field that came back to where it started is dropped.
function foldChanges(account: DemoAccount, from: number, to: number): Comparison['changes'] {
  const folded = new Map<string, { old: ChangeValue; new: ChangeValue }>()
  for (let index = from + 1; index <= to; index++) {
    for (const change of account.steps[index].changes) {
      const seen = folded.get(change.field)
      folded.set(change.field, { old: seen ? seen.old : change.old, new: change.new })
    }
  }
  return [...folded.entries()].filter(([, value]) => value.old !== value.new).slice(0, 64).map(([field, value]) => ({ field, old: value.old, new: value.new }))
}

function comparisonOf(
  lookup: { account: Map<string, DemoAccount>; snapshots: Map<string, Snapshot[]> },
  targetPk: string,
  olderId: string,
  newerId: string,
): Comparison {
  const account = lookup.account.get(targetPk)
  const snapshots = lookup.snapshots.get(targetPk) ?? []
  const from = snapshots.findIndex(snapshot => snapshot.id === olderId)
  const to = snapshots.findIndex(snapshot => snapshot.id === newerId)
  if (account === undefined || from < 0 || to < 0 || from >= to) throw new DesktopFailure('snapshot_unavailable')
  const unknown = new Set<string>()
  for (let index = from + 1; index <= to; index++) for (const field of account.steps[index].unknown ?? []) unknown.add(field)
  return { older: snapshots[from], newer: snapshots[to], changes: foldChanges(account, from, to), unknown_fields: [...unknown].slice(0, 64) }
}

const historyPage = (items: HistoryItem[], scanned: number) => envelope('history_page', { items, next_cursor: null, scan_complete: true, scanned })

const text = (args: Record<string, unknown> | undefined, group: string, key: string): string | null => {
  const container = args?.[group]
  if (container === null || typeof container !== 'object') return null
  const value = (container as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}
const number = (args: Record<string, unknown> | undefined, group: string, key: string): number | null => {
  const container = args?.[group]
  if (container === null || typeof container !== 'object') return null
  const value = (container as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : null
}

// A lookup asks the provider about an account the user has just typed, so the
// mock has to invent the posts behind it. The four places, the tags and the
// mentions below are made up; the numbers are derived from the account's pk, so
// a screenshot taken twice is the same picture.
const DEMO_PLACES: readonly { name: string; lat: number; lng: number }[] = [
  { name: 'Ferry Terminal', lat: 52.3739, lng: 4.8903 },
  { name: 'Birch Yard', lat: 52.3612, lng: 4.8721 },
  { name: 'North Pier', lat: 52.4018, lng: 4.9224 },
  { name: 'Vasa Coffee', lat: 59.3251, lng: 18.0711 },
]
const DEMO_TAGS = ['harbour', 'nightferry', 'slowfilm', 'risograph', 'coldlight', 'commissions']
const DEMO_MENTIONS = ['atlas.ferry', 'birchwood.press', 'cobalt.harbor']
// A short artificial wait, so the window's loading state is visible in the demo
// rather than flashing past. A real lookup takes seconds. Tests pass
// `lookupDelayMs: 0` rather than spending it nine times over in wall-clock.
export const MOCK_LOOKUP_MS = 250
const pause = (ms: number) => (ms === 0 ? Promise.resolve() : new Promise(resolve => { setTimeout(resolve, ms) }))

interface DemoPost { code: string; takenAt: number; likes: number; place: { name: string; lat: number; lng: number } | null; tags: string[]; mentions: string[] }

const round3 = (value: number) => Math.round(value * 1000) / 1000
const RADIANS = Math.PI / 180
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * RADIANS, dLng = (bLng - aLng) * RADIANS
  const chord = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RADIANS) * Math.cos(bLat * RADIANS) * Math.sin(dLng / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(chord)))
}
// Count descending, ties by key ascending, then the top slice — the order
// `analytics._top_from_counter` produces and the decoder insists on.
const topTerms = (counts: Map<string, number>, top: number) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, top).map(([key, count]) => ({ key, count }))

function demoPosts(pk: string, user: string, count: number): DemoPost[] {
  const prefix = user.replace(/[^a-z0-9]/g, '').slice(0, 4)
  return Array.from({ length: count }, (_, index) => {
    const seed = parseInt(hex(`${pk}:post:${index}`, 8), 16)
    return {
      code: `${prefix}${String(index).padStart(2, '0')}`,
      // Newest first, roughly every half day, jittered by a few hours.
      takenAt: NOW - index * (DAY / 2) - (seed % (11 * HOUR)),
      likes: 40 + (seed % 1200),
      // `Math.floor`, not `>>`: an eight-hex seed exceeds the signed 32-bit
      // range a shift would truncate it to, and a negative index reads nothing.
      place: seed % 5 === 0 ? null : DEMO_PLACES[Math.floor(seed / 8) % DEMO_PLACES.length],
      tags: [DEMO_TAGS[seed % DEMO_TAGS.length], DEMO_TAGS[(seed + index) % DEMO_TAGS.length]],
      mentions: seed % 3 === 0 ? [DEMO_MENTIONS[Math.floor(seed / 32) % DEMO_MENTIONS.length]] : [],
    }
  })
}

// Every number below is computed from the one post window, exactly as the core
// computes it from one fetch: the mock is only useful while `dto.ts` accepts it.
function activityOf(pk: string, user: string, posts: number, window: LookupWindow, quota: number | null) {
  const inspected = demoPosts(pk, user, Math.min(window, posts))
  const tagged = inspected.filter(post => post.place !== null)
  const places = new Map<string, { name: string; lat: number; lng: number; count: number }>()
  for (const post of tagged) {
    const place = post.place!
    const seen = places.get(place.name)
    places.set(place.name, { ...place, count: (seen?.count ?? 0) + 1 })
  }
  const ordered = [...places.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)).slice(0, 10)
  const centroid = tagged.length === 0 ? null : {
    lat: tagged.reduce((sum, post) => sum + post.place!.lat, 0) / tagged.length,
    lng: tagged.reduce((sum, post) => sum + post.place!.lng, 0) / tagged.length,
  }
  const radius = centroid === null ? null : round3(Math.max(...tagged.map(post => haversineKm(centroid.lat, centroid.lng, post.place!.lat, post.place!.lng))))
  const hours = Array.from({ length: 24 }, () => 0)
  const days = Array.from({ length: 7 }, () => 0)
  const hashtags = new Map<string, number>(), mentions = new Map<string, number>(), locations = new Map<string, number>()
  for (const post of inspected) {
    const at = new Date(post.takenAt * 1000)
    hours[at.getUTCHours()]++
    // Monday first, like `datetime.weekday()`.
    days[(at.getUTCDay() + 6) % 7]++
    for (const tag of post.tags) hashtags.set(tag, (hashtags.get(tag) ?? 0) + 1)
    for (const mention of post.mentions) mentions.set(mention, (mentions.get(mention) ?? 0) + 1)
    if (post.place !== null) locations.set(post.place.name, (locations.get(post.place.name) ?? 0) + 1)
  }
  const total = inspected.reduce((sum, post) => sum + post.likes, 0)
  const byLikes = [...inspected].sort((a, b) => b.likes - a.likes || (a.code < b.code ? -1 : 1)).slice(0, 5)
  const stamps = inspected.map(post => post.takenAt)
  return {
    target_pk: pk, window, analyzed: inspected.length,
    geo: {
      geotagged: tagged.length, anchor: ordered[0] ?? null, centroid,
      radius_km: radius, places: ordered,
    },
    timeline: {
      hour_of_day: hours, day_of_week: days,
      first_post_at: stamps.length === 0 ? null : Math.min(...stamps),
      last_post_at: stamps.length === 0 ? null : Math.max(...stamps),
    },
    hashtags: topTerms(hashtags, 20), mentions: topTerms(mentions, 20), locations: topTerms(locations, 20),
    likes: {
      total, average: inspected.length === 0 ? 0 : round3(total / inspected.length),
      top_posts: byLikes.map(post => ({ code: post.code, like_count: post.likes })),
    },
    quota_remaining: quota,
  }
}

// An adopted home always answers with an expanded absolute path; this one names a
// user that does not exist on any machine.
const DEMO_HOME = '/Users/demo/.insto'
const ADOPTABLE: HomeReport = {
  path: DEMO_HOME, exists: true, private: true, config: 'ok', backend: 'hikerapi', database: 'ok',
  registration: 'none', interpreter: null, loaded: false, process: 'stopped', adoptable: true, reason: null,
}

// `setup: true` starts before a token was connected, to look at the first screen;
// connecting any valid token then moves on to the demo data.
// The service checks a newly added account right away, so the demo window shows
// the waiting state and then the profile card a moment later rather than an empty
// pane. Two seconds is long enough to see the wait and short enough to sit through.
export const MOCK_FIRST_CHECK_MS = 2000

export function createMockInvoke(options: { setup?: boolean; lookupDelayMs?: number } = {}): Invoke {
  const lookupDelayMs = options.lookupDelayMs ?? MOCK_LOOKUP_MS
  let revisions = 0
  // Per-instance overlays: an account added here must not leak into another mock.
  const snapshotsByPk = new Map(SNAPSHOTS)
  const byPk = new Map(BY_PK)
  const byUser = new Map(BY_USER)
  let feed: HistoryItem[] = FEED
  let nextPk = 90_000_000_000
  let nextSnapshotId = 100_000 + TOTAL_SNAPSHOTS
  // Pending first checks, so a watch removed before its check lands — or one
  // re-added — never leaves a timer running against a discarded mock.
  const pendingChecks = new Map<string, ReturnType<typeof setTimeout>>()
  function cancelCheck(user: string): void {
    const timer = pendingChecks.get(user)
    if (timer !== undefined) { clearTimeout(timer); pendingChecks.delete(user) }
  }
  const nextRevision = (user: string) => hex(`${user}:${++revisions}`, 64)
  const watches = new Map<string, Watch>(ACCOUNTS.map(account => {
    const snapshots = snapshotsByPk.get(account.pk)!
    const lastOk = snapshots.length === 0 ? null : snapshots[snapshots.length - 1].captured_at
    return [account.user, {
      user: account.user, status: account.status, interval_seconds: account.interval,
      last_ok: lastOk, waiting_first_check: lastOk === null, has_error: account.errors > 0,
      consecutive_errors: account.errors, revision: nextRevision(account.user),
    }]
  }))
  let profile: Profile = options.setup
    ? { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }
    : {
      configured: true, status: 'running', desired_service: 'running', service_running: true,
      quota_remaining: 4_128, quota_checked_at: NOW - 240, revision: hex('profile', 32),
    }
  // The registration this app wrote, on the runtime this app ships: nothing to
  // migrate, nothing read-only.
  let facts = { registration: 'owned', interpreter: 'current' as string | null, interpreter_exists: true as boolean | null, loaded: true as boolean | null, settings: 'matching' as string | null }
  let binding: { state: string; home: string | null } = { state: 'own', home: null }

  const sorted = () => [...watches.values()].sort((a, b) => (a.user < b.user ? -1 : a.user > b.user ? 1 : 0))
  const overview = (): Overview => ({
    configured: profile.configured, desired_service: profile.desired_service,
    service_state: profile.service_running ? 'running' : 'stopped',
    quota_remaining: profile.quota_remaining, quota_checked_at: profile.quota_checked_at,
    watches: sorted(), next_cursor: null,
  })
  // The first check landing: one saved snapshot, one baseline in the feed and a
  // registration that is no longer waiting. A watch removed in the meantime, or a
  // name that already has a demo history, gets nothing.
  function firstCheck(user: string): void {
    pendingChecks.delete(user)
    const current = watches.get(user)
    if (current === undefined || byUser.has(user)) return
    const pk = String(nextPk++)
    const snapshot: Snapshot = { id: String(nextSnapshotId++), target_pk: pk, captured_at: NOW }
    const account: DemoAccount = {
      user, pk, status: current.status, interval: current.interval_seconds, errors: 0,
      profile: inventedProfile(user), steps: [{ ago: 0, changes: [] }],
    }
    byUser.set(user, account); byPk.set(pk, account); snapshotsByPk.set(pk, [snapshot])
    feed = [{ kind: 'baseline', snapshot }, ...feed]
    watches.set(user, { ...current, last_ok: snapshot.captured_at, waiting_first_check: false, revision: nextRevision(user) })
  }
  // A paid read costs the demo profile what the real one costs: two requests for
  // a profile, one page request for an analysis.
  function spend(requests: number): void {
    if (profile.quota_remaining !== null) profile = { ...profile, quota_remaining: Math.max(0, profile.quota_remaining - requests) }
  }
  function touch(user: string | null, change: (watch: Watch) => Watch): unknown {
    const current = user === null ? undefined : watches.get(user)
    if (current === undefined) throw new DesktopFailure('watch_not_found')
    const updated = { ...change(current), revision: nextRevision(current.user) }
    watches.set(updated.user, updated)
    return envelope('watch', updated)
  }

  return async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    switch (command) {
      case 'prepare_desktop': return { core_version: CORE_VERSION, build_id: hex('insto-gui-mock-build', 64) }
      case 'inspect_setup': return envelope('profile', profile)
      case 'inspect_binding': return binding
      case 'inspect_service': return envelope('service_inspection', facts)
      case 'read_overview': return envelope('overview', overview())
      case 'list_watches': return envelope('watch_page', { items: sorted(), next_cursor: null })
      case 'open_token_page': return undefined

      case 'configure_setup':
      case 'replace_credentials':
        profile = { ...profile, configured: true, status: 'running', desired_service: 'running', service_running: true, revision: hex(`profile:${++revisions}`, 32) }
        return envelope('profile', profile)
      case 'start_service':
      case 'repair_service':
        profile = { ...profile, status: 'running', desired_service: 'running', service_running: true }
        return envelope('profile', profile)
      case 'stop_service':
        profile = { ...profile, status: 'stopped', desired_service: 'stopped', service_running: false }
        return envelope('profile', profile)
      case 'migrate_service':
        facts = { ...facts, registration: 'owned', interpreter: 'current', interpreter_exists: true, loaded: true }
        return envelope('profile', profile)
      case 'uninstall_service':
        facts = { registration: 'none', interpreter: null, interpreter_exists: null, loaded: false, settings: null }
        profile = { ...profile, status: 'stopped', desired_service: 'stopped', service_running: false }
        return envelope('profile', profile)

      case 'add_watch': {
        const user = text(args, 'watch', 'user') ?? ''
        if (watches.has(user)) throw new DesktopFailure('watch_exists')
        const watch: Watch = {
          user, status: 'active', interval_seconds: number(args, 'watch', 'interval_seconds') ?? 3600,
          last_ok: null, waiting_first_check: true, has_error: false, consecutive_errors: 0, revision: nextRevision(user),
        }
        watches.set(user, watch)
        cancelCheck(user)
        pendingChecks.set(user, setTimeout(() => firstCheck(user), MOCK_FIRST_CHECK_MS))
        return envelope('watch', watch)
      }
      case 'update_watch': return touch(text(args, 'watch', 'user'), watch => ({ ...watch, interval_seconds: number(args, 'watch', 'interval_seconds') ?? watch.interval_seconds }))
      case 'pause_watch': return touch(text(args, 'watch', 'user'), watch => ({ ...watch, status: 'paused' }))
      case 'resume_watch': return touch(text(args, 'watch', 'user'), watch => ({ ...watch, status: 'active' }))
      case 'remove_watch': {
        const user = text(args, 'watch', 'user') ?? ''
        if (!watches.delete(user)) throw new DesktopFailure('watch_not_found')
        cancelCheck(user)
        return envelope('removed', { removed_user: user })
      }

      case 'search_targets': {
        const account = byUser.get(text(args, 'query', 'username') ?? '')
        const snapshots = account === undefined ? [] : snapshotsByPk.get(account.pk)!
        if (account === undefined || snapshots.length === 0) return historyPage([], 0)
        return historyPage([{ kind: 'target', target_pk: account.pk, snapshot: snapshots[snapshots.length - 1] }], snapshots.length)
      }
      case 'list_snapshots': {
        const snapshots = (snapshotsByPk.get(text(args, 'query', 'target_pk') ?? '') ?? []).slice().reverse()
        return historyPage(snapshots.map(snapshot => ({ kind: 'snapshot', snapshot })), snapshots.length)
      }
      case 'compare_snapshots':
        return envelope('comparison', comparisonOf({ account: byPk, snapshots: snapshotsByPk }, text(args, 'pair', 'target_pk') ?? '', text(args, 'pair', 'older_id') ?? '', text(args, 'pair', 'newer_id') ?? ''))
      case 'read_snapshot': {
        const targetPk = text(args, 'snapshot', 'target_pk') ?? ''
        const account = byPk.get(targetPk), snapshots = snapshotsByPk.get(targetPk) ?? []
        const index = snapshots.findIndex(item => item.id === (text(args, 'snapshot', 'snapshot_id') ?? ''))
        if (account === undefined || index < 0) throw new DesktopFailure('snapshot_unavailable')
        const { fields, unknown } = fieldsAt(account, index)
        return envelope('snapshot_fields', { snapshot: snapshots[index], fields, unknown_fields: unknown })
      }
      case 'list_changes': {
        const filter = text(args, 'query', 'target_pk')
        const items = filter === null ? feed : feed.filter(item => itemSnapshot(item).target_pk === filter)
        return historyPage(items, filter === null ? feed.length : (snapshotsByPk.get(filter)?.length ?? 0))
      }

      // The two on-demand lookups. Both cost paid requests, so the mock spends
      // the demo quota too: the number in the footer has to move when a click
      // costs something.
      case 'lookup_profile': {
        const user = text(args, 'lookup', 'username') ?? ''
        if (!profile.configured) throw new DesktopFailure('not_configured')
        await pause(lookupDelayMs)
        const account = byUser.get(user)
        if (account === undefined) throw new DesktopFailure('target_not_found')
        const latest = account.steps.length === 0 ? account.profile : fieldsAt(account, account.steps.length - 1).fields
        // Exactly the thirteen tracked names: a live lookup never has the stored
        // avatar or banner hash, and this provider supplies every other one.
        const fields: Fields = {}
        for (const name of LOOKUP_FIELDS) fields[name] = latest[name] ?? null
        spend(2)
        return envelope('lookup_profile', {
          target_pk: account.pk,
          access: latest.is_private === true ? 'private' : 'public',
          fields, unknown_fields: [], quota_remaining: profile.quota_remaining,
        })
      }
      case 'lookup_activity': {
        const pk = text(args, 'lookup', 'target_pk') ?? ''
        const requested = number(args, 'lookup', 'window') ?? 0
        if (!profile.configured) throw new DesktopFailure('not_configured')
        await pause(lookupDelayMs)
        const account = byPk.get(pk)
        const window = (LOOKUP_WINDOWS as readonly number[]).includes(requested) ? (requested as LookupWindow) : 50
        if (account === undefined) throw new DesktopFailure('target_not_found')
        const latest = account.steps.length === 0 ? account.profile : fieldsAt(account, account.steps.length - 1).fields
        // A private account is where the provider stops answering, which is the
        // refusal the section has to render.
        if (latest.is_private === true) throw new DesktopFailure('target_private')
        const posts = typeof latest.media_count === 'number' ? latest.media_count : 0
        spend(1)
        return envelope('lookup_activity', activityOf(pk, account.user, posts, window, profile.quota_remaining))
      }

      case 'inspect_home': {
        const path = text(args, 'query', 'path') ?? ''
        // Only the demo home is presentable; anything else answers with the shape
        // the core returns for a path that is not there.
        if (path === '~' || path === '~/.insto' || path === DEMO_HOME) return envelope('home_inspection', ADOPTABLE)
        return envelope('home_inspection', { ...ADOPTABLE, path: path.startsWith('/') ? path : '/Users/demo/absent', exists: false, private: false, config: 'missing', backend: null, database: 'missing', loaded: null, process: 'unknown', adoptable: false, reason: 'home_invalid' })
      }
      case 'select_home': {
        const path = text(args, 'home', 'path')
        binding = path === null ? { state: 'own', home: null } : { state: 'adopted', home: DEMO_HOME }
        return envelope('profile', profile)
      }
      default:
        console.warn('[mock] unhandled command', command)
        throw new DesktopFailure('internal_error')
    }
  }
}
