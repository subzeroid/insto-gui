import type { HistoryItem, Overview, Snapshot, Watch } from './dto'

export const watch: Watch = { user: 'alice', status: 'active', interval_seconds: 300, last_ok: null, waiting_first_check: true, has_error: false, consecutive_errors: 0, revision: 'a'.repeat(64) }
export const overview: Overview = { configured: true, desired_service: 'running', service_state: 'unknown', quota_remaining: 8, quota_checked_at: 100, watches: [watch], next_cursor: null }
export const envelope = (kind: string, data: unknown) => ({ kind, data })
export const snap = (id: string, pk: string, at: number): Snapshot => ({ id, target_pk: pk, captured_at: at })
export const page = (items: HistoryItem[], cursor: string | null = null, scanned = items.length) => ({ items, next_cursor: cursor, scan_complete: cursor === null, scanned })
