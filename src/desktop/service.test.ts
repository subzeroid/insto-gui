import { describe, expect, it, vi } from 'vitest'
import { DesktopClient, type Binding, type Invoke, type Profile, type ServiceFacts } from './client'
import { createDesktopState } from './state'
import { createServiceState, isUncertain, shouldAutoMigrate } from './service'
import { adoptedProfile, current, facts, foreign, prepared, running, unregistered, wire } from './fixtures'

const stopped: Profile = { ...running, status: 'stopped', desired_service: 'stopped', service_running: false }
const empty: Profile = { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }
const mismatched: ServiceFacts = { ...facts, settings: 'different' }
const vanished: ServiceFacts = { ...facts, interpreterExists: false }
const own: Binding = { state: 'own', home: null }
const adopted: Binding = { state: 'adopted', home: '/Users/x/.insto' }
const nobody: Binding = { state: 'unknown', home: null }

const wrap = (data: Profile) => ({ kind: 'profile', data })
const inspection = (value: ServiceFacts = facts) => ({ kind: 'service_inspection', data: wire(value) })
const failure = (code: string) => ({ kind: 'error', data: { code, message: 'RAW_SENTINEL', retryable: false } })
const names = (invoke: ReturnType<typeof vi.fn<Invoke>>) => invoke.mock.calls.map(call => call[0])

async function boot(invoke: ReturnType<typeof vi.fn<Invoke>>) {
  const client = new DesktopClient(invoke)
  const desktop = createDesktopState(client)
  await desktop.initialize()
  return { desktop, service: createServiceState(client, desktop) }
}

describe('service state: binding, facts and freshness', () => {
  it('reads the binding and the facts and never throws to the caller', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
    const { service } = await boot(invoke)
    await expect(service.inspect()).resolves.toBeUndefined()
    expect(service.state.binding).toEqual(own)
    expect(service.state.facts).toEqual(facts)
    expect(service.state.error).toBeNull()
    expect(service.fresh()).toBe(true)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service'])
  })

  it('a failed inspection clears the facts, records the reason and never shows a raw core message', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(own).mockResolvedValueOnce(failure('storage_error'))
    const { service } = await boot(invoke)
    await service.inspect()
    expect(service.state.facts).toEqual(facts)
    await service.inspect()
    // R7: retained facts would let a mutation predicate answer from a
    // registration nobody has confirmed.
    expect(service.state.facts).toBeNull()
    expect(service.state.factsAt).toBeNull()
    expect(service.state.error?.code).toBe('storage_error')
    expect(service.readonly()).toBe(true)
    expect(JSON.stringify(service.state)).not.toContain('RAW_SENTINEL')
  })

  it('an unreadable binding is unknown, and a binding read still answers when the core inspection failed', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockRejectedValueOnce('transport')
      .mockResolvedValueOnce(adopted)
    const { desktop, service } = await boot(invoke)
    expect(desktop.state.phase).toBe('failed')
    await service.refreshBinding()
    expect(service.state.binding).toEqual(adopted)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding'])
    const broken = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running)).mockRejectedValueOnce('transport')
    const second = await boot(broken)
    await second.service.refreshBinding()
    expect(second.service.state.binding).toEqual({ state: 'unknown', home: null })
    expect(second.service.readonly()).toBe(true)
  })

  it('any later profile read makes the facts stale until they are read again', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection())
    const { desktop, service } = await boot(invoke)
    await service.inspect()
    expect(service.fresh()).toBe(true)
    expect(service.readonly()).toBe(false)
    await desktop.refresh()
    expect(service.state.facts).toEqual(facts) // still shown …
    expect(service.fresh()).toBe(false)        // … but no longer proof of anything
    expect(service.readonly()).toBe(true)
    await service.refreshFacts()
    expect(service.fresh()).toBe(true)
    expect(service.readonly()).toBe(false)
  })

  it('every profile mutation routed through afterMutation leaves fresh facts behind', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection(unregistered))
      .mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection())
    const { desktop, service } = await boot(invoke)
    await service.inspect()
    expect(await service.afterMutation(() => desktop.configure('TOKEN_SENTINEL'))).toBe(true)
    expect(service.fresh()).toBe(true)
    expect(service.state.facts).toEqual(facts)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'configure_setup', 'inspect_service'])
    expect(JSON.stringify(service.state)).not.toContain('SENTINEL')
  })
})

