const messages = {
  invalid_token_input: 'Введите токен: от 4 до 4096 символов, без пробелов.',
  invalid_token: 'HikerAPI отклонил токен. Проверьте его и попробуйте ещё раз.',
  quota_exhausted: 'Лимит HikerAPI исчерпан. Пополните баланс для новых проверок.',
  rate_limited: 'HikerAPI временно ограничил запросы. Попробуйте позже.',
  network_error: 'Не удалось связаться с HikerAPI. Проверьте подключение к интернету.',
  access_unconfirmed: 'HikerAPI не подтвердил доступ. Токен не сохранён; попробуйте позже.',
  operation_timeout: 'Время операции истекло. Проверьте текущее состояние перед повтором.',
  outcome_unknown: 'Связь с ядром прервалась. Изменение могло примениться; не повторяйте его вслепую.',
  profile_busy: 'Другая операция меняет профиль. Обновите состояние чуть позже.',
  busy: 'Дождитесь завершения текущей операции.',
  closed: 'Приложение завершает работу. Новые действия недоступны.',
  profile_ownership: 'Безопасное управление этим профилем недоступно. Его данные не изменены автоматически.',
  not_configured: 'Сначала подключите HikerAPI.',
  already_configured: 'Профиль уже настроен. Используйте замену токена.',
  recovery_required: 'Предыдущее изменение не завершилось. Нужна проверка и восстановление профиля.',
  service_error: 'Не удалось подтвердить запуск службы. Сохранённые настройки можно восстановить.',
  storage_error: 'Не удалось открыть защищённое хранилище приложения.',
  schema_mismatch: 'Эта версия приложения не поддерживает формат базы. Данные не изменены.',
  protocol: 'Ядро вернуло несовместимые данные. Действие не считается успешным.',
  transport: 'Не удалось получить состояние ядра. Попробуйте обновить его.',
  launcher: 'Не удалось безопасно открыть встроенное ядро.',
  runtime_manifest: 'Описание встроенного ядра повреждено. Нужна целая копия приложения.',
  runtime_incompatible: 'Встроенное ядро не подходит этой версии приложения или этому Mac.',
  runtime_ownership: 'Нельзя безопасно использовать каталог ядра. Существующие файлы сохранены.',
  runtime_integrity: 'Проверка файлов ядра не пройдена. Существующая версия не перезаписана.',
  runtime_storage: 'Не удалось подготовить ядро. Проверьте свободное место на диске.',
  runtime_timeout: 'Подготовка ядра заняла слишком долго. Можно попробовать ещё раз.',
  runtime_handshake: 'Не удалось запустить встроенное ядро. Подготовку можно повторить.',
  unsupported_platform: 'Эта версия приложения предназначена для macOS.',
  internal_error: 'Не удалось завершить действие. Обновите состояние приложения.',
} as const

export type ErrorCode = keyof typeof messages
export class DesktopFailure extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode) { super(messages[code]); this.name = 'DesktopFailure'; this.code = code }
}
export function safeFailure(error: unknown): DesktopFailure {
  if (error instanceof DesktopFailure) return error
  const code = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? error.code : null
  return new DesktopFailure(typeof code === 'string' && Object.hasOwn(messages, code) ? code as ErrorCode : 'transport')
}
