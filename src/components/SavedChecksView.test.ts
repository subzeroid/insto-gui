import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SavedChecksView from './SavedChecksView.vue'
import { createResearchState, ResearchClient, type SavedCheck } from '../desktop/workbench'
import { localTime } from '../desktop/format'
import { setLocale, t } from '../i18n'

const check = (username = 'alice', id = 'a'.repeat(32)): SavedCheck => ({
  id, username, target_pk: '7', captured_at: 1700000000, saved_at: 1700003600,
  profile: {
    target_pk: '7', access: 'public', quota_remaining: null, unknown_fields: [],
    fields: {
      username, full_name: username, biography: null, external_url: null,
      is_verified: false, is_business: false, is_private: false,
      follower_count: 100, following_count: 20, media_count: 2,
      public_email: null, public_phone: null, business_category: null,
    },
  },
  activity: {
    target_pk: '7', window: 12, analyzed: 2,
    geo: { geotagged: 0, anchor: null, centroid: null, radius_km: null, places: [] },
    timeline: {
      hour_of_day: Array.from({ length: 24 }, (_, hour) => hour === 10 ? 2 : 0),
      day_of_week: [2, 0, 0, 0, 0, 0, 0],
      weekday_hours: Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => day === 0 && hour === 10 ? 2 : 0)),
      first_post_at: 1690000000, last_post_at: 1690003600,
    },
    hashtags: [{ key: 'coffee', count: 1 }], mentions: [{ key: 'atlas', count: 1 }], locations: [{ key: 'Cafe', count: 1 }],
    likes: { total: 30, average: 15, top_posts: [{ code: 'one', like_count: 20 }, { code: 'two', like_count: 10 }] },
    quota_remaining: null,
  },
})

function setup(items: SavedCheck[] = [check()]) {
  const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>): Promise<unknown> => {
    if (command === 'research_list') return items
    if (command === 'research_delete' || command === 'research_export') return true
    throw new Error(`Unexpected command: ${command}`)
  })
  const research = createResearchState(new ResearchClient(invoke))
  const wrapper = mount(SavedChecksView, { props: { research } })
  return { wrapper, research, invoke }
}
const selectPair = async (harness: ReturnType<typeof setup>, left: SavedCheck, right: SavedCheck) => {
  await harness.wrapper.get('select[name="first-check"]').setValue(left.id)
  await harness.wrapper.get('select[name="second-check"]').setValue(right.id)
  await flushPromises()
}
afterEach(() => setLocale('en'))

