import { reactive } from 'vue'
import { canonicalUsername, type DesktopClient } from './client'
import type { LookupActivity, LookupProfile, LookupWindow } from './dto'
import { DesktopFailure, safeFailure } from './messages'

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
 * `lookUp` canonicalizes the name it is given (leading `@`, surrounding
 * whitespace, case), because this is the only entry point for a name a person
 * typed; a form need not do it first.
 */
export function createLookupState(client: DesktopClient) {
  const state = reactive({
    username: null as string | null,
    profile: emptyProfile(),
    activity: emptyActivity(DEFAULT_WINDOW),
  })
  // One generation for both kinds: looking up another account must also drop an
  // analysis already in flight for the previous one, so a paid answer can never
  // land under the wrong name.
  let generation = 0
  // The two kinds share the host's single network-read slot, so a second request
  // of either kind is ignored rather than queued behind up to seventy seconds of
  // provider round trip. It is also what keeps the running one authoritative: a
  // click that is refused changes nothing on screen.
  const idle = () => !state.profile.loading && !state.activity.loading

  async function lookUp(raw: string): Promise<boolean> {
    if (!idle()) return false
    generation++
    const expected = generation
    const username = canonicalUsername(raw)
    state.username = username ?? raw
    // A new account never leaves the previous one's analysis on screen, and the
    // chosen window survives, because it is a preference and not a result.
    state.activity = emptyActivity(state.activity.window)
    if (username === null) {
      state.profile = { ...emptyProfile(), error: new DesktopFailure('invalid_lookup_input') }
      return false
    }
    state.profile = { ...emptyProfile(), loading: true, spent: true }
    try {
      const value = await client.lookupProfile(username)
      if (generation !== expected) return false
      state.profile.value = value
      state.profile.at = Math.floor(Date.now() / 1000)
      return true
    } catch (error) {
      if (generation === expected) state.profile.error = safeFailure(error)
      return false
    } finally {
      if (generation === expected) state.profile.loading = false
    }
  }

  async function analyze(window: LookupWindow): Promise<boolean> {
    const found = state.profile.value
    if (found === null || !idle()) return false
    // The core's own rule: `lookup.activity` is handed a bare pk and cannot tell
    // a private account from an empty one, because a provider may answer a
    // private account's media with an empty page. A refusal that is already
    // certain is not worth a paid request — hence `spent: false`.
    if (found.access === 'private') {
      state.activity = { ...emptyActivity(window), error: new DesktopFailure('target_private') }
      return false
    }
    const expected = generation
    const targetPk = found.target_pk
    state.activity = { ...emptyActivity(window), loading: true, spent: true }
    try {
      const value = await client.lookupActivity(targetPk, window)
      if (generation !== expected) return false
      state.activity.value = value
      return true
    } catch (error) {
      if (generation === expected) state.activity.error = safeFailure(error)
      return false
    } finally {
      if (generation === expected) state.activity.loading = false
    }
  }

  // Nothing was ever written to disk, so forgetting is the whole of clearing.
  // The chosen window is the one thing that stays: it is the user's setting for
  // the selector, not a result, and it must not jump under them.
  function clear(): void {
    generation++
    state.username = null
    state.profile = emptyProfile()
    state.activity = emptyActivity(state.activity.window)
  }

  return { state, lookUp, analyze, clear }
}
