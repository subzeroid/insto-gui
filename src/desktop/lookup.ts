import { reactive } from 'vue'
import type { DesktopClient } from './client'
import type { LookupActivity, LookupProfile, LookupWindow } from './dto'
import { DesktopFailure, safeFailure } from './messages'

// The largest window the core offers, and the one the design quotes first: the
// analysis costs one page request either way for a provider page of fifty.
export const DEFAULT_WINDOW: LookupWindow = 50

const emptyProfile = () => ({ value: null as LookupProfile | null, loading: false, error: null as DesktopFailure | null })
const emptyActivity = (window: LookupWindow) => ({ value: null as LookupActivity | null, window, loading: false, error: null as DesktopFailure | null })

/**
 * The Lookup section's state. Both calls here spend the user's paid HikerAPI
 * quota, so this module is deliberately dull: it starts one request per kind,
 * never repeats one, never polls, and persists nothing. Results live in memory
 * until `clear()` or a new username, so re-opening the tab costs nothing.
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

  async function lookUp(username: string): Promise<boolean> {
    // A second click while the first request is in flight is ignored rather than
    // queued: it would cost the same two requests for the same answer.
    if (state.profile.loading) return false
    generation++
    const expected = generation
    state.username = username
    state.profile = { ...emptyProfile(), loading: true }
    state.activity = emptyActivity(state.activity.window)
    try {
      const value = await client.lookupProfile(username)
      if (generation !== expected) return false
      state.profile.value = value
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
    if (found === null || state.activity.loading) return false
    // The core's own rule: `lookup.activity` is handed a bare pk and cannot tell
    // a private account from an empty one, because a provider may answer a
    // private account's media with an empty page. A refusal that is already
    // certain is not worth a paid request.
    if (found.access === 'private') {
      state.activity = { ...emptyActivity(window), error: new DesktopFailure('target_private') }
      return false
    }
    const expected = generation
    const targetPk = found.target_pk
    state.activity = { ...emptyActivity(window), loading: true }
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
  function clear(): void {
    generation++
    state.username = null
    state.profile = emptyProfile()
    state.activity = emptyActivity(DEFAULT_WINDOW)
  }

  return { state, lookUp, analyze, clear }
}
