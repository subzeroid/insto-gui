import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView.vue'

describe('settings', () => {
  it('replaces the token through the existing form and stops the service only after confirmation', async () => {
    const stop = vi.fn().mockResolvedValue(true)
    const wrapper = mount(SettingsView, { props: { busy: false, stale: false, configured: true, serviceRunning: true, coreVersion: '0.7.21', buildId: 'a'.repeat(64), replace: vi.fn().mockResolvedValue(true), stop, openTokenPage: vi.fn() } })
    expect(wrapper.text()).toContain('0.7.21'); expect(wrapper.text()).toContain('Корзин')
    await wrapper.get('button[data-action="uninstall"]').trigger('click')
    expect(stop).not.toHaveBeenCalled()
    await wrapper.get('button[data-action="confirm-uninstall"]').trigger('click')
    expect(stop).toHaveBeenCalledTimes(1)
    await wrapper.get('button[data-action="replace"]').trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })
})
