import { DesktopFailure } from './messages'

export type WatchStatus = 'active' | 'paused'
export interface Watch { user: string; status: WatchStatus; interval_seconds: number; last_ok: number | null; waiting_first_check: boolean; has_error: boolean; consecutive_errors: number; revision: string }
export interface WatchPage { items: Watch[]; next_cursor: string | null }
export type ServiceState = 'running' | 'stopped' | 'unknown'
export interface Overview { configured: boolean; desired_service: 'running' | 'stopped' | null; service_state: ServiceState; quota_remaining: number | null; quota_checked_at: number | null; watches: Watch[]; next_cursor: string | null }
export interface Snapshot { id: string; target_pk: string; captured_at: number }
export type ChangeValue = null | boolean | number | string
export interface Change { field: string; old: ChangeValue; new: ChangeValue }
export interface Comparison { older: Snapshot; newer: Snapshot; changes: Change[]; unknown_fields: string[] }
// `snapshots.read`: one saved snapshot's tracked values, typed exactly as the
// comparison reports its change values. A tracked field the snapshot has no
// data for is listed in `unknown_fields` instead of carrying a value.
export interface SnapshotFields { snapshot: Snapshot; fields: Record<string, ChangeValue>; unknown_fields: string[] }
export type DiagnosticCode = 'history_corrupt' | 'history_oversized' | 'history_identity_unknown'
export type HistoryItem =
  | { kind: 'target'; target_pk: string; snapshot: Snapshot }
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'baseline'; snapshot: Snapshot }
  | ({ kind: 'comparison' } & Comparison)
  | ({ kind: 'incomplete' } & Comparison)
  | { kind: 'diagnostic'; snapshot: Snapshot; code: DiagnosticCode }
export type HistoryKind = HistoryItem['kind']
export interface HistoryPage { items: HistoryItem[]; next_cursor: string | null; scan_complete: boolean; scanned: number }

export const MAX_TIME = 253402300799
export const USERNAME = /^[a-z0-9._]{1,255}$/
export const TARGET_PK = /^[1-9][0-9]{0,63}$/
export const SNAPSHOT_ID = /^[1-9][0-9]{0,18}$/
export const REVISION = /^[a-f0-9]{64}$/
export const WATCH_CURSOR = /^w1\.[A-Za-z0-9_-]{1,509}$/
export const HISTORY_CURSOR = /^[A-Za-z0-9_-]{1,1024}$/
const FIELD = /^[a-z_]{1,64}$/
const DIAGNOSTICS = ['history_corrupt', 'history_oversized', 'history_identity_unknown']
export const TARGET_KINDS: readonly HistoryKind[] = ['target', 'diagnostic']
export const SNAPSHOT_KINDS: readonly HistoryKind[] = ['snapshot', 'diagnostic']
export const CHANGE_KINDS: readonly HistoryKind[] = ['baseline', 'comparison', 'incomplete', 'diagnostic']

const fail = (): never => { throw new DesktopFailure('protocol') }
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) fail()
  return value as Record<string, unknown>
}
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail()
  return value as number
}
const nullableCount = (value: unknown, max?: number) => (value === null ? null : count(value, max))
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail()
  return value as string
}
const nullableCursor = (value: unknown, pattern: RegExp) => (value === null ? null : text(value, pattern))
export const validSnapshotId = (value: string) => SNAPSHOT_ID.test(value) && (value.length < 19 || value <= '9223372036854775807')

