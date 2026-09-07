import { reactive } from 'vue'
import type { Binding, DesktopClient, Profile, ServiceFacts } from './client'
import type { DesktopState } from './state'
import { safeFailure, type DesktopFailure } from './messages'

// The four honest outcomes of a migration attempt. There is no generic failure
// notice: a refusal that changed nothing is shown by the global error banner with
// the core's own reason, not by a sentence the app invented.
export type ServiceNotice = 'migrated' | 'migration_rolled_back' | 'migration_recovery' | 'migration_uncertain'

// A binding that has not been read yet is `unknown`: the read-only end of the matrix.
export const UNREAD_BINDING: Binding = { state: 'unknown', home: null }

// The change may or may not have applied. `operation_timeout` is here even though
// the core's own migrate rolls back when its checkpoint trips, because the
// identical code also arrives from the host budget timer and the app cannot tell
// the two apart from the wire.
export const UNCERTAIN_CODES: readonly string[] = ['operation_timeout', 'outcome_unknown', 'transport']
export const isUncertain = (failure: DesktopFailure | null): boolean =>
  failure !== null && UNCERTAIN_CODES.includes(failure.code)

// The `own` row of the decision matrix. `interpreter: 'current'` means the
// registered manifest names exactly the interpreter this bridge runs — the app's
// staged runtime — so `other` is the only case with anything to move, and a
// binding read from the desktop root is what keeps a CLI service inside an adopted
// home out of this branch across relaunches. Freshness is enforced by the caller:
// this predicate is pure and has no session.
export function shouldAutoMigrate(profile: Profile | null, facts: ServiceFacts | null, binding: Binding): boolean {
  if (profile === null || facts === null || binding.state !== 'own') return false
  if (!profile.configured || profile.status === 'recovery_required') return false
  if (facts.registration !== 'owned' || facts.interpreter !== 'other') return false
  if (facts.interpreterExists === null) return false
  // A known settings mismatch is shown, never silently rewritten; the core refuses
  // it as `service_config_mismatch` anyway.
  return facts.settings !== 'different'
}

