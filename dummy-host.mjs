// dummy-host.mjs — 测试用假宿主
// 行为：
//  - DSH_WD_CRASH_ONCE=1：第一次启动 N 毫秒后以退出码 3 崩溃；重启后长驻（只崩一次）
//  - 否则：DSH_WD_EXIT_MS 毫秒后以 DSH_WD_EXIT_CODE 退出（默认 60s 后 exit 0）
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const marker = process.env.DSH_WD_MARKER
const delay = Number(process.env.DSH_WD_EXIT_MS ?? '60000')
const exitCode = Number(process.env.DSH_WD_EXIT_CODE ?? '0')
if (marker !== undefined && marker !== '') {
  appendFileSync(marker, 'boot pid=' + process.pid + ' at=' + new Date().toISOString() + '\n')
}
if (process.env.DSH_WD_CRASH_ONCE === '1') {
  const counterFile = join(marker !== undefined ? String(marker).replace(/[^\\/]+$/, '') : '.', 'crash-once-count.txt')
  let count = 0
  try { count = Number(readFileSync(counterFile, 'utf8').trim()) } catch {}
  count += 1
  writeFileSync(counterFile, String(count), 'utf8')
  if (count === 1) {
    setTimeout(() => { process.exit(3) }, delay)
  } else {
    setInterval(() => {}, 1000)   // 重启后长驻
  }
} else {
  setTimeout(() => { process.exit(exitCode) }, delay)
  setInterval(() => {}, 1000)
}