export function decodeWatch(value: unknown): Watch {
  const v = exact(value, ['user', 'status', 'interval_seconds', 'last_ok', 'waiting_first_check', 'has_error', 'consecutive_errors', 'revision'])
  const user = text(v.user, USERNAME)
  if (user === '.' || user === '..' || (v.status !== 'active' && v.status !== 'paused')) fail()
  const interval = count(v.interval_seconds, 2147483647)
  if (interval < 300) fail()
  const lastOk = nullableCount(v.last_ok, MAX_TIME)
  if (typeof v.waiting_first_check !== 'boolean' || typeof v.has_error !== 'boolean' || v.waiting_first_check !== (lastOk === null)) fail()
  return { user, status: v.status as WatchStatus, interval_seconds: interval, last_ok: lastOk, waiting_first_check: v.waiting_first_check as boolean, has_error: v.has_error as boolean, consecutive_errors: count(v.consecutive_errors), revision: text(v.revision, REVISION) }
}
function watchList(value: unknown, cursor: unknown): WatchPage {
  if (!Array.isArray(value) || value.length > 50) fail()
  const items = (value as unknown[]).map(decodeWatch)
  for (let index = 1; index < items.length; index++) if (items[index - 1].user >= items[index].user) fail()
  return { items, next_cursor: nullableCursor(cursor, WATCH_CURSOR) }
}
export function decodeWatchPage(value: unknown): WatchPage {
  const v = exact(value, ['items', 'next_cursor'])
  return watchList(v.items, v.next_cursor)
}
export function decodeOverview(value: unknown): Overview {
  const v = exact(value, ['configured', 'desired_service', 'service_state', 'quota_remaining', 'quota_checked_at', 'watches', 'next_cursor'])
  if (typeof v.configured !== 'boolean' || ![null, 'running', 'stopped'].includes(v.desired_service as string | null) || !['running', 'stopped', 'unknown'].includes(v.service_state as string)) fail()
  const quota = nullableCount(v.quota_remaining)
  const checked = nullableCount(v.quota_checked_at, MAX_TIME)
  const list = watchList(v.watches, v.next_cursor)
  const configured = v.configured as boolean
  // `quota_remaining` and `quota_checked_at` are written together (`new_state`),
  // so an adopted home reports both null until its next credential check.
  // Both-or-neither is the rule; only an unconfigured profile forces them null.
  if ((v.desired_service !== null) !== configured || (quota === null) !== (checked === null)) fail()
  if (!configured && quota !== null) fail()
  if (!configured && (list.items.length > 0 || list.next_cursor !== null || v.service_state !== 'unknown')) fail()
  return { configured, desired_service: v.desired_service as Overview['desired_service'], service_state: v.service_state as ServiceState, quota_remaining: quota, quota_checked_at: checked, watches: list.items, next_cursor: list.next_cursor }
}
export function decodeRemoved(value: unknown): string {
  return text(exact(value, ['removed_user']).removed_user, USERNAME)
}
export function decodeSnapshot(value: unknown): Snapshot {
  const v = exact(value, ['id', 'target_pk', 'captured_at'])
  const id = text(v.id, SNAPSHOT_ID)
  if (!validSnapshotId(id)) fail()
  return { id, target_pk: text(v.target_pk, TARGET_PK), captured_at: count(v.captured_at, MAX_TIME) }
}
export const snapshotKey = (snapshot: Snapshot): [number, bigint] => [snapshot.captured_at, BigInt(snapshot.id)]
function later(a: Snapshot, b: Snapshot): boolean {
  const [ta, ia] = snapshotKey(a), [tb, ib] = snapshotKey(b)
  return ta > tb || (ta === tb && ia > ib)
}
function changeValue(value: unknown): ChangeValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return count(value)
  return fail()
}
// A standalone comparison (compare_snapshots data) carries no inner `kind`: the
// Rust IPC envelope holds it. Feed items carry `kind` inside the item.
function comparisonBody(value: unknown, kind: 'comparison' | 'incomplete' | null): Comparison {
  const v = exact(value, kind === null ? ['older', 'newer', 'changes', 'unknown_fields'] : ['kind', 'older', 'newer', 'changes', 'unknown_fields'])
  if ((kind !== null && v.kind !== kind) || !Array.isArray(v.changes) || !Array.isArray(v.unknown_fields) || v.changes.length > 64 || v.unknown_fields.length > 64) fail()
  const older = decodeSnapshot(v.older), newer = decodeSnapshot(v.newer)
  if (older.target_pk !== newer.target_pk || !later(newer, older)) fail()
  const changes = (v.changes as unknown[]).map(change => { const c = exact(change, ['field', 'old', 'new']); return { field: text(c.field, FIELD), old: changeValue(c.old), new: changeValue(c.new) } })
  return { older, newer, changes, unknown_fields: (v.unknown_fields as unknown[]).map(name => text(name, FIELD)) }
}
export const decodeComparison = (value: unknown): Comparison => comparisonBody(value, null)
// The host re-emits the core's object as-is, so the key set is exact and every
// value gets the change-value validation. A name may be known or unknown, never
// both; anything else is a `protocol` failure.
export function decodeSnapshotFields(value: unknown): SnapshotFields {
  const v = exact(value, ['snapshot', 'fields', 'unknown_fields'])
  if (!record(v.fields) || !Array.isArray(v.unknown_fields) || v.unknown_fields.length > 64) fail()
  const raw = v.fields as Record<string, unknown>
  const names = Object.keys(raw)
  if (names.length > 64) fail()
  // `FIELD` matches `__proto__`, and assigning it on an object that inherits
  // `Object.prototype` is a silent no-op: the entry would vanish instead of being
  // refused, and would also slip past the disjointness check below. A null
  // prototype makes every accepted name an ordinary own property.
  const fields: Record<string, ChangeValue> = Object.create(null)
  for (const name of names) fields[text(name, FIELD)] = changeValue(raw[name])
  const unknown = (v.unknown_fields as unknown[]).map(name => text(name, FIELD))
  if (unknown.some(name => Object.hasOwn(fields, name))) fail()
  return { snapshot: decodeSnapshot(v.snapshot), fields, unknown_fields: unknown }
}
export const itemSnapshot = (item: HistoryItem): Snapshot => (item.kind === 'comparison' || item.kind === 'incomplete' ? item.newer : item.snapshot)
function historyItem(value: unknown, kinds: readonly HistoryKind[]): HistoryItem {
  if (!record(value) || typeof value.kind !== 'string' || !(kinds as readonly string[]).includes(value.kind)) fail()
  const v = value as Record<string, unknown>
  switch (v.kind) {
    case 'target': {
      const t = exact(v, ['kind', 'target_pk', 'snapshot'])
      const snapshot = decodeSnapshot(t.snapshot)
      if (text(t.target_pk, TARGET_PK) !== snapshot.target_pk) fail()
      return { kind: 'target', target_pk: snapshot.target_pk, snapshot }
    }
    case 'snapshot': return { kind: 'snapshot', snapshot: decodeSnapshot(exact(v, ['kind', 'snapshot']).snapshot) }
    case 'baseline': return { kind: 'baseline', snapshot: decodeSnapshot(exact(v, ['kind', 'snapshot']).snapshot) }
    case 'comparison': {
      const c = comparisonBody(v, 'comparison')
      if (c.changes.length === 0 || c.unknown_fields.length > 0) fail()
      return { kind: 'comparison', ...c }
    }
    case 'incomplete': {
      const c = comparisonBody(v, 'incomplete')
      if (c.unknown_fields.length === 0) fail()
      return { kind: 'incomplete', ...c }
    }
    default: {
      const d = exact(v, ['kind', 'snapshot', 'code'])
      if (typeof d.code !== 'string' || !DIAGNOSTICS.includes(d.code) || (d.code === 'history_identity_unknown' && !kinds.includes('target'))) fail()
      return { kind: 'diagnostic', snapshot: decodeSnapshot(d.snapshot), code: d.code as DiagnosticCode }
    }
  }
}
export function decodeHistoryPage(value: unknown, kinds: readonly HistoryKind[], filterPk: string | null = null, limit = 50): HistoryPage {
  const v = exact(value, ['items', 'next_cursor', 'scan_complete', 'scanned'])
  const cursor = nullableCursor(v.next_cursor, HISTORY_CURSOR)
  if (typeof v.scan_complete !== 'boolean' || v.scan_complete !== (cursor === null) || !Array.isArray(v.items) || v.items.length > limit) fail()
  const scanned = count(v.scanned, 2000)
  const items = (v.items as unknown[]).map(item => historyItem(item, kinds))
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const current = itemSnapshot(item)
    if (filterPk !== null && current.target_pk !== filterPk) fail()
    if (item.kind === 'target') { if (seen.has(item.target_pk)) fail(); seen.add(item.target_pk) }
    if (index > 0 && !later(itemSnapshot(items[index - 1]), current)) fail()
  })
  return { items, next_cursor: cursor, scan_complete: v.scan_complete as boolean, scanned }
}

