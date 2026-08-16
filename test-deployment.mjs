// test-deployment.mjs — 真实部署形态端到端测试
// 监督进程由宿主（假 dsh web）通过插件的 WMI 机制拉起；
// 用 Stop-Process -Force 硬杀宿主，验证监督进程独立存活、写崩溃记录、自动拉起新宿主。
// 这正是 test-isolated.mjs 覆盖不到的真实形态（那里监督进程的父是常驻测试进程）。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dataDir = join(process.cwd(), 'wd-test-deploy')
const marker = join(dataDir, 'marker.txt')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  port: 4796,
  supervisor: { backoffStartSec: 3, backoffMaxSec: 15, maxRestarts: 5 },
}, null, 2))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = 0
const check = (name, cond, extra) => {
  if (cond) console.log('PASS', name)
  else { failed += 1; console.log('FAIL', name, extra ?? '') }
}
const readMarker = () => existsSync(marker) ? readFileSync(marker, 'utf8').trim().split(/\r?\n/).filter(Boolean) : []
const readCrash = () => existsSync(join(dataDir, 'crash.log')) ? readFileSync(join(dataDir, 'crash.log'), 'utf8') : ''
const getStatus = async () => {
  try {
    const r = await fetch('http://127.0.0.1:4796/api/watchdog/status')
    return { ok: true, body: await r.json() }
  } catch {
    return { ok: false, body: null }
  }
}
const killByPid = (pid) => { try { process.kill(pid) } catch { /* 已死 */ } }

console.log('[1] 启动假宿主（应用插件，插件通过 WMI 拉起监督进程）')
const host = spawn('node', ['test-host.mjs'], {
  env: { ...process.env, DSH_WATCHDOG_DATA: dataDir, DSH_WATCHDOG_PORT: '4796', DSH_WD_MARKER: marker },
  stdio: 'ignore',
})
for (let i = 0; i < 40 && readMarker().length < 1; i += 1) { await sleep(500) }
check('host booted', readMarker().length >= 1)
const hostPid1 = Number((readMarker()[0] ?? '').match(/pid=(\d+)/)?.[1] ?? 0)
await sleep(3000)
let st = await getStatus()
check('plugin API up + supervisor alive via WMI', st.ok && st.body?.supervisor?.alive === true, JSON.stringify(st.body?.supervisor))

console.log('[2] 硬杀宿主（模拟 Stop-Process -Force）')
killByPid(hostPid1)
await sleep(2000)
// 退避 3s 后监督进程应拉起新宿主（新宿主写 marker）
for (let i = 0; i < 50 && readMarker().length < 2; i += 1) { await sleep(500) }
const boots = readMarker()
check('supervisor survived and restarted host', boots.length >= 2, JSON.stringify(boots))
const crash = readCrash()
check('CRASH record written', crash.includes('CRASH') && crash.includes(String(hostPid1)), crash.slice(-300))
check('restart record written', crash.includes('[重启]'), crash.slice(-300))

console.log('[3] 计划重启（API → 标记 → 监督进程换新宿主）')
await sleep(2000)
const rr = await fetch('http://127.0.0.1:4796/api/watchdog/restart', { method: 'POST' })
check('restart API 200', rr.status === 200, 'got ' + rr.status)
for (let i = 0; i < 40 && readMarker().length < 3; i += 1) { await sleep(500) }
check('planned restart booted new host', readMarker().length >= 3, JSON.stringify(readMarker()))
const crash2 = readCrash()
check('PLANNED-RESTART record', crash2.includes('PLANNED-RESTART'), crash2.slice(-300))

console.log('[4] 新宿主与监督进程健在')
st = await getStatus()
check('status OK after restarts', st.ok && st.body?.supervisor?.alive === true, JSON.stringify(st.body))

console.log('[5] 清理：杀新宿主（它已由监督进程托管，杀掉后监督进程会再拉起——直接连监督进程一起停）')
const supPidFile = join(dataDir, 'supervisor.pid')
if (existsSync(supPidFile)) {
  const supPid = Number(readFileSync(supPidFile, 'utf8').trim())
  if (Number.isFinite(supPid) && supPid > 0) {
    try { process.kill(supPid) } catch {}
  }
}
await sleep(1000)
const boots3 = readMarker()
const lastPid = Number((boots3[boots3.length - 1] ?? '').match(/pid=(\d+)/)?.[1] ?? 0)
if (lastPid > 0) { try { process.kill(lastPid) } catch {} }
await sleep(500)

console.log(failed === 0 ? 'ALL TESTS PASSED' : failed + ' TESTS FAILED')
process.exit(failed === 0 ? 0 : 1)
