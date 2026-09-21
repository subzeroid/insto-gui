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
  // The four codes only the two on-demand lookups can return.
  'target_not_found',
  'target_private',
  'target_unavailable',
  'provider_response_invalid',
  'invalid_watch_input',
  'invalid_history_input',
  'invalid_home_input',
  'invalid_lookup_input',
  'invalid_params',
  'internal_error',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
const KNOWN: ReadonlySet<string> = new Set(ERROR_CODES)

// The codes that prove a paid request never left this Mac: the window, the
// Tauri command, the launcher or the core refused before a provider client was
// ever built. A lookup that fails with one of these cost nothing, and saying it
// may have been charged would be a lie in the expensive direction.
//
// Everything else is treated as possibly charged, which is the safe side of the
// question. That deliberately includes the three codes that describe a broken
// answer rather than a broken request — `transport`, `operation_timeout` and
// `protocol`, plus `outcome_unknown` — because a request that was dispatched and
// then lost is exactly the case the user has to be warned about, and every code
// that names HikerAPI itself (`invalid_token`, `quota_exhausted`, `rate_limited`,
// `network_error`, `access_unconfirmed`, `target_*`, `provider_response_invalid`)
// can only be produced after the provider was reached or attempted.
const FREE_FAILURES: ReadonlySet<string> = new Set<string>([
  'not_configured',
  'invalid_lookup_input',
  'busy',
  'closed',
  'launcher',
  // Parameter validation in the Tauri command, and the profile's own admission
  // control: all five are refused before a process is spawned, exactly like
  // `busy` above. None of them can reach a lookup today, but this predicate is
  // written for every code, not for the two operations that call it.
  'invalid_token_input',
  'invalid_watch_input',
  'invalid_history_input',
  'invalid_home_input',
  'profile_busy',
  'home_invalid',
  'home_backend_unsupported',
  'profile_ownership',
  'invalid_params',
  'unsupported_platform',
  // Preparing the bundled core fails before any operation is sent, and a code
  // added to that family later joins this set by itself.
  ...ERROR_CODES.filter(code => code.startsWith('runtime_')),
])
/** Whether a failure with this code may already have cost a paid request. */
export const mayHaveBeenCharged = (code: ErrorCode): boolean => !FREE_FAILURES.has(code)

export class DesktopFailure extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode) { super(t(`error.${code}`)); this.name = 'DesktopFailure'; this.code = code }
}
export function safeFailure(error: unknown): DesktopFailure {
  if (error instanceof DesktopFailure) return error
  const code = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? error.code : null
  return new DesktopFailure(typeof code === 'string' && KNOWN.has(code) ? code as ErrorCode : 'transport')
}
