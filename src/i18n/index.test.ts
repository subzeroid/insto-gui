import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ru } from './ru'
import { currentLocale, detectLocale, setLocale, localeTag, t, type Key } from './index'

describe('locale detection', () => {
  it('honours ?lang= only in a development server', () => {
    expect(detectLocale('en-US', '?lang=ru', true)).toBe('ru')
    expect(detectLocale('ru-RU', '?lang=en', true)).toBe('en')
    expect(detectLocale('en-US', '?mock=1&lang=ru', true)).toBe('ru')
    // A release bundle follows the system language whatever the query says.
    expect(detectLocale('en-US', '?lang=ru', false)).toBe('en')
    expect(detectLocale('ru-RU', '?lang=en', false)).toBe('ru')
    // An unknown value is not a locale: the system language decides.
    expect(detectLocale('ru-RU', '?lang=de', true)).toBe('ru')
  })
  it('falls back to English for every language that is not Russian', () => {
    expect(detectLocale('ru-RU', '', false)).toBe('ru')
    expect(detectLocale('RU', '', false)).toBe('ru')
    expect(detectLocale('en-GB', '', false)).toBe('en')
    expect(detectLocale(undefined, '', false)).toBe('en')
    expect(detectLocale('', '', false)).toBe('en')
  })
})

describe('translation', () => {
  it('fills placeholders and leaves a missing one in place', () => {
    expect(t('watch_list.checked', { time: '1 Jan' })).toBe('Checked 1 Jan')
    expect(t('history.target', { pk: '7', time: '1 Jan' })).toBe('PK 7 · snapshot 1 Jan')
    expect(t('watch_list.checked', {})).toBe('Checked {time}')
    expect(t('watch_list.interval', { seconds: 300 })).toBe('Interval 300 s')
  })
  it('follows the locale set for the window', () => {
    expect(currentLocale()).toBe('en')
    expect(localeTag()).toBe('en-US')
    setLocale('ru')
    try {
      expect(currentLocale()).toBe('ru')
      expect(localeTag()).toBe('ru-RU')
      expect(t('nav.watches')).toBe('Наблюдения')
    } finally { setLocale('en') }
    expect(t('nav.watches')).toBe('Watches')
  })
})

describe('dictionaries', () => {
  it('hold the same keys, none of them empty', () => {
    const english = Object.keys(en).sort()
    expect(Object.keys(ru).sort()).toEqual(english)
    expect(english.filter(key => en[key as Key].trim() === '')).toEqual([])
    expect(english.filter(key => ru[key as Key].trim() === '')).toEqual([])
  })
})
