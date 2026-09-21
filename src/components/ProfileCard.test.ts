import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProfileCard from './ProfileCard.vue'
import { profileFields } from '../desktop/fixtures'
import { DesktopFailure } from '../desktop/messages'
import { formatCount, localTime } from '../desktop/format'
import { t } from '../i18n'

const card = (value: ReturnType<typeof profileFields> | null, loading = false, error: DesktopFailure | null = null) =>
  mount(ProfileCard, { props: { profile: { value, loading, error } } })

describe('profile card', () => {
  it('shows the account, its counts and the time of the snapshot it came from', () => {
    const wrapper = card(profileFields('4102', '7', 1_770_000_000))
    expect(wrapper.get('.profile-user').text()).toBe('@alice')
    expect(wrapper.get('.profile-name').text()).toBe('Alice Harbour')
    expect(wrapper.text()).toContain('Night ferries and harbour light.')
    expect(wrapper.findAll('.profile-counts dt').map(node => node.text())).toEqual(['Followers', 'Following', 'Posts'])
    expect(wrapper.findAll('.profile-counts dd').map(node => node.text())).toEqual([formatCount(18507), formatCount(809), formatCount(423)])
    // A known field with no value is named, not silently dropped.
    expect(wrapper.text()).toContain(t('format.no_value'))
    expect(wrapper.text()).toContain(t('profile.as_of', { time: localTime(1_770_000_000) }))
    // Only a hash is stored, so the card never claims to show a picture.
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('a'.repeat(64))
    expect(wrapper.find('.profile-badges').exists()).toBe(false)
  })
  it('renders a quiet badge for each flag that is true', () => {
    const wrapper = card(profileFields('1', '7', 1, { is_verified: true, is_business: true }))
    expect(wrapper.findAll('.profile-badges .badge').map(node => node.text())).toEqual([t('profile.badge_verified'), t('profile.badge_business')])
    expect(wrapper.text()).not.toContain(t('profile.badge_private'))
  })
  it('leaves out every field the snapshot carried no data for', () => {
    const unknown = ['full_name', 'biography', 'following_count', 'is_verified']
    const wrapper = card(profileFields('1', '7', 1, { is_business: true }, unknown))
    expect(wrapper.find('.profile-name').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Night ferries')
    expect(wrapper.findAll('.profile-counts dt').map(node => node.text())).toEqual(['Followers', 'Posts'])
    // The badge list never guesses: an unknown flag is not "false".
    expect(wrapper.findAll('.profile-badges .badge').map(node => node.text())).toEqual([t('profile.badge_business')])
    // The absent names are not listed anywhere either.
    expect(wrapper.text()).not.toContain('Full name')
  })
  it('shows the loading line, then the failure in place of the card', () => {
    expect(card(null, true).get('[role="status"]').text()).toBe(t('profile.loading'))
    const failed = card(null, false, new DesktopFailure('history_corrupt'))
    expect(failed.get('[role="alert"]').text()).toBe(new DesktopFailure('history_corrupt').message)
    expect(failed.find('.profile-counts').exists()).toBe(false)
    // Nothing to read, nothing in flight, nothing wrong: no empty frame.
    expect(card(null).find('.profile-card').exists()).toBe(false)
  })
})