export type Registration = 'none' | 'owned' | 'unknown'
export type Interpreter = 'current' | 'other'
export type HomeReason = 'home_invalid' | 'home_backend_unsupported' | 'schema_mismatch' | 'storage_error'
export type BindingState = 'own' | 'adopted' | 'unknown'
export interface ServiceFacts { registration: Registration; interpreter: Interpreter | null; interpreterExists: boolean | null; loaded: boolean | null; settings: 'matching' | 'different' | null }
export interface HomeReport { path: string; exists: boolean; private: boolean; config: 'ok' | 'missing' | 'invalid'; backend: 'hikerapi' | 'aiograpi' | 'fake' | null; database: 'ok' | 'missing' | 'schema_mismatch' | 'unreadable'; registration: Registration; interpreter: Interpreter | null; loaded: boolean | null; process: 'running' | 'stopped' | 'unknown'; adoptable: boolean; reason: HomeReason | null }
export interface Binding { state: BindingState; home: string | null }

const REGISTRATIONS: readonly Registration[] = ['none', 'owned', 'unknown']
const INTERPRETERS: readonly Interpreter[] = ['current', 'other']
const SETTINGS: readonly NonNullable<ServiceFacts['settings']>[] = ['matching', 'different']
const CONFIGS: readonly HomeReport['config'][] = ['ok', 'missing', 'invalid']
const BACKENDS: readonly NonNullable<HomeReport['backend']>[] = ['hikerapi', 'aiograpi', 'fake']
const DATABASES: readonly HomeReport['database'][] = ['ok', 'missing', 'schema_mismatch', 'unreadable']
const PROCESSES: readonly HomeReport['process'][] = ['running', 'stopped', 'unknown']
const BINDING_STATES: readonly BindingState[] = ['own', 'adopted', 'unknown']
// The core's four static reasons for a refusal (`insto/desktop/home.py:_reason`),
// mirroring the Rust known set; every entry is a key of `messages`, so the UI
// renders a reason through the existing catalogue without a mapping table.
export const HOME_REASONS: readonly HomeReason[] = ['home_invalid', 'home_backend_unsupported', 'schema_mismatch', 'storage_error']
// PATH_MAX. The *request* bound (`HOME_PATH_LIMIT`, 1024) is deliberately smaller:
// the core expands `~` before it answers, so the absolute path it returns can be
// longer than the path the user typed.
export const RESPONSE_PATH_LIMIT = 4096

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail()
  return value as T
}
const nullableMember = <T extends string>(value: unknown, allowed: readonly T[]): T | null => (value === null ? null : member(value, allowed))
function flag(value: unknown): boolean { if (typeof value !== 'boolean') fail(); return value as boolean }
const nullableFlag = (value: unknown): boolean | null => (value === null ? null : flag(value))
// Every path the core returns: absolute (which also rules out the empty string),
// no NUL, at most PATH_MAX bytes. `String.length` counts UTF-16 units, so the
// bound is measured with TextEncoder.
export function responsePath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0') || new TextEncoder().encode(value).length > RESPONSE_PATH_LIMIT) fail()
  return value as string
}

