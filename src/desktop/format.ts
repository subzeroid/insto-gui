import type { ChangeValue } from './dto'

const LABELS: Record<string, string> = {
  username: 'Имя пользователя', full_name: 'Полное имя', biography: 'Описание', external_url: 'Ссылка в профиле',
  is_verified: 'Верификация', is_business: 'Бизнес-аккаунт', is_private: 'Закрытый аккаунт',
  follower_count: 'Подписчики', following_count: 'Подписки', media_count: 'Публикации', avatar: 'Аватар (хеш)', banner: 'Обложка (хеш)',
}
export function localTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? 'дата недоступна' : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
}
export const formatCount = (value: number) => value.toLocaleString('ru-RU')
export const fieldLabel = (field: string) => LABELS[field] ?? field
export function describeValue(value: ChangeValue): string {
  if (value === null) return 'нет значения'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return formatCount(value)
  return value === '' ? 'пусто' : value
}
