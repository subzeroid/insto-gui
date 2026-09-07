import { reactive } from 'vue'
import type { DesktopClient, Profile, RuntimeInfo } from './client'
import { safeFailure, type DesktopFailure } from './messages'

export function createDesktopState(client: DesktopClient) {
  const state = reactive({ phase: 'preparing' as 'preparing' | 'ready' | 'failed' | 'closed', busy: false, profile: null as Profile | null, runtime: null as RuntimeInfo | null, error: null as DesktopFailure | null, stale: false, lastReadAt: null as number | null, reads: 0, outcomeUnknown: false })
  let disposed = false
  function apply(profile: Profile) {
    if (disposed) return
    // `reads` is the session's read clock: anything derived from a profile read
    // records it and is stale the moment it advances. Wall-clock time cannot do
    // this — two reads can land in the same millisecond.
    state.profile = profile; state.stale = false; state.lastReadAt = Date.now(); state.reads++
  }
  async function read() {
    try { apply(await client.inspect()); return true }
    catch (error) { if (!disposed) { state.stale = true; state.error = safeFailure(error) }; return false }
  }
  async function initialize() {
    if (disposed || state.busy) return
    state.busy = true; state.phase = 'preparing'; state.error = null
    try {
      const runtime = await client.prepare()
      if (disposed) return
      state.runtime = runtime
      const inspected = await read()
      if (!disposed) state.phase = inspected ? 'ready' : 'failed'
    } catch (error) { if (!disposed) { state.error = safeFailure(error); state.phase = 'failed' } }
    finally { state.busy = false }
  }
  async function refresh() {
    if (disposed || state.busy || state.phase !== 'ready') return
    state.busy = true; state.error = null
    try { if (await read()) state.outcomeUnknown = false }
    finally { state.busy = false }
  }
  async function mutate(action: () => Promise<Profile>) {
    if (disposed || state.busy || state.stale || state.phase !== 'ready') return false
    state.busy = true; state.error = null; state.outcomeUnknown = false
    try { apply(await action()); return !disposed }
    catch (error) {
      if (disposed) return false
      const failure = safeFailure(error)
      state.outcomeUnknown = ['outcome_unknown', 'operation_timeout'].includes(failure.code)
      // Even a domain service/storage error can happen after config was saved.
      // Read back state once; never repeat a mutation or ask for a saved token.
      await read()
      if (!disposed) state.error = failure
      return false
    } finally { state.busy = false }
  }
  // R10: the one narrow escape for a binding the app cannot use. It is not a
  // widening of `mutate`: it runs in `failed` as well as `ready`, because a home
  // whose inspection fails is precisely the home a release has to undo, and the
  // core accepts `select_home {home:{path:null}}` in that state. It still never
  // runs beside another mutation and never after dispose. On a refusal the reason
  // stays on screen and initialization is not restarted.
  async function releaseBinding(): Promise<boolean> {
    if (disposed || state.busy || (state.phase !== 'ready' && state.phase !== 'failed')) return false
    state.busy = true; state.error = null; state.outcomeUnknown = false
    let released = false
    try { await client.selectHome(null); released = true }
    catch (error) {
      if (!disposed) {
        const failure = safeFailure(error)
        state.outcomeUnknown = ['outcome_unknown', 'operation_timeout'].includes(failure.code)
        state.error = failure
      }
    } finally { if (!disposed) state.busy = false }
    if (!released || disposed) return false
    await initialize()
    return !disposed && state.phase === 'ready'
  }
  return {
    state, initialize, refresh, mutate, releaseBinding,
    configure: (token: string) => mutate(() => client.configure(token)),
    replace: (token: string) => mutate(() => client.replace(token)),
    start: () => mutate(() => client.start()), stop: () => mutate(() => client.stop()), repair: () => mutate(() => client.repair()),
    dispose() { disposed = true; state.phase = 'closed' },
  }
}

export type DesktopState = ReturnType<typeof createDesktopState>
