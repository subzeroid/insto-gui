import { describe, expect, it, vi } from 'vitest'
import { CORE_VERSION, DesktopClient, type Profile } from './client'

export const unconfigured: Profile = { configured: false, status: 'unconfigured', desired_service: null, service_running: false, quota_remaining: null, quota_checked_at: null, revision: null }

describe('desktop boundary', () => {
  it('uses only named commands and sends credentials only in the credential argument', async () => {
    const invoke = vi.fn().mockResolvedValue({ kind: 'profile', data: unconfigured })
    const client = new DesktopClient(invoke)
    expect(await client.inspect()).toEqual(unconfigured)
    await client.configure('TOKEN_SENTINEL')
    await client.replace('NEW_SENTINEL')
    await client.start(); await client.stop(); await client.repair()
    expect(invoke.mock.calls).toEqual([
      ['inspect_setup'], ['configure_setup', { credentials: { token: 'TOKEN_SENTINEL' } }],
      ['replace_credentials', { credentials: { token: 'NEW_SENTINEL' } }],
      ['start_service'], ['stop_service'], ['repair_service'],
    ])
  })
  it('rejects invalid token before IPC without trimming it', async () => {
    const invoke = vi.fn()
    for (const token of ['', 'abc', 'abcd ', 'a\nbcd', '☃abc', 'a'.repeat(4097)]) {
      await expect(new DesktopClient(invoke).configure(token)).rejects.toMatchObject({ code: 'invalid_token_input' })
    }
    expect(invoke).not.toHaveBeenCalled()
  })
  it('never carries raw error messages or token sentinels', async () => {
    const invoke = vi.fn().mockRejectedValue({ code: 'outcome_unknown', message: 'TOKEN_SENTINEL /private/path' })
    await expect(new DesktopClient(invoke).stop()).rejects.toMatchObject({ code: 'outcome_unknown' })
    try { await new DesktopClient(invoke).stop() } catch (error) { expect(String(error)).not.toContain('TOKEN_SENTINEL') }
    invoke.mockResolvedValue({ kind: 'error', data: { code: 'invalid_token', message: 'TOKEN_SENTINEL', retryable: false } })
    await expect(new DesktopClient(invoke).inspect()).rejects.toMatchObject({ code: 'invalid_token' })
  })
  it('rejects malformed result and unsafe JavaScript integers', async () => {
    for (const data of [{}, { ...unconfigured, quota_remaining: 2 ** 64 }, { ...unconfigured, status: 'unknown' }, { ...unconfigured, status: ['running'] }, { ...unconfigured, secret: 'sentinel' }]) {
      const invoke = vi.fn().mockResolvedValue({ kind: 'profile', data })
      await expect(new DesktopClient(invoke).inspect()).rejects.toMatchObject({ code: 'protocol' })
    }
  })
  it('checks prepared runtime identity and opens only the fixed Rust action', async () => {
    const info = { core_version: CORE_VERSION, build_id: 'a'.repeat(64) }
    const invoke = vi.fn().mockResolvedValue(info)
    const client = new DesktopClient(invoke)
    expect(await client.prepare()).toEqual(info)
    await client.openTokenPage()
    expect(invoke.mock.calls).toEqual([['prepare_desktop'], ['open_token_page']])
  })
  it('canonicalizes usernames like the CLI and rejects the rest before IPC', async () => {
    const { canonicalUsername } = await import('./client')
    expect(canonicalUsername('@@Alice ')).toBe('alice')
    for (const raw of [' @alice', '.', '..', 'a b', 'ñ', 'a'.repeat(256), '']) expect(canonicalUsername(raw)).toBeNull()
    const invoke = vi.fn()
    const client = new DesktopClient(invoke)
    await expect(client.addWatch('Alice')).rejects.toMatchObject({ code: 'invalid_watch_input' })
    await expect(client.addWatch('alice', 299)).rejects.toMatchObject({ code: 'invalid_watch_input' })
    await expect(client.searchTargets('@alice')).rejects.toMatchObject({ code: 'invalid_history_input' })
    await expect(client.compareSnapshots('7', '1', '1')).rejects.toMatchObject({ code: 'invalid_history_input' })
    expect(invoke).not.toHaveBeenCalled()
  })
  it('sends exact C2 arguments and decodes kinds', async () => {
    const watch = { user: 'alice', status: 'active', interval_seconds: 300, last_ok: null, waiting_first_check: true, has_error: false, consecutive_errors: 0, revision: 'a'.repeat(64) }
    const invoke = vi.fn()
      .mockResolvedValueOnce({ kind: 'watch', data: watch })
      .mockResolvedValueOnce({ kind: 'removed', data: { removed_user: 'alice' } })
      .mockResolvedValueOnce({ kind: 'history_page', data: { items: [], next_cursor: null, scan_complete: true, scanned: 0 } })
      .mockResolvedValueOnce({ kind: 'watch', data: watch })
    const client = new DesktopClient(invoke)
    expect(await client.addWatch('alice', 600)).toEqual(watch)
    expect(await client.removeWatch({ user: 'alice', revision: 'a'.repeat(64) })).toBe('alice')
    expect((await client.listChanges({ target_pk: '7', limit: 10 })).scan_complete).toBe(true)
    await expect(client.overview()).rejects.toMatchObject({ code: 'protocol' })
    expect(invoke.mock.calls).toEqual([
      ['add_watch', { watch: { user: 'alice', interval_seconds: 600 } }],
      ['remove_watch', { watch: { user: 'alice', revision: 'a'.repeat(64) } }],
      ['list_changes', { query: { target_pk: '7', limit: 10 } }],
      ['read_overview'],
    ])
  })
  it('queues reads beyond two slots and hands a released slot to the next waiter', async () => {
    const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
    const pending: ((value: unknown) => void)[] = []
    const invoke = vi.fn(() => new Promise(resolve => { pending.push(resolve) }))
    const client = new DesktopClient(invoke)
    const overviewData = { configured: false, desired_service: null, service_state: 'unknown', quota_remaining: null, quota_checked_at: null, watches: [], next_cursor: null }
    const first = client.overview(), second = client.listChanges(), third = client.listWatches()
    await tick()
    expect(invoke).toHaveBeenCalledTimes(2)
    pending[0]({ kind: 'overview', data: overviewData })
    const fourth = client.overview() // issued during the hand-off: must wait, not take a third slot
    await first; await tick()
    expect(invoke).toHaveBeenCalledTimes(3)
    pending[1]({ kind: 'history_page', data: { items: [], next_cursor: null, scan_complete: true, scanned: 0 } })
    await second; await tick()
    expect(invoke).toHaveBeenCalledTimes(4)
    pending[2]({ kind: 'watch_page', data: { items: [], next_cursor: null } })
    pending[3]({ kind: 'overview', data: overviewData })
    await Promise.all([third, fourth])
  })
})
