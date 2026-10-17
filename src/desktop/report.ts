import type { ChangeValue, LookupActivity, LookupProfile, Term } from './dto'

export interface ReportCheck {
  id?: string
  username: string
  target_pk: string
  captured_at: number
  saved_at?: number
  profile: LookupProfile
  activity: LookupActivity | null
}

type Locale = 'en' | 'ru'
const labels = {
  en: {
    title: 'Saved check', comparison: 'Offline comparison', captured: 'Captured', saved: 'Saved', identity: 'Target ID',
    profile: 'Profile', field: 'Field', value: 'Value', unknown: 'Unknown', none: 'None', yes: 'Yes', no: 'No',
    access: 'Access', public: 'Public', private: 'Private', scope: 'Capture scope', profileOnly: 'Profile only',
    noActivity: 'Activity data was not saved', coverage: 'Analyzed posts / requested window', partial: 'Partial coverage',
    limitation: 'This sample covers recent returned posts. It does not describe the entire account or establish a person’s location.',
    geo: 'Geography', tagged: 'Geotagged posts', place: 'Place', coordinates: 'Coordinates', count: 'Count',
    centroid: 'Centroid', radius: 'Radius (km)', geoNone: 'No usable geotags in this sample', map: 'Sample geotags',
    activity: 'Activity', hours: 'Hour of day (UTC)', days: 'Day of week (UTC)', heatmap: 'Day × hour (UTC)',
    first: 'First dated post', last: 'Last dated post', hashtags: 'Hashtags', mentions: 'Mentions', locations: 'Location labels',
    likes: 'Likes', total: 'Total likes', average: 'Average likes', differences: 'Profile differences',
    earlier: 'First check', later: 'Second check', unchanged: 'No differences in the saved profile values',
    commonHashtags: 'Common hashtags', commonMentions: 'Common mentions', commonLocations: 'Common location labels',
    commonNone: 'No shared terms in the saved samples', unknownFields: 'Unknown fields',
  },
  ru: {
    title: 'Сохранённая проверка', comparison: 'Сравнение без сети', captured: 'Получено', saved: 'Сохранено', identity: 'ID аккаунта',
    profile: 'Профиль', field: 'Поле', value: 'Значение', unknown: 'Неизвестно', none: 'Нет', yes: 'Да', no: 'Нет',
    access: 'Доступ', public: 'Открытый', private: 'Закрытый', scope: 'Охват проверки', profileOnly: 'Только профиль',
    noActivity: 'Данные активности не сохранены', coverage: 'Изучено публикаций / запрошенное окно', partial: 'Неполный охват',
    limitation: 'Выборка содержит последние полученные публикации. Она не описывает весь аккаунт и не устанавливает местоположение человека.',
    geo: 'География', tagged: 'Публикации с геометками', place: 'Место', coordinates: 'Координаты', count: 'Количество',
    centroid: 'Центр выборки', radius: 'Радиус (км)', geoNone: 'В выборке нет пригодных геометок', map: 'Геометки выборки',
    activity: 'Активность', hours: 'Часы суток (UTC)', days: 'Дни недели (UTC)', heatmap: 'День × час (UTC)',
    first: 'Первая датированная публикация', last: 'Последняя датированная публикация', hashtags: 'Хэштеги', mentions: 'Упоминания', locations: 'Названия мест',
    likes: 'Отметки «Нравится»', total: 'Всего отметок', average: 'В среднем', differences: 'Различия профилей',
    earlier: 'Первая проверка', later: 'Вторая проверка', unchanged: 'В сохранённых значениях профиля различий нет',
    commonHashtags: 'Общие хэштеги', commonMentions: 'Общие упоминания', commonLocations: 'Общие названия мест',
    commonNone: 'В сохранённых выборках нет общих терминов', unknownFields: 'Неизвестные поля',
  },
} as const
type Labels = { [K in keyof typeof labels.en]: string }
const fieldNames: Record<string, readonly [string, string]> = {
  username: ['Username', 'Имя пользователя'], full_name: ['Full name', 'Имя'], biography: ['Biography', 'Биография'],
  external_url: ['External URL', 'Внешний URL'], is_verified: ['Verified', 'Подтверждён'], is_business: ['Business account', 'Бизнес-аккаунт'],
  is_private: ['Private account', 'Закрытый аккаунт'], follower_count: ['Followers', 'Подписчики'], following_count: ['Following', 'Подписки'],
  media_count: ['Posts', 'Публикации'], public_email: ['Public email', 'Публичная почта'], public_phone: ['Public phone', 'Публичный телефон'],
  business_category: ['Business category', 'Категория бизнеса'],
}
const days = { en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] }
const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const timestamp = (value: number): string => Number.isFinite(value) && value >= 0 && value <= 253402300799 ? new Date(value * 1000).toISOString().replace('.000Z', ' UTC') : '—'
const fieldLabel = (field: string, locale: Locale) => escape(fieldNames[field]?.[locale === 'en' ? 0 : 1] ?? field)
const scalar = (value: ChangeValue | undefined, l: Labels): string => value === undefined ? l.unknown : value === null ? l.none : typeof value === 'boolean' ? value ? l.yes : l.no : String(value)
const row = (label: string, value: unknown): string => `<tr><th scope="row">${escape(label)}</th><td>${escape(value)}</td></tr>`
const termTable = (title: string, terms: readonly Term[], l: Labels): string => `<section><h3>${escape(title)}</h3>${terms.length ? `<table><thead><tr><th>${escape(l.value)}</th><th>${escape(l.count)}</th></tr></thead><tbody>${terms.map(term => row(term.key, term.count)).join('')}</tbody></table>` : `<p>${escape(l.none)}</p>`}</section>`

