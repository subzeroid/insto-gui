import { t } from '../i18n'

// The bridge-error boundary. A code that crosses the bridge may only ever select
// a sentence from this list: the UI copy lives under other prefixes in the
// dictionaries, so `error.` plus this closed set makes it impossible for a string
// from the core to pick out a UI sentence and show it as an error nobody sent.
export const ERROR_CODES = [
  'invalid_token_input',
  'invalid_token',
  'quota_exhausted',
  'rate_limited',
  'network_error',
  'access_unconfirmed',
  'operation_timeout',
  'outcome_unknown',
  'profile_busy',
  'busy',
  'closed',
  'profile_ownership',
  'not_configured',
  'already_configured',
  'recovery_required',
  'service_error',
  'storage_error',
  'schema_mismatch',
  'home_invalid',
  'home_backend_unsupported',
  'service_ownership_unknown',
  'service_config_mismatch',
  'protocol',
  'transport',
  'launcher',
  'runtime_manifest',
  'runtime_incompatible',
  'runtime_ownership',
  'runtime_integrity',
  'runtime_storage',
  'runtime_timeout',
  'runtime_handshake',
  'unsupported_platform',
  'watch_conflict',
  'watch_not_found',
  'watch_exists',
  'watch_limit',
  'history_corrupt',
  'history_oversized',
  'snapshot_unavailable',
  'snapshot_identity_mismatch',
  'invalid_watch_input',
  'invalid_history_input',
  'invalid_home_input',
  'invalid_params',
  'internal_error',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
const KNOWN: ReadonlySet<string> = new Set(ERROR_CODES)

export class DesktopFailure extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode) { super(t(`error.${code}`)); this.name = 'DesktopFailure'; this.code = code }
}
export function safeFailure(error: unknown): DesktopFailure {
  if (error instanceof DesktopFailure) return error
  const code = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? error.code : null
  return new DesktopFailure(typeof code === 'string' && KNOWN.has(code) ? code as ErrorCode : 'transport')
}
