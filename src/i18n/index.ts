import { en } from './en'
import { ru, type Dictionary } from './ru'

export type Locale = 'en' | 'ru'
export type Key = keyof typeof en
export const LOCALES: readonly Locale[] = ['en', 'ru']

const DICTIONARIES: Record<Locale, Dictionary> = { en, ru }
const STORAGE_KEY = 'insto.locale'
// The locale is fixed once, in `main.ts`, before the app mounts: nothing in the
// window changes it afterwards, so `t` does not have to be reactive. Choosing
// another language in Settings saves it and reloads the window.
let active: Locale = 'en'

const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ru'

// Pure, so the rule is testable without a window. English is the default whatever
// language macOS runs in; only a choice saved from Settings changes it. `?lang=`
// is honoured only in a development server — the same guard as `?mock=1` in
// `main.ts` — so a release bundle never follows the query.
export function detectLocale(saved: string | null | undefined, search: string, dev: boolean): Locale {
  if (dev) {
    const requested = new URLSearchParams(search).get('lang')
    if (isLocale(requested)) return requested
  }
  return isLocale(saved) ? saved : 'en'
}

// Storage can be unavailable or throw (private windows, blocked site data); the
// app then simply stays in English.
export function savedLocale(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY) } catch { return null }
}
export function saveLocale(locale: Locale): boolean {
  try { window.localStorage.setItem(STORAGE_KEY, locale); return true } catch { return false }
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
