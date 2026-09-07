import { DesktopFailure, safeFailure } from './messages'
import { CHANGE_KINDS, HISTORY_CURSOR, SNAPSHOT_KINDS, TARGET_KINDS, TARGET_PK, REVISION, USERNAME, WATCH_CURSOR, decodeComparison, decodeHistoryPage, decodeOverview, decodeRemoved, decodeWatch, decodeWatchPage, record, validSnapshotId, type Comparison, type HistoryPage, type Overview, type Watch, type WatchPage } from './dto'
export const CORE_VERSION = '0.7.22'
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
export type Status = 'unconfigured' | 'recovery_required' | 'quota_exhausted' | 'running' | 'stopped' | 'service_error'
export interface Profile {
  configured: boolean
  status: Status
  desired_service: 'running' | 'stopped' | null
  service_running: boolean
  quota_remaining: number | null
  quota_checked_at: number | null
  revision: string | null
}
export interface RuntimeInfo { core_version: string; build_id: string }
export const validToken = (token: string) => /^[\x21-\x7e]{4,4096}$/.test(token)
const statuses = new Set(['unconfigured', 'recovery_required', 'quota_exhausted', 'running', 'stopped', 'service_error'])
const profileKeys = ['configured', 'status', 'desired_service', 'service_running', 'quota_remaining', 'quota_checked_at', 'revision']
function nullableNumber(value: unknown) { return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) }
function profile(value: unknown): Profile {
  if (!record(value) || Object.keys(value).length !== 7 || !profileKeys.every(key => Object.hasOwn(value, key)) || typeof value.configured !== 'boolean' || typeof value.service_running !== 'boolean' || typeof value.status !== 'string' || !statuses.has(value.status) || ![null, 'running', 'stopped'].includes(value.desired_service as null | string) || !nullableNumber(value.quota_remaining) || !nullableNumber(value.quota_checked_at) || !(value.revision === null || typeof value.revision === 'string' && /^[0-9a-f]{32}$/.test(value.revision))) throw new DesktopFailure('protocol')
  return value as unknown as Profile
}
export const MIN_INTERVAL = 300
export const MAX_INTERVAL = 2147483647
export function canonicalUsername(raw: string): string | null {
  const user = raw.replace(/^@+/, '').trim().toLowerCase()
  return USERNAME.test(user) && user !== '.' && user !== '..' ? user : null
}
export const validInterval = (value: number) => Number.isSafeInteger(value) && value >= MIN_INTERVAL && value <= MAX_INTERVAL
export interface WatchRef { user: string; revision: string }
export interface Page { limit?: number; cursor?: string }
// The host admits two concurrent reads; a third would fail with `busy`. Queue
// reads in the client so polling, history and service reads never collide.
export const READ_SLOTS = 2
const READ_COMMANDS = new Set(['inspect_setup', 'read_overview', 'list_watches', 'search_targets', 'list_snapshots', 'compare_snapshots', 'list_changes'])
class ReadGate {
  private active = 0
  private readonly waiting: (() => void)[] = []
  async run<T>(work: () => Promise<T>): Promise<T> {
    // A waiter receives the finishing call's permit directly; the count only
    // drops when nobody waits, so a third call can never slip in during hand-off.
    if (this.active >= READ_SLOTS) await new Promise<void>(resolve => { this.waiting.push(resolve) })
    else this.active++
    try { return await work() } finally { const next = this.waiting.shift(); if (next) next(); else this.active-- }
  }
}
function pageArgs(page: Page, cursorPattern: RegExp, code: 'invalid_watch_input' | 'invalid_history_input'): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  if (page.limit !== undefined) { if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50) throw new DesktopFailure(code); args.limit = page.limit }
  if (page.cursor !== undefined) { if (!cursorPattern.test(page.cursor)) throw new DesktopFailure(code); args.cursor = page.cursor }
  return args
}
function ref(value: WatchRef): WatchRef {
  if (canonicalUsername(value.user) !== value.user || !REVISION.test(value.revision)) throw new DesktopFailure('invalid_watch_input')
  return { user: value.user, revision: value.revision }
}
function pk(value: string): string { if (!TARGET_PK.test(value)) throw new DesktopFailure('invalid_history_input'); return value }
export class DesktopClient {
  constructor(private readonly invoke: Invoke) {}
  private readonly gate = new ReadGate()
  private async call(command: string, args?: Record<string, unknown>): Promise<unknown> {
    try { return args ? await this.invoke(command, args) : await this.invoke(command) }
    catch (error) { throw safeFailure(error) }
  }
  private async exchange<T>(command: string, kind: string, decode: (data: unknown) => T, args?: Record<string, unknown>): Promise<T> {
    const response = await this.call(command, args)
    if (!record(response) || Object.keys(response).length !== 2) throw new DesktopFailure('protocol')
    if (response.kind === 'error') throw safeFailure(response.data)
    if (response.kind !== kind) throw new DesktopFailure('protocol')
    return decode(response.data)
  }
  private read<T>(command: string, kind: string, decode: (data: unknown) => T, args?: Record<string, unknown>): Promise<T> {
    return READ_COMMANDS.has(command) ? this.gate.run(() => this.exchange(command, kind, decode, args)) : this.exchange(command, kind, decode, args)
  }
  private readProfile(command: string, args?: Record<string, unknown>) { return this.read(command, 'profile', profile, args) }
  async prepare(): Promise<RuntimeInfo> {
    const result = await this.call('prepare_desktop')
    if (!record(result) || Object.keys(result).length !== 2 || result.core_version !== CORE_VERSION || typeof result.build_id !== 'string' || !/^[0-9a-f]{64}$/.test(result.build_id)) throw new DesktopFailure('protocol')
    return result as unknown as RuntimeInfo
  }
  inspect() { return this.readProfile('inspect_setup') }
  async configure(token: string) {
    if (!validToken(token)) throw new DesktopFailure('invalid_token_input')
    return this.readProfile('configure_setup', { credentials: { token } })
  }
  async replace(token: string) {
    if (!validToken(token)) throw new DesktopFailure('invalid_token_input')
    return this.readProfile('replace_credentials', { credentials: { token } })
  }
  start() { return this.readProfile('start_service') }
  stop() { return this.readProfile('stop_service') }
  repair() { return this.readProfile('repair_service') }
  async openTokenPage() { await this.call('open_token_page') }
  overview(): Promise<Overview> { return this.read('read_overview', 'overview', decodeOverview) }
  async listWatches(page: Page = {}): Promise<WatchPage> { return this.read('list_watches', 'watch_page', decodeWatchPage, { page: pageArgs(page, WATCH_CURSOR, 'invalid_watch_input') }) }
  async addWatch(user: string, intervalSeconds?: number): Promise<Watch> {
    if (canonicalUsername(user) !== user || (intervalSeconds !== undefined && !validInterval(intervalSeconds))) throw new DesktopFailure('invalid_watch_input')
    return this.read('add_watch', 'watch', decodeWatch, { watch: intervalSeconds === undefined ? { user } : { user, interval_seconds: intervalSeconds } })
  }
  async updateWatch(target: WatchRef, intervalSeconds: number): Promise<Watch> {
    if (!validInterval(intervalSeconds)) throw new DesktopFailure('invalid_watch_input')
    return this.read('update_watch', 'watch', decodeWatch, { watch: { ...ref(target), interval_seconds: intervalSeconds } })
  }
  async pauseWatch(target: WatchRef): Promise<Watch> { return this.read('pause_watch', 'watch', decodeWatch, { watch: ref(target) }) }
  async resumeWatch(target: WatchRef): Promise<Watch> { return this.read('resume_watch', 'watch', decodeWatch, { watch: ref(target) }) }
  async removeWatch(target: WatchRef): Promise<string> { return this.read('remove_watch', 'removed', decodeRemoved, { watch: ref(target) }) }
  async searchTargets(username: string, page: Page = {}): Promise<HistoryPage> {
    if (canonicalUsername(username) !== username) throw new DesktopFailure('invalid_history_input')
    return this.read('search_targets', 'history_page', data => decodeHistoryPage(data, TARGET_KINDS, null, page.limit ?? 50), { query: { username, ...pageArgs(page, HISTORY_CURSOR, 'invalid_history_input') } })
  }
  async listSnapshots(targetPk: string, page: Page = {}): Promise<HistoryPage> {
    return this.read('list_snapshots', 'history_page', data => decodeHistoryPage(data, SNAPSHOT_KINDS, targetPk, page.limit ?? 50), { query: { target_pk: pk(targetPk), ...pageArgs(page, HISTORY_CURSOR, 'invalid_history_input') } })
  }
  async compareSnapshots(targetPk: string, olderId: string, newerId: string): Promise<Comparison> {
    if (!validSnapshotId(olderId) || !validSnapshotId(newerId) || olderId === newerId) throw new DesktopFailure('invalid_history_input')
    const comparison = await this.read('compare_snapshots', 'comparison', decodeComparison, { pair: { target_pk: pk(targetPk), older_id: olderId, newer_id: newerId } })
    if (comparison.older.id !== olderId || comparison.newer.id !== newerId || comparison.older.target_pk !== targetPk) throw new DesktopFailure('protocol')
    return comparison
  }
  async listChanges(query: Page & { target_pk?: string } = {}): Promise<HistoryPage> {
    const filter = query.target_pk === undefined ? null : pk(query.target_pk)
    return this.read('list_changes', 'history_page', data => decodeHistoryPage(data, CHANGE_KINDS, filter, query.limit ?? 50), { query: { ...(filter === null ? {} : { target_pk: filter }), ...pageArgs(query, HISTORY_CURSOR, 'invalid_history_input') } })
  }
}