describe('service state: the decision matrix', () => {
  it('decides the startup migration by the binding, never by a remembered flag', () => {
    const recovery: Profile = { ...running, status: 'recovery_required' }
    const rows: [string, Profile | null, ServiceFacts | null, Binding, boolean][] = [
      ['own + owned + other', running, facts, own, true],
      ['own + owned + other, old interpreter gone', running, vanished, own, true],
      ['own + owned + other, service stopped by the user', stopped, facts, own, true],
      ['own + owned + current', running, current, own, false],
      ['own + none', running, unregistered, own, false],
      ['own + unknown', running, foreign, own, false],
      ['own + owned + other, settings differ', running, mismatched, own, false],
      ['own + owned + other, recovery required', recovery, facts, own, false],
      ['own + owned + other, unconfigured', empty, facts, own, false],
      ['adopted + owned + other — the user CLI service', running, facts, adopted, false],
      ['adopted + owned + current', running, current, adopted, false],
      ['adopted + none', running, unregistered, adopted, false],
      ['unknown binding', running, facts, nobody, false],
      ['facts unread', running, null, own, false],
      ['profile unread', null, facts, own, false],
    ]
    for (const [label, profile, value, binding, expected] of rows) {
      expect(shouldAutoMigrate(profile, value, binding), label).toBe(expected)
    }
  })

  it('a relaunch inside an adopted home never migrates the CLI service', async () => {
    // The first session adopted the home. This session has no memory of it and
    // learns the binding from the desktop root, exactly as a real relaunch does;
    // the CLI registration inside that home is `owned` + `other` all the same.
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(adopted).mockResolvedValueOnce(inspection())
    const { service } = await boot(invoke)
    await service.autoMigrateOnce()
    expect(service.state.binding).toEqual(adopted)
    expect(service.state.facts).toEqual(facts)
    expect(service.state.notice).toBeNull()
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service'])
    expect(names(invoke)).not.toContain('migrate_service')
    // It is offered as an explicit takeover instead, and never as an uninstall.
    expect(service.takeover()).toBe(true)
    expect(service.canMigrate()).toBe(true)
    expect(service.canUninstall()).toBe(false)
  })

  it('uninstall follows the matrix column and refuses an adopted CLI registration', async () => {
    const cases: [Binding, ServiceFacts, boolean][] = [
      [own, facts, true], [own, current, true], [own, unregistered, false], [own, foreign, false],
      [adopted, facts, false], [adopted, current, true], [adopted, unregistered, false],
      [nobody, facts, false],
    ]
    for (const [binding, value, expected] of cases) {
      const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
        .mockResolvedValueOnce(binding).mockResolvedValueOnce(inspection(value))
      const { service } = await boot(invoke)
      await service.inspect()
      expect(service.canUninstall(), `${binding.state}/${value.registration}/${value.interpreter}`).toBe(expected)
    }
  })

  it('an unknown binding disables every service mutation and issues no IPC', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(nobody).mockResolvedValueOnce(inspection())
    const { service } = await boot(invoke)
    await service.inspect()
    expect(service.readonly()).toBe(true)
    expect(service.canMigrate()).toBe(false)
    expect(service.canUninstall()).toBe(false)
    expect(await service.migrate()).toBe(false)
    expect(await service.uninstall()).toBe(false)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service'])
  })

  it('an unknown registration and stale facts disable every service mutation too', async () => {
    const unowned = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection(foreign))
    const first = await boot(unowned)
    await first.service.inspect()
    expect(first.service.readonly()).toBe(true)
    expect(await first.service.migrate()).toBe(false)
    expect(await first.service.uninstall()).toBe(false)
    expect(names(unowned)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service'])

    const stale = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(wrap(running))
    const second = await boot(stale)
    await second.service.inspect()
    await second.desktop.refresh()
    expect(second.service.readonly()).toBe(true)
    expect(await second.service.migrate()).toBe(false)
    expect(await second.service.uninstall()).toBe(false)
    expect(names(stale)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'inspect_setup'])
  })

  it('a known settings mismatch is shown, never migrated automatically or manually', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection(mismatched))
    const { service } = await boot(invoke)
    await service.autoMigrateOnce()
    expect(service.state.facts?.settings).toBe('different')
    expect(service.canMigrate()).toBe(false)
    expect(await service.migrate()).toBe(false)
    expect(names(invoke)).not.toContain('migrate_service')
  })
})

