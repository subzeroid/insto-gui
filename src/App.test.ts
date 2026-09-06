import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from './App.vue'
import { CORE_VERSION, type Profile } from './desktop/client'

const prepared = { core_version: CORE_VERSION, build_id: 'a'.repeat(64) }
const empty: Profile = { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }
const stopped: Profile = { configured: true, status: 'stopped', desired_service: 'stopped', service_running: false, quota_remaining: 10, quota_checked_at: 100, revision: 'a'.repeat(32) }
const wrap = (data: Profile) => ({ kind: 'profile', data })
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('application integration', () => {
  it('starts read-only and exposes an honest setup screen', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
    wrapper = mount(App, { props: { invokeCommand: invoke } })
    expect(wrapper.text()).toContain('Готовим ядро')
    await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('экраны аккаунтов ещё в разработке')
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup'])
  })

  it('a saved setup with failed start is read back without requesting the token again', async () => {
    const recovery = { ...stopped, status: 'recovery_required' as const }
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockRejectedValueOnce({ code: 'service_error', message: 'TOKEN_SENTINEL /private/secret' })
      .mockResolvedValueOnce(wrap(recovery))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    await wrapper.get('input').setValue('TOKEN_SENTINEL')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('TOKEN_SENTINEL')
    expect(wrapper.text()).not.toContain('/private/secret')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'configure_setup', 'inspect_setup'])
  })

  it('stale refresh keeps the visible profile and disables service changes', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockRejectedValueOnce('transport')
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    const refresh = wrapper.findAll('button').find(button => button.text() === 'Обновить')!
    await refresh.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Данные устарели')
    for (const button of wrapper.findAll('button').filter(button => button.text() !== 'Обновить')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('failed preparation only retries when requested and never starts the service', async () => {
    const invoke = vi.fn().mockRejectedValueOnce('runtime_integrity').mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Нужно повторить проверку')
    expect(invoke).toHaveBeenCalledTimes(1)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount(); wrapper = undefined
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'prepare_desktop', 'inspect_setup'])
  })
})