export function createServiceState(client: DesktopClient, desktop: DesktopState) {
  const state = reactive({
    facts: null as ServiceFacts | null,
    binding: { ...UNREAD_BINDING } as Binding,
    factsAt: null as number | null,
    migrating: false,
    notice: null as ServiceNotice | null,
    error: null as DesktopFailure | null,
  })
  let disposed = false
  let attempted = false

  // Facts are fresh only while they describe the profile read now on screen.
  // `desktop.state.reads` advances on every successful profile read, so a refresh
  // or any mutation makes retained facts stale at once.
  const fresh = () => state.facts !== null && state.factsAt === desktop.state.reads

  // Both readers return their failure instead of writing it: the public entry
  // points decide which one the user sees, so a binding failure is not erased by a
  // facts read that happened to succeed.
  async function readBinding(): Promise<DesktopFailure | null> {
    if (disposed) return null
    try {
      const binding = await client.inspectBinding()
      if (!disposed) state.binding = binding
      return null
    } catch (error) {
      const failure = safeFailure(error)
      if (!disposed) state.binding = { ...UNREAD_BINDING }
      return failure
    }
  }

  async function readFacts(): Promise<DesktopFailure | null> {
    if (disposed) return null
    const at = desktop.state.reads
    try {
      const facts = await client.inspectService()
      if (!disposed) { state.facts = facts; state.factsAt = at }
      return null
    } catch (error) {
      const failure = safeFailure(error)
      // R7: clearing is the point. Retained facts would let a mutation predicate
      // answer from a registration nobody has confirmed.
      if (!disposed) { state.facts = null; state.factsAt = null }
      return failure
    }
  }

  async function inspect(): Promise<void> {
    if (disposed) return
    const binding = await readBinding()
    const facts = await readFacts()
    if (!disposed) state.error = facts ?? binding
  }
  async function refreshBinding(): Promise<void> { const failure = await readBinding(); if (!disposed) state.error = failure }
  async function refreshFacts(): Promise<void> { const failure = await readFacts(); if (!disposed) state.error = failure }

  // R11: a home selection invalidates every home-scoped read. Facts and notices
  // describe the previous home and must not survive it.
  function clear() { state.facts = null; state.factsAt = null; state.notice = null; state.error = null }

  // R12. An unknown or unread binding, missing or stale facts, and a registration
  // the app did not write all mean the same thing: no proof of what a mutation
  // would be changing. Start, Stop, Repair, Migrate and Uninstall read this one
  // predicate, and an open confirmation closes when it turns true.
  function readonly(): boolean {
    if (state.binding.state === 'unknown') return true
    // A profile read that failed leaves no confirmed profile at all, and the read
    // counter cannot see it: a failed read never advances `reads`, so the facts
    // still look fresh. The desktop guard refuses every mutation while the profile
    // is stale, so the predicates must refuse too — before any IPC.
    if (desktop.state.stale) return true
    if (state.facts === null || state.factsAt !== desktop.state.reads) return true
    return state.facts.registration === 'unknown'
  }

  // The uninstall column of the matrix: a registration the app owns may be
  // removed, except inside an adopted home while it still names another
  // interpreter — that one is the user's own CLI service.
  function canUninstall(): boolean {
    if (readonly() || state.facts === null) return false
    if (state.facts.registration !== 'owned') return false
    return !(state.binding.state === 'adopted' && state.facts.interpreter === 'other')
  }

  // The migration columns, for both the automatic path and the manual one. R11
  // re-checks this at execution time, not only when the button was rendered.
  function canMigrate(): boolean {
    const profile = desktop.state.profile
    if (readonly() || state.facts === null || profile === null) return false
    if (!profile.configured || profile.status === 'recovery_required') return false
    if (state.facts.registration !== 'owned' || state.facts.interpreter !== 'other') return false
    return state.facts.settings !== 'different'
  }

  // Only an adopted home's still-CLI registration is a takeover, and only a
  // takeover needs the extra confirmation.
  const takeover = () => canMigrate() && state.binding.state === 'adopted'

  // R13, read from `insto/desktop/migration.py`. `service_error` is the single
  // code the core documents as a completed rollback (RestartFailedError: the
  // previous registration is back, its process did not restart).
  // `recovery_required` means the rollback did not settle — the app restored
  // nothing. The uncertain codes mean the change may or may not have applied.
  // Every other refusal changed nothing and gets no notice at all: the global
  // error banner carries the core's own reason, which is what keeps
  // `service_config_mismatch` visible instead of degraded.
  function noticeFor(ok: boolean, failure: DesktopFailure | null): ServiceNotice | null {
    if (ok) return 'migrated'
    if (failure === null) return null
    if (failure.code === 'recovery_required') return 'migration_recovery'
    if (isUncertain(failure)) return 'migration_uncertain'
    return failure.code === 'service_error' ? 'migration_rolled_back' : null
  }

  // Both mutations go through the desktop guard, which owns busy / stale /
  // recovery, the returned profile and the outcomeUnknown rule. The facts are
  // re-read after every attempt so no predicate answers from the registration as
  // it was before.
  async function run(action: () => Promise<Profile>): Promise<boolean> {
    if (disposed || state.migrating) return false
    state.migrating = true
    try {
      const ok = await desktop.mutate(action)
      await refreshFacts()
      return ok
    } finally { if (!disposed) state.migrating = false }
  }

  async function migrate(): Promise<boolean> {
    if (!canMigrate()) return false
    state.notice = null
    const ok = await run(() => client.migrateService())
    if (!disposed) state.notice = noticeFor(ok, desktop.state.error)
    return ok
  }

  async function uninstall(): Promise<boolean> {
    if (!canUninstall()) return false
    return run(() => client.uninstallService())
  }

  // R7: the facts are re-read after every profile mutation, not only the two this
  // state owns. Every call site in App.vue routes through here, so configure,
  // credential replacement, start, stop, repair and a home selection all leave a
  // fresh registration behind.
  async function afterMutation(action: () => Promise<boolean>): Promise<boolean> {
    const ok = await action()
    await refreshFacts()
    return ok
  }

  async function autoMigrateOnce(): Promise<void> {
    if (disposed || attempted) return
    // Marked before the attempt: a refused, failed or uncertain migration is
    // reported once and never retried behind the user's back.
    attempted = true
    if (!fresh()) await inspect()
    if (!fresh()) return
    if (!shouldAutoMigrate(desktop.state.profile, state.facts, state.binding)) return
    await migrate()
  }

  return {
    state, fresh, inspect, refreshBinding, refreshFacts, clear, afterMutation,
    migrate, uninstall, autoMigrateOnce, readonly, canMigrate, canUninstall, takeover,
    shouldAutoMigrate,
    dispose() { disposed = true },
  }
}