describe('saved checks view', () => {
  it('loads locally, names both timestamps and coverage, and opens without requesting the provider', async () => {
    const first = check(), second = check('bob', 'b'.repeat(32))
    second.activity = null
    const { wrapper, invoke } = setup([first, second])
    await flushPromises()
    const cards = wrapper.findAll('[data-check]')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain(t('research.capture', { time: localTime(first.captured_at) }))
    expect(cards[0].text()).toContain(t('research.saved_at', { time: localTime(first.saved_at) }))
    expect(cards[0].text()).toContain(t('research.coverage', { count: '2', window: '12' }))
    expect(cards[1].text()).toContain(t('research.profile_only'))
    await cards[0].get('[data-action="open"]').trigger('click')
    expect(wrapper.emitted('open')).toEqual([[first]])
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['research_list'])
    await wrapper.get('[data-action="refresh"]').trigger('click')
    await flushPromises()
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['research_list', 'research_list'])
  })

  it('shows loading before a read finishes and an empty state only after a successful empty read', async () => {
    let resolve!: (value: unknown) => void
    const research = createResearchState(new ResearchClient(() => new Promise(done => { resolve = done })))
    const wrapper = mount(SavedChecksView, { props: { research } })
    await nextTick()
    expect(wrapper.text()).toContain(t('research.loading'))
    expect(wrapper.text()).not.toContain(t('research.empty'))
    resolve([])
    await flushPromises()
    expect(wrapper.text()).toContain(t('research.empty'))
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('requires inline deletion confirmation and lets cancellation keep the saved check', async () => {
    const item = check()
    const { wrapper, invoke } = setup([item])
    await flushPromises()
    await wrapper.get('[data-action="delete"]').trigger('click')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain(t('research.delete_confirm'))
    expect(invoke).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-action="cancel-delete"]').trigger('click')
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-check]')).toHaveLength(1)
    await wrapper.get('[data-action="delete"]').trigger('click')
    await wrapper.get('[data-action="confirm-delete"]').trigger('click')
    await flushPromises()
    expect(invoke.mock.calls[1]).toEqual(['research_delete', { id: item.id }])
    expect(wrapper.findAll('[data-check]')).toHaveLength(0)
    expect(wrapper.text()).toContain(t('research.empty'))
  })

  it('keeps a failed deletion visible and displays only a translated failure', async () => {
    const { wrapper, invoke } = setup()
    await flushPromises()
    invoke.mockRejectedValueOnce({ code: 'research_storage', message: 'secret path /private/provider' })
    await wrapper.get('[data-action="delete"]').trigger('click')
    await wrapper.get('[data-action="confirm-delete"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-check]')).toHaveLength(1)
    expect(wrapper.get('[role="alert"]').text()).toBe(t('error.research_storage'))
    expect(wrapper.text()).not.toContain('secret path')
  })

  it('compares known changes and unknown fields, with counts and coverage for each shared term sample', async () => {
    const first = check(), second = check('bob', 'b'.repeat(32))
    delete first.profile.fields.biography
    first.profile.unknown_fields = ['biography']
    second.profile.fields.follower_count = 150
    second.activity!.window = 30
    second.activity!.hashtags = [{ key: 'Coffee', count: 2 }]
    const harness = setup([first, second])
    await flushPromises()
    await selectPair(harness, first, second)
    const comparison = harness.wrapper.get('[data-comparison]')
    expect(comparison.get('[data-field="follower_count"]').text()).toContain('100')
    expect(comparison.get('[data-field="follower_count"]').text()).toContain('150')
    const biography = comparison.get('[data-field="biography"]')
    expect(biography.findAll('td').map(cell => cell.text())).toEqual([t('research.unknown'), t('format.no_value')])
    expect(comparison.text()).not.toContain(t('research.same_fields'))
    expect(comparison.get('[data-common="hashtags"] tbody tr').findAll('td').map(cell => cell.text())).toEqual(['1', '2'])
    expect(comparison.get('[data-common="mentions"]').text()).toContain('@atlas')
    expect(comparison.get('[data-common="locations"]').text()).toContain('Cafe')
    expect(comparison.text()).toContain(t('research.coverage', { count: '2', window: '12' }))
    expect(comparison.text()).toContain(t('research.coverage', { count: '2', window: '30' }))
    expect(harness.invoke.mock.calls.map(call => call[0])).toEqual(['research_list'])
  })

  it('distinguishes unsaved activity from a sample with no shared terms and prevents selecting the same check twice', async () => {
    const first = check(), second = check('bob', 'b'.repeat(32))
    second.activity = null
    const harness = setup([first, second])
    await flushPromises()
    await selectPair(harness, first, second)
    const comparison = harness.wrapper.get('[data-comparison]')
    expect(comparison.text()).toContain(t('research.comparison_unavailable'))
    expect(comparison.text()).not.toContain(t('research.no_common'))
    expect(harness.wrapper.get(`select[name="second-check"] option[value="${first.id}"]`).attributes('disabled')).toBeDefined()
    await harness.wrapper.get('select[name="second-check"]').setValue(first.id)
    expect(harness.wrapper.find('[data-comparison]').exists()).toBe(false)
  })

  it('exports localized HTML, exact JSON and comparison reports through the native export boundary', async () => {
    setLocale('ru')
    const first = check(), second = check('bob', 'b'.repeat(32))
    const harness = setup([first, second])
    await flushPromises()
    await harness.wrapper.findAll('[data-check]')[0].get('[data-action="export-html"]').trigger('click')
    await flushPromises()
    const htmlArgs = harness.invoke.mock.calls[1][1] as { filename: string; contents: string }
    expect(harness.invoke.mock.calls[1][0]).toBe('research_export')
    expect(htmlArgs.filename).toMatch(/^insto-.*\.html$/)
    expect(htmlArgs.filename.length).toBeLessThanOrEqual(120)
    expect(htmlArgs.contents).toContain('<html lang="ru">')
    expect(harness.wrapper.get('[data-export-status]').text()).toBe(t('research.exported'))
    await harness.wrapper.findAll('[data-check]')[0].get('[data-action="export-json"]').trigger('click')
    await flushPromises()
    const jsonArgs = harness.invoke.mock.calls[2][1] as { filename: string; contents: string }
    expect(jsonArgs.filename).toMatch(/\.json$/)
    expect(JSON.parse(jsonArgs.contents)).toEqual(first)
    await selectPair(harness, first, second)
    await harness.wrapper.get('[data-action="export-comparison"]').trigger('click')
    await flushPromises()
    const compareArgs = harness.invoke.mock.calls[3][1] as { filename: string; contents: string }
    expect(compareArgs.filename).toMatch(/\.html$/)
    expect(compareArgs.contents).toContain('@alice')
    expect(compareArgs.contents).toContain('@bob')
    expect(compareArgs.contents).toContain('Сравнение без сети')
    expect(harness.invoke.mock.calls.map(call => call[0])).toEqual(['research_list', 'research_export', 'research_export', 'research_export'])
  })

  it('does not report cancelled exports as successful and sanitizes export errors', async () => {
    const { wrapper, invoke } = setup()
    await flushPromises()
    const exportButton = wrapper.get('[data-action="export-html"]')
    await exportButton.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-export-status]').exists()).toBe(true)
    invoke.mockResolvedValueOnce(false)
    await exportButton.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-export-status]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    invoke.mockRejectedValueOnce(new Error('secret filesystem path'))
    await exportButton.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(t('error.transport'))
    expect(wrapper.text()).not.toContain('secret filesystem')
    expect(wrapper.find('[data-export-status]').exists()).toBe(false)
  })

  it('blocks duplicate exports while the save panel is open and removes deleted checks from comparison', async () => {
    const first = check(), second = check('bob', 'b'.repeat(32)), third = check('carol', 'c'.repeat(32))
    const harness = setup([first, second, third])
    await flushPromises()
    let finish!: (value: boolean) => void
    harness.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const exportButton = harness.wrapper.findAll('[data-check]')[0].get('[data-action="export-html"]')
    await exportButton.trigger('click')
    expect(exportButton.attributes('disabled')).toBeDefined()
    await exportButton.trigger('click')
    expect(harness.invoke).toHaveBeenCalledTimes(2)
    finish(false)
    await flushPromises()
    await selectPair(harness, first, second)
    await harness.wrapper.findAll('[data-check]')[0].get('[data-action="delete"]').trigger('click')
    await harness.wrapper.get('[data-action="confirm-delete"]').trigger('click')
    await flushPromises()
    expect(harness.wrapper.find('[data-comparison]').exists()).toBe(false)
    expect((harness.wrapper.get('select[name="first-check"]').element as HTMLSelectElement).value).toBe('')
    expect(harness.wrapper.find(`option[value="${first.id}"]`).exists()).toBe(false)
  })
})