function bars(title: string, counts: readonly number[], names: readonly string[]): string {
  const max = Math.max(1, ...counts)
  return `<section><h3>${escape(title)}</h3><svg class="histogram" viewBox="0 0 720 150" role="img" aria-label="${escape(title)}">${counts.map((count, index) => {
    const width = 720 / counts.length, height = Math.max(0, count / max * 110), x = index * width
    return `<g><title>${escape(names[index])}: ${escape(count)}</title><rect x="${x + 2}" y="${120 - height}" width="${Math.max(1, width - 4)}" height="${height}" fill="#16735b"/><text x="${x + width / 2}" y="140" text-anchor="middle">${escape(names[index])}</text></g>`
  }).join('')}</svg></section>`
}

function heatmap(activity: LookupActivity, locale: Locale, l: Labels): string {
  const matrix = activity.timeline.weekday_hours
  const max = Math.max(1, ...matrix.flat())
  return `<section><h3>${escape(l.heatmap)}</h3><div class="scroll"><table class="heatmap"><thead><tr><th>UTC</th>${Array.from({ length: 24 }, (_, hour) => `<th>${hour}</th>`).join('')}</tr></thead><tbody>${matrix.map((hours, day) => `<tr><th scope="row">${escape(days[locale][day])}</th>${hours.map((count, hour) => `<td title="${escape(days[locale][day])} ${hour}:00: ${escape(count)}" style="background:rgba(22,115,91,${count ? 0.15 + count / max * 0.65 : 0.03})">${escape(count)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`
}

function geography(activity: LookupActivity, l: Labels): string {
  const geo = activity.geo
  if (!geo.geotagged) return `<section><h3>${escape(l.geo)}</h3><p>${escape(l.geoNone)}</p></section>`
  const point = (lat: number, lng: number) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  const map = `<svg class="map" viewBox="0 0 720 360" role="img" aria-label="${escape(l.map)}"><rect width="720" height="360" fill="#edf2ef"/>${[-60, -30, 0, 30, 60].map(lat => `<line x1="0" y1="${180 - lat * 2}" x2="720" y2="${180 - lat * 2}" stroke="#c7d4ce"/>`).join('')}${[-120, -60, 0, 60, 120].map(lng => `<line x1="${360 + lng * 2}" y1="0" x2="${360 + lng * 2}" y2="360" stroke="#c7d4ce"/>`).join('')}<text x="8" y="18">90° N</text><text x="8" y="350">90° S</text><text x="670" y="180">180° E</text>${geo.places.map(place => `<circle cx="${360 + place.lng * 2}" cy="${180 - place.lat * 2}" r="${Math.min(14, 4 + Math.sqrt(place.count) * 2)}" fill="#16735b" fill-opacity="0.7"><title>${escape(place.name)}: ${escape(point(place.lat, place.lng))}; ${escape(place.count)}</title></circle>`).join('')}</svg>`
  return `<section><h3>${escape(l.geo)}</h3><table><tbody>${row(l.tagged, geo.geotagged)}${row(l.centroid, geo.centroid ? point(geo.centroid.lat, geo.centroid.lng) : l.unknown)}${row(l.radius, geo.radius_km ?? l.unknown)}</tbody></table>${map}<table><thead><tr><th>${escape(l.place)}</th><th>${escape(l.coordinates)}</th><th>${escape(l.count)}</th></tr></thead><tbody>${geo.places.map(place => `<tr><th scope="row">${escape(place.name)}</th><td>${escape(point(place.lat, place.lng))}</td><td>${escape(place.count)}</td></tr>`).join('')}</tbody></table></section>`
}

function renderCheck(check: ReportCheck, locale: Locale, l: Labels): string {
  const fields = new Set([...Object.keys(check.profile.fields), ...check.profile.unknown_fields])
  const profile = `<section><h3>${escape(l.profile)}</h3><table><thead><tr><th>${escape(l.field)}</th><th>${escape(l.value)}</th></tr></thead><tbody>${[...fields].map(field => `<tr><th scope="row">${fieldLabel(field, locale)} <small>(${escape(field)})</small></th><td>${escape(scalar(Object.hasOwn(check.profile.fields, field) ? check.profile.fields[field] : undefined, l))}</td></tr>`).join('')}</tbody></table><p>${escape(l.unknownFields)}: ${escape(check.profile.unknown_fields.join(', ') || l.none)}</p></section>`
  const activity = check.activity
  const meta = `<table><tbody>${row(l.identity, check.target_pk)}${row(l.captured, timestamp(check.captured_at))}${check.saved_at === undefined ? '' : row(l.saved, timestamp(check.saved_at))}${row(l.access, check.profile.access === 'private' ? l.private : l.public)}${row(l.scope, activity ? `${activity.analyzed} / ${activity.window}` : l.profileOnly)}</tbody></table>`
  if (!activity) return `<article><h2>@${escape(check.username)}</h2>${meta}${profile}<p>${escape(l.noActivity)}</p></article>`
  const coverage = `<p><strong>${escape(l.coverage)}: ${activity.analyzed} / ${activity.window}</strong>${activity.analyzed < activity.window ? ` · ${escape(l.partial)}` : ''}</p><p class="note">${escape(l.limitation)}</p>`
  const timeline = `<section><h3>${escape(l.activity)}</h3><table><tbody>${row(l.first, activity.timeline.first_post_at === null ? l.unknown : timestamp(activity.timeline.first_post_at))}${row(l.last, activity.timeline.last_post_at === null ? l.unknown : timestamp(activity.timeline.last_post_at))}</tbody></table>${bars(l.hours, activity.timeline.hour_of_day, Array.from({ length: 24 }, (_, i) => String(i)))}${bars(l.days, activity.timeline.day_of_week, days[locale])}${heatmap(activity, locale, l)}</section>`
  return `<article><h2>@${escape(check.username)}</h2>${meta}${coverage}${profile}${geography(activity, l)}${timeline}<div class="terms">${termTable(l.hashtags, activity.hashtags, l)}${termTable(l.mentions, activity.mentions, l)}${termTable(l.locations, activity.locations, l)}</div><section><h3>${escape(l.likes)}</h3><table><tbody>${row(l.total, activity.likes.total)}${row(l.average, activity.likes.average)}</tbody></table></section></article>`
}

function compare(first: ReportCheck, second: ReportCheck, locale: Locale, l: Labels): string {
  const keys = new Set([...Object.keys(first.profile.fields), ...first.profile.unknown_fields, ...Object.keys(second.profile.fields), ...second.profile.unknown_fields])
  const known = (check: ReportCheck, key: string) => Object.hasOwn(check.profile.fields, key) && !check.profile.unknown_fields.includes(key)
  const changes = [...keys].filter(key => !known(first, key) || !known(second, key) || first.profile.fields[key] !== second.profile.fields[key])
  const table = changes.length ? `<table><thead><tr><th>${escape(l.field)}</th><th>${escape(l.earlier)}</th><th>${escape(l.later)}</th></tr></thead><tbody>${changes.map(key => `<tr><th scope="row">${fieldLabel(key, locale)}</th><td>${escape(scalar(known(first, key) ? first.profile.fields[key] : undefined, l))}</td><td>${escape(scalar(known(second, key) ? second.profile.fields[key] : undefined, l))}</td></tr>`).join('')}</tbody></table>` : `<p>${escape(l.unchanged)}</p>`
  const common = (title: string, field: 'hashtags' | 'mentions' | 'locations') => {
    if (!first.activity || !second.activity) return `<section><h3>${escape(title)}</h3><p>${escape(l.noActivity)}</p></section>`
    const a = first.activity[field], b = new Map(second.activity[field].map(term => [term.key.toLowerCase(), term]))
    const shared = a.flatMap(term => { const other = b.get(term.key.toLowerCase()); return other ? [{ term, other }] : [] })
    return `<section><h3>${escape(title)}</h3>${shared.length ? `<table><thead><tr><th>${escape(l.value)}</th><th>${escape(l.earlier)}</th><th>${escape(l.later)}</th></tr></thead><tbody>${shared.map(({ term, other }) => `<tr><th scope="row">${escape(term.key)}</th><td>${escape(term.count)}</td><td>${escape(other.count)}</td></tr>`).join('')}</tbody></table>` : `<p>${escape(l.commonNone)}</p>`}</section>`
  }
  return `<article><h2>${escape(l.comparison)}</h2><h3>${escape(l.differences)}</h3>${table}${common(l.commonHashtags, 'hashtags')}${common(l.commonMentions, 'mentions')}${common(l.commonLocations, 'locations')}</article>`
}

/** A portable, script-free document. All provider text stays escaped text;
 * charts use local SVG/table markup and never fetch tiles, fonts or images. */
export function generateReport(check: ReportCheck, comparison?: ReportCheck, locale: Locale = 'en'): string {
  const l: Labels = labels[locale]
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escape(comparison ? l.comparison : l.title)} · @${escape(check.username)}</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#192a24;background:#f6f8f6;margin:0}main{max-width:980px;margin:auto;padding:40px 24px}h1{font-size:32px}h2{font-size:24px}h3{font-size:18px;margin-top:28px}article{background:white;padding:28px;margin:24px 0;border:1px solid #dce5df;border-radius:10px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{padding:9px 12px;border-bottom:1px solid #e0e7e2;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{font-weight:600}small,.note{color:#5d6e65}svg{display:block;width:100%;height:auto;margin:16px 0}svg text{font:11px system-ui,sans-serif;fill:#3f5549}.map{max-height:360px}.terms{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}.scroll{overflow:auto}.heatmap{min-width:720px;font-size:11px}.heatmap td,.heatmap th{padding:5px 3px;text-align:center;border:2px solid white}@media print{body{background:white}main{padding:0}article{border:0;padding:0;break-before:page}article:first-of-type{break-before:auto}tr,svg{break-inside:avoid}}</style></head><body><main><h1>${escape(comparison ? l.comparison : l.title)}</h1>${renderCheck(check, locale, l)}${comparison ? `${renderCheck(comparison, locale, l)}${compare(check, comparison, locale, l)}` : ''}</main></body></html>`
}
