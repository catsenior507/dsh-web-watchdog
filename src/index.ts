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
import { execFileSync, spawn } from 'node:child_process'
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
    /**
     * 新宿主的就绪探针。重启后用它确认宿主真的在对外服务，
     * 而不是只看进程还在 —— 后者会把「起来了但不健康」的宿主当成好的。
     */
    healthUrl: string
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
      // 默认空 = 不做 HTTP 探针。探针 URL 配错会把正常宿主判成不健康，
      // 而看门狗对不健康宿主的处置是杀掉它 —— 一个错误的默认值足以让看护
      // 反过来变成破坏。要启用探针，设 DSH_WATCHDOG_HEALTH_URL。
      healthUrl: process.env.DSH_WATCHDOG_HEALTH_URL ?? '',
    },
  }
}

function supervisorScriptPath(): string {
  return fileURLToPath(new URL('../assets/supervisor.ps1', import.meta.url))
}

/**
 * 启动（或复用）监督进程。
 * 用 WMI Win32_Process.Create 创建：新进程的父进程是 WmiPrvSE.exe（WMI 服务宿主），
 * 天然脱离宿主的作业对象——宿主被 Stop-Process -Force 杀掉时监督进程不受牵连，
 * 且权限正常、可以写 pid/日志文件。
 * 为什么不用 spawn：detached:true 在本机沙箱会被降权无法写文件；
 * 普通非分离 spawn 的子进程与宿主同属一个作业对象，会随宿主一起死——
 * 两者都无法让监督进程在宿主死后存活并完成重启。
 */
/**
 * 用户点过「彻底关闭」之后留下的闸门文件。
 *
 * 面板每 10 秒轮询一次 /status，而 /status 会调用 ensureSupervisor —— 没有这道
 * 闸门的话，关闭请求会被下一次轮询立刻撤销，看门狗又活过来。
 * 闸门是持久的：要重新启用看护，删掉这个文件即可。
 * @param config - 看门狗配置。
 * @returns 闸门文件路径。
 */
function stopFlagPath(config: WatchdogConfig): string {
  return join(config.dataDir, 'shutdown.flag')
}

/**
 * Find a supervisor that is already running, whatever the pid file says.
 *
 * The pid file is bookkeeping, not truth. Measured 2026-10-15: it read 7644 for
 * days while six successive supervisors ran and exited, so the supervisor never
 * writes it at all - that value predated every one of them. `isProcessAlive`
 * therefore reported a dead pid on every check, and `/status` - which the panel
 * polls every ten seconds - spawned a fresh supervisor each time. Each spawn is
 * a PowerShell process, so the visible symptom was a console window flashing up
 * with errors every few seconds and closing itself again.
 *
 * Asking the OS who is actually running settles it: the live supervisor gets
 * adopted, its pid is written back, and the next check takes the cheap path.
 * @returns the live supervisor pid, or null when there is none.
 */
function findRunningSupervisor(): { pid: number; hostPid: number | null } | null {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*supervisor.ps1*' } | " +
        'ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" } | ' +
        'Select-Object -First 1)',
    ], { encoding: 'utf8', timeout: 15_000 })
    const line = out.trim()
    if (line === '') return null
    const sep = line.indexOf('|')
    const pid = Number(line.slice(0, sep))
    if (!Number.isInteger(pid) || pid <= 0) return null
    // Which host does it watch? That, not merely "a supervisor exists", is what
    // decides whether it is still the right one for this process.
    const host = /-HostPid\s+(\d+)/.exec(line.slice(sep + 1))
    return { pid, hostPid: host === null ? null : Number(host[1]) }
  } catch {
    // If the query itself fails, fall back to the pid file rather than
    // spawning blind: a duplicate supervisor is worse than a missing one.
    return null
  }
}

