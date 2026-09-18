import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WatchList from './WatchList.vue'
import { watch } from '../desktop/fixtures'
import { describeValue, formatCount, localTime } from '../desktop/format'

describe('watch list', () => {
  it('shows waiting, paused and error states without raw errors and selects by keyboard', async () => {
    const items = [watch, { ...watch, user: 'bob', status: 'paused' as const, last_ok: 1_700_000_000, waiting_first_check: false, has_error: true, consecutive_errors: 3 }]
    const wrapper = mount(WatchList, { props: { items, selectedUser: null, stale: false } })
    expect(wrapper.text()).toContain('Waiting for the first check')
    expect(wrapper.text()).toContain('Paused')
    expect(wrapper.text()).toContain('Errors: 3')
    expect(wrapper.text()).toContain(localTime(1_700_000_000))
    const rows = wrapper.findAll('[role="option"]')
    expect(rows).toHaveLength(2)
    await rows[1].trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')?.[0]).toEqual(['bob'])
  })
  it('renders empty and stale states', () => {
    expect(mount(WatchList, { props: { items: [], selectedUser: null, stale: false } }).text()).toContain('No watches yet')
    expect(mount(WatchList, { props: { items: [watch], selectedUser: 'alice', stale: true } }).find('[aria-selected="true"]').exists()).toBe(true)
  })
  it('never renders an epoch check time, counts in ru-RU and keeps the empty state outside the listbox', () => {
    const errored = { ...watch, user: 'carol', last_ok: null, waiting_first_check: false, has_error: true, consecutive_errors: 0, interval_seconds: 3600 }
    const wrapper = mount(WatchList, { props: { items: [errored], selectedUser: null, stale: false } })
    expect(wrapper.text()).toContain('Waiting for the first check'); expect(wrapper.text()).not.toContain('Checked')
    expect(wrapper.text()).toContain('There is an error'); expect(wrapper.text()).not.toContain('Errors:')
    expect(wrapper.text()).toContain(`Interval ${formatCount(3600)} s`)
    const empty = mount(WatchList, { props: { items: [], selectedUser: null, stale: false } })
    expect(empty.find('.empty').exists()).toBe(true); expect(empty.find('[role="listbox"] .empty').exists()).toBe(false)
  })
  it('formats change values', () => {
    expect(describeValue(null)).toBe('no value'); expect(describeValue(true)).toBe('yes'); expect(describeValue(1234)).toBe(formatCount(1234)); expect(describeValue('')).toBe('empty')
  })
})
