import { describe, expect, it, vi } from 'vitest'
import { DesktopClient, type HomeReport, type Invoke, type Profile } from './client'
import { createDesktopState } from './state'
import { DEFAULT_HOME, createHomeState, outcomeOf } from './home'
import { DesktopFailure } from './messages'
import { envelope, homeAdoptable, homeAdoptable as report, prepared, running } from './fixtures'

const empty: Profile = { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }
const unsupported: HomeReport = { ...homeAdoptable, backend: 'aiograpi', adoptable: false, reason: 'home_backend_unsupported' }
const wrap = (data: Profile) => envelope('profile', data)
const inspection = (data: HomeReport) => envelope('home_inspection', data)
const names = (invoke: ReturnType<typeof vi.fn<Invoke>>) => invoke.mock.calls.map(call => call[0])
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

async function boot(invoke: ReturnType<typeof vi.fn<Invoke>>) {
  const client = new DesktopClient(invoke)
  const desktop = createDesktopState(client)
  await desktop.initialize()
  const invalidate = vi.fn()
  return { desktop, invalidate, home: createHomeState(client, desktop, { invalidate }) }
}

describe('home state', () => {
  it('starts on the default path with nothing checked', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
    const { home } = await boot(invoke)
    expect(home.state.path).toBe(DEFAULT_HOME)
    expect(home.state.checked).toBeNull()
    expect(home.state.checking).toBe(false)
  })

  it('refuses a path the host would reject, before any IPC', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
    const { home } = await boot(invoke)
    home.edit('relative/insto')
    await home.check()
    expect(home.state.error?.code).toBe('invalid_home_input')
    expect(home.state.checked).toBeNull()
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup'])
  })

  it('binds the report to the exact input it was inspected for and forgets it on any edit', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockResolvedValueOnce(inspection(report))
    const { home } = await boot(invoke)
    home.edit('/Users/x/.insto')
    await home.check()
    expect(home.state.checked).toEqual({ path: '/Users/x/.insto', report })
    home.edit('/Users/x/.insto2')
    expect(home.state.checked).toBeNull()
    expect(home.state.error).toBeNull()
    expect(await home.adopt()).toBe(false)
    expect(names(invoke)).toEqual(['prepare_desktop', 'inspect_setup', 'inspect_home'])
  })

  it('drops a late inspection issued for a superseded input', async () => {
    const wait = pending<unknown>()
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockReturnValueOnce(wait.promise)
    const { home } = await boot(invoke)
    home.edit('/Users/x/.insto')
    const request = home.check()
    expect(home.state.checking).toBe(true)
    home.edit('/Users/x/other')
    wait.resolve(inspection(report)); await request
    expect(home.state.checked).toBeNull()
    expect(home.state.checking).toBe(false)
    expect(home.state.path).toBe('/Users/x/other')
  })

  it('never runs a second inspection while one is in flight', async () => {
    const wait = pending<unknown>()
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockReturnValueOnce(wait.promise)
    const { home } = await boot(invoke)
    const first = home.check()
    await home.check()
    expect(await home.adopt()).toBe(false) // adoption is disabled while checking
    wait.resolve(inspection(report)); await first
    expect(invoke.mock.calls.filter(call => call[0] === 'inspect_home')).toHaveLength(1)
  })

  it('never adopts a report the core refused', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockResolvedValueOnce(inspection(unsupported))
    const { home, invalidate } = await boot(invoke)
    await home.check()
    expect(home.state.checked?.report.reason).toBe('home_backend_unsupported')
    expect(await home.adopt()).toBe(false)
    expect(invalidate).not.toHaveBeenCalled()
    expect(names(invoke)).not.toContain('select_home')
  })

  it('adopts the inspected path, not the text in the field, and invalidates before the call', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockResolvedValueOnce(inspection(report)).mockResolvedValueOnce(wrap(running))
    const { home, invalidate } = await boot(invoke)
    home.edit('/Users/x/.insto')
    await home.check()
    // The component routes every keystroke through `edit`, which clears `checked`.
    // Even a raw write straight to the field cannot smuggle a different path into
    // the selection: `adopt()` reads `checked.path` and nothing else.
    home.state.path = '/Users/x/typed-after'
    expect(await home.adopt()).toBe(true)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls.at(-1)).toEqual(['select_home', { home: { path: '/Users/x/.insto' } }])
    expect(home.state.checked).toBeNull()
  })

  it('releases with a null path and invalidates first', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(running))
      .mockResolvedValueOnce(wrap(empty))
    const { home, invalidate } = await boot(invoke)
    expect(await home.release()).toBe(true)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls.at(-1)).toEqual(['select_home', { home: { path: null } }])
  })

  it('surfaces a core refusal, drops the report and classifies the outcome', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
      .mockResolvedValueOnce(inspection(report))
      .mockResolvedValueOnce(envelope('error', { code: 'home_invalid', message: 'RAW_SENTINEL', retryable: false }))
      .mockResolvedValueOnce(wrap(empty))
    const { home } = await boot(invoke)
    await home.check()
    expect(await home.adopt()).toBe(false)
    expect(home.state.error?.code).toBe('home_invalid')
    expect(home.state.checked).toBeNull()
    expect(JSON.stringify(home.state)).not.toContain('RAW_SENTINEL')
    expect(outcomeOf(false, home.state.error)).toBe('refused')
  })

  it('classifies the three outcomes the App has to distinguish', () => {
    expect(outcomeOf(true, null)).toBe('selected')
    expect(outcomeOf(false, null)).toBe('refused')
    expect(outcomeOf(false, new DesktopFailure('home_invalid'))).toBe('refused')
    for (const code of ['operation_timeout', 'outcome_unknown', 'transport'] as const) {
      expect(outcomeOf(false, new DesktopFailure(code))).toBe('uncertain')
    }
  })
})
