import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OnboardingView from './OnboardingView.vue'
import type { Binding } from '../desktop/client'
import { DesktopFailure } from '../desktop/messages'

const own: Binding = { state: 'own', home: null }
const home = () => ({ state: { path: '~/.insto', checked: null as unknown, checking: false, error: null }, edit: vi.fn(), check: vi.fn(), adopt: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(true) })
const props = (overrides: Record<string, unknown> = {}) => ({ busy: false, stale: false, error: null, home: home(), binding: own, connect: vi.fn().mockResolvedValue(true), openTokenPage: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined), ...overrides })

describe('onboarding', () => {
  it('shows only the token form until the existing-installation line is opened', async () => {
    const view = mount(OnboardingView, { props: props() as never })
    expect(view.find('input[type="password"]').exists()).toBe(true)
    expect(view.find('.home-adoption').exists()).toBe(false)
    const toggle = view.get('[data-action="show-home-adoption"]')
    expect(toggle.text()).toBe('Already use insto in the terminal?')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(view.get('.home-adoption').text()).toContain('Existing insto installation')
  })
  it('says what the app is for, not how it is built', () => {
    const text = mount(OnboardingView, { props: props() as never }).text()
    expect(text).toContain('See what changed.')
    expect(text).toContain('Checks run in the background, even with the window closed')
    expect(text).not.toMatch(/Python|core/i)
  })
  it('keeps the setup errors and the stale banner it replaced', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const view = mount(OnboardingView, { props: props({ error: new DesktopFailure('invalid_token'), stale: true, refresh }) as never })
    expect(view.get('[role="alert"]').text()).toContain('HikerAPI rejected the token')
    expect(view.text()).toContain('The data is out of date')
    await view.get('button.text-button').trigger('click')
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('carries no adoption outcome of its own', () => {
    // The selection is reported by `createHomeState`, because a successful
    // adoption here flips `configured` and unmounts this whole screen.
    const view = mount(OnboardingView, { props: props() as never })
    expect(view.emitted('adopted')).toBeUndefined()
    expect(view.emitted('released')).toBeUndefined()
  })
})
