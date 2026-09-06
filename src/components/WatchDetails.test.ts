import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WatchDetails from './WatchDetails.vue'
import { DesktopClient } from '../desktop/client'
import { createHistoryState } from '../desktop/history'
import { watch } from '../desktop/fixtures'

describe('watch details', () => {
  it('saves a changed interval, toggles pause and resume, and disables every action while stale', async () => {
    const actions = { pause: vi.fn().mockResolvedValue(true), resume: vi.fn().mockResolvedValue(true), update: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true) }
    const history = createHistoryState(new DesktopClient(vi.fn()))
    const wrapper = mount(WatchDetails, { props: { watch, busy: false, stale: false, history, ...actions } })
    expect(wrapper.get('button[data-action="interval"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="interval"]').setValue('600')
    await wrapper.get('form.interval-form').trigger('submit'); await flushPromises()
    expect(actions.update).toHaveBeenCalledWith(watch, 600)
    await wrapper.get('button[data-action="pause"]').trigger('click')
    expect(actions.pause).toHaveBeenCalledWith(watch)
    await wrapper.setProps({ watch: { ...watch, status: 'paused' } })
    await wrapper.get('button[data-action="resume"]').trigger('click')
    expect(actions.resume).toHaveBeenCalledTimes(1)
    await wrapper.get('button[data-action="remove"]').trigger('click')
    expect(wrapper.find('button[data-action="confirm-remove"]').exists()).toBe(true)
    await wrapper.get('button[data-action="cancel-remove"]').trigger('click')
    expect(wrapper.find('button[data-action="confirm-remove"]').exists()).toBe(false)
    await wrapper.setProps({ stale: true })
    expect(wrapper.findAll('button[data-action]').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).not.toContain(watch.revision)
  })
})
