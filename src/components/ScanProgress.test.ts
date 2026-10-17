import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScanProgress from './ScanProgress.vue'
import { t } from '../i18n'

afterEach(() => vi.useRealTimers())

describe('real scan feedback', () => {
  it('names the active operation and never invents a percentage or an unrequested stage', () => {
    const scan = mount(ScanProgress, { props: { phase: 'profile', username: 'alice', window: 30 } })
    expect(scan.text()).toContain(t('scan.profile_title'))
    expect(scan.text()).toContain('@alice')
    expect(scan.find('[data-stage="activity"]').exists()).toBe(false)
    expect(scan.find('[aria-valuenow]').exists()).toBe(false)
    expect(scan.text()).not.toMatch(/\d+%/)
    scan.unmount()
  })

  it('moves from the real profile stage to the requested analysis without resetting elapsed time', async () => {
    vi.useFakeTimers()
    const scan = mount(ScanProgress, { props: { phase: 'profile', username: 'alice', window: 50, includeActivity: true } })
    await vi.advanceTimersByTimeAsync(12_000)
    expect(scan.get('[data-elapsed]').text()).toBe('00:12')
    expect(scan.get('[data-elapsed]').attributes('aria-hidden')).toBe('true')
    await scan.setProps({ phase: 'activity' })
    expect(scan.text()).toContain(t('scan.activity_title'))
    expect(scan.text()).toContain(t('scan.activity_detail', { count: 50 }))
    expect(scan.get('[data-stage="profile"]').attributes('data-state')).toBe('complete')
    expect(scan.get('[data-stage="activity"]').attributes('data-state')).toBe('active')
    expect(scan.get('[data-elapsed]').text()).toBe('00:12')
    scan.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('treats the target as text and gives a truthful slow-source notice', async () => {
    vi.useFakeTimers()
    const target = '<img src=x onerror=alert(1)>'
    const scan = mount(ScanProgress, { props: { phase: 'activity', username: target, window: 12 } })
    expect(scan.text()).toContain(target)
    expect(scan.find('img').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(scan.text()).toContain(t('scan.slow'))
    expect(scan.get('[role="status"]').attributes('aria-live')).toBe('polite')
    scan.unmount()
  })

  it('keeps the operation clock across remounts and starts a new clock for a new operation', async () => {
    vi.useFakeTimers()
    const startedAt = performance.now()
    await vi.advanceTimersByTimeAsync(9_000)
    const props = { phase: 'profile' as const, username: 'alice', window: 30, startedAt }
    const first = mount(ScanProgress, { props })
    await first.vm.$nextTick()
    expect(first.get('[data-elapsed]').text()).toBe('00:09')
    first.unmount()
    await vi.advanceTimersByTimeAsync(4_000)
    const reopened = mount(ScanProgress, { props })
    await reopened.vm.$nextTick()
    expect(reopened.get('[data-elapsed]').text()).toBe('00:13')
    await reopened.setProps({ startedAt: performance.now() })
    expect(reopened.get('[data-elapsed]').text()).toBe('00:00')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reopened.get('[data-elapsed]').text()).toBe('00:01')
    reopened.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
