import { describe, expect, it, vi } from 'vitest'
import { CORE_VERSION, DesktopClient, type Profile } from './client'
import { createDesktopState } from './state'

const empty: Profile = { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }
const stopped: Profile = { configured: true, status: 'stopped', desired_service: 'stopped', service_running: false, quota_remaining: 10, quota_checked_at: 100, revision: 'a'.repeat(32) }
const wrap = (data: Profile) => ({ kind: 'profile', data })
const prepared = { core_version: CORE_VERSION, build_id: 'a'.repeat(64) }
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('desktop state', () => {
  it('dispose during initial inspection cannot reopen the closed state', async () => {
    const wait = pending<unknown>()
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockReturnValueOnce(wait.promise)
    const ui = createDesktopState(new DesktopClient(invoke))
    const request = ui.initialize()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('inspect_setup')
    ui.dispose(); wait.resolve(wrap(stopped)); await request
    expect(ui.state.phase).toBe('closed')
    expect(ui.state.profile).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('startup only prepares and inspects; stopped intent is preserved', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize()
    expect(ui.state.phase).toBe('ready')
    expect(ui.state.profile).toEqual(stopped)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup'])
  })
  it('does not queue a duplicate mutation', async () => {
    const wait = pending<unknown>()
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty)).mockReturnValueOnce(wait.promise)
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize()
    const first = ui.configure('TOKEN_SENTINEL')
    expect(ui.state.busy).toBe(true)
    expect(await ui.configure('SECOND_SENTINEL')).toBe(false)
    wait.resolve(wrap(stopped)); expect(await first).toBe(true)
    expect(invoke.mock.calls.filter(call => call[0] === 'configure_setup')).toHaveLength(1)
    expect(JSON.stringify(ui.state)).not.toContain('SENTINEL')
  })
  it('reconciles unknown mutation by a read, never replay', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty)).mockRejectedValueOnce('outcome_unknown').mockResolvedValueOnce(wrap(stopped))
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize(); expect(await ui.configure('TOKEN_SENTINEL')).toBe(false)
    expect(ui.state.outcomeUnknown).toBe(true)
    expect(ui.state.profile).toEqual(stopped)
    expect(ui.state.stale).toBe(false)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'configure_setup', 'inspect_setup'])
  })
  it('preserves cached data on failed refresh and blocks writes while stale', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockRejectedValueOnce('transport')
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize(); const last = ui.state.lastReadAt
    await ui.refresh()
    expect(ui.state.profile).toEqual(stopped)
    expect(ui.state.stale).toBe(true)
    expect(ui.state.lastReadAt).toBe(last)
    expect(await ui.start()).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(3)
  })
  it('saved configuration with failed start switches to recovery without a new token request', async () => {
    const recovery = { ...stopped, status: 'recovery_required' as const }
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty)).mockResolvedValueOnce({ kind: 'error', data: { code: 'service_error', message: 'sentinel', retryable: false } }).mockResolvedValueOnce(wrap(recovery))
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize(); await ui.configure('TOKEN_SENTINEL')
    expect(ui.state.profile).toEqual(recovery)
    expect(ui.state.error?.code).toBe('service_error')
    expect(JSON.stringify(ui.state)).not.toContain('sentinel')
  })
  it('dispose ignores late results without issuing service stop', async () => {
    const wait = pending<unknown>()
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty)).mockReturnValueOnce(wait.promise)
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize(); const request = ui.configure('TOKEN_SENTINEL')
    ui.dispose(); wait.resolve(wrap(stopped)); await request
    expect(ui.state.phase).toBe('closed')
    expect(ui.state.profile).toEqual(empty)
    expect(invoke.mock.calls.some(call => call[0] === 'stop_service')).toBe(false)
  })
  it('counts every successful profile read so a later reader can tell fresh from retained', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped))
      .mockResolvedValueOnce(wrap(stopped)).mockRejectedValueOnce('transport')
    const ui = createDesktopState(new DesktopClient(invoke))
    expect(ui.state.reads).toBe(0)
    await ui.initialize()
    expect(ui.state.reads).toBe(1)
    await ui.refresh()
    expect(ui.state.reads).toBe(2)
    await ui.refresh()
    expect(ui.state.reads).toBe(2) // a failed read is not a read
    expect(ui.state.stale).toBe(true)
  })
  it('exposes the raw mutation guard for the service and home states', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(stopped)).mockResolvedValueOnce(wrap(stopped))
    const client = new DesktopClient(invoke)
    const ui = createDesktopState(client)
    await ui.initialize()
    expect(await ui.mutate(() => client.migrateService())).toBe(true)
    expect(ui.state.reads).toBe(2)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'migrate_service'])
  })
  it('releases the bound home after a failed initialization and starts over', async () => {
    // The core inspection fails because the bound home is unusable; `select_home`
    // with a null path is exactly the escape the core supports for that state.
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockRejectedValueOnce({ code: 'home_invalid' })
      .mockResolvedValueOnce(wrap(empty)).mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty))
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize()
    expect(ui.state.phase).toBe('failed')
    expect(await ui.releaseBinding()).toBe(true)
    expect(ui.state.phase).toBe('ready')
    expect(ui.state.profile).toEqual(empty)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['prepare_desktop', 'inspect_setup', 'select_home', 'prepare_desktop', 'inspect_setup'])
    expect(invoke.mock.calls[2][1]).toEqual({ home: { path: null } })
  })
  it('a refused release keeps its reason and does not restart initialization', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockRejectedValueOnce({ code: 'home_invalid' })
      .mockRejectedValueOnce({ code: 'profile_busy' })
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize()
    expect(await ui.releaseBinding()).toBe(false)
    expect(ui.state.error?.code).toBe('profile_busy')
    expect(ui.state.phase).toBe('failed')
    expect(invoke).toHaveBeenCalledTimes(3)
  })
  it('a release never runs while another mutation is in flight and never after dispose', async () => {
    const wait = pending<unknown>()
    const invoke = vi.fn().mockResolvedValueOnce(prepared).mockResolvedValueOnce(wrap(empty)).mockReturnValueOnce(wait.promise)
    const ui = createDesktopState(new DesktopClient(invoke))
    await ui.initialize()
    const first = ui.configure('TOKEN_SENTINEL')
    expect(await ui.releaseBinding()).toBe(false)
    wait.resolve(wrap(stopped)); await first
    ui.dispose()
    expect(await ui.releaseBinding()).toBe(false)
    expect(invoke.mock.calls.some(call => call[0] === 'select_home')).toBe(false)
  })
})
