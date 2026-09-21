import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProfileCard from './ProfileCard.vue'
import type { ChangeValue } from '../desktop/dto'
import { profileFields } from '../desktop/fixtures'
import { DesktopFailure } from '../desktop/messages'
import { formatCount, localTime } from '../desktop/format'
import { t } from '../i18n'

const card = (value: ReturnType<typeof profileFields> | null, loading = false, error: DesktopFailure | null = null, watchUser = 'alice') =>
  mount(ProfileCard, { props: { profile: { value, loading, error }, watchUser, caption: value === null ? '' : t('profile.as_of', { time: localTime(value.snapshot.captured_at) }) } })

describe('profile card', () => {
  it('shows the account, its counts and the time of the snapshot it came from', () => {
    const wrapper = card(profileFields('4102', '7', 1_770_000_000))
    // The details heading already says "@alice"; the card does not repeat it.
    expect(wrapper.find('.profile-user').exists()).toBe(false)
    expect(wrapper.get('.profile-card').attributes('aria-label')).toBe(t('profile.title'))
    expect(wrapper.get('.profile-name').text()).toBe('Alice Harbour')
    expect(wrapper.text()).toContain('Night ferries and harbour light.')
    expect(wrapper.findAll('.profile-counts dt').map(node => node.text())).toEqual(['Followers', 'Following', 'Posts'])
    expect(wrapper.findAll('.profile-counts dd').map(node => node.text())).toEqual([formatCount(18507), formatCount(809), formatCount(423)])
    // A field with nothing in it costs no line: the row is left out rather than
    // filled with "no value". The fixture's link is null, so it is not there.
    expect(wrapper.text()).not.toContain(t('format.no_value'))
    expect(wrapper.findAll('.profile-text dt').map(node => node.text())).toEqual(['Bio'])
    expect(wrapper.text()).toContain(t('profile.as_of', { time: localTime(1_770_000_000) }))
    // Only a hash is stored, so the card never claims to show a picture.
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('a'.repeat(64))
    expect(wrapper.find('.profile-badges').exists()).toBe(false)
  })
  it('names the account only when the snapshot disagrees with the selected watch', () => {
    // A rename: the saved snapshot still carries the old name, so the card says so.
    const renamed = card(profileFields('1', '7', 1, { username: 'alice.harbour' }))
    // Labelled, so it is clear which of the two names on screen this one is.
    expect(renamed.get('.profile-user .label').text()).toBe(t('profile.renamed'))
    expect(renamed.get('.profile-user').text()).toContain('@alice.harbour')
    // An unknown username is not invented.
    expect(card(profileFields('1', '7', 1, {}, ['username'])).find('.profile-user').exists()).toBe(false)
  })
  it('shows every remaining field the core tracks', () => {
    const wrapper = card(profileFields('1', '7', 1, { public_email: 'hello@example.com', public_phone: '', business_category: 'Photographer' }))
    // Declaration order, and only the names that have something in them: the
    // link is null and the public phone is the empty string, so neither shows.
    expect(wrapper.findAll('.profile-text dt').map(node => node.text()))
      .toEqual(['Bio', 'Public email', 'Business category'])
    expect(wrapper.text()).toContain('hello@example.com')
    expect(wrapper.text()).toContain('Photographer')
    expect(wrapper.text()).not.toContain(t('format.empty'))
    expect(wrapper.text()).not.toContain('Public phone')
    const filled = card(profileFields('1', '7', 1, { external_url: 'https://example.com/a', public_phone: '+1 555' }))
    expect(filled.findAll('.profile-text dt').map(node => node.text()))
      .toEqual(['Bio', 'Link in the profile', 'Public phone'])
    // A link in the profile is text, never something to press.
    expect(filled.find('a').exists()).toBe(false)
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
  it('serves a live lookup as well as a saved snapshot', () => {
    // A lookup hands the card the same tracked vocabulary with no snapshot
    // behind it. What the card cannot know is the caller's: the landmark, the
    // line under it and what a differing account name means. An empty field is
    // left out in this mode too.
    const lookup = (fields: Record<string, ChangeValue>, watchUser = 'alice') => mount(ProfileCard, {
      props: {
        profile: { value: { fields }, loading: false, error: null }, watchUser,
        caption: t('lookup.as_of', { time: localTime(1_770_000_000) }),
        label: t('lookup.result_label'), otherNameLabel: t('lookup.other_name'),
      },
    })
    const wrapper = lookup({ username: 'alice', full_name: 'Alice Harbour', biography: '', external_url: null, follower_count: 1200, is_private: true })
    expect(wrapper.get('.profile-card').attributes('aria-label')).toBe(t('lookup.result_label'))
    expect(wrapper.get('.profile-name').text()).toBe('Alice Harbour')
    expect(wrapper.findAll('.profile-counts dt').map(node => node.text())).toEqual(['Followers'])
    expect(wrapper.findAll('.profile-badges .badge').map(node => node.text())).toEqual([t('profile.badge_private')])
    // The empty bio and the absent link take no rows at all.
    expect(wrapper.find('.profile-text').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(t('format.no_value'))
    expect(wrapper.text()).not.toContain(t('format.empty'))
    expect(wrapper.text()).toContain(t('lookup.as_of', { time: localTime(1_770_000_000) }))
    expect(wrapper.text()).not.toContain(t('profile.as_of', { time: localTime(1_770_000_000) }))
    expect(wrapper.find('.profile-user').exists()).toBe(false)
    // A name the account answers under that is not the one that was typed.
    expect(lookup({ username: 'alice.co' }).get('.profile-user .label').text()).toBe(t('lookup.other_name'))
  })
  it('shows the loading line, then the failure in place of the card', () => {
    expect(card(null, true).get('[role="status"]').text()).toBe(t('profile.loading'))
    const failed = card(null, false, new DesktopFailure('history_corrupt'))
    expect(failed.get('[role="alert"]').text()).toBe(new DesktopFailure('history_corrupt').message)
    expect(failed.find('.profile-counts').exists()).toBe(false)
    // Nothing to read, nothing in flight, nothing wrong: no empty frame.
    expect(card(null).find('.profile-card').exists()).toBe(false)
    // Even with nothing to head it, the landmark is named.
    expect(card(null, true).get('.profile-card').attributes('aria-label')).toBe(t('profile.title'))
  })
})
