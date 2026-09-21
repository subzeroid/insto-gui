import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WatchesView from './WatchesView.vue'
import { DesktopClient } from '../desktop/client'
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
  it('re-reads locally every five seconds while the first check is outstanding, and stops when it lands', async () => {
    vi.useFakeTimers()
    try {
      const checked = { ...watch, last_ok: 1_770_000_000, waiting_first_check: false }
      const invoke = vi.fn()
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValueOnce(envelope('history_page', page([])))
        // First tick: nothing has changed yet, so the history is read again too.
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValueOnce(envelope('history_page', page([])))
        // Second tick: the check landed. The selection watcher reloads the history,
        // so the tick itself asks for nothing more.
        .mockResolvedValueOnce(envelope('overview', { ...overview, watches: [checked] }))
        .mockResolvedValueOnce(envelope('history_page', page([{ kind: 'target', target_pk: '7', snapshot: snap('2', '7', 2) }])))
        .mockResolvedValueOnce(envelope('history_page', page([{ kind: 'snapshot', snapshot: snap('2', '7', 2) }])))
        .mockResolvedValueOnce(envelope('snapshot_fields', profileFields('2', '7', 2)))
        .mockResolvedValue(envelope('overview', { ...overview, watches: [checked] }))
      const client = new DesktopClient(invoke)
      const monitoring = createMonitoringState(client, { target: null })
      const history = createHistoryState(client)
      const wrapper = mount(WatchesView, { props: { monitoring, history } })
      await monitoring.refresh(); await flushPromises()
      await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets'])
      // Nothing happens between the ticks: the window makes no request of its own.
      await vi.advanceTimersByTimeAsync(4_999); await flushPromises()
      expect(invoke).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1); await flushPromises()
      expect(invoke.mock.calls.map(call => call[0])).toEqual(['read_overview', 'search_targets', 'read_overview', 'search_targets'])
      await vi.advanceTimersByTimeAsync(5_000); await flushPromises()
      expect(invoke.mock.calls.map(call => call[0])).toEqual([
        'read_overview', 'search_targets', 'read_overview', 'search_targets',
        'read_overview', 'search_targets', 'list_snapshots', 'read_snapshot',
      ])
      expect(wrapper.text()).toContain('@alice')
      // The check landed, so the timer is gone: another five seconds read nothing.
      const settled = invoke.mock.calls.length
      await vi.advanceTimersByTimeAsync(20_000); await flushPromises()
      expect(invoke).toHaveBeenCalledTimes(settled)
      wrapper.unmount()
    } finally { vi.useRealTimers() }
  })
  it('stops the first-check poll when the watch is paused, and leaves no timer behind on unmount', async () => {
    vi.useFakeTimers()
    try {
      const invoke = vi.fn()
        .mockResolvedValueOnce(envelope('overview', overview))
        .mockResolvedValueOnce(envelope('history_page', page([])))
        .mockResolvedValue(envelope('overview', { ...overview, watches: [{ ...watch, status: 'paused' }] }))
      const client = new DesktopClient(invoke)
      const monitoring = createMonitoringState(client, { target: null })
      const wrapper = mount(WatchesView, { props: { monitoring, history: createHistoryState(client) } })
      await monitoring.refresh(); await flushPromises()
      await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
      await vi.advanceTimersByTimeAsync(5_000); await flushPromises()
      // One tick, which observed the pause; a paused watch is not waiting for a check.
      expect(invoke.mock.calls.map(call => call[0]).slice(2)).toEqual(['read_overview', 'search_targets'])
      const paused = invoke.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000); await flushPromises()
      expect(invoke).toHaveBeenCalledTimes(paused)
      wrapper.unmount()
      await vi.advanceTimersByTimeAsync(30_000); await flushPromises()
      expect(invoke).toHaveBeenCalledTimes(paused)
      expect(vi.getTimerCount()).toBe(0)
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
