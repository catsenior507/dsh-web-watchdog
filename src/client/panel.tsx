import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { WatchdogStatus } from '../shared/types'
import css from './styles.module.css'

export function WatchdogPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<WatchdogStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = setInterval(() => void refresh(), 10000)
    return () => clearInterval(timer)
  }, [open, refresh])

  const restart = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.restart()
      setNotice(res.message)
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const sv = status?.supervisor

  return (
    <>
      <button
        type="button"
        className={css.wdLauncher}
        title="dsh web 看护（崩溃记录 + 自动重启）"
        onClick={() => setOpen((value) => !value)}
      >
        🛡
      </button>

      {open && (
        <div id="dsh-watchdog-panel" className={css.wdPanel}>
          <div className={css.wdTitlebar}>
            <span className={css.wdTitle}>🛡 dsh web 看护</span>
            <div className={css.wdSpacer} />
            <button type="button" className={css.wdWinBtn} title="关闭" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className={css.wdBody}>
            {error !== null && <div className={css.wdErrorBanner}>看护服务不可达：{error}</div>}
            {notice !== null && <div className={`${css.wdChip} ${css.wdChipGreen}`} style={{ marginBottom: 8, display: 'inline-flex' }}>✔ {notice}</div>}

            <div className={css.wdCard}>
              <div className={css.wdCardTitle}>📡 状态</div>
              <div className={css.wdGrid}>
                <span className={css.wdMuted}>宿主进程（dsh web）</span><span className={css.wdMono}>PID {status?.hostPid ?? '—'}</span>
                <span className={css.wdMuted}>监督进程</span>
                <span>
                  <span className={`${css.wdDot} ${sv?.alive === true ? css.wdDotOk : css.wdDotBad}`} />
                  {sv?.alive === true ? `在线（PID ${sv.pid}）` : '离线'}{' '}
                  {sv?.alive === true && <span className={`${css.wdChip} ${css.wdChipGreen}`}>自动重启已启用</span>}
                </span>
                <span className={css.wdMuted}>崩溃日志</span><span className={css.wdMono}>{status?.config.crashLog ?? '—'}</span>
                <span className={css.wdMuted}>连续重启上限</span><span>{status?.config.maxRestarts ?? '—'} 次（退避 {status?.config.backoffStartSec ?? '—'}s → {status?.config.backoffMaxSec ?? '—'}s）</span>
              </div>
            </div>

            <div className={css.wdCard}>
              <div className={css.wdCardTitle}>📜 崩溃记录（最近 30 条）</div>
              <pre className={css.wdLogBox}>{(status?.crashLogTail ?? []).join('\n') || '（暂无记录）'}</pre>
            </div>

            <div className={css.wdRow}>
              <button type="button" className={`${css.wdBtn} ${css.wdBtnSmall}`} onClick={() => void refresh()}>↻ 刷新</button>
              {confirming ? (
                <>
                  <span className={`${css.wdChip} ${css.wdChipAmber}`}>确认计划重启 dsh web？（浏览器将短暂断线，监督进程会自动拉起）</span>
                  <button type="button" className={`${css.wdBtn} ${css.wdBtnDanger} ${css.wdBtnSmall}`} disabled={busy} onClick={() => void restart()}>确认重启</button>
                  <button type="button" className={`${css.wdBtn} ${css.wdBtnSmall}`} onClick={() => setConfirming(false)}>取消</button>
                </>
              ) : (
                <button type="button" className={`${css.wdBtn} ${css.wdBtnDanger} ${css.wdBtnSmall}`} onClick={() => setConfirming(true)}>⚡ 计划重启</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
