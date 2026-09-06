import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WatchList from './WatchList.vue'
import { watch } from '../desktop/fixtures'
import { describeValue, localTime } from '../desktop/format'

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
  it('formats change values', () => {
    expect(describeValue(null)).toBe('нет значения'); expect(describeValue(true)).toBe('да'); expect(describeValue(1234)).toBe((1234).toLocaleString('ru-RU')); expect(describeValue('')).toBe('пусто')
  })
})
