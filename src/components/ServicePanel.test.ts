import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ServicePanel from './ServicePanel.vue'
import type { Profile } from '../desktop/client'

const profile: Profile = { configured: true, status: 'quota_exhausted', desired_service: 'running', service_running: true, quota_remaining: 0, quota_checked_at: 100, revision: 'a'.repeat(32) }
const actions = () => ({ start: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true), repair: vi.fn().mockResolvedValue(true) })
describe('local service panel', () => {
  it('zero quota is exhausted even when the process is running', () => {
    const wrapper = mount(ServicePanel, { props: { profile, busy: false, stale: false, ...actions() } })
    expect(wrapper.get('h1').text()).toBe('Лимит исчерпан')
    expect(wrapper.text()).toContain('Служба запущена')
    expect(wrapper.text()).toContain('последней проверки токена')
    expect(wrapper.text()).not.toContain('Мониторинг работает')
  })
  it('stale state disables lifecycle commands', () => {
    const wrapper = mount(ServicePanel, { props: { profile, busy: false, stale: true, ...actions() } })
    expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
  })
  it('recovery requires Repair before Start or Stop', async () => {
    const callbacks = actions()
    const wrapper = mount(ServicePanel, { props: { profile: { ...profile, status: 'recovery_required' }, busy: false, stale: false, ...callbacks } })
    expect(wrapper.get('button[data-action=start]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[data-action=stop]').attributes('disabled')).toBeDefined()
    await wrapper.get('button[data-action=repair]').trigger('click')
    expect(callbacks.repair).toHaveBeenCalledTimes(1)
  })
})
