import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SetupPanel from './SetupPanel.vue'

describe('token form', () => {
  it('has a labelled secret input, keyboard submit and clears the DOM before IPC settles', async () => {
    let finish!: (value: boolean) => void
    const connect = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const wrapper = mount(SetupPanel, { props: { busy: false, connect, openTokenPage: vi.fn() } })
    expect(wrapper.get('label').text()).toContain('HikerAPI')
    const input = wrapper.get('input')
    expect(input.attributes('type')).toBe('password')
    expect(input.attributes('autocomplete')).toBe('off')
    await input.setValue('TOKEN_SENTINEL')
    await wrapper.get('form').trigger('submit')
    expect(connect).toHaveBeenCalledWith('TOKEN_SENTINEL')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(connect).toHaveBeenCalledTimes(1)
    finish(false); await flushPromises()
    expect(wrapper.html()).not.toContain('TOKEN_SENTINEL')
    wrapper.unmount()
  })
  it('toggles visibility without submitting or persisting the token', async () => {
    const connect = vi.fn().mockResolvedValue(true)
    const wrapper = mount(SetupPanel, { props: { busy: false, connect, openTokenPage: vi.fn() } })
    await wrapper.get('input').setValue('TOKEN_SENTINEL')
    await wrapper.get('button[aria-label="Show the token"]').trigger('click')
    expect(wrapper.get('input').attributes('type')).toBe('text')
    expect(connect).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0); expect(window.sessionStorage.length).toBe(0)
    wrapper.unmount()
  })
  it('explains background operation and spending before first setup', () => {
    const wrapper = mount(SetupPanel, { props: { busy: false, connect: vi.fn(), openTokenPage: vi.fn() } })
    expect(wrapper.text()).toContain('the window is closed')
    expect(wrapper.text()).toContain('HikerAPI quota')
    expect(wrapper.get('button[type=submit]').text()).toBe('Connect and start')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  })
})
