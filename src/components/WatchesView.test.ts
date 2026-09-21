import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi, type Mock } from 'vitest'
import WatchesView from './WatchesView.vue'
import { DesktopClient, type Invoke } from '../desktop/client'
import { createHistoryState } from '../desktop/history'
import { createMonitoringState } from '../desktop/monitoring'
import { envelope, overview, page, profileFields, snap, watch } from '../desktop/fixtures'

describe('watches view', () => {
  it('selects a row without network, confirms removal in page and shows the empty call to action', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(envelope('overview', overview))
      .mockResolvedValueOnce(envelope('history_page', page([])))
      .mockResolvedValueOnce(envelope('removed', { removed_user: 'alice' }))
      .mockResolvedValueOnce(envelope('overview', { ...overview, watches: [] }))
    const client = new DesktopClient(invoke)
    const monitoring = createMonitoringState(client, { target: null })
    const history = createHistoryState(client)
    const wrapper = mount(WatchesView, { props: { monitoring, history } })
    await monitoring.refresh(); await flushPromises()
    await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets'])
    await wrapper.get('button[data-action="remove"]').trigger('click')
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('The snapshot history stays')
    await wrapper.get('button[data-action="confirm-remove"]').trigger('click'); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets', 'remove_watch', 'read_overview'])
    expect(wrapper.text()).toContain('No watches yet')
    expect(window.localStorage.length).toBe(0)
  })
  it('reloads the selected history when a new check lands or the same row is clicked again', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(envelope('overview', overview))
      .mockResolvedValueOnce(envelope('history_page', page([])))
      .mockResolvedValueOnce(envelope('overview', { ...overview, watches: [{ ...watch, last_ok: 1_700_000_000, waiting_first_check: false }] }))
      .mockResolvedValueOnce(envelope('history_page', page([])))
      .mockResolvedValueOnce(envelope('history_page', page([])))
    const client = new DesktopClient(invoke)
    const monitoring = createMonitoringState(client, { target: null })
    const wrapper = mount(WatchesView, { props: { monitoring, history: createHistoryState(client) } })
    await monitoring.refresh(); await flushPromises()
    await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
    await monitoring.refresh(); await flushPromises()
    await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets', 'read_overview', 'search_targets', 'search_targets'])
  })
  it('keeps the loaded history across a poll that brought no new check', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(envelope('overview', overview))
      .mockResolvedValueOnce(envelope('history_page', page([])))
      .mockResolvedValueOnce(envelope('overview', overview))
    const client = new DesktopClient(invoke)
    const monitoring = createMonitoringState(client, { target: null })
    const wrapper = mount(WatchesView, { props: { monitoring, history: createHistoryState(client) } })
    await monitoring.refresh(); await flushPromises()
    await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
    await monitoring.refresh(); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets', 'read_overview'])
    expect(wrapper.text()).toContain('No history yet')
  })
  // ── the first-check poll ──────────────────────────────────────────────────
  // Every tick is a local read of the saved history. `monitoring` already polls
  // `read_overview` on the same five-second cadence, so the view adds no second
  // overview read; these tests drive the view's own timer only.
  const waiting = watch                                         // alice, never checked, active
  const other = { ...watch, user: 'bob', revision: 'b'.repeat(64) }
  const landed = { ...watch, last_ok: 1_770_000_000, waiting_first_check: false }
  const twoWatches = { ...overview, watches: [waiting, other] }
  const mounted = (invoke: Mock<Invoke>, options: { visible?: () => boolean } = {}) => {
    const client = new DesktopClient(invoke)
    const monitoring = createMonitoringState(client, { target: null, ...options })
    const history = createHistoryState(client)
    return { monitoring, history, wrapper: mount(WatchesView, { props: { monitoring, history } }) }
  }

  it('re-reads the saved history every five seconds and stops once the first snapshot is there', async () => {
    vi.useFakeTimers()
    try {
      const invoke = vi.fn()
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValueOnce(envelope('history_page', page([])))       // the selection
        .mockResolvedValueOnce(envelope('history_page', page([])))       // tick 1: still nothing
        .mockResolvedValueOnce(envelope('history_page', page([{ kind: 'target', target_pk: '7', snapshot: snap('2', '7', 2) }])))
        .mockResolvedValueOnce(envelope('history_page', page([{ kind: 'snapshot', snapshot: snap('2', '7', 2) }])))
        .mockResolvedValueOnce(envelope('snapshot_fields', profileFields('2', '7', 2)))
      const { monitoring, wrapper } = mounted(invoke)
      await monitoring.refresh(); await flushPromises()
      await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets'])
      // Nothing happens between the ticks, and the tick never re-reads the overview.
      await vi.advanceTimersByTimeAsync(4_999); await flushPromises()
      expect(invoke).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1); await flushPromises()
      expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets', 'search_targets'])
      await vi.advanceTimersByTimeAsync(5_000); await flushPromises()
      expect(invoke.mock.calls.map(call => call[0])).toEqual([
        'read_overview', 'search_targets', 'search_targets',
        'search_targets', 'list_snapshots', 'read_snapshot',
      ])
      expect(wrapper.text()).toContain('Alice Harbour')
      // The snapshot is there, so the timer is gone.
      const settled = invoke.mock.calls.length
      await vi.advanceTimersByTimeAsync(20_000); await flushPromises()
      expect(invoke).toHaveBeenCalledTimes(settled)
      expect(vi.getTimerCount()).toBe(0)
      wrapper.unmount()
    } finally { vi.useRealTimers() }
  })
  it('reads nothing while the document is hidden, and resumes when it is visible again', async () => {
    vi.useFakeTimers()
    try {
      let shown = false
      const invoke = vi.fn()
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValue(envelope('history_page', page([])))
      const { monitoring, wrapper } = mounted(invoke, { visible: () => shown })
      await monitoring.refresh(); await flushPromises()
      await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      const selected = invoke.mock.calls.length
      // The timer still fires — the same gate `monitoring` uses simply does no work.
      await vi.advanceTimersByTimeAsync(20_000); await flushPromises()
      expect(invoke).toHaveBeenCalledTimes(selected)
      shown = true
      await vi.advanceTimersByTimeAsync(5_000); await flushPromises()
      expect(invoke.mock.calls.map(call => call[0]).slice(selected)).toEqual(['search_targets'])
      wrapper.unmount()
    } finally { vi.useRealTimers() }
  })
  it('never lets two ticks overlap, however long a read takes', async () => {
    vi.useFakeTimers()
    try {
      const invoke = vi.fn()
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValueOnce(envelope('history_page', page([])))
        .mockImplementationOnce(() => new Promise(() => {}))  // a scan that outlasts the interval
        .mockResolvedValue(envelope('history_page', page([])))
      const { monitoring, wrapper } = mounted(invoke)
      await monitoring.refresh(); await flushPromises()
      await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      await vi.advanceTimersByTimeAsync(30_000); await flushPromises()
      // Six ticks fired; one read is still in flight, and none queued behind it.
      expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets', 'search_targets'])
      wrapper.unmount()
    } finally { vi.useRealTimers() }
  })
  it('stops for a failing, paused, removed or deselected watch, and on unmount', async () => {
    vi.useFakeTimers()
    try {
      const quiet = async (monitoring: ReturnType<typeof createMonitoringState>, invoke: Mock<Invoke>) => {
        const before = invoke.mock.calls.length
        await vi.advanceTimersByTimeAsync(30_000); await flushPromises()
        expect(invoke.mock.calls.length, 'the poll should have stopped').toBe(before)
        expect(monitoring.state.overview).not.toBeNull()
      }
      // 1. A never-checked watch that has already failed: the copy does not claim a
      //    check is running, and the poll agrees with it.
      const failing = vi.fn()
        .mockResolvedValueOnce(envelope('overview', { ...overview, watches: [{ ...waiting, has_error: true, consecutive_errors: 3 }] }))
        .mockResolvedValue(envelope('history_page', page([])))
      const first = mounted(failing)
      await first.monitoring.refresh(); await flushPromises()
      await first.wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      await quiet(first.monitoring, failing)
      first.wrapper.unmount()

      // 2. Paused after one tick.
      const paused = vi.fn()
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValue(envelope('history_page', page([])))
      const second = mounted(paused)
      await second.monitoring.refresh(); await flushPromises()
      await second.wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      await vi.advanceTimersByTimeAsync(5_000); await flushPromises()
      expect(paused.mock.calls.map(call => call[0]).slice(2)).toEqual(['search_targets'])
      paused.mockResolvedValueOnce(envelope('overview', { ...overview, watches: [{ ...waiting, status: 'paused' }] }))
      await second.monitoring.refresh(); await flushPromises()
      await quiet(second.monitoring, paused)
      second.wrapper.unmount()

      // 3. Removed from the overview altogether: nothing is selected any more.
      const removed = vi.fn()
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValueOnce(envelope('history_page', page([])))
        .mockResolvedValueOnce(envelope('overview', { ...overview, watches: [] }))
      const third = mounted(removed)
      await third.monitoring.refresh(); await flushPromises()
      await third.wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      await third.monitoring.refresh(); await flushPromises()
      expect(third.monitoring.state.selectedUser).toBeNull()
      await quiet(third.monitoring, removed)
      third.wrapper.unmount()

      // 4. The selection moves to another account: the timer follows it.
      const switched = vi.fn()
        .mockResolvedValueOnce(envelope('overview', twoWatches))
        .mockResolvedValue(envelope('history_page', page([])))
      const fourth = mounted(switched)
      await fourth.monitoring.refresh(); await flushPromises()
      await fourth.wrapper.findAll('[role="option"]')[0].trigger('click'); await flushPromises()
      await vi.advanceTimersByTimeAsync(5_000); await flushPromises()
      expect(switched.mock.calls.at(-1)).toEqual(['search_targets', { query: { username: 'alice' } }])
      await fourth.wrapper.findAll('[role="option"]')[1].trigger('click'); await flushPromises()
      await vi.advanceTimersByTimeAsync(5_000); await flushPromises()
      expect(switched.mock.calls.at(-1)).toEqual(['search_targets', { query: { username: 'bob' } }])
      // 5. …and unmounting leaves nothing behind.
      fourth.wrapper.unmount()
      const stopped = switched.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000); await flushPromises()
      expect(switched).toHaveBeenCalledTimes(stopped)
      expect(vi.getTimerCount()).toBe(0)

      // A watch whose check landed is not waiting either.
      const done = vi.fn()
        .mockResolvedValueOnce(envelope('overview', { ...overview, watches: [landed] }))
        .mockResolvedValue(envelope('history_page', page([])))
      const fifth = mounted(done)
      await fifth.monitoring.refresh(); await flushPromises()
      await fifth.wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      await quiet(fifth.monitoring, done)
      fifth.wrapper.unmount()
    } finally { vi.useRealTimers() }
  })
  it('shows the stale banner and disables every mutation of the selected watch while stale', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(envelope('overview', overview))
      .mockResolvedValueOnce(envelope('history_page', page([])))
      .mockRejectedValueOnce('transport')
    const client = new DesktopClient(invoke)
    const monitoring = createMonitoringState(client, { target: null, now: () => 0 })
    const wrapper = mount(WatchesView, { props: { monitoring, history: createHistoryState(client) } })
    await monitoring.refresh(); await flushPromises()
    await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
    await monitoring.refresh(); await flushPromises()
    expect(wrapper.text()).toContain('The data is out of date')
    // The banner's own control is a named read, like the history reload: only the
    // mutations are blocked.
    const banner = wrapper.get('button[data-action="refresh-watches"]')
    expect(banner.text()).toBe('Refresh')
    expect(banner.attributes('aria-label')).toBe('Refresh the watch list')
    const reads = ['reload-history', 'refresh-watches']
    const mutations = wrapper.findAll('button[data-action]').filter(button => !reads.includes(button.attributes('data-action')!))
    expect(mutations.map(button => button.attributes('data-action'))).toEqual(['pause', 'remove', 'interval'])
    expect(mutations.every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.get('button[data-action="reload-history"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.add-watch button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain(watch.revision)
  })
})
