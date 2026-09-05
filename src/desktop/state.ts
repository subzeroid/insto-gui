import { reactive } from 'vue'
import type { DesktopClient, Profile, RuntimeInfo } from './client'
import { safeFailure, type DesktopFailure } from './messages'

export function createDesktopState(client: DesktopClient) {
  const state = reactive({ phase: 'preparing' as 'preparing' | 'ready' | 'failed' | 'closed', busy: false, profile: null as Profile | null, runtime: null as RuntimeInfo | null, error: null as DesktopFailure | null, stale: false, lastReadAt: null as number | null, outcomeUnknown: false })
  let disposed = false
  function apply(profile: Profile) {
    if (disposed) return
    state.profile = profile; state.stale = false; state.lastReadAt = Date.now()
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
  return {
    state, initialize, refresh,
    configure: (token: string) => mutate(() => client.configure(token)),
    replace: (token: string) => mutate(() => client.replace(token)),
    start: () => mutate(() => client.start()), stop: () => mutate(() => client.stop()), repair: () => mutate(() => client.repair()),
    dispose() { disposed = true; state.phase = 'closed' },
  }
}
