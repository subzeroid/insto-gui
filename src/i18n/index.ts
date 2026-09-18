import { en } from './en'
import { ru, type Dictionary } from './ru'

export type Locale = 'en' | 'ru'
export type Key = keyof typeof en

const DICTIONARIES: Record<Locale, Dictionary> = { en, ru }
// The locale is fixed once, in `main.ts`, before the app mounts: nothing in the
// window changes it afterwards, so `t` does not have to be reactive.
let active: Locale = 'en'

// Pure, so the rule is testable without a window. `?lang=` is honoured only in a
// development server — the same guard as `?mock=1` in `main.ts` — so a release
// bundle always follows the system language.
export function detectLocale(language: string | undefined, search: string, dev: boolean): Locale {
  if (dev) {
    const requested = new URLSearchParams(search).get('lang')
    if (requested === 'en' || requested === 'ru') return requested
  }
  return (language ?? '').toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export function setLocale(locale: Locale): void { active = locale }
export function currentLocale(): Locale { return active }
export function localeTag(): 'en-US' | 'ru-RU' { return active === 'ru' ? 'ru-RU' : 'en-US' }

// A parameter that was not passed leaves its placeholder in place: a half-built
// sentence is visible in review and in tests, where a silently empty one is not.
export function t(key: Key, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[active][key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder)
}
