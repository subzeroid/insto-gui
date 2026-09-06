import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ServiceView from './ServiceView.vue'
import type { Profile } from '../desktop/client'
import { overview } from '../desktop/fixtures'

import { DesktopFailure } from '../desktop/messages'

const profile: Profile = { configured: true, status: 'running', desired_service: 'running', service_running: true, quota_remaining: 5, quota_checked_at: 100, revision: 'a'.repeat(32) }
const actions = () => ({ refreshOverview: vi.fn().mockResolvedValue(true), start: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(true), repair: vi.fn().mockResolvedValue(true) })

describe('service view', () => {
  it('shows the observed service state separately from the process flag and degrades honestly', async () => {
    const shown = mount(ServiceView, { props: { profile, overview: { ...overview, service_state: 'stopped' }, lastReadAt: 1_700_000_000_000, stale: false, monitoringStale: false, readError: null, busy: false, ...actions() } })
    expect(shown.text()).toContain('Наблюдаемое состояние службы'); expect(shown.text()).toContain('остановлена'); expect(shown.text()).toContain('Служба запущена'); expect(shown.text()).not.toContain('устарело')
    const missing = mount(ServiceView, { props: { profile, overview: null, lastReadAt: null, stale: false, monitoringStale: false, readError: new DesktopFailure('transport'), busy: false, ...actions() } })
    expect(missing.text()).toContain('нет данных'); expect(missing.text()).toContain('последнее чтение не удалось'); expect(missing.text()).toContain('не выполнено')
    const callbacks = actions()
    const stale = mount(ServiceView, { props: { profile, overview: { ...overview, service_state: 'running' }, lastReadAt: 1_700_000_000_000, stale: false, monitoringStale: true, readError: new DesktopFailure('transport'), busy: false, ...callbacks } })
    expect(stale.text()).toContain('запущена (устарело)'); expect(stale.text()).toContain('последнее чтение не удалось'); expect(stale.text()).not.toContain('доступны')
    await stale.get('button[data-action="refresh-overview"]').trigger('click')
    expect(callbacks.refreshOverview).toHaveBeenCalledTimes(1)
  })
})
