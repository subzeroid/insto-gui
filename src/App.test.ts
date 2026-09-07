import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from './App.vue'
import { CORE_VERSION, type Profile } from './desktop/client'
import { current, envelope, facts, foreign, overview, page, snap, wire } from './desktop/fixtures'
import type { ServiceFacts } from './desktop/client'

const prepared = { core_version: CORE_VERSION, build_id: 'a'.repeat(64) }
const empty: Profile = { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }
const stopped: Profile = { configured: true, status: 'stopped', desired_service: 'stopped', service_running: false, quota_remaining: 10, quota_checked_at: 100, revision: 'a'.repeat(32) }
const wrap = (data: Profile) => envelope('profile', data)
const runningProfile: Profile = { ...stopped, status: 'running', desired_service: 'running', service_running: true }
const inspection = (value: ServiceFacts) => envelope('service_inspection', wire(value))
const ownBinding = { state: 'own', home: null }
const adoptedBinding = { state: 'adopted', home: '/Users/x/.insto' }
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
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding'])
  })
  it('a configured profile lands on the watches section with the empty call to action and polls the overview', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(current))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Добавить аккаунт')
    expect(invoke.mock.calls.slice(0, 5).map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'read_overview'])
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
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty)).mockResolvedValueOnce(ownBinding)
      .mockRejectedValueOnce({ code: 'service_error', message: 'TOKEN_SENTINEL /private/secret' })
      .mockResolvedValueOnce(wrap(recovery))
      // The poll starts from a watcher, so its first overview read lands between
      // the mutation and the facts read `afterMutation` awaits right after it.
      .mockResolvedValueOnce(envelope('overview', { ...overview, watches: [] })).mockResolvedValueOnce(inspection(current))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    await wrapper.get('input').setValue('TOKEN_SENTINEL')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('TOKEN_SENTINEL'); expect(wrapper.html()).not.toContain('/private/secret')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Нужно восстановление') // landed on the service section, recovery visible
    expect(wrapper.get('.app-nav button[aria-selected="true"]').text()).toBe('Служба')
    expect(invoke.mock.calls.slice(0, 7).map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'configure_setup', 'inspect_setup', 'read_overview', 'inspect_service'])
  })
  it('opening the changes section loads the global feed with no filter', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(current))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    invoke.mockResolvedValueOnce(envelope('history_page', { items: [], next_cursor: null, scan_complete: true, scanned: 0 }))
    await wrapper.findAll('.app-nav button')[1].trigger('click'); await flushPromises()
    expect(invoke.mock.calls.at(-1)).toEqual(['list_changes', { query: {} }])
    expect(wrapper.find('button[data-action="clear-filter"]').exists()).toBe(false)
  })
  it('show-changes from the watches section opens the filtered feed; clear-filter reloads the global feed', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(current)).mockResolvedValueOnce(envelope('overview', overview))
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
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'read_overview', 'search_targets', 'list_snapshots', 'list_changes', 'list_changes'])
    expect(invoke.mock.calls.at(-1)).toEqual(['list_changes', { query: {} }])
    // Returning to the watches section keeps the selection and its loaded history without a reload.
    await wrapper.findAll('.app-nav button')[0].trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Аккаунт PK 7')
    expect(invoke).toHaveBeenCalledTimes(9)
  })
  it('a stale setup refresh shows the global banner and blocks service and settings changes, not navigation', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(current))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
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
  it('a profile needing recovery opens the service section and the global notice brings it back from any other section', async () => {
    const recovery = { ...stopped, status: 'recovery_required' as const }
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(recovery))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(current))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.get('.app-nav button[aria-selected="true"]').text()).toBe('Служба')
    expect(wrapper.find('button[data-action="open-service"]').exists()).toBe(false)
    await wrapper.findAll('.app-nav button')[3].trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Служба требует внимания')
    expect(wrapper.get('button[data-action="replace"]').attributes('disabled')).toBeDefined() // recovery guards token replacement
    expect(wrapper.get('button[data-action="uninstall"]').attributes('disabled')).toBeDefined() // and service removal
    await wrapper.get('button[data-action="open-service"]').trigger('click'); await flushPromises()
    expect(wrapper.get('.app-nav button[aria-selected="true"]').text()).toBe('Служба')
    expect(wrapper.text()).toContain('Нужно восстановление')
  })
  it('a service action is followed by one overview read', async () => {
    const running: Profile = { ...stopped, status: 'running', desired_service: 'running', service_running: true }
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(current)).mockResolvedValueOnce(envelope('overview', { ...overview, watches: [] }))
      .mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection(current)).mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    await wrapper.findAll('.app-nav button')[2].trigger('click'); await flushPromises()
    await wrapper.get('button[data-action="start"]').trigger('click'); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'read_overview', 'start_service', 'inspect_service', 'read_overview'])
    expect(wrapper.text()).toContain('Служба запущена')
  })
  it('failed preparation only retries when requested and never starts the service', async () => {
    const invoke = vi.fn().mockRejectedValueOnce('runtime_integrity').mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockResolvedValue(envelope('overview', overview))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Нужно повторить проверку')
    expect(invoke).toHaveBeenCalledTimes(2) // prepare_desktop, then the host-local binding read
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(invoke.mock.calls.some(call => ['start_service', 'stop_service', 'repair_service'].includes(call[0]))).toBe(false)
  })
  it('migrates the own outdated service once at startup, before polling, and shows the outcome', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(runningProfile))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(facts))
      .mockResolvedValueOnce(wrap(runningProfile)).mockResolvedValueOnce(inspection(current))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'migrate_service', 'inspect_service', 'read_overview'])
    expect(wrapper.text()).toContain('Служба переведена на встроенное ядро этой версии.')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('a service already on this core is left alone', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(runningProfile))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(current))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'read_overview'])
    expect(wrapper.text()).not.toContain('Служба переведена')
  })
  it('an adopted binding never migrates the CLI service at startup', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(runningProfile))
      .mockResolvedValueOnce(adoptedBinding).mockResolvedValueOnce(inspection(facts))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).not.toContain('migrate_service')
    expect(wrapper.text()).not.toContain('Служба переведена')
  })
  it('a refusal is reported once, keeps reading, and never claims a restored registration', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(runningProfile))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(facts))
      .mockResolvedValueOnce(envelope('error', { code: 'service_ownership_unknown', message: 'RAW_SENTINEL', retryable: false }))
      .mockResolvedValueOnce(wrap(runningProfile)).mockResolvedValueOnce(inspection(foreign))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(invoke.mock.calls.filter(call => call[0] === 'migrate_service')).toHaveLength(1)
    expect(wrapper.text()).toContain('Служба зарегистрирована не приложением. Чужая регистрация не изменяется.')
    expect(wrapper.text()).not.toContain('Прежняя регистрация')
    expect(wrapper.html()).not.toContain('RAW_SENTINEL')
    // Reads continue: the app is read-only about the service, not frozen.
    expect(invoke.mock.calls.map(call => call[0])).toContain('read_overview')
  })
  it('an uncertain migration says so instead of claiming a rollback', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(runningProfile))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(facts))
      .mockRejectedValueOnce('operation_timeout')
      .mockResolvedValueOnce(wrap(runningProfile)).mockResolvedValueOnce(inspection(facts))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Результат перевода службы неизвестен')
    expect(wrapper.text()).not.toContain('Прежняя регистрация')
  })
  it('a migration that needed recovery does not claim the app restored anything', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(runningProfile))
      .mockResolvedValueOnce(ownBinding).mockResolvedValueOnce(inspection(facts))
      .mockResolvedValueOnce(envelope('error', { code: 'recovery_required', message: 'RAW_SENTINEL', retryable: false }))
      .mockResolvedValueOnce(wrap({ ...runningProfile, status: 'recovery_required' })).mockResolvedValueOnce(inspection(facts))
      .mockResolvedValue(envelope('overview', { ...overview, watches: [] }))
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Приложение ничего не восстанавливало')
    expect(wrapper.text()).not.toContain('Прежняя регистрация восстановлена')
    expect(wrapper.get('.app-nav button[aria-selected="true"]').text()).toBe('Служба')
  })
  it('an unconfigured profile reads the binding but not the registration facts', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty)).mockResolvedValueOnce(ownBinding)
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding'])
  })
  it('a failed initialization on an adopted binding offers the release and starts over', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockRejectedValueOnce({ code: 'home_invalid' })
      .mockResolvedValueOnce(adoptedBinding)
      .mockResolvedValueOnce(wrap(empty))                               // select_home {home:{path:null}}
      .mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockResolvedValueOnce(ownBinding)
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Нужно повторить проверку')
    expect(wrapper.text()).toContain('Приложение связано с внешним каталогом insto')
    await wrapper.get('button[data-action="release-binding"]').trigger('click'); await flushPromises()
    expect(wrapper.find('input[type="password"]').exists()).toBe(true) // back on its own unconfigured profile
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'select_home', 'prepare_desktop', 'inspect_setup', 'inspect_binding'])
  })
  it('a failed initialization on its own binding offers no release', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockRejectedValueOnce('transport')
      .mockResolvedValueOnce(ownBinding)
    wrapper = mount(App, { props: { invokeCommand: invoke } }); await flushPromises()
    expect(wrapper.text()).toContain('Нужно повторить проверку')
    expect(wrapper.find('button[data-action="release-binding"]').exists()).toBe(false)
  })
})
