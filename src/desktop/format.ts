import type { ChangeValue } from './dto'
import { localeTag, t } from '../i18n'

// The snapshot fields the core compares. A field outside this list is shown by its
// raw name rather than by a key the dictionaries do not have.
const FIELDS = [
  'username', 'full_name', 'biography', 'external_url',
  'is_verified', 'is_business', 'is_private',
  'follower_count', 'following_count', 'media_count',
  'public_email', 'public_phone', 'business_category',
  'avatar', 'banner',
] as const
type Field = (typeof FIELDS)[number]
const KNOWN: ReadonlySet<string> = new Set(FIELDS)

export function localTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? t('format.no_date') : date.toLocaleString(localeTag(), { dateStyle: 'medium', timeStyle: 'short' })
}
export const formatCount = (value: number) => value.toLocaleString(localeTag())
export const fieldLabel = (field: string) => KNOWN.has(field) ? t(`field.${field as Field}`) : field
export function describeValue(value: ChangeValue): string {
  if (value === null) return t('format.no_value')
  if (typeof value === 'boolean') return value ? t('format.yes') : t('format.no')
  if (typeof value === 'number') return formatCount(value)
  return value === '' ? t('format.empty') : value
}
