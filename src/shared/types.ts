/** Shared wire types for the dsh-web-watchdog plugin. */

export interface WatchdogStatus {
  ok: boolean
  plugin: string
  hostPid: number
  hostStartedAt: string
  supervisor: {
    pid: number | null
    alive: boolean
    startedAt: string | null
  }
  config: {
    nodePath: string
    binPath: string
    restartArgs: string[]
    workdir: string
    logDir: string
    crashLog: string
    requestFlag: string
    maxRestarts: number
    backoffStartSec: number
    backoffMaxSec: number
  }
  crashLogTail: string[]
  message: string
}

export interface RestartResult {
  ok: boolean
  message: string
}
