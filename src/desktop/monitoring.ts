import { computed, reactive } from 'vue'
import type { DesktopClient } from './client'
import type { Overview, Watch } from './dto'
import { safeFailure, type DesktopFailure } from './messages'

export interface MonitoringOptions { intervalMs?: number; now?: () => number; visible?: () => boolean; target?: EventTarget | null }
const REFRESH_AFTER = new Set(['watch_conflict', 'watch_not_found', 'watch_exists', 'watch_limit', 'outcome_unknown', 'operation_timeout'])
// The overview carries the first page of registrations; the active cap is 3 but
// paused rows are unbounded, so a read follows the cursor (bounded) to keep every
// registration reachable.
export const MAX_WATCH_PAGES = 20

export function createMonitoringState(client: DesktopClient, options: MonitoringOptions = {}) {
  const intervalMs = options.intervalMs ?? 5000
  const now = options.now ?? Date.now
  const visible = options.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const target = options.target === undefined ? (typeof document === 'undefined' ? null : document) : options.target
  const state = reactive({
    overview: null as Overview | null, loading: false, busy: false, stale: false, lastReadAt: null as number | null,
    readError: null as DesktopFailure | null, error: null as DesktopFailure | null, outcomeUnknown: false,
    selectedUser: null as string | null, polling: false,
  })
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<boolean> | null = null
  let disposed = false
  const selected = computed(() => state.overview?.watches.find(item => item.user === state.selectedUser) ?? null)
  async function fetchOverview(): Promise<Overview> {
    const overview = await client.overview()
    let cursor = overview.next_cursor
    for (let pages = 1; cursor !== null && pages < MAX_WATCH_PAGES; pages++) {
      const page = await client.listWatches({ cursor })
      overview.watches.push(...page.items); cursor = page.next_cursor
    }
    overview.next_cursor = cursor
    return overview
  }
  // The internal read: polling and reconciliation. It never touches outcomeUnknown.
  function read(): Promise<boolean> {
    if (disposed) return Promise.resolve(false)
    if (inFlight) return inFlight
    state.loading = true
    inFlight = (async () => {
      try {
        const overview = await fetchOverview()
        if (disposed) return false
        state.overview = overview; state.stale = false; state.readError = null; state.lastReadAt = now()
        if (state.selectedUser !== null && !overview.watches.some(item => item.user === state.selectedUser)) state.selectedUser = null
        return true
      } catch (error) {
        if (!disposed) { state.stale = state.overview !== null; state.readError = safeFailure(error) }
        return false
      } finally { state.loading = false; inFlight = null }
    })()
    return inFlight
  }
  // The explicit user refresh acknowledges an uncertain outcome.
  function refresh(): Promise<boolean> { state.outcomeUnknown = false; return read() }
  // Reconciliation must observe the database after the mutation ended: wait for a
  // poll that was already in flight, then start a fresh read.
  async function reconcile(): Promise<boolean> { if (inFlight) await inFlight; return read() }
  function clearTimer() { if (timer !== null) { clearInterval(timer); timer = null } }
  function schedule() { clearTimer(); timer = setInterval(() => { if (visible()) void read() }, intervalMs) }
  function onVisibility() { if (visible()) { void read(); schedule() } else clearTimer() }
  function start() {
    if (disposed || state.polling) return
    state.polling = true
    target?.addEventListener('visibilitychange', onVisibility)
    void read(); schedule()
  }
  function stop() {
    if (!state.polling) return
    state.polling = false; clearTimer(); target?.removeEventListener('visibilitychange', onVisibility)
  }
  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    if (disposed || state.busy || state.stale || state.overview === null) return false
    state.busy = true; state.error = null; state.outcomeUnknown = false
    try { await action(); if (disposed) return false; await reconcile(); return true }
    catch (error) {
      if (disposed) return false
      const failure = safeFailure(error)
      state.outcomeUnknown = failure.code === 'outcome_unknown' || failure.code === 'operation_timeout'
      // A rejected or uncertain mutation is reconciled by one read, never replayed.
      if (REFRESH_AFTER.has(failure.code)) await reconcile()
      if (!disposed) state.error = failure
      return false
    } finally { state.busy = false }
  }
  return {
    state, selected, refresh, reconcile, start, stop,
    select(user: string | null) { state.selectedUser = user },
    add: (user: string, interval: number) => mutate(() => client.addWatch(user, interval)),
    update: (watch: Watch, interval: number) => mutate(() => client.updateWatch(watch, interval)),
    pause: (watch: Watch) => mutate(() => client.pauseWatch(watch)),
    resume: (watch: Watch) => mutate(() => client.resumeWatch(watch)),
    remove: (watch: Watch) => mutate(async () => { await client.removeWatch(watch); if (state.selectedUser === watch.user) state.selectedUser = null }),
    dispose() { disposed = true; stop() },
  }
}
