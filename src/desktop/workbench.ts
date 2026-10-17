// Bounded native research boundary and local comparisons.
import { reactive } from 'vue'
import type { Invoke } from './client'
import { decodeLookupProfile, decodeLookupActivity, record, LOOKUP_FIELDS, MAX_TIME, USERNAME, TARGET_PK, type LookupProfile, type LookupActivity, type ChangeValue, type Term } from './dto'
import { DesktopFailure, safeFailure } from './messages'

export interface Usage { day: string; used: number; daily_limit: number | null; reset_at: number }
export interface SaveInput { username: string; target_pk: string; captured_at: number; profile: LookupProfile; activity: LookupActivity | null }
export interface SavedCheck extends SaveInput { id: string; saved_at: number }
const fail = (): never => { throw new DesktopFailure('protocol') }
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : fail()
function exact(v: unknown, keys: string[]): Record<string, unknown> {
  if (!record(v) || Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))) return fail()
  return v
}
export function decodeUsage(value: unknown): Usage {
  const v = exact(value, ['day', 'used', 'daily_limit', 'reset_at'])
  if (typeof v.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return fail()
  const start = Date.parse(`${v.day}T00:00:00Z`)
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== v.day || v.reset_at !== start / 1000 + 86400) return fail()
  const limit = v.daily_limit === null ? null : integer(v.daily_limit, 1_000_000)
  if (limit === 0) return fail()
  return { day: v.day, used: integer(v.used), daily_limit: limit, reset_at: integer(v.reset_at, MAX_TIME) }
}
export function decodeSavedCheck(value: unknown): SavedCheck {
  const v = exact(value, ['id', 'username', 'target_pk', 'captured_at', 'saved_at', 'profile', 'activity'])
  if (typeof v.id !== 'string' || !/^[a-f0-9]{32}$/.test(v.id) || typeof v.username !== 'string' || !USERNAME.test(v.username) || v.username === '.' || v.username === '..' || typeof v.target_pk !== 'string' || !TARGET_PK.test(v.target_pk)) return fail()
  const profile = decodeLookupProfile(v.profile)
  if (profile.target_pk !== v.target_pk) return fail()
  if (v.activity !== null && (!record(v.activity) || ![12, 30, 50].includes(v.activity.window as number))) return fail()
  const activity = v.activity === null ? null : decodeLookupActivity(v.activity, v.target_pk, (v.activity as unknown as LookupActivity).window)
  if (profile.access === 'private' && activity !== null) return fail()
  return { id: v.id, username: v.username, target_pk: v.target_pk, captured_at: integer(v.captured_at, MAX_TIME), saved_at: integer(v.saved_at, MAX_TIME), profile, activity }
}
export class ResearchClient {
  constructor(private invoke: Invoke) {}
  private async call(command: string, args?: Record<string, unknown>) {
    try { return await this.invoke(command, args) } catch (e) { throw safeFailure(e) }
  }
  async list(): Promise<SavedCheck[]> {
    const value = await this.call('research_list')
    if (!Array.isArray(value) || value.length > 100) return fail()
    const items = value.map(decodeSavedCheck)
    if (new Set(items.map(item => item.id)).size !== items.length) return fail()
    return items
  }
  async save(check: SaveInput): Promise<SavedCheck> {
    decodeSavedCheck({ ...check, id: '0'.repeat(32), saved_at: check.captured_at })
    return decodeSavedCheck(await this.call('research_save', { check }))
  }
  async remove(id: string): Promise<boolean> {
    if (!/^[a-f0-9]{32}$/.test(id)) return fail()
    const result = await this.call('research_delete', { id })
    return typeof result === 'boolean' ? result : fail()
  }
  async export(filename: string, contents: string): Promise<boolean> {
    const result = await this.call('research_export', { filename, contents })
    return typeof result === 'boolean' ? result : fail()
  }
}
export function createResearchState(client: ResearchClient) {
  const state = reactive({ items: [] as SavedCheck[], loaded: false, busy: false, error: null as DesktopFailure | null, saved: null as string | null })
  let generation = 0
  let revision = 0
  let latestRead = 0
  async function refresh() {
    if (state.busy) return
    const expected = generation, version = revision, read = ++latestRead
    try { const items = await client.list(); if (expected === generation && version === revision && read === latestRead) { state.items = items; state.loaded = true; state.error = null } }
    catch (e) { if (expected === generation && version === revision && read === latestRead) state.error = safeFailure(e) }
  }
  async function save(input: SaveInput): Promise<boolean> {
    if (state.busy) return false
    const expected = generation
    revision++
    state.busy = true; state.error = null; state.saved = null
    try {
      const existing = state.loaded ? state.items : await client.list()
      if (expected !== generation) return false
      const item = await client.save(input)
      if (expected !== generation) return false
      state.items = [item, ...existing.filter(c => c.id !== item.id)]; state.saved = item.id; state.loaded = true
      return true
    } catch (e) { if (expected === generation) state.error = safeFailure(e); return false }
    finally { if (expected === generation) state.busy = false }
  }
  async function remove(id: string) {
    if (state.busy) return
    const expected = generation
    revision++
    state.busy = true; state.error = null
    try { await client.remove(id); if (expected === generation) state.items = state.items.filter(c => c.id !== id) }
    catch (e) { if (expected === generation) state.error = safeFailure(e) }
    finally { if (expected === generation) state.busy = false }
  }
  function reset() { generation++; state.items = []; state.loaded = false; state.busy = false; state.error = null; state.saved = null }
  return { state, refresh, save, remove, reset, export: client.export.bind(client) }
}
export function compareChecks(left: SavedCheck, right: SavedCheck) {
  const fields = LOOKUP_FIELDS.map(field => ({ field, left: left.profile.fields[field] as ChangeValue | undefined, right: right.profile.fields[field] as ChangeValue | undefined, leftKnown: Object.hasOwn(left.profile.fields, field) && !left.profile.unknown_fields.includes(field), rightKnown: Object.hasOwn(right.profile.fields, field) && !right.profile.unknown_fields.includes(field) }))
    .filter(row => !row.leftKnown || !row.rightKnown || row.left !== row.right)
  const intersect = (a: Term[], b: Term[]) => {
    const other = new Map(b.map(item => [item.key.toLowerCase(), item]))
    return a.flatMap(item => { const found = other.get(item.key.toLowerCase()); return found ? [{ key: item.key, left: item.count, right: found.count }] : [] })
  }
  const common = Object.fromEntries((['hashtags', 'mentions', 'locations'] as const).map(key => [key, intersect(left.activity?.[key] ?? [], right.activity?.[key] ?? [])])) as Record<'hashtags' | 'mentions' | 'locations', { key: string; left: number; right: number }[]>
  return { fields, common }
}
/** Baseline estimate: one profile read and one media page per scheduled cycle. */
export function forecastRequests(watches: readonly { status: string; interval_seconds: number }[]): number {
  return Math.ceil(watches.filter(watch => watch.status === 'active' && watch.interval_seconds >= 300).reduce((sum, watch) => sum + 86400 / watch.interval_seconds * 2, 0))
}
