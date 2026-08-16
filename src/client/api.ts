/** Browser-side API client for the dsh-web-watchdog host half. */
import type { RestartResult, WatchdogStatus } from '../shared/types'

const API_BASE = 'http://127.0.0.1:4795'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let body: unknown = {}
  if (text.trim() !== '') {
    try { body = JSON.parse(text) } catch { body = { raw: text } }
  }
  if (!res.ok) {
    const error = (body as { error?: string }).error ?? ('HTTP ' + res.status)
    throw new Error(error)
  }
  return body as T
}

export const api = {
  base: API_BASE,
  health: () => request<{ ok: boolean; dataDir: string }>('/api/health'),
  status: () => request<WatchdogStatus>('/api/watchdog/status'),
  log: (lines = 60) => request<{ ok: boolean; lines: string[]; crashLog: string }>('/api/watchdog/log?lines=' + lines),
  restart: () => request<RestartResult>('/api/watchdog/restart', { method: 'POST' }),
}
