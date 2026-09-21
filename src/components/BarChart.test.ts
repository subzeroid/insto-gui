import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BarChart from './BarChart.vue'
import { t } from '../i18n'

const labels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday']
const ticks = ['Mon', '', 'Wed', '']
const chart = (values: number[]) => mount(BarChart, { props: { title: 'Posts by day', values, labels, ticks } })
const heights = (wrapper: ReturnType<typeof chart>) => wrapper.findAll('.bar').map(bar => bar.attributes('style'))

describe('bar chart', () => {
  it('scales every bar to the tallest one', () => {
    const wrapper = chart([5, 0, 10, 1])
    expect(heights(wrapper)).toEqual(['height: 50%;', 'height: 0%;', 'height: 100%;', 'height: 10%;'])
    expect(wrapper.get('figcaption').text()).toBe('Posts by day')
    expect(wrapper.findAll('.bar-ticks span').map(tick => tick.text())).toEqual(['Mon', '', 'Wed', ''])
  })
  it('draws nothing rather than dividing by zero when every bar is empty', () => {
    const wrapper = chart([0, 0, 0, 0])
    expect(heights(wrapper)).toEqual(['height: 0%;', 'height: 0%;', 'height: 0%;', 'height: 0%;'])
    // Nothing to name, so no sentence is invented.
    expect(wrapper.find('.chart-alt').exists()).toBe(false)
  })
  it('names the busiest bars in words, count first and then in the order of the axis', () => {
    const wrapper = chart([4, 7, 4, 1])
    expect(wrapper.get('.chart-alt').text()).toBe(
      t('lookup.chart_top', { items: ['Tuesday — 7', 'Monday — 4', 'Wednesday — 4'].join(', ') }),
    )
    // Only the top three, so the sentence stays a sentence.
    expect(wrapper.get('.chart-alt').text()).not.toContain('Thursday')
  })
  it('is a picture with the meaning beside it, never instead of it', () => {
    const wrapper = chart([1, 2, 3, 4])
    // The bars are decorative: reading out four unlabelled boxes says nothing,
    // and the sentence under them carries the same facts in words.
    expect(wrapper.get('.bars').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.bar-ticks').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.chart-alt').attributes('aria-hidden')).toBeUndefined()
    // No library, no canvas, no image, nothing to press.
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })
})
