# supervisor.ps1 — dsh web watchdog 监督进程（由 dsh-web-watchdog 插件托管生成）
# 职责：监督宿主进程（dsh web）。宿主异常退出（退出码 != 0）→ 记录 CRASH
# （退出码 + stderr/stdout 末尾 + Windows 事件日志）→ 指数退避后自动重启；
# 请求标记文件出现 → 视为计划重启（记录 PLANNED-RESTART，立即重启）。
# 交接：重启后若新宿主已拉起自己的监督进程（pid 文件被他人接管），本进程退出。
param(
  [Parameter(Mandatory=$true)][int]$HostPid,          # 被监督的宿主进程 PID
  [Parameter(Mandatory=$true)][string]$NodePath,      # node.exe 绝对路径
  [Parameter(Mandatory=$true)][string]$BinPath,       # dsh bin.js 绝对路径（或任意宿主入口脚本）
  [Parameter(Mandatory=$true)][string]$WorkDir,       # 宿主工作目录
  [string]$RestartArgs = '',                          # 重启参数（空格分隔，追加在 BinPath 后；空 = 不追加）
  [Parameter(Mandatory=$true)][string]$LogDir,        # 每次运行的 out/err 日志目录
  [Parameter(Mandatory=$true)][string]$CrashLog,      # 崩溃记录文件
  [Parameter(Mandatory=$true)][string]$RequestFlag,   # 计划重启请求标记
  [Parameter(Mandatory=$true)][string]$PidFile,       # 监督进程自身的 pid 文件（交接信号）
  [Parameter(Mandatory=$true)][string]$StateFile,     # 连续崩溃计数（跨监督进程持久化）
  [int]$MaxRestarts = 10,
  [int]$BackoffStartSec = 10,
  [int]$BackoffMaxSec = 600
)

$ErrorActionPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force $LogDir | Out-Null
Set-Content -Path $PidFile -Value $PID -Encoding ASCII
$script:lastProc = $null
$script:lastOut = ''
$script:lastErr = ''

if (-not (Test-Path $CrashLog)) {
  Set-Content -Path $CrashLog -Value '# dsh web watchdog 异常退出记录' -Encoding UTF8
}

function Write-Record([string]$procId, [string]$exitCode, [string]$kind, [string]$outFile, [string]$errFile) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $record = @('', ('=' * 80), "时间: $stamp | PID: $procId | 退出码: $exitCode | 类型: $kind")
  if ($kind -eq 'CRASH') {
    $record += '--- stderr 末尾 40 行 ---'
    $record += (Get-Content $errFile -Tail 40 -ErrorAction SilentlyContinue)
    $record += '--- stdout 末尾 20 行 ---'
    $record += (Get-Content $outFile -Tail 20 -ErrorAction SilentlyContinue)
    $events = Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000} -MaxEvents 5 -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match $procId }
    if ($events) {
      $record += '--- Windows 事件日志 (Application Error 1000) ---'
      foreach ($evt in $events) {
        $firstLine = ($evt.Message -split "`r?`n")[0]
        $record += ($evt.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss') + ' | ' + $firstLine)
      }
    }
  }
  $record += ('=' * 80)
  Add-Content -Path $CrashLog -Value $record -Encoding UTF8
}

function Get-RestartCount {
  if (Test-Path $StateFile) {
    $value = Get-Content $StateFile -Raw
    $parsed = 0
    if ([int]::TryParse($value.Trim(), [ref]$parsed)) { return $parsed }
  }
  return 0
}

function Set-RestartCount([int]$value) {
  Set-Content -Path $StateFile -Value $value -Encoding ASCII
}

function Start-Host([string]$stamp) {
  $outFile = Join-Path $LogDir "host-$stamp.out.log"
  $errFile = Join-Path $LogDir "host-$stamp.err.log"
  $argsList = @('--no-warnings', $BinPath)
  if ($RestartArgs.Trim() -ne '') { $argsList += ($RestartArgs.Trim() -split '\s+') }
  $proc = Start-Process -FilePath $NodePath -ArgumentList $argsList `
    -WorkingDirectory $WorkDir -WindowStyle Hidden `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru
  $script:lastProc = $proc
  $script:lastOut = $outFile
  $script:lastErr = $errFile
  return $proc
}

