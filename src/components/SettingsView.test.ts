import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import SettingsView from './SettingsView.vue'
import type { Binding, ServiceFacts } from '../desktop/client'
import { current, facts, foreign, homeAdoptable } from '../desktop/fixtures'

const own: Binding = { state: 'own', home: null }
const adopted: Binding = { state: 'adopted', home: '/Users/x/.insto' }
const nobody: Binding = { state: 'unknown', home: null }

function serviceStub(value: ServiceFacts | null, binding: Binding) {
  // Reactive, and every predicate reads `state`, exactly as `createServiceState`
  // does: a facts change under an open confirmation has to reach the component.
  const state = reactive({ facts: value, binding, factsAt: 1, migrating: false, notice: null, error: null })
  const readonly = () => state.binding.state === 'unknown' || state.facts === null || state.facts.registration === 'unknown'
  return {
    state,
    fresh: () => state.facts !== null, readonly,
    canUninstall: () => !readonly() && state.facts !== null && state.facts.registration === 'owned' && !(state.binding.state === 'adopted' && state.facts.interpreter === 'other'),
    canMigrate: () => false, takeover: () => false,
    migrate: vi.fn().mockResolvedValue(true), uninstall: vi.fn().mockResolvedValue(true),
  }
}
function homeStub() {
  return { state: { path: '~/.insto', checked: null as unknown, checking: false, error: null }, edit: vi.fn(), check: vi.fn(), adopt: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(true) }
}
function make(overrides: Record<string, unknown> = {}) {
  const service = (overrides.service as ReturnType<typeof serviceStub>) ?? serviceStub(current, own)
  const uninstall = vi.fn().mockResolvedValue(true)
  const props = { busy: false, stale: false, configured: true, recovery: false, serviceRunning: true, coreVersion: '0.7.22', buildId: 'a'.repeat(64), service, home: homeStub(), binding: service.state.binding, replace: vi.fn().mockResolvedValue(true), uninstall, openTokenPage: vi.fn(), ...overrides }
  return { uninstall, service, wrapper: mount(SettingsView, { props: props as never }) }
}

describe('settings', () => {
  it('replaces the token through the existing form and removes the service only after confirmation', async () => {
    const { wrapper, uninstall } = make()
    expect(wrapper.text()).toContain('0.7.22'); expect(wrapper.text()).toContain('Корзин')
    await wrapper.get('button[data-action="uninstall"]').trigger('click')
    expect(uninstall).not.toHaveBeenCalled()
    await wrapper.get('button[data-action="confirm-uninstall"]').trigger('click')
    expect(uninstall).toHaveBeenCalledTimes(1)
    await wrapper.get('button[data-action="replace"]').trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })
  it('recovery disables token replacement and service removal and closes whichever is open', async () => {
    const { wrapper } = make({ recovery: true })
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ recovery: false })
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('button[data-action="replace"]').trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    await wrapper.setProps({ recovery: true })
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    await wrapper.setProps({ recovery: false })
    await wrapper.get('button[data-action="uninstall"]').trigger('click')
    expect(wrapper.find('button[data-action="confirm-uninstall"]').exists()).toBe(true)
    await wrapper.setProps({ recovery: true })
    expect(wrapper.find('button[data-action="confirm-uninstall"]').exists()).toBe(false)
  })
  it('an unknown registration and an unknown binding both make removal read-only and close the confirmation', async () => {
    for (const service of [serviceStub(foreign, own), serviceStub(facts, nobody), serviceStub(null, own)]) {
      const { wrapper, uninstall } = make({ service, binding: service.state.binding })
      expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('доступен только просмотр')
      expect(uninstall).not.toHaveBeenCalled()
    }
    const { wrapper, service } = make()
    await wrapper.get('button[data-action="uninstall"]').trigger('click')
    expect(wrapper.find('button[data-action="confirm-uninstall"]').exists()).toBe(true)
    service.state.facts = foreign
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button[data-action="confirm-uninstall"]').exists()).toBe(false)
  })
  it('an adopted CLI service is never removed by the app, and it says why', () => {
    const service = serviceStub(facts, adopted)
    const { wrapper } = make({ service, binding: adopted })
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Эта служба принадлежит подключённой установке insto')
  })
  it('an adopted home that was already taken over may be removed', () => {
    const service = serviceStub(current, adopted)
    const { wrapper } = make({ service, binding: adopted })
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeUndefined()
  })
  it('renders the adoption block without relaying an outcome of its own', () => {
    const { wrapper } = make()
    expect(wrapper.find('.home-adoption').exists()).toBe(true)
    expect(wrapper.emitted('adopted')).toBeUndefined()
    expect(wrapper.emitted('released')).toBeUndefined()
  })
  it('no longer promises adoption in a future version', () => {
    const { wrapper } = make()
    expect(wrapper.text()).not.toContain('появятся в следующей версии')
    expect(homeAdoptable.backend).toBe('hikerapi') // the block only ever accepts a HikerAPI home
  })
})