describe('service state: migration outcomes', () => {
  it('migrates once per session, re-reads the facts and reports the success', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection(current))
    const { service } = await boot(invoke)
    await service.autoMigrateOnce()
    await service.autoMigrateOnce()
    expect(service.state.notice).toBe('migrated')
    expect(service.state.facts).toEqual(current)
    expect(service.fresh()).toBe(true)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'migrate_service', 'inspect_service'])
  })

  it('a completed rollback, a needed recovery and an uncertain outcome get three different notices', async () => {
    const outcomes: [string, unknown, string | null][] = [
      ['service_error', failure('service_error'), 'migration_rolled_back'],
      ['recovery_required', failure('recovery_required'), 'migration_recovery'],
      ['operation_timeout', failure('operation_timeout'), 'migration_uncertain'],
      ['outcome_unknown', failure('outcome_unknown'), 'migration_uncertain'],
      ['transport', undefined, 'migration_uncertain'],
      ['service_ownership_unknown', failure('service_ownership_unknown'), null],
      ['service_config_mismatch', failure('service_config_mismatch'), null],
    ]
    for (const [label, response, notice] of outcomes) {
      const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
        .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      if (response === undefined) invoke.mockRejectedValueOnce('transport')
      else invoke.mockResolvedValueOnce(response)
      invoke.mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection())
      const { desktop, service } = await boot(invoke)
      await service.autoMigrateOnce()
      expect(service.state.notice, label).toBe(notice)
      expect(desktop.state.error?.code, label).toBe(label === 'transport' ? 'transport' : label)
      expect(invoke.mock.calls.filter(call => call[0] === 'migrate_service'), label).toHaveLength(1)
      expect(JSON.stringify(service.state), label).not.toContain('RAW_SENTINEL')
    }
    expect(isUncertain(null)).toBe(false)
  })

  it('a refusal is reported once, never retried, and leaves the facts read-only', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(failure('service_ownership_unknown'))
      .mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection(foreign))
    const { desktop, service } = await boot(invoke)
    await service.autoMigrateOnce()
    await service.autoMigrateOnce()
    expect(desktop.state.error?.code).toBe('service_ownership_unknown')
    expect(service.state.notice).toBeNull()
    expect(service.state.facts?.registration).toBe('unknown')
    expect(service.readonly()).toBe(true)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'migrate_service', 'inspect_setup', 'inspect_service'])
  })

  it('both mutations use the desktop guard and never replay an uncertain outcome', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      .mockRejectedValueOnce('operation_timeout').mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(wrap(stopped)).mockResolvedValueOnce(inspection(unregistered))
    const { desktop, service } = await boot(invoke)
    await service.inspect()
    expect(await service.migrate()).toBe(false)
    expect(desktop.state.outcomeUnknown).toBe(true)
    expect(service.state.notice).toBe('migration_uncertain')
    expect(await service.uninstall()).toBe(true)
    expect(desktop.state.profile).toEqual(stopped)
    expect(service.state.facts).toEqual(unregistered)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'migrate_service', 'inspect_setup', 'inspect_service', 'uninstall_service', 'inspect_service'])
  })

  it('a stale profile blocks both mutations before any IPC', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection()).mockRejectedValueOnce('transport')
    const { desktop, service } = await boot(invoke)
    await service.inspect()
    await desktop.refresh()
    expect(desktop.state.stale).toBe(true)
    expect(await service.migrate()).toBe(false)
    expect(await service.uninstall()).toBe(false)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_binding', 'inspect_service', 'inspect_setup'])
  })

  it('clear drops the facts and the notice of the previous home', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(wrap(running)).mockResolvedValueOnce(inspection(current))
    const { service } = await boot(invoke)
    await service.autoMigrateOnce()
    expect(service.state.notice).toBe('migrated')
    service.clear()
    expect(service.state.facts).toBeNull()
    expect(service.state.factsAt).toBeNull()
    expect(service.state.notice).toBeNull()
    expect(service.state.error).toBeNull()
    expect(service.readonly()).toBe(true)
  })

  it('dispose stops every late write into the state', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(own).mockResolvedValueOnce(inspection())
    const { service } = await boot(invoke)
    service.dispose()
    await service.inspect()
    expect(service.state.facts).toBeNull()
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup'])
  })
})
