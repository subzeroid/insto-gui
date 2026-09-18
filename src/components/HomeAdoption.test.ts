import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import HomeAdoption from './HomeAdoption.vue'
import type { Binding, HomeReport } from '../desktop/client'
import { DesktopFailure } from '../desktop/messages'
import { homeAdoptable } from '../desktop/fixtures'

const cliOwned: HomeReport = { ...homeAdoptable, registration: 'owned', interpreter: 'other', loaded: true, process: 'running' }
const unsupported: HomeReport = { ...homeAdoptable, backend: 'aiograpi', adoptable: false, reason: 'home_backend_unsupported' }
const missing: HomeReport = { path: '/Users/x/none', exists: false, private: false, config: 'missing', backend: null, database: 'missing', registration: 'none', interpreter: null, loaded: null, process: 'unknown', adoptable: false, reason: 'home_invalid' }
const own: Binding = { state: 'own', home: null }
const adopted: Binding = { state: 'adopted', home: '/Users/x/.insto' }

function stub(checked: HomeReport | null = null, overrides: Record<string, unknown> = {}) {
  return {
    // Reactive: the component only sees a change the test makes when it goes
    // through a proxy, exactly as it would through the real `createHomeState`.
    state: reactive({ path: '~/.insto', checked: checked === null ? null : { path: checked.path, report: checked }, checking: false, error: null as DesktopFailure | null }),
    edit: vi.fn(), check: vi.fn(),
    adopt: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}
const mountBlock = (home: ReturnType<typeof stub>, binding: Binding = own, extra: Record<string, unknown> = {}) =>
  mount(HomeAdoption, { props: { home, binding, busy: false, disabled: false, ...extra } as never })

describe('home adoption block', () => {
  it('routes every keystroke through edit, so the report can never outlive its input', async () => {
    const home = stub(homeAdoptable)
    const view = mountBlock(home)
    await view.get('input[data-field="home-path"]').setValue('/Users/x/other')
    expect(home.edit).toHaveBeenCalledWith('/Users/x/other')
  })

  it('checks the typed path and renders the report card', async () => {
    const home = stub(homeAdoptable)
    const view = mountBlock(home)
    await view.get('button[data-action="check-home"]').trigger('click')
    expect(home.check).toHaveBeenCalled()
    const card = view.get('.home-report').text()
    expect(card).toContain('HikerAPI')
    expect(card).toContain('/Users/x/.insto')
    expect(card).toContain('can be connected')
  })

  it('explains an unsupported backend and an unusable directory and offers no connect button', () => {
    const unsupportedView = mountBlock(stub(unsupported))
    expect(unsupportedView.text()).toContain('is set to something other than HikerAPI')
    expect(unsupportedView.find('button[data-action="adopt-home"]').exists()).toBe(false)
    const missingView = mountBlock(stub(missing))
    expect(missingView.text()).toContain('The folder cannot be used safely')
    expect(missingView.find('button[data-action="adopt-home"]').exists()).toBe(false)
  })

  it('names a CLI service inside the home without pretending the app will manage it', () => {
    const view = mountBlock(stub(cliOwned))
    expect(view.text()).toContain('an insto service is installed')
    expect(view.text()).toContain('its core is another one')
  })

  it('disables the input, the check and the adoption while an inspection is in flight', () => {
    const view = mountBlock(stub(homeAdoptable, { state: { path: '~/.insto', checked: { path: homeAdoptable.path, report: homeAdoptable }, checking: true, error: null } }))
    expect(view.get('input[data-field="home-path"]').attributes('disabled')).toBeDefined()
    expect(view.get('button[data-action="check-home"]').attributes('disabled')).toBeDefined()
    expect(view.get('button[data-action="adopt-home"]').attributes('disabled')).toBeDefined()
  })

  it('asks for confirmation, adopts exactly once and never adopts on cancel', async () => {
    const home = stub(homeAdoptable)
    const view = mountBlock(home)
    await view.get('button[data-action="adopt-home"]').trigger('click')
    expect(view.text()).toContain('The app will start working with the folder')
    expect(home.adopt).not.toHaveBeenCalled()
    await view.get('button[data-action="cancel-adopt"]').trigger('click')
    expect(view.find('button[data-action="confirm-adopt"]').exists()).toBe(false)
    expect(home.adopt).not.toHaveBeenCalled()
    await view.get('button[data-action="adopt-home"]').trigger('click')
    await view.get('button[data-action="confirm-adopt"]').trigger('click')
    expect(home.adopt).toHaveBeenCalledTimes(1)
  })

  it('shows the refusal the state recorded and reports no outcome of its own', async () => {
    const refused = stub(homeAdoptable, { adopt: vi.fn().mockResolvedValue(false) })
    refused.state.error = new DesktopFailure('home_invalid')
    const view = mountBlock(refused)
    await view.get('button[data-action="adopt-home"]').trigger('click')
    await view.get('button[data-action="confirm-adopt"]').trigger('click')
    expect(view.get('[role="alert"]').text()).toBe(refused.state.error.message)
    // The outcome travels through `createHomeState`'s `settled` hook: a successful
    // adoption unmounts this block, so it must never be the thing that carries it.
    expect(view.emitted('adopted')).toBeUndefined()
    expect(view.emitted('released')).toBeUndefined()
  })

  it('closes an open confirmation when the state under it changes', async () => {
    const home = stub(homeAdoptable)
    const view = mountBlock(home)
    await view.get('button[data-action="adopt-home"]').trigger('click')
    expect(view.find('button[data-action="confirm-adopt"]').exists()).toBe(true)
    home.state.checked = null
    await view.vm.$nextTick()
    expect(view.find('button[data-action="confirm-adopt"]').exists()).toBe(false)
    expect(home.adopt).not.toHaveBeenCalled()
  })

  it('offers the return to the own profile only while adopted, and names the bound folder', async () => {
    const own_ = mountBlock(stub(null), own)
    expect(own_.find('button[data-action="release-home"]').exists()).toBe(false)
    const home = stub(null)
    const view = mountBlock(home, adopted)
    expect(view.text()).toContain('/Users/x/.insto')
    await view.get('button[data-action="release-home"]').trigger('click')
    expect(view.text()).toContain('The app will return to its own folder')
    await view.get('button[data-action="confirm-release"]').trigger('click')
    expect(home.release).toHaveBeenCalledTimes(1)
  })

  it('an adopted binding hides the connect button for a second home', () => {
    const view = mountBlock(stub(homeAdoptable), adopted)
    expect(view.find('button[data-action="adopt-home"]').exists()).toBe(false)
  })
})
