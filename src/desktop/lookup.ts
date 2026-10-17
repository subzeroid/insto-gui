import { toRaw, reactive } from 'vue'
import { canonicalUsername, type DesktopClient } from './client'
import type { LookupActivity, LookupProfile, LookupWindow } from './dto'
import type { SavedCheck } from './workbench'
import { DesktopFailure, mayHaveBeenCharged, safeFailure } from './messages'

// The middle window: enough posts for a rhythm to be visible, and — at the page
// sizes the provider actually serves — usually still one paid page request. The
// largest window is one click away for anyone who wants it.
export const DEFAULT_WINDOW: LookupWindow = 30

// `spent` says whether a provider request was actually dispatched, so a failure
// can be labelled honestly: a refusal this module made itself costs nothing,
// while a cancelled or timed-out one may already have been charged. L3 renders
// `lookup.may_be_charged` beside a failure whose part has it set.
// `at` is when the answer landed, in seconds. A result survives leaving the tab
// and coming back, so the card has to date itself honestly rather than say the
// lookup just happened.
const emptyProfile = () => ({ value: null as LookupProfile | null, at: null as number | null, loading: false, spent: false, error: null as DesktopFailure | null })
const emptyActivity = (window: LookupWindow) => ({ value: null as LookupActivity | null, window, loading: false, spent: false, error: null as DesktopFailure | null })

/**
 * The Lookup section's state. Both calls here spend the user's paid HikerAPI
 * quota, so this module is deliberately dull: it starts one request at a time —
 * the two kinds are mutually exclusive, not one each — never repeats one, never
 * polls, and persists nothing. Results live in memory until `clear()` or a new
 * username, so re-opening the tab costs nothing.
 *
 * `lookUp` and `check` canonicalize the name they are given (surrounding
 * whitespace, a leading `@`, case), because these accept names people typed;
 * a form need not do it first. A name they cannot rescue is refused into
 * `state.inputError` and changes nothing else — a typo is free, and it must not
 * throw away an answer that was paid for.
 */
