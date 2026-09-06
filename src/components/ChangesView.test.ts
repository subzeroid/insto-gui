import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ChangesView from './ChangesView.vue'
import { DesktopClient } from '../desktop/client'
import { createHistoryState } from '../desktop/history'
import { envelope, page, snap } from '../desktop/fixtures'
import { formatCount } from '../desktop/format'

describe('changes feed', () => {
  it('labels baselines, comparisons, incomplete and diagnostic entries and continues empty pages', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(envelope('history_page', page([
        { kind: 'incomplete', older: snap('3', '7', 3), newer: snap('4', '7', 4), changes: [], unknown_fields: ['full_name'] },
        { kind: 'comparison', older: snap('2', '7', 2), newer: snap('3', '7', 3), changes: [{ field: 'follower_count', old: 10, new: 12 }, { field: 'biography', old: 'a <b>x</b>', new: 'https://example.com/y' }], unknown_fields: [] },
        { kind: 'diagnostic', snapshot: snap('2', '8', 2), code: 'history_corrupt' },
        { kind: 'baseline', snapshot: snap('1', '7', 1) },
      ], 'next', 1500)))
      .mockResolvedValueOnce(envelope('history_page', page([], null, 4)))
    const history = createHistoryState(new DesktopClient(invoke))
    const wrapper = mount(ChangesView, { props: { history, filterPk: null } })
    await flushPromises()
    expect(wrapper.text()).toContain('Первый снимок'); expect(wrapper.text()).toContain('Подписчики'); expect(wrapper.text()).toContain('Неполное сравнение'); expect(wrapper.text()).toContain('не удалось прочитать')
    expect(wrapper.html()).toContain('a &lt;b&gt;x&lt;/b&gt;'); expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('между двумя временами')
    expect(wrapper.text()).toContain(`Просмотрено кандидатов: ${formatCount(1500)}.`) // locale-formatted like every other count
    await wrapper.get('button[data-action="more"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Лента просмотрена до конца')
    expect(invoke.mock.calls[1]).toEqual(['list_changes', { query: { cursor: 'next' } }])
  })
  it('shows loading, empty and error states', async () => {
    const invoke = vi.fn().mockRejectedValueOnce('transport').mockResolvedValueOnce(envelope('history_page', page([])))
    const history = createHistoryState(new DesktopClient(invoke))
    const wrapper = mount(ChangesView, { props: { history, filterPk: '7' } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await wrapper.get('button[data-action="retry"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Изменений пока нет')
    expect(wrapper.text()).toContain('PK 7')
    await wrapper.get('button[data-action="clear-filter"]').trigger('click')
    expect(wrapper.emitted('clear-filter')).toHaveLength(1)
    expect(invoke).toHaveBeenCalledTimes(2) // the parent owns the filter; nothing is reloaded until it changes the prop
  })
})
