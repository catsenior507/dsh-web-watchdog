// test-host.mjs — 端到端测试用的『假宿主』：应用插件后常驻，等待监督进程接管
import { apply } from './lib/index.js'
import { appendFileSync } from 'node:fs'

if (process.env.DSH_WD_MARKER !== undefined) {
  appendFileSync(process.env.DSH_WD_MARKER, 'boot pid=' + process.pid + ' at=' + new Date().toISOString() + '\n')
}
const ctx = { effect: () => {}, on: () => {} }
apply(ctx)
setInterval(() => {}, 1000)
