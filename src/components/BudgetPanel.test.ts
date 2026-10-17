import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import BudgetPanel from './BudgetPanel.vue'
import { DesktopClient } from '../desktop/client'
import { createMockInvoke } from '../desktop/mock'
import { t } from '../i18n'

describe('request budget', () => {
  it('reads locally, forecasts active watches, and applies an explicit limit', async () => {
    const invoke = vi.fn(createMockInvoke({ lookupDelayMs: 0 }))
    const wrapper = mount(BudgetPanel, { props: { client: new DesktopClient(invoke), watches: [{ status: 'active', interval_seconds: 3600 }, { status: 'paused', interval_seconds: 300 }], incomplete: false } })
    await flushPromises()
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['inspect_usage'])
    expect(wrapper.text()).toContain(t('usage.forecast', { count: '48' }))
    await wrapper.get('input').setValue('100')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(invoke.mock.calls.at(-1)).toEqual(['configure_usage', { budget: { daily_limit: 100 } }])
    expect(wrapper.text()).toContain(t('usage.saved'))
    await wrapper.get('input').setValue('')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(invoke.mock.calls.at(-1)).toEqual(['configure_usage', { budget: { daily_limit: null } }])
    wrapper.unmount()
  })
  it('refuses invalid caps locally, labels partial forecasts and preserves a failed save', async () => {
    const invoke = vi.fn(createMockInvoke())
    const wrapper = mount(BudgetPanel, { props: { client: new DesktopClient(invoke), watches: [], incomplete: true } })
    await flushPromises()
    expect(wrapper.text()).toContain(t('usage.partial_forecast'))
    await wrapper.get('input').setValue('0')
    await wrapper.get('form').trigger('submit')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain(t('usage.invalid'))
    invoke.mockRejectedValueOnce('transport')
    await wrapper.get('input').setValue('123')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('123')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain(t('usage.saved'))
    wrapper.unmount()
  })
})
