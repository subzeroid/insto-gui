import type { Binding, HistoryItem, HomeReport, Overview, ServiceFacts, Snapshot, Watch } from './dto'
import { CORE_VERSION, type Profile } from './client'

export const watch: Watch = { user: 'alice', status: 'active', interval_seconds: 300, last_ok: null, waiting_first_check: true, has_error: false, consecutive_errors: 0, revision: 'a'.repeat(64) }
export const overview: Overview = { configured: true, desired_service: 'running', service_state: 'unknown', quota_remaining: 8, quota_checked_at: 100, watches: [watch], next_cursor: null }
export const envelope = (kind: string, data: unknown) => ({ kind, data })
export const snap = (id: string, pk: string, at: number): Snapshot => ({ id, target_pk: pk, captured_at: at })
export const page = (items: HistoryItem[], cursor: string | null = null, scanned = items.length) => ({ items, next_cursor: cursor, scan_complete: cursor === null, scanned })
export const prepared = { core_version: CORE_VERSION, build_id: 'a'.repeat(64) }
export const running: Profile = { configured: true, status: 'running', desired_service: 'running', service_running: true, quota_remaining: 10, quota_checked_at: 100, revision: 'a'.repeat(32) }
// An adopted home before its first credential check: configured, quota not yet known.
export const adoptedProfile: Profile = { ...running, quota_remaining: null, quota_checked_at: null }
// The core expands `~` before it answers, so a legitimate response path can be
// longer than the 1024-byte request bound: 9 + 600 * 2 + 7 = 1216 UTF-8 bytes.
export const expandedPath = `/Users/x/${'ä'.repeat(600)}/.insto`

// ── `service.inspect`: exactly five keys, wire spelling (R8 1-6) ────────────
export const serviceNone = { registration: 'none', interpreter: null, interpreter_exists: null, loaded: null, settings: null }   // 1 early return
export const serviceNoneStopped = { ...serviceNone, loaded: false }                                                              // 2 the ordinary macOS shape
export const serviceOwnedOther = { registration: 'owned', interpreter: 'other', interpreter_exists: true, loaded: true, settings: 'matching' }   // 3
export const serviceOwnedCurrent = { registration: 'owned', interpreter: 'current', interpreter_exists: true, loaded: false, settings: null }    // 4 no parseable config
export const serviceForeign = { registration: 'unknown', interpreter: null, interpreter_exists: null, loaded: true, settings: null }             // 5
export const serviceRejected = [                                                                                                 // 6
  { ...serviceNone, loaded: true },              // a loaded job forces "unknown"
  { ...serviceOwnedOther, interpreter: null },   // owned always names its interpreter
  { ...serviceForeign, settings: 'matching' },   // settings come only from an owned manifest
]
// The decoded counterparts the state modules hold.
export const facts: ServiceFacts = { registration: 'owned', interpreter: 'other', interpreterExists: true, loaded: true, settings: 'matching' }
export const current: ServiceFacts = { registration: 'owned', interpreter: 'current', interpreterExists: true, loaded: false, settings: null }
export const unregistered: ServiceFacts = { registration: 'none', interpreter: null, interpreterExists: null, loaded: false, settings: null }
export const foreign: ServiceFacts = { registration: 'unknown', interpreter: null, interpreterExists: null, loaded: true, settings: null }
export const wire = (value: ServiceFacts) => ({ registration: value.registration, interpreter: value.interpreter, interpreter_exists: value.interpreterExists, loaded: value.loaded, settings: value.settings })

// ── `home.inspect`: exactly twelve keys (R8 7-13) ──────────────────────────
export const homeAdoptable: HomeReport = { path: '/Users/x/.insto', exists: true, private: true, config: 'ok', backend: 'hikerapi', database: 'ok', registration: 'none', interpreter: null, loaded: false, process: 'stopped', adoptable: true, reason: null }                        // 7
export const homeMissing: HomeReport = { path: '/Users/x/absent', exists: false, private: false, config: 'missing', backend: null, database: 'missing', registration: 'none', interpreter: null, loaded: null, process: 'unknown', adoptable: false, reason: 'home_invalid' }          // 8
export const homeNotPrivate: HomeReport = { path: '/Users/x/open', exists: true, private: false, config: 'invalid', backend: null, database: 'unreadable', registration: 'unknown', interpreter: null, loaded: null, process: 'unknown', adoptable: false, reason: 'home_invalid' }    // 9
// 10: an invalid token keeps the backend the configuration parsed.
export const homeInvalidConfig: HomeReport = { ...homeAdoptable, config: 'invalid', backend: 'hikerapi', adoptable: false, reason: 'home_invalid' }
// 10b: a readable configuration naming a backend outside the three known ones.
export const homeUnsupportedBackend: HomeReport = { ...homeAdoptable, backend: null, adoptable: false, reason: 'home_backend_unsupported' }
export const homeSchemaMismatch: HomeReport = { ...homeAdoptable, database: 'schema_mismatch', adoptable: false, reason: 'schema_mismatch' }     // 11
// 12: the CLI runs its own service in this home; it is still adoptable.
export const homeCliOwned: HomeReport = { ...homeAdoptable, registration: 'owned', interpreter: 'other', loaded: true, process: 'running' }
export const homeRejected = [                                                                                                                   // 13
  { ...homeAdoptable, reason: 'storage_error' },   // adoptable never carries a reason
  { ...homeAdoptable, process: 'running' },        // loaded:false means process:"stopped"
  { ...homeMissing, private: true },               // nothing inside a missing path is read
]
// Roles the state and component tests read by name.

// ── `inspect_binding`: the wire object and the decoded value are identical ──
export const ownBinding: Binding = { state: 'own', home: null }
export const adoptedBinding: Binding = { state: 'adopted', home: '/Users/x/.insto' }
export const unknownBinding: Binding = { state: 'unknown', home: null }
