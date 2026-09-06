import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from './App.vue'
import { CORE_VERSION, type Profile } from './desktop/client'
import { envelope, overview, page, snap } from './desktop/fixtures'

const prepared = { core_version: CORE_VERSION, build_id: 'a'.repeat(64) }
const empty: Profile = { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }
const stopped: Profile = { configured: true, status: 'stopped', desired_service: 'stopped', service_running: false, quota_remaining: 10, quota_checked_at: 100, revision: 'a'.repeat(32) }
const wrap = (data: Profile) => envelope('profile', data)
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('application integration', () => {
  it('starts read-only with the setup screen and no monitoring reads', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
    wrapper = mount(App, { props: { invokeCommand: invoke } })
    expect(wrapper.text()).toContain('Готовим ядро')
    await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    expect(wrapper.find('.app-nav').exists()).toBe(false)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup'])
  })
  it('a configured profile lands on the watches section with the empty call to action and polls the overview', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Добавить аккаунт')
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'read_overview'])
    const tabs = wrapper.findAll('.app-nav button')
    expect(tabs.map(tab => tab.text())).toEqual(['Наблюдения', 'Изменения', 'Служба', 'Настройки'])
    invoke.mockResolvedValueOnce(envelope('history_page', { items: [], next_cursor: null, scan_complete: true, scanned: 0 }))
    await tabs[1].trigger('click'); await flushPromises()
    expect(invoke.mock.calls.at(-1)?.[0]).toBe('list_changes')
    await tabs[2].trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Служба остановлена'); expect(wrapper.text()).toContain('Наблюдаемое состояние')
    await tabs[3].trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Заменить токен')
    expect(window.localStorage.length).toBe(0); expect(window.sessionStorage.length).toBe(0)
  })
  it('a saved setup with failed start is read back without requesting the token again', async () => {
    const recovery = { ...stopped, status: 'recovery_required' as const }
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockRejectedValueOnce({ code: 'service_error', message: 'TOKEN_SENTINEL /private/secret' })
      .mockResolvedValueOnce(wrap(recovery)).mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    await wrapper.get('input').setValue('TOKEN_SENTINEL')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('TOKEN_SENTINEL'); expect(wrapper.text()).not.toContain('/private/secret')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Нужно восстановление') // landed on the service section, recovery visible
    expect(wrapper.get('.app-nav button[aria-selected="true"]').text()).toBe('Служба')
    expect(invoke.mock.calls.slice(0, 4).map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'configure_setup', 'inspect_setup'])
  })
  it('the feed filter is owned by the app: clearing it reloads the global feed everywhere', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    invoke.mockResolvedValueOnce(envelope('history_page', { items: [], next_cursor: null, scan_complete: true, scanned: 0 }))
    await wrapper.findAll('.app-nav button')[1].trigger('click'); await flushPromises()
    expect(invoke.mock.calls.at(-1)).toEqual(['list_changes', { query: {} }])
    expect(wrapper.find('button[data-action="clear-filter"]').exists()).toBe(false)
  })
  it('show-changes from the watches section opens the filtered feed; clear-filter reloads the global feed', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockResolvedValueOnce(envelope('overview', overview))
      .mockResolvedValueOnce(envelope('history_page', page([{ kind: 'target', target_pk: '7', snapshot: snap('1', '7', 1) }])))
      .mockResolvedValueOnce(envelope('history_page', page([{ kind: 'snapshot', snapshot: snap('1', '7', 1) }])))
      .mockResolvedValueOnce(envelope('history_page', page([]))).mockResolvedValueOnce(envelope('history_page', page([])))
      .mockResolvedValue(envelope('overview', overview))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    await wrapper.get('[role="option"]').trigger('click'); await flushPromises()
    await wrapper.get('button[data-action="changes"]').trigger('click'); await flushPromises()
    expect(wrapper.get('.app-nav button[aria-selected="true"]').text()).toBe('Изменения')
    expect(wrapper.text()).toContain('PK 7')
    expect(invoke.mock.calls.at(-1)).toEqual(['list_changes', { query: { target_pk: '7' } }])
    await wrapper.get('button[data-action="clear-filter"]').trigger('click'); await flushPromises()
    expect(wrapper.find('button[data-action="clear-filter"]').exists()).toBe(false)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'read_overview', 'search_targets', 'list_snapshots', 'list_changes', 'list_changes'])
    expect(invoke.mock.calls.at(-1)).toEqual(['list_changes', { query: {} }])
    // Returning to the watches section keeps the selection and its loaded history without a reload.
    await wrapper.findAll('.app-nav button')[0].trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Аккаунт PK 7')
    expect(invoke).toHaveBeenCalledTimes(7)
  })
  it('a stale setup refresh shows the global banner and blocks service and settings changes, not navigation', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    await wrapper.findAll('.app-nav button')[2].trigger('click'); await flushPromises()
    invoke.mockRejectedValueOnce('transport')
    await wrapper.findAll('button').find(button => button.text() === 'Обновить')!.trigger('click'); await flushPromises()
    expect(invoke.mock.calls.at(-1)?.[0]).toBe('inspect_setup')
    expect(wrapper.text()).toContain('Состояние настройки устарело'); expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Служба остановлена') // the last good profile stays visible
    for (const action of ['start', 'stop', 'repair']) expect(wrapper.get(`button[data-action="${action}"]`).attributes('disabled')).toBeDefined()
    await wrapper.findAll('.app-nav button')[3].trigger('click'); await flushPromises()
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Состояние настройки устарело')
  })
  it('failed preparation only retries when requested and never starts the service', async () => {
    const invoke = vi.fn().mockRejectedValueOnce('runtime_integrity').mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockResolvedValue(envelope('overview', overview))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Нужно повторить проверку')
    expect(invoke).toHaveBeenCalledTimes(1)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(invoke.mock.calls.some(call => ['start_service', 'stop_service', 'repair_service'].includes(call[0]))).toBe(false)
  })
})
