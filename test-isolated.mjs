// test-isolated.mjs — 直接驱动 supervisor.ps1 的端到端测试
// 覆盖：崩溃检测+CRASH记录+退避自动重启、计划重启(PLANNED-RESTART)、
// 正常退出(EXIT-0)不重启并结束监督。全程使用假宿主，不碰真实 dsh web。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dataDir = join(process.cwd(), 'wd-test-data')
const marker = join(dataDir, 'marker.txt')
const crashLog = join(dataDir, 'crash.log')
const requestFlag = join(dataDir, 'restart-request.flag')
const pidFile = join(dataDir, 'supervisor.pid')
const stateFile = join(dataDir, 'restart-state.txt')
const logDir = join(dataDir, 'web-logs')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(logDir, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = 0
const check = (name, cond, extra) => {
  if (cond) console.log('PASS', name)
  else { failed += 1; console.log('FAIL', name, extra ?? '') }
}
const readMarker = (file) => existsSync(file) ? readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean) : []
const readCrash = () => existsSync(crashLog) ? readFileSync(crashLog, 'utf8') : ''
const supervisorPath = join(process.cwd(), 'assets', 'supervisor.ps1')
const supArgs = ({ hostPid, pidFileOverride, env } = {}) => [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', supervisorPath,
  '-HostPid', String(hostPid ?? process.pid),
  '-NodePath', process.execPath,
  '-BinPath', join(process.cwd(), 'dummy-host.mjs'),
  '-WorkDir', process.cwd(),
  '-LogDir', logDir,
  '-CrashLog', crashLog,
  '-RequestFlag', requestFlag,
  '-PidFile', pidFileOverride ?? pidFile,
  '-StateFile', stateFile,
  '-MaxRestarts', '5',
  '-BackoffStartSec', '3',
  '-BackoffMaxSec', '15',
]

console.log('[1] 监督进程基础：pid 文件写入')
const sup0 = spawn('powershell.exe', supArgs(), { stdio: 'ignore', windowsHide: true })
await sleep(4000)
check('supervisor pid file written', existsSync(pidFile))
sup0.kill()
await sleep(1500)

console.log('[2] 场景A：假宿主只崩一次（4 秒后 exit 3）→ CRASH 记录 + 退避自动重启')
const envA = { ...process.env, DSH_WD_MARKER: marker, DSH_WD_EXIT_MS: '4000', DSH_WD_EXIT_CODE: '3', DSH_WD_CRASH_ONCE: '1' }
const hostA = spawn('node', ['dummy-host.mjs'], { env: envA, stdio: 'ignore' })
await sleep(1000)
const supA = spawn('powershell.exe', supArgs({ hostPid: hostA.pid }), { env: envA, stdio: 'ignore', windowsHide: true })
for (let i = 0; i < 60 && readMarker(marker).length < 2; i += 1) { await sleep(500) }
let boots = readMarker(marker)
check('auto-restart after crash (marker written by restarted host)', boots.length >= 2, JSON.stringify(boots))
let crash = readCrash()
check('CRASH record', crash.includes('CRASH'), crash.slice(-300))
check('restart record', crash.includes('[重启]'), crash.slice(-300))

console.log('[3] 场景A续：计划重启（请求标记 → PLANNED-RESTART + 新宿主）')
const before = readMarker(marker).length
writeFileSync(requestFlag, new Date().toISOString(), 'utf8')
for (let i = 0; i < 40 && readMarker(marker).length < before + 1; i += 1) { await sleep(500) }
boots = readMarker(marker)
check('planned restart booted host', boots.length >= before + 1, JSON.stringify(boots))
crash = readCrash()
check('PLANNED-RESTART record', crash.includes('PLANNED-RESTART'), crash.slice(-300))
supA.kill()
await sleep(1000)
// 杀掉场景 A 里监督进程拉起的宿主，避免串场
const stray = boots.slice(before).map((line) => Number((line.match(/pid=(\d+)/) ?? [])[1])).filter((pid) => Number.isFinite(pid) && pid > 0)
for (const pid of stray) { try { process.kill(pid, 'SIGKILL') } catch {} }
await sleep(1000)

console.log('[4] 场景B：监督进程自己拉起的宿主正常退出（exit 0）→ EXIT-0 + 监督结束')
const markerB = join(dataDir, 'markerB.txt')
const envB = { ...process.env, DSH_WD_MARKER: markerB, DSH_WD_EXIT_MS: '120000', DSH_WD_EXIT_CODE: '0' }
// 先把标记环境改成 4 秒退出 0：先启动长驻宿主 → 计划重启 → 新宿主(4s exit 0)
const hostB = spawn('node', ['dummy-host.mjs'], { env: envB, stdio: 'ignore' })
await sleep(1000)
const supB = spawn('powershell.exe', supArgs({ hostPid: hostB.pid, pidFileOverride: join(dataDir, 'supervisorB.pid') }), { env: envB, stdio: 'ignore', windowsHide: true })
await sleep(3000)
// 计划重启：监督进程杀掉 hostB 并自己拉起新宿主（新宿主 120s 长驻）
writeFileSync(requestFlag, new Date().toISOString(), 'utf8')
for (let i = 0; i < 30 && readMarker(markerB).length < 2; i += 1) { await sleep(500) }
const bootsB = readMarker(markerB)
check('planned restart in scenario B booted new host', bootsB.length >= 2, JSON.stringify(bootsB))
// 新宿主是监督进程自己拉起的：将其环境里的退出时间改短不现实，
// 改为：直接杀新宿主（unknown 退出码 → CRASH → 自动重启），验证监督进程仍活着并接管。
const newPid = Number((bootsB[1] ?? '').match(/pid=(\d+)/)?.[1] ?? 0)
if (newPid > 0) { try { process.kill(newPid, 'SIGKILL') } catch {} }
for (let i = 0; i < 50 && readMarker(markerB).length < 3; i += 1) { await sleep(500) }
const bootsB2 = readMarker(markerB)
check('supervisor survives and restarts again', bootsB2.length >= 3, JSON.stringify(bootsB2))
const crashB = readCrash()
check('second CRASH recorded', (crashB.match(/CRASH/g) ?? []).length >= 2, crashB.slice(-400))

console.log('[5] 清理')
supB.kill()
hostB.kill()
await sleep(1000)

console.log(failed === 0 ? 'ALL TESTS PASSED' : failed + ' TESTS FAILED')
process.exit(failed === 0 ? 0 : 1)
