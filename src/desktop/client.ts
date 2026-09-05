import { DesktopFailure, safeFailure } from './messages'
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
export type Status = 'unconfigured' | 'recovery_required' | 'quota_exhausted' | 'running' | 'stopped' | 'service_error'
export interface Profile {
  configured: boolean
  status: Status
  desired_service: 'running' | 'stopped' | null
  service_running: boolean
  quota_remaining: number | null
  quota_checked_at: number | null
  revision: string | null
}
export interface RuntimeInfo { core_version: string; build_id: string }
export const validToken = (token: string) => /^[\x21-\x7e]{4,4096}$/.test(token)
const statuses = new Set(['unconfigured', 'recovery_required', 'quota_exhausted', 'running', 'stopped', 'service_error'])
const profileKeys = ['configured', 'status', 'desired_service', 'service_running', 'quota_remaining', 'quota_checked_at', 'revision']
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function nullableNumber(value: unknown) { return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) }
function profile(value: unknown): Profile {
  if (!record(value) || Object.keys(value).length !== 7 || !profileKeys.every(key => Object.hasOwn(value, key)) || typeof value.configured !== 'boolean' || typeof value.service_running !== 'boolean' || typeof value.status !== 'string' || !statuses.has(value.status) || ![null, 'running', 'stopped'].includes(value.desired_service as null | string) || !nullableNumber(value.quota_remaining) || !nullableNumber(value.quota_checked_at) || !(value.revision === null || typeof value.revision === 'string' && /^[0-9a-f]{32}$/.test(value.revision))) throw new DesktopFailure('protocol')
  return value as unknown as Profile
}
export class DesktopClient {
  constructor(private readonly invoke: Invoke) {}
  private async call(command: string, args?: Record<string, unknown>): Promise<unknown> {
    try { return args ? await this.invoke(command, args) : await this.invoke(command) }
    catch (error) { throw safeFailure(error) }
  }
  private async readProfile(command: string, args?: Record<string, unknown>): Promise<Profile> {
    const response = await this.call(command, args)
    if (!record(response) || Object.keys(response).length !== 2) throw new DesktopFailure('protocol')
    if (response.kind === 'error') throw safeFailure(response.data)
    if (response.kind !== 'profile') throw new DesktopFailure('protocol')
    return profile(response.data)
  }
  async prepare(): Promise<RuntimeInfo> {
    const result = await this.call('prepare_desktop')
    if (!record(result) || Object.keys(result).length !== 2 || result.core_version !== '0.7.20' || typeof result.build_id !== 'string' || !/^[0-9a-f]{64}$/.test(result.build_id)) throw new DesktopFailure('protocol')
    return result as unknown as RuntimeInfo
  }
  inspect() { return this.readProfile('inspect_setup') }
  async configure(token: string) {
    if (!validToken(token)) throw new DesktopFailure('invalid_token_input')
    return this.readProfile('configure_setup', { credentials: { token } })
  }
  async replace(token: string) {
    if (!validToken(token)) throw new DesktopFailure('invalid_token_input')
    return this.readProfile('replace_credentials', { credentials: { token } })
  }
  start() { return this.readProfile('start_service') }
  stop() { return this.readProfile('stop_service') }
  repair() { return this.readProfile('repair_service') }
  async openTokenPage() { await this.call('open_token_page') }
}
