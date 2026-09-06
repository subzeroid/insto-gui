import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AddWatchForm from './AddWatchForm.vue'

describe('add watch form', () => {
  it('canonicalizes the username, defaults the interval and warns about spending', async () => {
    const add = vi.fn().mockResolvedValue(true)
    const wrapper = mount(AddWatchForm, { props: { busy: false, add } })
    expect(wrapper.text()).toContain('лимит HikerAPI')
    await wrapper.get('input[name="user"]').setValue('@Alice ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(add).toHaveBeenCalledWith('alice', 300)
    expect((wrapper.get('input[name="user"]').element as HTMLInputElement).value).toBe('')
  })
  it('rejects invalid input locally and never submits twice while busy', async () => {
    const add = vi.fn().mockResolvedValue(false)
    const wrapper = mount(AddWatchForm, { props: { busy: false, add } })
    await wrapper.get('input[name="user"]').setValue('a b')
    await wrapper.get('form').trigger('submit')
    expect(add).not.toHaveBeenCalled(); expect(wrapper.find('[role="alert"]').text()).toContain('Имя аккаунта')
    await wrapper.get('input[name="user"]').setValue(' @alice') // the CLI order strips "@" before whitespace: this stays invalid
    await wrapper.get('form').trigger('submit')
    expect(add).not.toHaveBeenCalled()
    await wrapper.get('input[name="user"]').setValue('alice')
    await wrapper.get('input[name="interval"]').setValue('120')
    await wrapper.get('form').trigger('submit')
    expect(add).not.toHaveBeenCalled()
    await wrapper.setProps({ busy: true })
    await wrapper.get('input[name="interval"]').setValue('300')
    await wrapper.get('form').trigger('submit')
    expect(add).not.toHaveBeenCalled()
  })
  it('keeps the add label while disabled by the parent and clears the local error on input', async () => {
    const wrapper = mount(AddWatchForm, { props: { busy: true, add: vi.fn() } })
    expect(wrapper.get('button[type="submit"]').text()).toBe('Добавить аккаунт'); expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ busy: false })
    await wrapper.get('input[name="user"]').setValue('a b'); await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await wrapper.get('input[name="user"]').setValue('ab')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('blocks a second submit while the first add is still pending', async () => {
    let finish!: (value: boolean) => void
    const add = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const wrapper = mount(AddWatchForm, { props: { busy: false, add } })
    await wrapper.get('input[name="user"]').setValue('alice')
    await wrapper.get('form').trigger('submit')
    expect(add).toHaveBeenCalledTimes(1)
    expect(wrapper.get('button[type="submit"]').text()).toBe('Сохраняем…'); expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(add).toHaveBeenCalledTimes(1)
    finish(true); await flushPromises()
    expect((wrapper.get('input[name="user"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Добавить аккаунт')
  })
})
