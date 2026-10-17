import { describe, expect, it } from 'vitest'
import { generateReport, type ReportCheck } from './report'

const check = (): ReportCheck => ({
  id: 'a'.repeat(32), username: 'alice', target_pk: '7', captured_at: 1700000000, saved_at: 1700000001,
  profile: { target_pk: '7', access: 'public', fields: { username: 'alice', full_name: 'Alice', follower_count: 100, biography: 'Hello' }, unknown_fields: ['public_email'], quota_remaining: null },
  activity: {
    target_pk: '7', window: 12, analyzed: 2,
    geo: { geotagged: 1, anchor: { name: 'Cafe', lat: 52, lng: 4, count: 1 }, centroid: { lat: 52, lng: 4 }, radius_km: 0, places: [{ name: 'Cafe', lat: 52, lng: 4, count: 1 }] },
    timeline: { hour_of_day: Array.from({ length: 24 }, (_, i) => i === 10 ? 2 : 0), day_of_week: [2, 0, 0, 0, 0, 0, 0], weekday_hours: Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => day === 0 && hour === 10 ? 2 : 0)), first_post_at: 1690000000, last_post_at: 1690003600 },
    hashtags: [{ key: 'coffee', count: 2 }], mentions: [{ key: 'bob', count: 1 }], locations: [{ key: 'Cafe', count: 1 }], likes: { total: 30, average: 15, top_posts: [{ code: 'one', like_count: 20 }, { code: 'two', like_count: 10 }] }, quota_remaining: null,
  },
})

describe('standalone report', () => {
  it('includes capture scope, coverage, geography and timestamped activity charts', () => {
    const html = generateReport(check())
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('Alice')
    expect(html).toContain('2023-11-14')
    expect(html).toContain('2 / 12')
    expect(html).toContain('Partial coverage')
    expect(html).toContain('Cafe')
    expect(html).toContain('52.0000')
    expect(html).toContain('Hour of day (UTC)')
    expect(html).toContain('Day × hour (UTC)')
    expect(html).toContain('Mon 10:00: 2')
    expect(html).toContain('coffee')
    expect(html).toContain('public_email')
  })

  it('escapes every untrusted string and cannot load scripts or remote assets', () => {
    const item = check()
    item.username = '<img src=x onerror=alert(1)>'
    item.profile.fields.biography = '</td><script>alert(1)</script><td>'
    item.profile.fields.external_url = 'javascript:alert(1)'
    item.activity!.geo.places[0].name = '<svg onload=alert(1)>'
    item.activity!.hashtags[0].key = '"><script>alert(2)</script>'
    const html = generateReport(item)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('script, img, iframe, [href], [src], [onload], [onerror]')).toBeNull()
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;svg onload=alert(1)&gt;')
  })

  it('compares profile changes and shared terms while keeping unknown fields explicit', () => {
    const before = check(), after = check()
    after.captured_at += 86400
    after.profile.fields.follower_count = 125
    after.profile.fields.full_name = 'New name'
    after.profile.unknown_fields.push('biography')
    delete after.profile.fields.biography
    const html = generateReport(before, after)
    expect(html).toContain('Profile differences')
    expect(html).toContain('100')
    expect(html).toContain('125')
    expect(html).toContain('New name')
    expect(html).toContain('Common hashtags')
    expect(html).toContain('coffee')
    expect(html).toContain('Unknown')
    expect(html).not.toContain('undefined')
  })

  it('keeps fields unknown in both checks visible instead of claiming all saved fields match', () => {
    const first = check(), second = check()
    for (const item of [first, second]) {
      delete item.profile.fields.full_name
      item.profile.unknown_fields.push('full_name')
    }
    const document = new DOMParser().parseFromString(generateReport(first, second), 'text/html')
    const comparison = document.querySelectorAll('article')[2]
    const fullName = [...comparison.querySelectorAll('tr')].find(row => row.querySelector('th')?.textContent === 'Full name')
    expect(fullName).toBeDefined()
    expect([...fullName!.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['Unknown', 'Unknown'])
    expect(comparison.textContent).not.toContain('No differences in the saved profile values')
  })

  it('supports Russian labels and profile-only checks without invented activity', () => {
    const item = check(); item.activity = null
    const html = generateReport(item, undefined, 'ru')
    expect(html).toContain('<html lang="ru">')
    expect(html).toContain('Сохранённая проверка')
    expect(html).toContain('Данные активности не сохранены')
    expect(html).not.toContain('Day × hour')
  })

  it('does not interpret missing comparison activity as an empty term intersection', () => {
    const first = check(), second = check(); second.activity = null
    const document = new DOMParser().parseFromString(generateReport(first, second), 'text/html')
    const common = [...document.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === 'Common hashtags')
    expect(common?.textContent).toContain('Activity data was not saved')
    expect(common?.textContent).not.toContain('No shared terms')
  })

  it('matches common hashtags, mentions and location names without case sensitivity', () => {
    const first = check(), second = check()
    second.activity!.hashtags[0] = { key: 'COFFEE', count: 7 }
    second.activity!.mentions[0] = { key: 'BOB', count: 4 }
    second.activity!.locations[0] = { key: 'CAFE', count: 3 }
    const document = new DOMParser().parseFromString(generateReport(first, second), 'text/html')
    for (const [heading, key, count] of [['Common hashtags', 'coffee', '7'], ['Common mentions', 'bob', '4'], ['Common location labels', 'Cafe', '3']]) {
      const common = [...document.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === heading)
      expect(common?.textContent).toContain(key)
      expect(common?.textContent).toContain(count)
    }
  })
})
