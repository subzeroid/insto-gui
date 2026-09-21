import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppNav from './AppNav.vue'
import { setLocale } from '../i18n'

describe('AppNav', () => {
  it('is a full ARIA tab list with roving focus', () => {
    const nav = mount(AppNav, { props: { current: 'service' }, attachTo: document.body })
    const tabs = nav.findAll('[role="tab"]')
    expect(nav.find('[role="tablist"]').attributes('aria-label')).toBe('Sections')
    expect(tabs.map(tab => tab.attributes('id'))).toEqual(['tab-watches', 'tab-changes', 'tab-lookup', 'tab-service', 'tab-settings'])
    expect(tabs.map(tab => tab.attributes('aria-controls'))).toEqual(['panel-watches', 'panel-changes', 'panel-lookup', 'panel-service', 'panel-settings'])
    expect(tabs.map(tab => tab.attributes('aria-selected'))).toEqual(['false', 'false', 'false', 'true', 'false'])
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['-1', '-1', '-1', '0', '-1'])
    nav.unmount()
  })

  it('moves selection with the arrow, Home and End keys', async () => {
    const nav = mount(AppNav, { props: { current: 'service' }, attachTo: document.body })
    const tabs = nav.findAll('[role="tab"]')
    // Service is the fourth of the five tabs: Lookup sits between Changes and it.
    await tabs[3].trigger('keydown', { key: 'ArrowRight' })
    await tabs[3].trigger('keydown', { key: 'ArrowLeft' })
    await tabs[3].trigger('keydown', { key: 'Home' })
    await tabs[3].trigger('keydown', { key: 'End' })
    expect(nav.emitted('navigate')).toEqual([['settings'], ['lookup'], ['watches'], ['settings']])
    nav.unmount()
  })

  // The wiring proof: the locale chosen before mount reaches the rendered copy.
  it('renders the Russian labels under the Russian locale', () => {
    setLocale('ru')
    try {
      const nav = mount(AppNav, { props: { current: 'watches' } })
      expect(nav.findAll('[role="tab"]').map(tab => tab.text())).toEqual(['Наблюдения', 'Изменения', 'Проверка', 'Служба', 'Настройки'])
      expect(nav.find('[role="tablist"]').attributes('aria-label')).toBe('Разделы')
      nav.unmount()
    } finally { setLocale('en') }
  })

  it('wraps at both ends', async () => {
    const nav = mount(AppNav, { props: { current: 'watches' }, attachTo: document.body })
    await nav.findAll('[role="tab"]')[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(nav.emitted('navigate')).toEqual([['settings']])
    nav.unmount()
  })
})