function Test-Handoff([int]$selfPid) {
  # 新宿主可能已拉起新的监督进程并覆盖 pid 文件 → 本进程让位退出
  if (Test-Path $PidFile) {
    $current = Get-Content $PidFile | Select-Object -First 1
    if ($current -and ($current -ne $selfPid) -and (Get-Process -Id $current -ErrorAction SilentlyContinue)) {
      return $true
    }
  }
  return $false
}

function Get-ExitCode([System.Diagnostics.Process]$procObj) {
  if ($null -eq $procObj) { return 'unknown' }
  try { $procObj.Refresh(); return $procObj.ExitCode } catch { return 'unknown' }
}

Write-Output "[supervisor] 启动：监督 PID $HostPid，日志 $CrashLog"
$restartCount = Get-RestartCount
$healthySince = Get-Date

while ($true) {
  # 等待宿主退出；返回非空 = 收到计划重启请求
  $alive = $null
  while ($true) {
    Start-Sleep -Seconds 2
    $check = Get-Process -Id $HostPid -ErrorAction SilentlyContinue
    if ($null -eq $check) { break }
    if (Test-Path $RequestFlag) { $alive = $check; break }
  }
  $wasPlanned = ($null -ne $alive)

  if ($wasPlanned) {
    Write-Output "[supervisor] 计划重启：停止宿主 PID $HostPid"
    Stop-Process -Id $HostPid -Force
    $deadline = (Get-Date).AddSeconds(20)
    do { Start-Sleep -Milliseconds 500; $p = Get-Process -Id $HostPid -ErrorAction SilentlyContinue } while ($null -ne $p -and (Get-Date) -lt $deadline)
    Write-Record $HostPid 'killed' 'PLANNED-RESTART' $script:lastOut $script:lastErr
    $restartCount = 0
    Set-RestartCount 0
  } else {
    # 宿主已退出：判断正常还是崩溃
    $exitCode = Get-ExitCode $script:lastProc
    $isCrash = ($exitCode -ne 0)
    if ($isCrash) {
      if (((Get-Date) - $healthySince).TotalSeconds -lt 60) { $restartCount += 1 } else { $restartCount = 1 }
      Set-RestartCount $restartCount
      Write-Record $HostPid $exitCode 'CRASH' $script:lastOut $script:lastErr
      if ($restartCount -gt $MaxRestarts) {
        $msg = "[supervisor] 连续崩溃 $MaxRestarts 次，停止自动重启，请排查：$CrashLog"
        Add-Content -Path $CrashLog -Value $msg -Encoding UTF8
        Write-Output $msg
        exit 1
      }
      $delay = [math]::Min($BackoffStartSec * [math]::Pow(2, $restartCount - 1), $BackoffMaxSec)
      Write-Output "[supervisor] $($delay)s 后自动重启（第 $restartCount 次）"
      Start-Sleep -Seconds $delay
    } else {
      # 正常退出（exit 0）：记录后不重启，监督结束
      Write-Record $HostPid $exitCode 'EXIT-0' $script:lastOut $script:lastErr
      Write-Output '[supervisor] 宿主正常退出（exit 0），监督结束'
      exit 0
    }
  }

  # 启动新宿主并继续监督
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $proc = Start-Host $stamp
  $HostPid = $proc.Id
  Write-Output "[supervisor] 已重启宿主（新 PID $HostPid）"
  Add-Content -Path $CrashLog -Value "[重启] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 新宿主 PID $HostPid（第 $restartCount 次）" -Encoding UTF8

  # 交接窗口：新宿主可能拉起自己的监督进程；最多等 6 秒。
  # 若未交接，本进程继续监督也安全（插件侧 ensureSupervisor 会复用已在线的监督进程，
  # 不会产生第二个），窗口结束后重启请求即可被正常消费。
  $handoffDeadline = (Get-Date).AddSeconds(6)
  $handoff = $false
  while ((Get-Date) -lt $handoffDeadline) {
    if (Test-Handoff $PID) { $handoff = $true; break }
    $p = Get-Process -Id $HostPid -ErrorAction SilentlyContinue
    if ($null -eq $p) { break }   # 新宿主又崩了，继续本进程接管
    Start-Sleep -Seconds 2
  }
  if ($handoff) {
    Write-Output '[supervisor] 新宿主已拉起自己的监督进程，本进程交接退出'
    exit 0
  }
  $healthySince = Get-Date
}