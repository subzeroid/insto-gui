import { describe, expect, it } from 'vitest'
import { DesktopClient, CORE_VERSION, MIN_INTERVAL } from './client'
import { createMockInvoke } from './mock'

// The mock exists to be decoded: a payload the real client would refuse is worse
// than no mock at all, because it produces a screenshot of a screen the app can
// never show. Every read the app performs at boot and in each section is driven
// through `DesktopClient`, so `dto.ts` is the judge here, not this file.
const client = () => new DesktopClient(createMockInvoke())

describe('mock desktop', () => {
  it('prepares and inspects a configured, running profile', async () => {
    const desktop = client()
    const runtime = await desktop.prepare()
    expect(runtime.core_version).toBe(CORE_VERSION)
    const profile = await desktop.inspect()
    expect(profile.configured).toBe(true)
    expect(profile.status).toBe('running')
    expect(profile.quota_remaining).toBeGreaterThan(0)
  })

  it('answers the binding and the registration facts', async () => {
    const desktop = client()
    expect(await desktop.inspectBinding()).toEqual({ state: 'own', home: null })
    const facts = await desktop.inspectService()
    // Owned, on this app's own runtime: nothing to migrate, nothing read-only.
    expect(facts.registration).toBe('owned')
    expect(facts.interpreter).toBe('current')
  })

  it('lists a believable set of watches, sorted and mixed', async () => {
    const overview = await client().overview()
    expect(overview.watches.length).toBeGreaterThanOrEqual(5)
    expect(overview.watches.length).toBeLessThanOrEqual(7)
    expect(overview.service_state).toBe('running')
    expect(overview.watches.map(watch => watch.user)).toEqual([...overview.watches.map(watch => watch.user)].sort())
    expect(overview.watches.some(watch => watch.status === 'active')).toBe(true)
    expect(overview.watches.some(watch => watch.status === 'paused')).toBe(true)
    expect(overview.watches.some(watch => watch.has_error)).toBe(true)
    expect(overview.watches.some(watch => watch.waiting_first_check)).toBe(true)
    expect(overview.watches.every(watch => watch.interval_seconds >= MIN_INTERVAL)).toBe(true)
  })

  it('serves the same page through list_watches', async () => {
    const desktop = client()
    const page = await desktop.listWatches()
    expect(page.next_cursor).toBeNull()
    expect(page.items).toEqual((await desktop.overview()).watches)
  })

  it('resolves a watch to one saved history and compares its newest pair', async () => {
    const desktop = client()
    const { watches } = await desktop.overview()
    const checked = watches.find(watch => !watch.waiting_first_check)!
    const targets = await desktop.searchTargets(checked.user)
    expect(targets.scan_complete).toBe(true)
    expect(targets.items).toHaveLength(1)
    const target = targets.items[0]
    expect(target.kind).toBe('target')
    const pk = target.kind === 'target' ? target.target_pk : ''
    const snapshots = await desktop.listSnapshots(pk)
    expect(snapshots.items.length).toBeGreaterThanOrEqual(2)
    const ids = snapshots.items.map(item => (item.kind === 'snapshot' ? item.snapshot.id : ''))
    const comparison = await desktop.compareSnapshots(pk, ids[1], ids[0])
    expect(comparison.changes.length).toBeGreaterThan(0)
    // A hand-picked, non-adjacent pair is folded rather than refused.
    if (ids.length >= 3) expect((await desktop.compareSnapshots(pk, ids[2], ids[0])).older.id).toBe(ids[2])
  })

  it('builds a non-trivial change feed that filters by account', async () => {
    const desktop = client()
    const feed = await desktop.listChanges()
    expect(feed.items.length).toBeGreaterThan(8)
    expect(feed.scan_complete).toBe(true)
    const kinds = new Set(feed.items.map(item => item.kind))
    expect(kinds.has('comparison')).toBe(true)
    expect(kinds.has('baseline')).toBe(true)
    expect(kinds.has('incomplete')).toBe(true)
    const pk = feed.items.map(item => (item.kind === 'comparison' || item.kind === 'incomplete' ? item.newer.target_pk : item.snapshot.target_pk))[0]
    const filtered = await desktop.listChanges({ target_pk: pk })
    expect(filtered.items.length).toBeGreaterThan(0)
  })

  it('reports gains and losses, text and flags in the feed', async () => {
    const changes = (await client().listChanges()).items.flatMap(item => (item.kind === 'comparison' || item.kind === 'incomplete' ? item.changes : []))
    const followers = changes.filter(change => change.field === 'follower_count')
    expect(followers.some(change => Number(change.new) > Number(change.old))).toBe(true)
    expect(followers.some(change => Number(change.new) < Number(change.old))).toBe(true)
    expect(changes.some(change => change.field === 'biography')).toBe(true)
    expect(changes.some(change => change.field === 'avatar')).toBe(true)
    expect(changes.some(change => typeof change.new === 'boolean')).toBe(true)
  })

  it('accepts the watch mutations and reflects them in the next read', async () => {
    const desktop = client()
    const before = (await desktop.overview()).watches
    const added = await desktop.addWatch('quillon.works', 1800)
    expect(added.waiting_first_check).toBe(true)
    const paused = await desktop.pauseWatch(added)
    expect(paused.status).toBe('paused')
    const resumed = await desktop.resumeWatch(paused)
    const retimed = await desktop.updateWatch(resumed, 900)
    expect(retimed.interval_seconds).toBe(900)
    expect(await desktop.removeWatch(retimed)).toBe('quillon.works')
    expect((await desktop.overview()).watches).toHaveLength(before.length)
  })

  it('accepts the setup, service and home mutations', async () => {
    const desktop = client()
    expect((await desktop.replace('demo-token-not-a-real-credential')).configured).toBe(true)
    expect((await desktop.stop()).service_running).toBe(false)
    expect((await desktop.start()).service_running).toBe(true)
    expect((await desktop.repair()).status).toBe('running')
    const report = await desktop.inspectHome('~/.insto')
    expect(report.adoptable).toBe(true)
    expect((await desktop.selectHome(report.path)).configured).toBe(true)
    expect((await desktop.inspectBinding()).state).toBe('adopted')
    await desktop.selectHome(null)
    expect((await desktop.inspectBinding()).state).toBe('own')
    await desktop.migrateService()
    expect((await desktop.inspectService()).interpreter).toBe('current')
    await desktop.uninstallService()
    expect((await desktop.inspectService()).registration).toBe('none')
    await desktop.openTokenPage()
  })

  it('refuses a home it does not know', async () => {
    const report = await client().inspectHome('/tmp/not-an-insto-home')
    expect(report.exists).toBe(false)
    expect(report.adoptable).toBe(false)
  })
})
