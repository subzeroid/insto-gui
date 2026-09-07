import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppNav from './AppNav.vue'

describe('AppNav', () => {
  it('is a full ARIA tab list with roving focus', () => {
    const nav = mount(AppNav, { props: { current: 'service' }, attachTo: document.body })
    const tabs = nav.findAll('[role="tab"]')
    expect(nav.find('[role="tablist"]').attributes('aria-label')).toBe('Разделы')
    expect(tabs.map(tab => tab.attributes('id'))).toEqual(['tab-watches', 'tab-changes', 'tab-service', 'tab-settings'])
    expect(tabs.map(tab => tab.attributes('aria-controls'))).toEqual(['panel-watches', 'panel-changes', 'panel-service', 'panel-settings'])
    expect(tabs.map(tab => tab.attributes('aria-selected'))).toEqual(['false', 'false', 'true', 'false'])
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['-1', '-1', '0', '-1'])
    nav.unmount()
  })

  it('moves selection with the arrow, Home and End keys', async () => {
    const nav = mount(AppNav, { props: { current: 'service' }, attachTo: document.body })
    const tabs = nav.findAll('[role="tab"]')
    await tabs[2].trigger('keydown', { key: 'ArrowRight' })
    await tabs[2].trigger('keydown', { key: 'ArrowLeft' })
    await tabs[2].trigger('keydown', { key: 'Home' })
    await tabs[2].trigger('keydown', { key: 'End' })
    expect(nav.emitted('navigate')).toEqual([['settings'], ['changes'], ['watches'], ['settings']])
    nav.unmount()
  })

  it('wraps at both ends', async () => {
    const nav = mount(AppNav, { props: { current: 'watches' }, attachTo: document.body })
    await nav.findAll('[role="tab"]')[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(nav.emitted('navigate')).toEqual([['settings']])
    nav.unmount()
  })
})
