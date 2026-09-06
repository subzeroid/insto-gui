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
})
