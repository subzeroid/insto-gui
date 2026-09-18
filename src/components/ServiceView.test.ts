import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ServiceView from './ServiceView.vue'
import type { Binding, Profile, ServiceFacts } from '../desktop/client'
import { current, facts, foreign, overview, unregistered } from '../desktop/fixtures'
import { DesktopFailure } from '../desktop/messages'

const profile: Profile = { configured: true, status: 'running', desired_service: 'running', service_running: true, quota_remaining: 5, quota_checked_at: 100, revision: 'a'.repeat(32) }
const own: Binding = { state: 'own', home: null }
const adopted: Binding = { state: 'adopted', home: '/Users/x/.insto' }
const nobody: Binding = { state: 'unknown', home: null }

function serviceStub(value: ServiceFacts | null, binding: Binding, overrides: Record<string, unknown> = {}) {
  const state = { facts: value, binding, factsAt: 1, migrating: false, notice: null, error: null as DesktopFailure | null }
  const readonly = () => binding.state === 'unknown' || value === null || value.registration === 'unknown'
  const canMigrate = () => !readonly() && value !== null && value.registration === 'owned' && value.interpreter === 'other' && value.settings !== 'different'
  return {
    state, fresh: () => value !== null, readonly, canMigrate,
    canUninstall: () => !readonly() && value !== null && value.registration === 'owned' && !(binding.state === 'adopted' && value.interpreter === 'other'),
    takeover: () => canMigrate() && binding.state === 'adopted',
    migrate: vi.fn().mockResolvedValue(true), uninstall: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}
const actions = (service: ReturnType<typeof serviceStub>) => ({ service, refreshOverview: vi.fn().mockResolvedValue(true), refreshFacts: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true), repair: vi.fn().mockResolvedValue(true) })
const base = { profile, overview, lastReadAt: 1_700_000_000_000, stale: false, monitoringStale: false, readError: null, busy: false }

describe('service view', () => {
  it('shows the observed service state separately from the process flag and degrades honestly', async () => {
    const service = serviceStub(current, own)
    const shown = mount(ServiceView, { props: { ...base, overview: { ...overview, service_state: 'stopped' }, ...actions(service) } as never })
    expect(shown.text()).toContain('Observed state of the service'); expect(shown.text()).toContain('stopped'); expect(shown.text()).toContain('The service is running'); expect(shown.text()).not.toContain('out of date')
    const missing = mount(ServiceView, { props: { ...base, overview: null, lastReadAt: null, readError: new DesktopFailure('transport'), ...actions(service) } as never })
    expect(missing.text()).toContain('no data'); expect(missing.text()).toContain('the last read failed'); expect(missing.text()).toContain('none yet')
    const callbacks = actions(service)
    const stale = mount(ServiceView, { props: { ...base, overview: { ...overview, service_state: 'running' }, monitoringStale: true, readError: new DesktopFailure('transport'), ...callbacks } as never })
    expect(stale.text()).toContain('running (out of date)'); expect(stale.text()).toContain('the last read failed'); expect(stale.text()).not.toContain('available')
    await stale.get('button[data-action="refresh-overview"]').trigger('click')
    expect(callbacks.refreshOverview).toHaveBeenCalledTimes(1)
  })

  it('renders the registration facts and the bound folder', () => {
    const view = mount(ServiceView, { props: { ...base, ...actions(serviceStub(current, own)) } as never })
    const card = view.get('.registration-facts').text()
    expect(card).toContain('installed by insto')
    expect(card).toContain('bundled with this app')
    expect(card).toContain('the own folder of the app')
    const gone = mount(ServiceView, { props: { ...base, ...actions(serviceStub({ ...facts, interpreterExists: false }, own)) } as never })
    expect(gone.get('.registration-facts').text()).toContain('the core file is missing')
  })

  it('renders the read failure with a way to try again instead of hiding it', async () => {
    const service = serviceStub(null, own)
    service.state.error = new DesktopFailure('storage_error')
    const callbacks = actions(service)
    const view = mount(ServiceView, { props: { ...base, ...callbacks } as never })
    expect(view.text()).toContain('The registration of the service could not be read')
    await view.get('button[data-action="refresh-facts"]').trigger('click')
    expect(callbacks.refreshFacts).toHaveBeenCalledTimes(1)
  })

  it('an unknown registration, an unknown binding and unread facts each disable every control', () => {
    for (const service of [serviceStub(foreign, own), serviceStub(facts, nobody), serviceStub(null, own)]) {
      const view = mount(ServiceView, { props: { ...base, ...actions(service) } as never })
      expect(view.find('[data-note="service-readonly"]').exists()).toBe(true)
      expect(view.find('button[data-action="migrate-service"]').exists()).toBe(false)
      for (const action of ['start', 'stop', 'repair']) expect(view.get(`button[data-action="${action}"]`).attributes('disabled')).toBeDefined()
    }
  })

  it('a settings mismatch is shown and never offered as a migration', () => {
    const view = mount(ServiceView, { props: { ...base, ...actions(serviceStub({ ...facts, settings: 'different' }, own)) } as never })
    expect(view.get('[data-note="service-settings"]').text()).toContain('differ from the settings of this folder')
    expect(view.find('button[data-action="migrate-service"]').exists()).toBe(false)
  })

  it('its own outdated service migrates on one click, with no confirmation', async () => {
    const service = serviceStub(facts, own)
    const view = mount(ServiceView, { props: { ...base, ...actions(service) } as never })
    expect(view.get('button[data-action="migrate-service"]').text()).toBe('Move the service to the bundled core')
    await view.get('button[data-action="migrate-service"]').trigger('click')
    expect(service.migrate).toHaveBeenCalledTimes(1)
  })

  it('an adopted CLI service is a confirmed takeover, cancellable, and closes when it stops being possible', async () => {
    const service = serviceStub(facts, adopted)
    const view = mount(ServiceView, { props: { ...base, ...actions(service) } as never })
    const button = view.get('button[data-action="migrate-service"]')
    expect(button.text()).toBe('Let the app manage the service')
    await button.trigger('click')
    expect(view.text()).toContain('register it again on the bundled core')
    expect(service.migrate).not.toHaveBeenCalled()
    await view.get('button[data-action="cancel-takeover"]').trigger('click')
    expect(view.find('button[data-action="confirm-takeover"]').exists()).toBe(false)
    expect(service.migrate).not.toHaveBeenCalled()
    await view.get('button[data-action="migrate-service"]').trigger('click')
    // The facts change under the open confirmation: it closes instead of running.
    service.state.facts = unregistered
    await view.setProps({ stale: true })
    expect(view.find('button[data-action="confirm-takeover"]').exists()).toBe(false)
    expect(service.migrate).not.toHaveBeenCalled()
  })

  it('a service already on this core offers nothing to migrate', () => {
    const view = mount(ServiceView, { props: { ...base, ...actions(serviceStub(current, adopted)) } as never })
    expect(view.find('button[data-action="migrate-service"]').exists()).toBe(false)
  })
})