function ensureSupervisor(config: WatchdogConfig): void {
  if (existsSync(stopFlagPath(config))) return
  const pid = readPidFile(config.supervisor.pidFile)
  if (pid !== null && isProcessAlive(pid)) return
  // The recorded pid is not alive. Before spawning, check whether a supervisor
  // is running under a pid we simply failed to record: adopt it instead.
  const live = findRunningSupervisor()
  if (live !== null && live.hostPid === process.pid) {
    try { writeFileSync(config.supervisor.pidFile, String(live.pid), "utf8") } catch { /* bookkeeping only */ }
    return
  }
  if (live !== null) {
    // A supervisor is running, but it watches a host that is no longer this
    // one. Adopting it was the earlier mistake: it then refuses to restart the
    // live host, because the pid it stops belongs to a dead process - the
    // planned restart launched a second host that could not bind the port and
    // exited, leaving the original untouched. Retire it and start a fresh
    // supervisor bound to this process.
    try { process.kill(live.pid, 'SIGTERM') } catch { /* already gone */ }
    try { writeFileSync(config.supervisor.pidFile, '', 'utf8') } catch { /* bookkeeping only */ }
  }
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
  // PowerShell 5.1 的 -File 传空字符串会报「参数缺失」，空参数直接省略
  const restartArgs = config.supervisor.restartArgs.join(' ')
  if (restartArgs !== '') {
    args.splice(13, 0, '-RestartArgs', restartArgs)
  }
  // 就绪探针放在最后追加：上面那个 splice 依赖固定下标，插在它前面会错位。
  args.push('-HealthUrl', config.supervisor.healthUrl ?? 'http://127.0.0.1:3080/')

  // WMI 创建的进程不继承宿主环境变量：把环境快照落盘，
  // 监督进程重启宿主前先恢复（否则新 dsh web 会丢失 PATH/USERPROFILE 等）。
  const envFile = join(config.dataDir, 'host-env.json')
  try {
    writeFileSync(envFile, JSON.stringify(process.env), 'utf8')
    args.push('-EnvFile', envFile)
  } catch {
    // 写不了环境快照也不致命（宿主环境为空的极端情况）
  }

  // 组装 WMI 创建命令行：先做双引号转义（PowerShell 把 "" 解析为字面引号），
  // 再对整体做单引号转义（' → ''，用于嵌入 -Arguments 的单引号字符串）。
  const cmdline = ['powershell.exe', ...args]
    .map((arg) => '"' + arg.replace(/"/g, '""') + '"')
    .join(' ')
  const wmiCmd = "(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='" + cmdline.replace(/'/g, "''") + "'}).ReturnValue"

  // 用一个短命 powershell 发出 WMI 创建请求（stdio 忽略，避免受限环境下的管道 EPERM）；
  // 真正的监督进程由 WmiPrvSE 创建，独立于宿主。
  const caller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', wmiCmd], {
    stdio: 'ignore',
    windowsHide: true,
  })
  caller.on('error', (error) => {
    try {
      writeFileSync(config.supervisor.crashLog, '\n=== ' + new Date().toISOString() + ' | 监督进程启动失败: ' + String(error instanceof Error ? error.message : error) + ' ===\n', { flag: 'a' })
    } catch {
      // 忽略记录失败
    }
  })
  caller.unref()
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

/**
 * 彻底关闭：先停监督进程，再让宿主自己退出。
 *
 * 顺序不能反。监督进程的职责就是「宿主死了就把它拉起来」，先杀宿主的话它会在
 * 两秒内把宿主复活，用户看到的现象是「点了关闭，页面又回来了」。
 *
 * 宿主用 exit 0 退出，这是有意为之：监督进程把退出码 0 解释为正常关闭，
 * 于是它记一笔 EXIT-0 然后自己收工，不会重启。
 * @param config - 看门狗配置。
 * @returns 给面板的回执。
 */
function shutdownEverything(config: WatchdogConfig): { ok: boolean; message: string } {
  // 闸门先落盘，否则关闭过程中任何一次 ensureSupervisor 都会把它重新拉起来
  try {
    writeFileSync(stopFlagPath(config), new Date().toISOString(), 'utf8')
  } catch {
    // 写不动也要继续关闭，这是用户明确要求的事
  }
  const supervisorPid = readPidFile(config.supervisor.pidFile)
  let supervisorStopped = false
  if (supervisorPid !== null && isProcessAlive(supervisorPid)) {
    try {
      process.kill(supervisorPid)
      supervisorStopped = true
    } catch {
      // 停不掉就在回执里说明，不假装成功
    }
  }
  // 留一点时间让这个响应先发出去，然后宿主自己退出
  setTimeout(() => { process.exit(0) }, 900)
  return {
    ok: true,
    message:
      '看门狗已彻底关闭' +
      (supervisorStopped ? '（监督进程 ' + String(supervisorPid) + ' 已停止）' : '（没有在线的监督进程）') +
      '，后端与网页端将在 1 秒内退出。要重新启用看护，删除 ' + stopFlagPath(config) + ' 后重新启动 dsh web。',
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
        if (path === '/api/watchdog/shutdown' && req.method === 'POST') {
          sendJson(res, 200, shutdownEverything(config))
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
