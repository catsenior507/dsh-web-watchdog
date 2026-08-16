/**
 * dsh-web-watchdog host half: spawns a detached PowerShell supervisor that
 * watches THIS dsh web process. On abnormal exit (exit code != 0) the
 * supervisor records the crash (exit code + stderr/stdout tails + Windows
 * event log) to a crash log and restarts the web process with exponential
 * backoff. A request-flag file allows planned restarts. A tiny localhost
 * HTTP API exposes status / crash log / restart for the panel and scripts.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RestartResult, WatchdogStatus } from './shared/types'

export const name = 'dsh-web-watchdog'

const PLUGIN_ID = '@dsh-external/dsh-client-plugin-web-watchdog'
const DEFAULT_PORT = 4795

interface WatchdogConfig {
  port: number
  dataDir: string
  supervisor: {
    nodePath: string
    binPath: string
    restartArgs: string[]
    workdir: string
    logDir: string
    crashLog: string
    requestFlag: string
    pidFile: string
    stateFile: string
    maxRestarts: number
    backoffStartSec: number
    backoffMaxSec: number
  }
}

function defaultDataDir(): string {
  if (process.env.DSH_WATCHDOG_DATA !== undefined && process.env.DSH_WATCHDOG_DATA !== '') {
    return process.env.DSH_WATCHDOG_DATA
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd()
  return join(home, '.dsh', 'web-watchdog')
}

function defaultConfig(): WatchdogConfig {
  const dataDir = defaultDataDir()
  return {
    port: Number(process.env.DSH_WATCHDOG_PORT ?? DEFAULT_PORT),
    dataDir,
    supervisor: {
      nodePath: process.execPath,
      binPath: process.argv[1] ?? '',
      restartArgs: process.argv.slice(2),
      workdir: process.cwd(),
      logDir: join(dataDir, 'web-logs'),
      crashLog: join(dataDir, 'crash.log'),
      requestFlag: join(dataDir, 'restart-request.flag'),
      pidFile: join(dataDir, 'supervisor.pid'),
      stateFile: join(dataDir, 'restart-state.txt'),
      maxRestarts: 10,
      backoffStartSec: 10,
      backoffMaxSec: 600,
    },
  }
}

function supervisorScriptPath(): string {
  return fileURLToPath(new URL('../assets/supervisor.ps1', import.meta.url))
}

/** 启动（或复用）脱离进程的 PowerShell 监督进程；pid 文件里的进程还活着则复用。 */
function ensureSupervisor(config: WatchdogConfig): void {
  const pid = readPidFile(config.supervisor.pidFile)
  if (pid !== null && isProcessAlive(pid)) return
  const script = supervisorScriptPath()
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-HostPid', String(process.pid),
    '-NodePath', config.supervisor.nodePath,
    '-BinPath', config.supervisor.binPath,
    '-WorkDir', config.supervisor.workdir,
    '-LogDir', config.supervisor.logDir,
    '-CrashLog', config.supervisor.crashLog,
    '-RequestFlag', config.supervisor.requestFlag,
    '-PidFile', config.supervisor.pidFile,
    '-StateFile', config.supervisor.stateFile,
    '-MaxRestarts', String(config.supervisor.maxRestarts),
    '-BackoffStartSec', String(config.supervisor.backoffStartSec),
    '-BackoffMaxSec', String(config.supervisor.backoffMaxSec),
  ]
  // PowerShell 5.1 的 -File 传空字符串会报“参数缺失”，空参数直接省略
  const restartArgs = config.supervisor.restartArgs.join(' ')
  if (restartArgs !== '') {
    // 插到 -WorkDir 值之后、-LogDir 之前（命名参数位置无关，但不能拆开相邻的参数/值对）
    args.splice(13, 0, '-RestartArgs', restartArgs)
  }
  const child = spawn('powershell.exe', args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

function readPidFile(file: string): number | null {
  if (!existsSync(file)) return null
  try {
    const value = Number(readFileSync(file, 'utf8').trim())
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function crashLogTail(config: WatchdogConfig, lines: number): string[] {
  if (!existsSync(config.supervisor.crashLog)) return []
  try {
    const text = readFileSync(config.supervisor.crashLog, 'utf8')
    const all = text.split(/[\r\n]+/).filter((line) => line.trim() !== '')
    return all.slice(-lines)
  } catch {
    return []
  }
}

function buildStatus(config: WatchdogConfig): WatchdogStatus {
  const supervisorPid = readPidFile(config.supervisor.pidFile)
  const supervisorAlive = supervisorPid !== null && isProcessAlive(supervisorPid)
  return {
    ok: true,
    plugin: PLUGIN_ID,
    hostPid: process.pid,
    hostStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    supervisor: {
      pid: supervisorPid,
      alive: supervisorAlive,
      startedAt: null,
    },
    config: {
      nodePath: config.supervisor.nodePath,
      binPath: config.supervisor.binPath,
      restartArgs: config.supervisor.restartArgs,
      workdir: config.supervisor.workdir,
      logDir: config.supervisor.logDir,
      crashLog: config.supervisor.crashLog,
      requestFlag: config.supervisor.requestFlag,
      maxRestarts: config.supervisor.maxRestarts,
      backoffStartSec: config.supervisor.backoffStartSec,
      backoffMaxSec: config.supervisor.backoffMaxSec,
    },
    crashLogTail: crashLogTail(config, 30),
    message: supervisorAlive ? '监督进程在线' : '监督进程未运行（将在下次健康检查时拉起）',
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

export function apply(ctx: Context): void {
  const base = defaultConfig()
  mkdirSync(base.dataDir, { recursive: true })

  const configFile = join(base.dataDir, 'config.json')
  if (!existsSync(configFile)) {
    writeFileSync(configFile, JSON.stringify(base, null, 2), 'utf8')
  }
  let fileConfig: Partial<WatchdogConfig> = {}
  try {
    fileConfig = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<WatchdogConfig>
  } catch {
    fileConfig = {}
  }
  const config: WatchdogConfig = {
    ...base,
    ...fileConfig,
    supervisor: { ...base.supervisor, ...(fileConfig.supervisor ?? {}) },
    dataDir: base.dataDir,
  }

  ensureSupervisor(config)
  const recheck = setInterval(() => ensureSupervisor(config), 30000)

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        if (req.method === 'OPTIONS') {
          sendJson(res, 204, {})
          return
        }
        if (path === '/api/health' && req.method === 'GET') {
          sendJson(res, 200, { ok: true, plugin: PLUGIN_ID, port: config.port, dataDir: config.dataDir })
          return
        }
        if (path === '/api/watchdog/status' && req.method === 'GET') {
          ensureSupervisor(config)
          sendJson(res, 200, buildStatus(config))
          return
        }
        if (path === '/api/watchdog/log' && req.method === 'GET') {
          const lines = Math.min(Math.max(Number(url.searchParams.get('lines') ?? 50), 1), 500)
          sendJson(res, 200, { ok: true, lines: crashLogTail(config, lines), crashLog: config.supervisor.crashLog })
          return
        }
        if (path === '/api/watchdog/restart' && req.method === 'POST') {
          ensureSupervisor(config)
          try {
            writeFileSync(config.supervisor.requestFlag, new Date().toISOString(), 'utf8')
          } catch {
            // 标记写失败几乎不可能；忽略
          }
          const body: RestartResult = {
            ok: true,
            message: '重启请求已发送：监督进程将在 2 秒内停止并重新拉起 dsh web（浏览器会短暂断线，请稍候刷新页面）',
          }
          sendJson(res, 200, body)
          return
        }
        sendJson(res, 404, { error: '未知 API 路径' })
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })

  server.listen(config.port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log('[dsh-web-watchdog] API on http://127.0.0.1:' + config.port + ' (data: ' + config.dataDir + ')')
  })
  server.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('[dsh-web-watchdog] server error:', error instanceof Error ? error.message : error)
  })

  ctx.effect(() => () => {
    clearInterval(recheck)
    server.close()
  })
}
