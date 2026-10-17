import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppNav from './AppNav.vue'
import { setLocale } from '../i18n'

describe('AppNav', () => {
  it('is a full ARIA tab list with roving focus', () => {
    const nav = mount(AppNav, { props: { current: 'service' }, attachTo: document.body })
    const tabs = nav.findAll('[role="tab"]')
    expect(nav.find('[role="tablist"]').attributes('aria-label')).toBe('Sections')
    expect(tabs.map(tab => tab.attributes('id'))).toEqual(['tab-lookup', 'tab-watches', 'tab-library', 'tab-settings'])
    expect(tabs.map(tab => tab.attributes('aria-controls'))).toEqual(['panel-lookup', 'panel-watches', 'panel-library', 'panel-settings'])
    expect(tabs.map(tab => tab.attributes('aria-selected'))).toEqual(['false', 'false', 'false', 'true'])
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['-1', '-1', '-1', '0'])
    nav.unmount()
  })

  it('moves selection with the arrow, Home and End keys', async () => {
    const nav = mount(AppNav, { props: { current: 'service' }, attachTo: document.body })
    const tabs = nav.findAll('[role="tab"]')
    await tabs[3].trigger('keydown', { key: 'ArrowRight' })
    await tabs[3].trigger('keydown', { key: 'ArrowLeft' })
    await tabs[3].trigger('keydown', { key: 'Home' })
    await tabs[3].trigger('keydown', { key: 'End' })
    expect(nav.emitted('navigate')).toEqual([['lookup'], ['library'], ['lookup'], ['settings']])
    nav.unmount()
  })

  // The wiring proof: the locale chosen before mount reaches the rendered copy.
  it('renders the Russian labels under the Russian locale', () => {
    setLocale('ru')
    try {
      const nav = mount(AppNav, { props: { current: 'watches' } })
      expect(nav.findAll('[role="tab"]').map(tab => tab.text())).toEqual(['Проверка', 'Наблюдение', 'Сохранённое', 'Настройки'])
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

  it('blocks click and keyboard navigation while the selected profile is changing', async () => {
    const nav = mount(AppNav, { props: { current: 'settings', disabled: true }, attachTo: document.body })
    try {
      const tabs = nav.findAll('[role="tab"]')
      await tabs[2].trigger('click')
      await tabs[3].trigger('keydown', { key: 'ArrowLeft' })
      await tabs[3].trigger('keydown', { key: 'Home' })
      await tabs[3].trigger('keydown', { key: 'End' })
      expect(tabs.every(tab => (tab.element as HTMLButtonElement).disabled)).toBe(true)
      expect(tabs.every(tab => tab.attributes('tabindex') === '-1')).toBe(true)
      expect(nav.emitted('navigate')).toBeUndefined()
      await nav.setProps({ disabled: false })
      await tabs[2].trigger('click')
      expect(nav.emitted('navigate')).toEqual([['library']])
    } finally { nav.unmount() }
  })

  it('keeps changes under Monitoring and budget under Settings', () => {
    for (const [current, selected] of [['changes', 'watches'], ['budget', 'settings']] as const) {
      const nav = mount(AppNav, { props: { current } })
      expect(nav.get('[aria-selected="true"]').attributes('id')).toBe(`tab-${selected}`)
      nav.unmount()
    }
  })
})
