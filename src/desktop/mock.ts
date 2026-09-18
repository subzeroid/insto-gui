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
import { itemSnapshot, type Change, type ChangeValue, type Comparison, type HistoryItem, type HomeReport, type Overview, type Snapshot, type Watch, type WatchStatus } from './dto'
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
interface DemoAccount {
  user: string
  pk: string
  status: WatchStatus
  interval: number
  errors: number
  steps: DemoStep[]
}

// Six invented accounts: three active (the core's cap), three paused, one of the
// active ones failing its checks and one registration that has never been checked.
const ACCOUNTS: DemoAccount[] = [
  {
    user: 'atlas.ferry', pk: '51884219307', status: 'active', interval: 900, errors: 0,
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
  { user: 'fernwood.labs', pk: '85206643719', status: 'paused', interval: 1200, errors: 0, steps: [] },
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

function comparisonOf(targetPk: string, olderId: string, newerId: string): Comparison {
  const account = BY_PK.get(targetPk)
  const snapshots = SNAPSHOTS.get(targetPk) ?? []
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

// An adopted home always answers with an expanded absolute path; this one names a
// user that does not exist on any machine.
const DEMO_HOME = '/Users/demo/.insto'
const ADOPTABLE: HomeReport = {
  path: DEMO_HOME, exists: true, private: true, config: 'ok', backend: 'hikerapi', database: 'ok',
  registration: 'none', interpreter: null, loaded: false, process: 'stopped', adoptable: true, reason: null,
}

export function createMockInvoke(): Invoke {
  let revisions = 0
  const nextRevision = (user: string) => hex(`${user}:${++revisions}`, 64)
  const watches = new Map<string, Watch>(ACCOUNTS.map(account => {
    const snapshots = SNAPSHOTS.get(account.pk)!
    const lastOk = snapshots.length === 0 ? null : snapshots[snapshots.length - 1].captured_at
    return [account.user, {
      user: account.user, status: account.status, interval_seconds: account.interval,
      last_ok: lastOk, waiting_first_check: lastOk === null, has_error: account.errors > 0,
      consecutive_errors: account.errors, revision: nextRevision(account.user),
    }]
  }))
  let profile: Profile = {
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
        return envelope('watch', watch)
      }
      case 'update_watch': return touch(text(args, 'watch', 'user'), watch => ({ ...watch, interval_seconds: number(args, 'watch', 'interval_seconds') ?? watch.interval_seconds }))
      case 'pause_watch': return touch(text(args, 'watch', 'user'), watch => ({ ...watch, status: 'paused' }))
      case 'resume_watch': return touch(text(args, 'watch', 'user'), watch => ({ ...watch, status: 'active' }))
      case 'remove_watch': {
        const user = text(args, 'watch', 'user') ?? ''
        if (!watches.delete(user)) throw new DesktopFailure('watch_not_found')
        return envelope('removed', { removed_user: user })
      }

      case 'search_targets': {
        const account = BY_USER.get(text(args, 'query', 'username') ?? '')
        const snapshots = account === undefined ? [] : SNAPSHOTS.get(account.pk)!
        if (account === undefined || snapshots.length === 0) return historyPage([], 0)
        return historyPage([{ kind: 'target', target_pk: account.pk, snapshot: snapshots[snapshots.length - 1] }], snapshots.length)
      }
      case 'list_snapshots': {
        const snapshots = (SNAPSHOTS.get(text(args, 'query', 'target_pk') ?? '') ?? []).slice().reverse()
        return historyPage(snapshots.map(snapshot => ({ kind: 'snapshot', snapshot })), snapshots.length)
      }
      case 'compare_snapshots':
        return envelope('comparison', comparisonOf(text(args, 'pair', 'target_pk') ?? '', text(args, 'pair', 'older_id') ?? '', text(args, 'pair', 'newer_id') ?? ''))
      case 'list_changes': {
        const filter = text(args, 'query', 'target_pk')
        const items = filter === null ? FEED : FEED.filter(item => itemSnapshot(item).target_pk === filter)
        return historyPage(items, filter === null ? TOTAL_SNAPSHOTS : (SNAPSHOTS.get(filter)?.length ?? 0))
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