export function decodeServiceFacts(value: unknown): ServiceFacts {
  const v = exact(value, ['registration', 'interpreter', 'interpreter_exists', 'loaded', 'settings'])
  const facts: ServiceFacts = {
    registration: member(v.registration, REGISTRATIONS),
    interpreter: nullableMember(v.interpreter, INTERPRETERS),
    interpreterExists: nullableFlag(v.interpreter_exists),
    loaded: nullableFlag(v.loaded),
    settings: nullableMember(v.settings, SETTINGS),
  }
  if (facts.registration === 'owned') {
    // An owned manifest always names its interpreter and whether that file is
    // still there; `settings` alone stays null when the home has no parseable
    // configuration to compare the registered pins against.
    if (facts.interpreter === null || facts.interpreterExists === null) fail()
  } else {
    // Nothing was read from a manifest this app can trust.
    if (facts.interpreter !== null || facts.interpreterExists !== null || facts.settings !== null) fail()
    // A loaded job forces "unknown", so "none" is never loaded.
    if (facts.registration === 'none' && facts.loaded === true) fail()
  }
  // `loaded` may be null for any registration: launchctl can be unreachable.
  return facts
}

export function decodeHomeReport(value: unknown): HomeReport {
  const v = exact(value, ['path', 'exists', 'private', 'config', 'backend', 'database', 'registration', 'interpreter', 'loaded', 'process', 'adoptable', 'reason'])
  const report: HomeReport = {
    path: responsePath(v.path),
    exists: flag(v.exists),
    private: flag(v.private),
    config: member(v.config, CONFIGS),
    backend: nullableMember(v.backend, BACKENDS),
    database: member(v.database, DATABASES),
    registration: member(v.registration, REGISTRATIONS),
    interpreter: nullableMember(v.interpreter, INTERPRETERS),
    loaded: nullableFlag(v.loaded),
    process: member(v.process, PROCESSES),
    adoptable: flag(v.adoptable),
    reason: v.reason === null ? null : member(v.reason, HOME_REASONS),
  }
  // `_inspect` returns a fixed report for a path that does not exist, and reads
  // nothing inside one that is not a private 0700 directory. Both are exact.
  const closed = (config: HomeReport['config'], database: HomeReport['database'], registration: Registration) =>
    report.config === config && report.backend === null && report.database === database &&
    report.registration === registration && report.interpreter === null && report.loaded === null &&
    report.process === 'unknown' && !report.adoptable && report.reason === 'home_invalid'
  if (!report.exists && !(!report.private && closed('missing', 'missing', 'none'))) fail()
  if (report.exists && !report.private && !closed('invalid', 'unreadable', 'unknown')) fail()
  // Only a missing configuration file guarantees no backend name: an invalid
  // configuration can still carry the backend it parsed, and a readable one can
  // name a backend outside the three the app knows.
  if (report.config === 'missing' && report.backend !== null) fail()
  // `registration_facts`: an owned registration always names its interpreter and
  // nothing else ever does; a loaded job forces "unknown", so "none" is never loaded.
  if ((report.registration === 'owned') !== (report.interpreter !== null)) fail()
  if (report.registration === 'none' && report.loaded === true) fail()
  // The home report's process pairing.
  if (report.loaded === false ? report.process !== 'stopped' : report.loaded === null && report.process !== 'unknown') fail()
  // `_reason` is total, so adoptable is exactly "no reason", and the only shape it
  // can be true for is a private HikerAPI home whose database is present or not yet
  // created. The converse does not hold: another desktop root's own profile is
  // refused with `home_invalid` while looking otherwise adoptable.
  if (report.adoptable !== (report.reason === null)) fail()
  // `_reason` is total, so every reason it returns implies the state that produced
  // it, and the absence of one implies an adoptable shape. `home_invalid` is the
  // exception: it also covers a private, otherwise perfect home that is another
  // desktop root's own profile, so it constrains nothing. Same table as the host's
  // `inspected()`, so neither boundary accepts a report the other refuses.
  const hikerapi = report.backend === 'hikerapi'
  const verdict = report.reason === null
    ? report.config === 'ok' && hikerapi && (report.database === 'ok' || report.database === 'missing')
    : report.reason === 'home_backend_unsupported' ? report.config === 'ok' && !hikerapi
    : report.reason === 'schema_mismatch' ? report.config === 'ok' && hikerapi && report.database === 'schema_mismatch'
    : report.reason === 'storage_error' ? report.config === 'ok' && hikerapi && report.database === 'unreadable'
    : true
  if (!verdict) fail()
  return report
}

export function decodeBinding(value: unknown): Binding {
  const v = exact(value, ['state', 'home'])
  const state = member(v.state, BINDING_STATES)
  const home = v.home === null ? null : responsePath(v.home)
  // `read_binding` returns a home only for `Adopted`; every binding file it could
  // not fully trust became `Unknown`, with no path to show.
  if ((home !== null) !== (state === 'adopted')) fail()
  return { state, home }
}
