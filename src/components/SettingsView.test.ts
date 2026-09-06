import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView.vue'

describe('settings', () => {
  it('replaces the token through the existing form and stops the service only after confirmation', async () => {
    const stop = vi.fn().mockResolvedValue(true)
    const wrapper = mount(SettingsView, { props: { busy: false, stale: false, configured: true, recovery: false, desiredService: 'running', serviceRunning: true, coreVersion: '0.7.21', buildId: 'a'.repeat(64), replace: vi.fn().mockResolvedValue(true), stop, openTokenPage: vi.fn() } })
    expect(wrapper.text()).toContain('0.7.21'); expect(wrapper.text()).toContain('Корзин')
    await wrapper.get('button[data-action="uninstall"]').trigger('click')
    expect(stop).not.toHaveBeenCalled()
    await wrapper.get('button[data-action="confirm-uninstall"]').trigger('click')
    expect(stop).toHaveBeenCalledTimes(1)
    await wrapper.get('button[data-action="replace"]').trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })
  it('recovery disables token replacement and service removal and closes whichever is open', async () => {
    const wrapper = mount(SettingsView, { props: { busy: false, stale: false, configured: true, recovery: true, desiredService: 'running', serviceRunning: false, coreVersion: '0.7.21', buildId: 'a'.repeat(64), replace: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true), openTokenPage: vi.fn() } })
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ recovery: false })
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeUndefined() // recovery alone held it
    await wrapper.get('button[data-action="replace"]').trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    await wrapper.setProps({ recovery: true })
    expect(wrapper.find('input[type="password"]').exists()).toBe(false) // an open form closes when recovery starts
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ recovery: false })
    await wrapper.get('button[data-action="uninstall"]').trigger('click')
    expect(wrapper.find('button[data-action="confirm-uninstall"]').exists()).toBe(true)
    await wrapper.setProps({ recovery: true })
    expect(wrapper.find('button[data-action="confirm-uninstall"]').exists()).toBe(false) // an open confirmation closes as well
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined()
  })
  it('an already-stopped service disables the switch until its process is seen running', async () => {
    const wrapper = mount(SettingsView, { props: { busy: false, stale: false, configured: true, recovery: false, desiredService: 'stopped', serviceRunning: false, coreVersion: '0.7.21', buildId: 'a'.repeat(64), replace: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true), openTokenPage: vi.fn() } })
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined() // the ServicePanel stop predicate
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeUndefined() // token replacement follows its own rule
    await wrapper.setProps({ serviceRunning: true })
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeUndefined() // a running process can still be switched off
  })
})