export function createLookupState(client: DesktopClient) {
  const state = reactive({
    username: null as string | null,
    fromSaved: false,
    checking: false,
    // Monotonic milliseconds for the whole accepted operation. Views can
    // remount without restarting elapsed time; the posts stage shares it.
    startedAt: null as number | null,
    // Window-owned preference and admitted scope, so remounting a view cannot
    // relabel an ongoing paid check. Like the posts window, it survives reset.
    includeActivity: false,
    // A name that cannot be looked up at all. It is not a result and never
    // replaces one: it belongs to the field, not to the account on screen.
    inputError: null as DesktopFailure | null,
    profile: emptyProfile(),
    activity: emptyActivity(DEFAULT_WINDOW),
  })
  // One generation for both kinds: looking up another account must also drop an
  // analysis already in flight for the previous one, so a paid answer can never
  // land under the wrong name.
  let generation = 0
  let admitted: number | null = null
  let resetDepth = 0
  // The two kinds share the host's single network-read slot, so a second request
  // of either kind is ignored rather than queued behind up to seventy seconds of
  // provider round trip. It is also what keeps the running one authoritative: a
  // click that is refused changes nothing on screen.
  // A composite check also owns the gap after its profile settles and before
  // posts start. Per-stage loading flags alone would leave that gap unlocked.
  const idle = () => resetDepth === 0 && admitted === null && !state.checking && !state.profile.loading && !state.activity.loading

  function admit(): number | null {
    if (!idle()) return null
    // Acquire before any reactive write, including clearing an input error:
    // synchronous watchers must not admit a second paid request during setup.
    const expected = ++generation
    admitted = expected
    return expected
  }

  function release(expected: number): void {
    if (admitted === expected) admitted = null
  }

  function recordStart(expected: number): boolean {
    if (generation !== expected) return false
    state.startedAt = performance.now()
    return generation === expected
  }

  function inputUsername(raw: string): string | null {
    // The name is judged before anything on screen is touched. A typo costs
    // nothing and must not cost the user the answer they already paid for: it
    // is reported in `inputError`, beside the field it was typed in, and the
    // previous profile and analysis stay exactly as they were.
    const username = canonicalUsername(raw)
    if (username === null) {
      state.inputError = new DesktopFailure('invalid_lookup_input')
      return null
    }
    state.inputError = null
    return username
  }

  async function readProfile(username: string, expected: number): Promise<boolean> {
    if (generation !== expected) return false
    state.fromSaved = false
    if (generation !== expected) return false
    state.username = username
    if (generation !== expected) return false
    // A new account never leaves the previous one's analysis on screen, and the
    // chosen window survives, because it is a preference and not a result.
    state.activity = emptyActivity(state.activity.window)
    if (generation !== expected) return false
    state.profile = { ...emptyProfile(), loading: true, spent: true }
    if (!recordStart(expected)) return false
    try {
      const value = await client.lookupProfile(username)
      if (generation !== expected) return false
      // Publish the answer and its timestamp together. A synchronous reset on
      // the value must not be followed by writing a timestamp into empty state.
      state.profile = { ...state.profile, value, at: Math.floor(Date.now() / 1000) }
      return generation === expected
    } catch (error) {
      if (generation === expected) {
        const failure = safeFailure(error)
        // `spent` was set when the request was dispatched; a code that proves
        // nothing ever left this Mac takes it back.
        state.profile = { ...state.profile, error: failure, spent: mayHaveBeenCharged(failure.code) }
      }
      return false
    } finally {
      if (generation === expected) state.profile.loading = false
    }
  }

  async function lookUp(raw: string): Promise<boolean> {
    const expected = admit()
    if (expected === null) return false
    try {
      const username = inputUsername(raw)
      if (username === null || generation !== expected) return false
      return await readProfile(username, expected)
    } finally {
      release(expected)
    }
  }

  async function readActivity(window: LookupWindow, expected: number, newOperation = false): Promise<boolean> {
    const found = state.profile.value
    if (generation !== expected || found === null || state.fromSaved) return false
    // The core's own rule: `lookup.activity` is handed a bare pk and cannot tell
    // a private account from an empty one, because a provider may answer a
    // private account's media with an empty page. A refusal that is already
    // certain is not worth a paid request — hence `spent: false`.
    if (found.access === 'private') {
      state.activity = { ...emptyActivity(window), error: new DesktopFailure('target_private') }
      return false
    }
    const targetPk = found.target_pk
    state.activity = { ...emptyActivity(window), loading: true, spent: true }
    if (generation !== expected) return false
    if (newOperation && !recordStart(expected)) return false
    try {
      const value = await client.lookupActivity(targetPk, window)
      if (generation !== expected) return false
      state.activity.value = value
      return generation === expected
    } catch (error) {
      if (generation === expected) {
        const failure = safeFailure(error)
        state.activity = { ...state.activity, error: failure, spent: mayHaveBeenCharged(failure.code) }
      }
      return false
    } finally {
      if (generation === expected) state.activity.loading = false
    }
  }

  async function analyze(window: LookupWindow): Promise<boolean> {
    const expected = admit()
    if (expected === null) return false
    try {
      return await readActivity(window, expected, true)
    } finally {
      release(expected)
    }
  }

  /**
   * Fetch exactly one fresh profile, then posts if requested and public.
   * True means all applicable stages succeeded; private profiles succeed with
   * posts skipped. Refusal, failure, or invalidation returns false. A failed
   * post stage leaves the successful profile available to read or save.
   */
  async function check(raw: string, includeActivity: boolean): Promise<boolean> {
    const expected = admit()
    if (expected === null) return false
    try {
      const username = inputUsername(raw)
      if (username === null || generation !== expected) return false
      state.includeActivity = includeActivity
      if (generation !== expected) return false
      state.checking = true
      if (!await readProfile(username, expected) || generation !== expected) return false
      if (!includeActivity) return true
      const privateProfile = state.profile.value?.access === 'private'
      const analyzed = await readActivity(state.activity.window, expected)
      return generation === expected && (privateProfile || analyzed)
    } finally {
      // clear() may already have admitted another check. An old finalizer may
      // neither hide its busy indicator nor release its request guard.
      release(expected)
      if (generation === expected) state.checking = false
    }
  }

  // Nothing was ever written to disk, so forgetting is the whole of clearing.
  // The chosen window is the one thing that stays: it is the user's setting for
  // the selector, not a result, and it must not jump under them.
  function clear(): void {
    // Reset watchers may attempt another check, or clear again. Keep admission
    // closed until every reset write is published, including nested resets.
    resetDepth++
    try {
      generation++
      admitted = null
      state.checking = false
      state.startedAt = null
      state.fromSaved = false
      state.username = null
      state.inputError = null
      state.profile = emptyProfile()
      state.activity = emptyActivity(state.activity.window)
    } finally {
      resetDepth--
    }
  }

  function restore(check: SavedCheck): boolean {
    if (!idle()) return false
    // Hold admission across the initial reset and every saved-state write.
    // A watcher may clear at any of them; that invalidates this publication.
    resetDepth++
    try {
      const expected = generation + 1
      clear()
      if (generation !== expected) return false
      state.fromSaved = true
      if (generation !== expected) return false
      state.username = check.username
      if (generation !== expected) return false
      state.profile = { ...emptyProfile(), value: { ...structuredClone(toRaw(check.profile)), quota_remaining: null }, at: check.captured_at }
      if (generation !== expected) return false
      state.activity = { ...emptyActivity(check.activity?.window ?? DEFAULT_WINDOW), value: check.activity === null ? null : { ...structuredClone(toRaw(check.activity)), quota_remaining: null } }
      return generation === expected
    } finally {
      resetDepth--
    }
  }
  return { state, check, lookUp, analyze, clear, restore }
}
