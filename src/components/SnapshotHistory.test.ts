import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SnapshotHistory from './SnapshotHistory.vue'
import { DesktopClient } from '../desktop/client'
import { createHistoryState } from '../desktop/history'
import { envelope, page, snap } from '../desktop/fixtures'
import { formatCount } from '../desktop/format'

const target = (pk: string, id: string, at: number) => ({ kind: 'target' as const, target_pk: pk, snapshot: snap(id, pk, at) })
const snapshot = (id: string, pk: string, at: number) => ({ kind: 'snapshot' as const, snapshot: snap(id, pk, at) })

describe('snapshot history', () => {
  it('explains no history, first snapshot and an incomplete search', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(envelope('history_page', page([])))
    const history = createHistoryState(new DesktopClient(invoke))
    const wrapper = mount(SnapshotHistory, { props: { history } })
    await history.load('alice'); await flushPromises()
    expect(wrapper.text()).toContain('Истории ещё нет')
    invoke.mockResolvedValueOnce(envelope('history_page', page([target('7', '2', 2)]))).mockResolvedValueOnce(envelope('history_page', page([snapshot('2', '7', 2)])))
    await history.load('alice'); await flushPromises()
    expect(wrapper.text()).toContain('Первый снимок')
    expect(wrapper.text()).not.toContain('не изменились')
    invoke.mockResolvedValueOnce(envelope('history_page', page([target('8', '3', 3), target('7', '2', 2)], 'more', 1500)))
    await history.load('alice'); await flushPromises()
    expect(wrapper.text()).toContain(`Поиск не завершён: просмотрено ${formatCount(1500)} снимков`)
    expect(wrapper.findAll('button[data-target]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Выберите сохранённую историю')
    invoke.mockResolvedValueOnce(envelope('history_page', page([target('7', '2', 2)], 'more', 1)))
    await history.load('alice'); await flushPromises()
    expect(wrapper.findAll('button[data-target]')).toHaveLength(1)
    expect(wrapper.text()).toContain('Найдена одна история')
    expect(wrapper.find('select[name="older"]').exists()).toBe(false)
  })
  it('pair pickers only offer chronologically valid partners and an incomplete comparison is not "unchanged"', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(envelope('history_page', page([target('7', '3', 3)])))
      .mockResolvedValueOnce(envelope('history_page', page([snapshot('3', '7', 3), snapshot('2', '7', 2), snapshot('1', '7', 1)])))
      .mockResolvedValueOnce(envelope('comparison', { older: snap('2', '7', 2), newer: snap('3', '7', 3), changes: [], unknown_fields: ['biography'] }))
    const history = createHistoryState(new DesktopClient(invoke))
    const wrapper = mount(SnapshotHistory, { props: { history } })
    await history.load('alice'); await flushPromises()
    expect(wrapper.findAll('select[name="older"] option').map(option => option.attributes('value'))).toEqual(['2', '1'])
    expect(wrapper.findAll('select[name="newer"] option').map(option => option.attributes('value'))).toEqual(['3'])
    expect(wrapper.text()).toContain('Сравнение неполное'); expect(wrapper.text()).not.toContain('не изменились')
    expect(wrapper.find('button[data-action="reload-history"]').exists()).toBe(true)
  })
  it('lists the comparison, unknown fields and lets the user pick another pair', async () => {
    const comparison = { older: snap('1', '7', 1), newer: snap('3', '7', 3), changes: [{ field: 'follower_count', old: 1, new: 2 }], unknown_fields: ['full_name'] }
    const invoke = vi.fn()
      .mockResolvedValueOnce(envelope('history_page', page([target('7', '3', 3)])))
      .mockResolvedValueOnce(envelope('history_page', page([snapshot('3', '7', 3), snapshot('2', '7', 2), snapshot('1', '7', 1)])))
      .mockResolvedValueOnce(envelope('comparison', { ...comparison, older: snap('2', '7', 2) }))
      .mockResolvedValueOnce(envelope('comparison', comparison))
    const history = createHistoryState(new DesktopClient(invoke))
    const wrapper = mount(SnapshotHistory, { props: { history } })
    await history.load('alice'); await flushPromises()
    expect(wrapper.text()).toContain('Подписчики'); expect(wrapper.text()).toContain('неизвестно')
    await wrapper.get('select[name="older"]').setValue('1'); await flushPromises()
    expect(invoke.mock.calls[3]).toEqual(['compare_snapshots', { pair: { target_pk: '7', older_id: '1', newer_id: '3' } }])
    expect(wrapper.text()).toContain('между двумя временами')
  })
})
