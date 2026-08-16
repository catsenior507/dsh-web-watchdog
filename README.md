# 🛡 dsh-web-watchdog

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的**看护插件**：
崩溃记录 + 指数退避自动重启 + 状态面板。

dsh web（`dsh web`，默认 http://127.0.0.1:3080）在 Windows 上偶发崩溃
（Node 24 libuv 退出断言、原生 TS 类型剥离等）。本插件在宿主进程内托管一个
**脱离进程的 PowerShell 监督进程**：

- 📜 **崩溃记录**：宿主异常退出（退出码 != 0）时，把退出码、宿主 stderr/stdout
  末尾、Windows 事件日志追加到 `crash.log`；
- 🔁 **自动重启**：按指数退避（默认 10s 起、上限 600s、连续最多 10 次）自动拉起
  `node --no-warnings <bin> web`；宿主正常退出（exit 0）不重启；
- ⚡ **计划重启**：面板按钮或 `POST /api/watchdog/restart` 写请求标记，监督进程
  在 2 秒内完成「停旧进程 → 拉新进程」；
- 🤝 **监督进程交接**：重启后新宿主会拉起自己的监督进程，旧监督进程检测到
  pid 文件被接管后自动退出，避免双重监督。

## 安装

```bash
npm install
npm run build
dsh plugin --profile web add link:<本目录绝对路径>
# 重启 dsh web 后生效；右下角出现 🛡 按钮
```

## 面板 / API

| 端点 | 说明 |
|---|---|
| `GET /api/watchdog/status` | 宿主 PID、监督进程状态、配置、崩溃记录尾部 |
| `GET /api/watchdog/log?lines=60` | 崩溃日志尾部 |
| `POST /api/watchdog/restart` | 计划重启（浏览器会短暂断线，监督进程自动拉起） |
| `GET /api/health` | 插件健康检查 |

```bash
curl http://127.0.0.1:4795/api/watchdog/status
curl -X POST http://127.0.0.1:4795/api/watchdog/restart
```

## 配置

首次运行在数据目录（默认 `%USERPROFILE%\.dsh\web-watchdog`，可用环境变量
`DSH_WATCHDOG_DATA` / `DSH_WATCHDOG_PORT` 覆盖）生成 `config.json`：

- `supervisor.nodePath` / `binPath` / `restartArgs`：重启命令（自动探测，可覆盖）；
- `supervisor.maxRestarts` / `backoffStartSec` / `backoffMaxSec`：重启策略；
- 崩溃记录：`<数据目录>/crash.log`，宿主日志：`<数据目录>/web-logs/`。

## 开发 / 自测

- `npm run build` —— tsdown 产出 host half（`lib/index.js`）与 browser half（`lib/client.js`）；
- `node test-isolated.mjs` —— 隔离端到端测试：监督进程拉起、崩溃记录、自动重启、
  计划重启、监督交接（不接触真实 dsh web 进程）。
- `node test-deployment.mjs` —— **真实部署形态**端到端测试：假宿主通过插件的 WMI 机制拉起监督进程，
  再用 Stop-Process -Force 硬杀宿主，验证监督进程独立存活、恢复宿主环境、写崩溃记录并自动拉起新宿主。

## License

MIT
