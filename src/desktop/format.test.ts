import { describe, expect, it } from 'vitest'
import { formatCount, formatDecimal, weekdayNames } from './format'
import { setLocale } from '../i18n'

const inRussian = <T>(read: () => T): T => {
  setLocale('ru')
  try { return read() } finally { setLocale('en') }
}

describe('weekday names', () => {
  // The core counts weekdays the way `datetime.weekday()` does — Monday is
  // bucket 0 — and the charts must agree with that, in either language. The
  // whole thing rests on one date being a Monday, so it is pinned here.
  it('start at Monday in both languages', () => {
    expect(weekdayNames('long')).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    expect(weekdayNames('short')[0]).toBe('Mon')
    expect(weekdayNames('short')[6]).toBe('Sun')
    const russian = inRussian(() => weekdayNames('long'))
    expect(russian[0]).toBe('понедельник')
    expect(russian[6]).toBe('воскресенье')
    expect(inRussian(() => weekdayNames('short'))).toHaveLength(7)
  })
})

describe('decimals', () => {
  it('follow the language of the window', () => {
    expect(formatDecimal(901.44, 1)).toBe('901.4')
    expect(formatDecimal(2, 1)).toBe('2.0')
    // A measurement takes the Russian comma, which is what a reader expects of
    // a distance. Coordinates do not go through here for exactly that reason:
    // `LookupActivity` writes them with `toFixed`, so a pair stays readable.
    expect(inRussian(() => formatDecimal(901.44, 1))).toBe('901,4')
    expect(inRussian(() => (52.3739).toFixed(4))).toBe('52.3739')
  })
  it('group counts the way the language does', () => {
    expect(formatCount(18507)).toBe('18,507')
    expect(inRussian(() => formatCount(18507))).toBe('18 507')
  })
})
