import { reactive } from 'vue'
import type { DesktopClient, HomeReport } from './client'
import { validHomePath } from './client'
import { DesktopFailure, safeFailure } from './messages'
import { isUncertain } from './service'
import type { DesktopState } from './state'

export const DEFAULT_HOME = '~/.insto'

// What the App has to tell apart after a selection attempt: it changed, it was
// refused and nothing moved, or nobody can say.
export type SelectOutcome = 'selected' | 'refused' | 'uncertain'
export const outcomeOf = (done: boolean, failure: DesktopFailure | null): SelectOutcome =>
  done ? 'selected' : isUncertain(failure) ? 'uncertain' : 'refused'

// The invalidation the App performs synchronously, immediately before the
// selection IPC leaves: everything scoped to the previous home is dropped first,
// so a response still in flight from it has nothing left to fill.
export interface HomeHooks { invalidate: () => void }

export function createHomeState(client: DesktopClient, desktop: DesktopState, hooks: HomeHooks) {
  const state = reactive({
    path: DEFAULT_HOME,
    checked: null as { path: string; report: HomeReport } | null,
    checking: false,
    error: null as DesktopFailure | null,
  })
  // Every inspection carries the generation its input had. An edit advances it, so
  // a response for a path the user has already changed is discarded instead of
  // being shown against the new text.
  let generation = 0

  function edit(value: string) {
    if (value === state.path) return
    state.path = value; state.checked = null; state.error = null; generation++
  }

  async function check(): Promise<void> {
    // Only one inspection at a time: the second would race the first for the same
    // single `checked` slot, and adoption is disabled while either is running.
    if (state.checking) return
    const path = state.path
    const expected = ++generation
    state.checked = null; state.error = null
    if (!validHomePath(path)) {
      // The same rule the host enforces; refusing here keeps a malformed path out
      // of the bridge and names the reason immediately.
      state.error = new DesktopFailure('invalid_home_input')
      return
    }
    state.checking = true
    try {
      const report = await client.inspectHome(path)
      if (generation === expected) state.checked = { path, report }
    } catch (error) {
      if (generation === expected) state.error = safeFailure(error)
    } finally { state.checking = false }
  }

  async function select(path: string | null): Promise<boolean> {
    state.error = null
    hooks.invalidate()
    const done = await desktop.mutate(() => client.selectHome(path))
    if (!done) state.error = desktop.state.error
    // Whatever the outcome, the report described the home as it was before the
    // attempt; it is no longer evidence about the bound profile.
    state.checked = null
    return done
  }

  return {
    state, edit, check,
    // R8: the selection uses the path the report was produced for, never the text
    // in the field, and never a report the core refused.
    adopt: () => (state.checked !== null && state.checked.report.adoptable && !state.checking
      ? select(state.checked.path)
      : Promise.resolve(false)),
    release: () => select(null),
  }
}
