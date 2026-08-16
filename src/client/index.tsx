/**
 * dsh-web-watchdog client half: a small floating panel showing supervisor
 * status, crash history and a planned-restart button.
 */
import type { Context } from '@deepseek-ai/cordis'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WatchdogPanel } from './panel'
import './styles.module.css'

export function apply(ctx: Context): void {
  const mount = document.createElement('div')
  mount.dataset.dshWatchdogRoot = ''
  mount.setAttribute('aria-label', 'dsh web watchdog')
  document.body.append(mount)

  let root: Root | null = null
  try {
    root = createRoot(mount)
    root.render(React.createElement(WatchdogPanel))
  } catch {
    mount.remove()
    throw new Error('[dsh-web-watchdog] 挂载面板失败：React root 创建出错')
  }

  ctx.effect(() => () => {
    root?.unmount()
    mount.remove()
  }, 'ui-dsh-web-watchdog: panel lifecycle')
}
