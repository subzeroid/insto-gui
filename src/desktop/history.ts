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
  let targetGeneration = 0  // chosen PK scope: snapshots
  let pairGeneration = 0    // chosen pair scope: comparison
  let feedGeneration = 0
  async function guard<T>(part: Loadable, current: () => number, expected: number, work: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
    part.loading = true; part.error = null
    try { const value = await work(); if (current() !== expected) return false; apply(value); return true }
    catch (error) { if (current() === expected) part.error = safeFailure(error); return false }
    finally { if (current() === expected) part.loading = false }
  }
  const selection = () => generation
  const targetSelection = () => targetGeneration
  const pairSelection = () => pairGeneration
  const feedSelection = () => feedGeneration
  function reset() {
    generation++; targetGeneration++; pairGeneration++
    state.username = null; state.targets = emptyTargets(); state.targetPk = null; state.snapshots = emptySnapshots()
    state.pair = { olderId: null, newerId: null }; state.comparison = { value: null, loading: false, error: null }
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
  async function defaultPair() {
    if (state.snapshots.items.length >= 2) await choosePair(state.snapshots.items[1].id, state.snapshots.items[0].id)
  }
  async function chooseTarget(pk: string) {
    targetGeneration++; pairGeneration++
    const expected = targetGeneration
    state.targetPk = pk; state.snapshots = emptySnapshots(); state.pair = { olderId: null, newerId: null }; state.comparison = { value: null, loading: false, error: null }
    if (await guard(state.snapshots, targetSelection, expected, () => client.listSnapshots(pk), result => absorbSnapshots(result, true))) await defaultPair()
  }
  async function moreSnapshots() {
    const pk = state.targetPk, cursor = state.snapshots.cursor
    if (pk === null || cursor === null || state.snapshots.loading) return
    await guard(state.snapshots, targetSelection, targetGeneration, () => client.listSnapshots(pk, { cursor }), result => absorbSnapshots(result, false))
  }
  async function choosePair(olderId: string, newerId: string) {
    const pk = state.targetPk
    if (pk === null) return
    pairGeneration++
    const expected = pairGeneration, target = targetGeneration
    state.pair = { olderId, newerId }; state.comparison.value = null
    const ok = await guard(state.comparison, pairSelection, expected, () => client.compareSnapshots(pk, olderId, newerId), value => { state.comparison.value = value })
    if (!ok && pairGeneration === expected && state.comparison.error?.code === 'snapshot_unavailable') {
      // Retention removed a selected snapshot: reload the list and fall back to the newest pair.
      state.pair = { olderId: null, newerId: null }
      if (await guard(state.snapshots, targetSelection, target, () => client.listSnapshots(pk), result => absorbSnapshots(result, true))) await defaultPair()
    }
  }
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
  return { state, load, reload, continueSearch, chooseTarget, moreSnapshots, choosePair, loadFeed, moreFeed, reset }
}
