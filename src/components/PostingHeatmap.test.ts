import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import PostingHeatmap from './PostingHeatmap.vue'
import { setLocale, t } from '../i18n'

const bins = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0))
const heatmap = (values: number[][], attachTo?: HTMLElement) => mount(PostingHeatmap, { props: { values }, attachTo })
afterEach(() => { setLocale('en'); document.body.innerHTML = '' })

describe('posting heatmap', () => {
  it('renders all Monday-first UTC bins and scales them against the highest count', () => {
    const values = bins()
    values[0][0] = 1
    values[2][12] = 4
    const wrapper = heatmap(values)
    const cells = wrapper.findAll('.heatmap-cell')
    expect(cells).toHaveLength(168)
    expect(cells[0].attributes('data-level')).toBe('1')
    expect(cells[1].attributes('data-level')).toBe('0')
    expect(cells[2 * 24 + 12].attributes('data-level')).toBe('4')
    expect(wrapper.findAll('tbody th').map(day => day.text())).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(wrapper.get('figcaption').text()).toBe(t('lookup.heatmap_title'))
    expect(wrapper.get('table caption').text()).toBe(t('lookup.heatmap_title'))
    expect(cells[0].attributes('aria-label')).toBe(t('lookup.heatmap_cell', { day: 'Monday', hour: '00', next: '01', count: '1' }))
    expect(cells[167].attributes('aria-label')).toBe(t('lookup.heatmap_cell', { day: 'Sunday', hour: '23', next: '00', count: '0' }))
  })

  it('shows exact zero and nonzero counts on hover and keyboard focus', async () => {
    const values = bins()
    values[6][23] = 12
    const wrapper = heatmap(values)
    const cells = wrapper.findAll('.heatmap-cell')
    await cells[167].trigger('mouseenter')
    expect(wrapper.get('[role="tooltip"]').text()).toBe(cells[167].attributes('aria-label'))
    await cells[0].trigger('focus')
    expect(wrapper.get('[role="tooltip"]').text()).toBe(cells[0].attributes('aria-label'))
    expect(wrapper.get('[role="tooltip"]').text()).toContain('0')
  })

  it('uses one tab stop and arrow keys to explore cells, clamping at the grid boundaries', async () => {
    const values = bins()
    values[0][0] = 1
    const wrapper = heatmap(values, document.body)
    const cells = wrapper.findAll('.heatmap-cell')
    expect(cells.filter(cell => cell.attributes('tabindex') === '0')).toHaveLength(1)
    ;(cells[0].element as HTMLButtonElement).focus()
    await cells[0].trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cells[1].element)
    await cells[1].trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cells[25].element)
    await cells[25].trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(cells[24].element)
    await cells[24].trigger('keydown', { key: 'End', ctrlKey: true })
    expect(document.activeElement).toBe(cells[167].element)
    await cells[167].trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cells[167].element)
    await cells[167].trigger('keydown', { key: 'Home', ctrlKey: true })
    expect(document.activeElement).toBe(cells[0].element)
    await cells[0].trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cells[0].element)
    expect(cells.filter(cell => cell.attributes('tabindex') === '0')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not invent posts for absent or invalid bins and shows an empty state for all-zero input', () => {
    for (const values of [[], bins(), [[-1, Number.NaN, Number.POSITIVE_INFINITY]]]) {
      const wrapper = heatmap(values)
      expect(wrapper.get('.heatmap-empty').text()).toBe(t('lookup.heatmap_empty'))
      expect(wrapper.find('table').exists()).toBe(false)
    }
    const wrapper = heatmap([[2]])
    expect(wrapper.findAll('.heatmap-cell')).toHaveLength(168)
    expect(wrapper.findAll('.heatmap-cell').slice(1).every(cell => cell.attributes('data-level') === '0')).toBe(true)
  })

  it('localizes the weekday labels and tooltip text', async () => {
    setLocale('ru')
    const values = bins()
    values[0][0] = 1
    const wrapper = heatmap(values)
    expect(wrapper.get('tbody th').text()).toBe('пн')
    await wrapper.get('.heatmap-cell').trigger('focus')
    expect(wrapper.get('[role="tooltip"]').text()).toBe(t('lookup.heatmap_cell', { day: 'понедельник', hour: '00', next: '01', count: '1' }))
  })
})
