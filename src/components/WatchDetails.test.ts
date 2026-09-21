import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WatchDetails from './WatchDetails.vue'
import { DesktopClient } from '../desktop/client'
import { createHistoryState } from '../desktop/history'
import { profileFields, watch } from '../desktop/fixtures'
import { t } from '../i18n'

describe('watch details', () => {
  it('saves a changed interval, toggles pause and resume, and disables every mutating action while stale', async () => {
    const actions = { pause: vi.fn().mockResolvedValue(true), resume: vi.fn().mockResolvedValue(true), update: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true) }
    const history = createHistoryState(new DesktopClient(vi.fn()))
    const wrapper = mount(WatchDetails, { props: { watch, serviceState: 'running' as const, busy: false, stale: false, history, ...actions } })
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
    expect(wrapper.get('button[data-action="remove"]').attributes('disabled')).toBeUndefined() // the trigger keeps focus while confirming
    await wrapper.get('button[data-action="cancel-remove"]').trigger('click')
    expect(wrapper.find('button[data-action="confirm-remove"]').exists()).toBe(false)
    history.state.targetPk = '7'
    await wrapper.setProps({ stale: true })
    expect(wrapper.get('button[data-action="changes"]').attributes('disabled')).toBeUndefined() // a read stays available while stale
    expect(wrapper.findAll('button[data-action]').filter(button => button.attributes('data-action') !== 'changes').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).not.toContain(watch.revision)
    await wrapper.setProps({ busy: true })
    expect(wrapper.get('button[data-action="changes"]').attributes('disabled')).toBeDefined() // only a running mutation holds it back
  })
  it('says the first check is running, unless the watch is paused or already failing', async () => {
    const actions = { pause: vi.fn(), resume: vi.fn(), update: vi.fn(), remove: vi.fn() }
    const history = createHistoryState(new DesktopClient(vi.fn()))
    const wrapper = mount(WatchDetails, { props: { watch, serviceState: 'running' as const, busy: false, stale: false, history, ...actions } })
    expect(wrapper.get('.intro').text()).toBe(t('watches.detail_first_check'))
    expect(wrapper.get('.intro').text()).toContain('few seconds')
    // A registration that has never been checked and already failed keeps the old
    // wording: the app must not claim a check is under way.
    await wrapper.setProps({ watch: { ...watch, has_error: true, consecutive_errors: 2 } })
    expect(wrapper.get('.intro').text()).toBe(t('watches.detail_waiting'))
    // Nor may it claim one while the service that would perform it is not running.
    await wrapper.setProps({ watch, serviceState: 'stopped' })
    expect(wrapper.get('.intro').text()).toBe(t('watches.detail_waiting'))
    await wrapper.setProps({ serviceState: 'unknown' })
    expect(wrapper.get('.intro').text()).toBe(t('watches.detail_waiting'))
    await wrapper.setProps({ watch: { ...watch, status: 'paused' }, serviceState: 'running' })
    expect(wrapper.get('.intro').text()).toBe(t('watches.detail_paused'))
    await wrapper.setProps({ watch: { ...watch, last_ok: 1_770_000_000, waiting_first_check: false } })
    expect(wrapper.get('.intro').text()).toBe(t('watches.detail_active'))
  })
  it('puts the profile card first, above the controls and the saved snapshots', async () => {
    const actions = { pause: vi.fn(), resume: vi.fn(), update: vi.fn(), remove: vi.fn() }
    const history = createHistoryState(new DesktopClient(vi.fn()))
    history.state.username = 'alice'
    history.state.targetPk = '7'
    history.state.targets.scanComplete = true
    history.state.snapshots.items = [{ id: '2', target_pk: '7', captured_at: 1_770_000_000 }]
    history.state.snapshots.loaded = true
    history.state.profile = { value: profileFields('2', '7', 1_770_000_000), targetPk: '7', snapshotId: '2', loading: false, error: null }
    const wrapper = mount(WatchDetails, { props: { watch, serviceState: 'running' as const, busy: false, stale: false, history, ...actions } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('@alice')
    expect(text).toContain('First snapshot')
    expect(wrapper.findAll('section').map(node => node.attributes('class')).filter(Boolean)).toEqual(['watch-details', 'profile-card', 'snapshot-history'])
    // The card comes before the first control, and the account is named once.
    const order = [...wrapper.element.querySelectorAll('h2, .profile-card, .actions, .snapshot-history')].map(node => node.tagName === 'H2' ? 'h2' : node.className)
    expect(order).toEqual(['h2', 'profile-card', 'actions', 'snapshot-history'])
    expect(text.match(/@alice/g)).toHaveLength(1)
  })
})
