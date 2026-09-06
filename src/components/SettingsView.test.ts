import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView.vue'

describe('settings', () => {
  it('replaces the token through the existing form and stops the service only after confirmation', async () => {
    const stop = vi.fn().mockResolvedValue(true)
    const wrapper = mount(SettingsView, { props: { busy: false, stale: false, configured: true, recovery: false, serviceRunning: true, coreVersion: '0.7.21', buildId: 'a'.repeat(64), replace: vi.fn().mockResolvedValue(true), stop, openTokenPage: vi.fn() } })
    expect(wrapper.text()).toContain('0.7.21'); expect(wrapper.text()).toContain('Корзин')
    await wrapper.get('button[data-action="uninstall"]').trigger('click')
    expect(stop).not.toHaveBeenCalled()
    await wrapper.get('button[data-action="confirm-uninstall"]').trigger('click')
    expect(stop).toHaveBeenCalledTimes(1)
    await wrapper.get('button[data-action="replace"]').trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })
  it('recovery disables token replacement while the service switch follows its own rule', async () => {
    const wrapper = mount(SettingsView, { props: { busy: false, stale: false, configured: true, recovery: true, serviceRunning: false, coreVersion: '0.7.21', buildId: 'a'.repeat(64), replace: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true), openTokenPage: vi.fn() } })
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeUndefined()
    await wrapper.setProps({ recovery: false })
    await wrapper.get('button[data-action="replace"]').trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    await wrapper.setProps({ recovery: true })
    expect(wrapper.find('input[type="password"]').exists()).toBe(false) // an open form closes when recovery starts
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeDefined()
  })
})
