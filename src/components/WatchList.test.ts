import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WatchList from './WatchList.vue'
import { watch } from '../desktop/fixtures'
import { describeValue, formatCount, localTime } from '../desktop/format'

describe('watch list', () => {
  it('shows waiting, paused and error states without raw errors and selects by keyboard', async () => {
    const items = [watch, { ...watch, user: 'bob', status: 'paused' as const, last_ok: 1_700_000_000, waiting_first_check: false, has_error: true, consecutive_errors: 3 }]
    const wrapper = mount(WatchList, { props: { items, selectedUser: null, stale: false } })
    expect(wrapper.text()).toContain('Ожидает первой проверки')
    expect(wrapper.text()).toContain('Приостановлено')
    expect(wrapper.text()).toContain('Ошибки: 3')
    expect(wrapper.text()).toContain(localTime(1_700_000_000))
    const rows = wrapper.findAll('[role="option"]')
    expect(rows).toHaveLength(2)
    await rows[1].trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')?.[0]).toEqual(['bob'])
  })
  it('renders empty and stale states', () => {
    expect(mount(WatchList, { props: { items: [], selectedUser: null, stale: false } }).text()).toContain('Пока нет наблюдений')
    expect(mount(WatchList, { props: { items: [watch], selectedUser: 'alice', stale: true } }).find('[aria-selected="true"]').exists()).toBe(true)
  })
  it('never renders an epoch check time, counts in ru-RU and keeps the empty state outside the listbox', () => {
    const errored = { ...watch, user: 'carol', last_ok: null, waiting_first_check: false, has_error: true, consecutive_errors: 0, interval_seconds: 3600 }
    const wrapper = mount(WatchList, { props: { items: [errored], selectedUser: null, stale: false } })
    expect(wrapper.text()).toContain('Ожидает первой проверки'); expect(wrapper.text()).not.toContain('Проверено')
    expect(wrapper.text()).toContain('Есть ошибка'); expect(wrapper.text()).not.toContain('Ошибки:')
    expect(wrapper.text()).toContain(`Интервал ${formatCount(3600)} с`)
    const empty = mount(WatchList, { props: { items: [], selectedUser: null, stale: false } })
    expect(empty.find('.empty').exists()).toBe(true); expect(empty.find('[role="listbox"] .empty').exists()).toBe(false)
  })
  it('formats change values', () => {
    expect(describeValue(null)).toBe('нет значения'); expect(describeValue(true)).toBe('да'); expect(describeValue(1234)).toBe((1234).toLocaleString('ru-RU')); expect(describeValue('')).toBe('пусто')
  })
})
