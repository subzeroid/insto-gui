import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import App from './App.vue'
import AppNav from './components/AppNav.vue'
import { createMockInvoke } from './desktop/mock'
import type { SavedCheck } from './desktop/workbench'

it('saves two checks, compares them and reopens an offline analysis without another provider call', async () => {
  const invoke = vi.fn(createMockInvoke({ lookupDelayMs: 0 }))
  const app = mount(App, { props: { invokeCommand: invoke } })
  await flushPromises()
  for (const username of ['atlas.ferry', 'driftwood.studio']) {
    await app.get('#tab-lookup').trigger('click')
    await app.get('#lookup-user').setValue(username)
    await app.get('form.lookup-form').trigger('submit'); await flushPromises()
    await app.get('[data-action="analyse"]').trigger('click'); await flushPromises()
    const beforeTabs = invoke.mock.calls.length
    await app.get('[data-action="result-tab-geography"]').trigger('click')
    expect(app.find('.geo-map').exists()).toBe(true)
    await app.get('[data-action="result-tab-activity"]').trigger('click')
    expect(app.find('.posting-heatmap').exists()).toBe(true)
    expect(invoke.mock.calls).toHaveLength(beforeTabs)
    await app.get('[data-action="save-check"]').trigger('click'); await flushPromises()
  }
  const paid = invoke.mock.calls.filter(c => c[0].startsWith('lookup_')).length
  await app.get('#tab-library').trigger('click'); await flushPromises()
  expect(app.findAll('[data-check]')).toHaveLength(2)
  const selects = app.findAll('select')
  const ids = app.findAll('[data-check]').map(c => c.attributes('data-check'))
  await selects[0].setValue(ids[0]); await selects[1].setValue(ids[1]); await flushPromises()
  expect(app.text()).toContain('Shared hashtags')
  await app.findAll('[data-check]')[1].get('[data-action="open"]').trigger('click'); await flushPromises()
  expect(app.get('#panel-lookup').text()).toContain('Saved check from')
  await app.get('[data-action="result-tab-activity"]').trigger('click')
  expect(app.find('.posting-heatmap').exists()).toBe(true)
  expect(app.find('[data-note="quota"]').exists()).toBe(false)
  expect(invoke.mock.calls.filter(c => c[0].startsWith('lookup_'))).toHaveLength(paid)
  await app.get('#tab-settings').trigger('click'); await flushPromises()
  await app.get('#tab-budget').trigger('click'); await flushPromises()
  expect(app.find('.budget-panel').exists()).toBe(true)
  expect(app.find('[role="alert"]').exists()).toBe(false)
  app.unmount()
})

it('blocks scoped navigation and IPC until a pending profile selection settles', async () => {
  const base = createMockInvoke({ lookupDelayMs: 0 })
  let settleSelection: (() => void) | undefined
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'select_home') await new Promise<void>(resolve => { settleSelection = resolve })
    return base(command, args)
  })
  const app = mount(App, { props: { invokeCommand: invoke } })
  try {
    await flushPromises()
    await app.get('#tab-settings').trigger('click')
    await app.get('[data-action="check-home"]').trigger('click'); await flushPromises()
    await app.get('[data-action="adopt-home"]').trigger('click')
    await app.get('[data-action="confirm-adopt"]').trigger('click'); await flushPromises()
    const before = invoke.mock.calls.length
    const nav = app.getComponent(AppNav)
    await nav.get('#tab-library').trigger('click'); await flushPromises()
    await nav.get('#tab-settings').trigger('keydown', { key: 'Home' }); await flushPromises()
    // A queued component event must also be refused by the window boundary.
    nav.vm.$emit('navigate', 'lookup'); await flushPromises()
    expect(invoke.mock.calls.slice(before).filter(([command]) => /^(research_|lookup_)/.test(command))).toEqual([])
    expect(nav.findAll('button').every(tab => (tab.element as HTMLButtonElement).disabled)).toBe(true)
    expect(app.find('[role="tabpanel"]').exists()).toBe(false)
    settleSelection!(); await flushPromises()
    expect(app.find('#panel-lookup').exists()).toBe(true)
    expect(app.getComponent(AppNav).findAll('button').every(tab => !(tab.element as HTMLButtonElement).disabled)).toBe(true)
    await app.get('#tab-library').trigger('click'); await flushPromises()
    expect(app.find('#panel-library').exists()).toBe(true)
    expect(invoke.mock.calls.filter(([command]) => command === 'research_list')).toHaveLength(1)
  } finally { settleSelection?.(); app.unmount() }
})

it('clears a library read that crosses profile selection before reactivating the window', async () => {
  const base = createMockInvoke({ lookupDelayMs: 0 })
  let settleSelection: (() => void) | undefined
  let resolveList: ((items: SavedCheck[]) => void) | undefined
  let holdList = false
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'select_home') await new Promise<void>(resolve => { settleSelection = resolve })
    if (command === 'research_list' && holdList) return new Promise<SavedCheck[]>(resolve => { resolveList = resolve })
    return base(command, args)
  })
  const app = mount(App, { props: { invokeCommand: invoke } })
  try {
    await flushPromises()
    await app.get('#tab-lookup').trigger('click')
    await app.get('#lookup-user').setValue('atlas.ferry')
    await app.get('form.lookup-form').trigger('submit'); await flushPromises()
    await app.get('[data-action="save-check"]').trigger('click'); await flushPromises()
    const research = app.getComponent({ name: 'LookupView' }).props('research')!
    const oldItems = await base('research_list') as SavedCheck[]
    expect(oldItems).toHaveLength(1)
    await app.get('#tab-settings').trigger('click')
    await app.get('[data-action="check-home"]').trigger('click'); await flushPromises()
    await app.get('[data-action="adopt-home"]').trigger('click')
    await app.get('[data-action="confirm-adopt"]').trigger('click'); await flushPromises()
    // Model an already queued local callback admitted after initial invalidation.
    holdList = true
    const crossingRead = research.refresh()
    resolveList!(oldItems); await crossingRead
    expect(research.state.items).toHaveLength(1)
    settleSelection!(); await flushPromises()
    expect(app.find('#panel-lookup').exists()).toBe(true)
    expect(research.state.items).toEqual([])
    expect(research.state.loaded).toBe(false)
  } finally { settleSelection?.(); app.unmount() }
})
