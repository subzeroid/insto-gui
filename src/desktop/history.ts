import { reactive } from 'vue'
import type { DesktopClient } from './client'
import type { Comparison, HistoryItem, HistoryPage, Snapshot } from './dto'
import { safeFailure, type DesktopFailure } from './messages'

interface Loadable { loading: boolean; error: DesktopFailure | null }
const emptySnapshots = () => ({ items: [] as Snapshot[], diagnostics: 0, cursor: null as string | null, loading: false, error: null as DesktopFailure | null, loaded: false })
const emptyTargets = () => ({ pks: [] as string[], newest: {} as Record<string, Snapshot>, diagnostics: 0, scanned: 0, scanComplete: false, cursor: null as string | null, loading: false, error: null as DesktopFailure | null })
const emptyFeed = () => ({ items: [] as HistoryItem[], filterPk: null as string | null, cursor: null as string | null, scanComplete: false, scanned: 0, loading: false, error: null as DesktopFailure | null, loaded: false })

export function createHistoryState(client: DesktopClient) {
  const state = reactive({
    username: null as string | null,
    targets: emptyTargets(),
    targetPk: null as string | null,
    snapshots: emptySnapshots(),
    pair: { olderId: null as string | null, newerId: null as string | null },
    comparison: { value: null as Comparison | null, loading: false, error: null as DesktopFailure | null },
    feed: emptyFeed(),
  })
  let generation = 0        // username scope: targets
  let listGeneration = 0    // chosen PK's snapshot list: first page, more pages, recovery reload
  let pairGeneration = 0    // chosen pair scope: comparison
  let feedGeneration = 0
  async function guard<T>(part: Loadable, current: () => number, expected: number, work: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
    part.loading = true; part.error = null
    try { const value = await work(); if (current() !== expected) return false; apply(value); return true }
    catch (error) { if (current() === expected) part.error = safeFailure(error); return false }
    finally { if (current() === expected) part.loading = false }
  }
  const selection = () => generation
  const listSelection = () => listGeneration
  const pairSelection = () => pairGeneration
  const feedSelection = () => feedGeneration
  function reset() {
    generation++; listGeneration++; pairGeneration++
    state.username = null; state.targets = emptyTargets(); state.targetPk = null; state.snapshots = emptySnapshots()
    state.pair = { olderId: null, newerId: null }; state.comparison = { value: null, loading: false, error: null }
  }
  // `reset()` is the username scope — WatchesView calls it whenever the watch
  // selection is cleared, and the changes feed must survive that. A home selection
  // is wider: the feed describes the previous home too, and a page already in
  // flight for it is dropped by the feed generation.
  function resetHome() {
    reset()
    feedGeneration++
    state.feed = emptyFeed()
  }
  // Identity is concluded automatically only from complete, diagnostic-free
  // evidence (product spec section 7); anything else needs an explicit choice.
  async function settleSelection(expected: number) {
    if (generation !== expected || state.targetPk !== null) return
    if (state.targets.scanComplete && state.targets.diagnostics === 0 && state.targets.pks.length === 1) await chooseTarget(state.targets.pks[0])
  }
  function absorbTargets(result: HistoryPage) {
    for (const item of result.items) {
      if (item.kind === 'target') {
        if (!state.targets.pks.includes(item.target_pk)) { state.targets.pks.push(item.target_pk); state.targets.newest[item.target_pk] = item.snapshot }
      } else state.targets.diagnostics++
    }
    state.targets.scanned += result.scanned; state.targets.cursor = result.next_cursor; state.targets.scanComplete = result.scan_complete
  }
  function absorbSnapshots(result: HistoryPage, first: boolean) {
    if (first) { state.snapshots.items = []; state.snapshots.diagnostics = 0 }
    for (const item of result.items) { if (item.kind === 'snapshot') state.snapshots.items.push(item.snapshot); else state.snapshots.diagnostics++ }
    state.snapshots.cursor = result.next_cursor; state.snapshots.loaded = true
  }
  async function load(username: string) {
    reset(); const expected = generation; state.username = username
    if (await guard(state.targets, selection, expected, () => client.searchTargets(username), absorbTargets)) await settleSelection(expected)
  }
  async function reload() { if (state.username !== null) await load(state.username) }
  async function continueSearch() {
    const cursor = state.targets.cursor, username = state.username, expected = generation
    if (username === null || cursor === null || state.targets.loading) return
    if (await guard(state.targets, selection, expected, () => client.searchTargets(username, { cursor }), absorbTargets)) await settleSelection(expected)
  }
  async function defaultPair(recovered = false) {
    if (state.snapshots.items.length >= 2) await attemptPair(state.snapshots.items[1].id, state.snapshots.items[0].id, recovered)
  }
  async function chooseTarget(pk: string) {
    listGeneration++; pairGeneration++
    const expected = listGeneration
    state.targetPk = pk; state.snapshots = emptySnapshots(); state.pair = { olderId: null, newerId: null }; state.comparison = { value: null, loading: false, error: null }
    if (await guard(state.snapshots, listSelection, expected, () => client.listSnapshots(pk), result => absorbSnapshots(result, true))) await defaultPair()
  }
  async function moreSnapshots() {
    const pk = state.targetPk, cursor = state.snapshots.cursor
    if (pk === null || cursor === null || state.snapshots.loading) return
    await guard(state.snapshots, listSelection, listGeneration, () => client.listSnapshots(pk, { cursor }), result => absorbSnapshots(result, false))
  }
  // `recovered` marks the single automatic retry after retention removed a chosen
  // snapshot; a second `snapshot_unavailable` leaves the error visible and stops.
  async function attemptPair(olderId: string, newerId: string, recovered: boolean) {
    const pk = state.targetPk
    if (pk === null) return
    pairGeneration++
    const expected = pairGeneration
    state.pair = { olderId, newerId }; state.comparison.value = null
    const ok = await guard(state.comparison, pairSelection, expected, () => client.compareSnapshots(pk, olderId, newerId), value => { state.comparison.value = value })
    if (ok || recovered || pairGeneration !== expected || state.comparison.error?.code !== 'snapshot_unavailable') return
    // Retention removed a selected snapshot: reload the list once and fall back to
    // the newest pair. Bumping the list generation drops any page still in flight.
    state.pair = { olderId: null, newerId: null }
    listGeneration++
    if (await guard(state.snapshots, listSelection, listGeneration, () => client.listSnapshots(pk), result => absorbSnapshots(result, true))) await defaultPair(true)
  }
  async function choosePair(olderId: string, newerId: string) { await attemptPair(olderId, newerId, false) }
  function absorbFeed(result: HistoryPage) {
    state.feed.items.push(...result.items); state.feed.cursor = result.next_cursor; state.feed.scanComplete = result.scan_complete; state.feed.scanned += result.scanned; state.feed.loaded = true
  }
  async function loadFeed(filterPk: string | null = null) {
    feedGeneration++; const expected = feedGeneration
    state.feed = emptyFeed(); state.feed.filterPk = filterPk
    await guard(state.feed, feedSelection, expected, () => client.listChanges(filterPk === null ? {} : { target_pk: filterPk }), absorbFeed)
  }
  async function moreFeed() {
    const cursor = state.feed.cursor, filterPk = state.feed.filterPk
    if (cursor === null || state.feed.loading) return
    await guard(state.feed, feedSelection, feedGeneration, () => client.listChanges(filterPk === null ? { cursor } : { target_pk: filterPk, cursor }), absorbFeed)
  }
  return { state, load, reload, continueSearch, chooseTarget, moreSnapshots, choosePair, loadFeed, moreFeed, reset, resetHome }
}
