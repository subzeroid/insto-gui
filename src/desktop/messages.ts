export const messages = {
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
  home_invalid: 'Этот каталог нельзя использовать как установку insto. Файлы в нём не изменены.',
  home_backend_unsupported: 'В этой установке insto выбран другой источник данных. Приложение работает только с HikerAPI.',
  service_ownership_unknown: 'Служба зарегистрирована не приложением. Чужая регистрация не изменяется.',
  service_config_mismatch: 'Регистрация службы не совпадает с настройками этого каталога. Ничего не изменено.',
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
  watch_conflict: 'Наблюдение изменилось с момента последнего чтения. Список обновлён; повторите действие.',
  watch_not_found: 'Наблюдение уже удалено. Список обновлён.',
  watch_exists: 'Такое наблюдение уже есть. Список обновлён.',
  watch_limit: 'Одновременно активны не более трёх наблюдений. Приостановите одно из них.',
  history_corrupt: 'Сохранённый снимок не удалось прочитать безопасно.',
  history_oversized: 'Сохранённый снимок превышает поддерживаемый размер.',
  snapshot_unavailable: 'Выбранный снимок больше недоступен. Список снимков обновлён.',
  snapshot_identity_mismatch: 'Сравнивать можно только снимки одной сохранённой истории.',
  invalid_watch_input: 'Имя аккаунта: латинские буквы, цифры, точки и подчёркивания, до 255 символов. Интервал не меньше 300 секунд.',
  invalid_history_input: 'Некорректный запрос к сохранённой истории.',
  invalid_home_input: 'Путь должен начинаться с / или с ~, без «..» и не длиннее 1024 байт.',
  invalid_params: 'Ядро отклонило параметры запроса. Обновите список и повторите действие.',
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
// UI copy, deliberately outside `messages`: `safeFailure` accepts any key of
// `messages` as a code from the bridge, so a UI sentence there could be shown
// as an error the core never sent.
export const texts = {
  // Every user-visible sentence of this stage is defined once, here: Task 7
  // selects one migration notice per outcome and Task 8 renders the rest.
  // One sentence per migration outcome (R13). «Прежняя регистрация восстановлена»
  // appears only where the core reported a completed rollback; a recovery and an
  // unknown outcome say plainly that nothing was restored.
  service_migrated: 'Служба переведена на встроенное ядро этой версии.',
  service_migration_rolled_back: 'Перевести службу не удалось. Ядро восстановило прежнюю регистрацию, но её процесс не запустился. Откройте раздел «Служба» и нажмите «Восстановить».',
  service_migration_recovery: 'Перевод службы не завершён. Приложение ничего не восстанавливало: профилю нужно восстановление. Откройте раздел «Служба» и нажмите «Восстановить».',
  service_migration_uncertain: 'Результат перевода службы неизвестен: изменение могло примениться, а могло и нет. Проверьте состояние в разделе «Служба» перед повтором.',
  service_registration_none: 'Служба не зарегистрирована.',
  service_registration_owned: 'Служба зарегистрирована приложением.',
  service_registration_unknown: 'Служба зарегистрирована не приложением: доступен только просмотр.',
  service_interpreter_current: 'Служба работает на встроенном ядре этой версии.',
  service_interpreter_other: 'Служба работает на другом ядре. Её нужно перевести на встроенное.',
  service_interpreter_missing: 'Прежнее ядро службы недоступно.',
  service_loaded: 'Регистрация загружена в macOS.',
  service_unloaded: 'Регистрация не загружена в macOS.',
  service_settings_different: 'Настройки регистрации отличаются от ожидаемых приложением.',
  service_facts_unknown: 'Состояние службы прочитать не удалось. Пока оно неизвестно, менять её нельзя.',
  service_readonly: 'Этой службой приложение не управляет: доступен только просмотр.',
  service_migrate_action: 'Перевести службу на встроенное ядро',
  service_migrate_explain: 'Приложение перерегистрирует службу на встроенное ядро. Данные каталога не изменяются.',
  binding_own: 'Приложение работает со своим каталогом данных.',
  binding_adopted: 'Приложение работает с существующей установкой insto.',
  binding_unknown: 'Не удалось определить, с каким каталогом работает приложение. Доступен только просмотр.',
  binding_release_explain: 'Приложение связано с внешним каталогом insto. Если этот каталог недоступен, можно вернуться к собственному профилю приложения — файлы каталога при этом не меняются.',
  home_title: 'Существующая установка insto',
  home_path_label: 'Путь к каталогу insto',
  home_check_action: 'Проверить',
  home_adopt_action: 'Подключить',
  home_release_action: 'Вернуться к собственному профилю',
  home_adoptable: 'Каталог подходит для подключения.',
  home_not_adoptable: 'Каталог нельзя подключить.',
  home_unknown_owner: 'Службой этой установки управляет не приложение. Она продолжит работать сама по себе.',
  home_adopt_confirm: 'Приложение переключится на этот каталог. Собственная фоновая служба приложения будет остановлена. Данные обоих каталогов сохранятся.',
  home_release_confirm: 'Приложение вернётся к собственному профилю. Каталог существующей установки останется без изменений.',
  home_takeover_action: 'Перевести службу этой установки на приложение',
  home_takeover_explain: 'Служба существующей установки будет перерегистрирована на встроенное ядро приложения. Данные каталога не изменяются. Приложение никогда не делает этого само.',
  home_config_ok: 'Настройки insto прочитаны.',
  home_config_missing: 'В каталоге нет файла настроек insto.',
  home_config_invalid: 'Файл настроек insto прочитать не удалось.',
  home_database_ok: 'База данных доступна.',
  home_database_missing: 'База данных ещё не создана.',
  home_database_schema_mismatch: 'Формат базы не поддерживается этой версией.',
  home_database_unreadable: 'Базу данных прочитать не удалось.',
  home_process_running: 'Служба этой установки запущена.',
  home_process_stopped: 'Служба этой установки остановлена.',
  home_process_unknown: 'Состояние службы этой установки неизвестно.',
} as const
