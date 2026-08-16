import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/index.ts
const name = "dsh-web-watchdog";
const PLUGIN_ID = "@dsh-external/dsh-client-plugin-web-watchdog";
const DEFAULT_PORT = 4795;
function defaultDataDir() {
	if (process.env.DSH_WATCHDOG_DATA !== void 0 && process.env.DSH_WATCHDOG_DATA !== "") return process.env.DSH_WATCHDOG_DATA;
	const home = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
	return join(home, ".dsh", "web-watchdog");
}
function defaultConfig() {
	const dataDir = defaultDataDir();
	return {
		port: Number(process.env.DSH_WATCHDOG_PORT ?? DEFAULT_PORT),
		dataDir,
		supervisor: {
			nodePath: process.execPath,
			binPath: process.argv[1] ?? "",
			restartArgs: process.argv.slice(2),
			workdir: process.cwd(),
			logDir: join(dataDir, "web-logs"),
			crashLog: join(dataDir, "crash.log"),
			requestFlag: join(dataDir, "restart-request.flag"),
			pidFile: join(dataDir, "supervisor.pid"),
			stateFile: join(dataDir, "restart-state.txt"),
			maxRestarts: 10,
			backoffStartSec: 10,
			backoffMaxSec: 600
		}
	};
}
function supervisorScriptPath() {
	return fileURLToPath(new URL("../assets/supervisor.ps1", import.meta.url));
}
/** 启动（或复用）脱离进程的 PowerShell 监督进程；pid 文件里的进程还活着则复用。 */
function ensureSupervisor(config) {
	const pid = readPidFile(config.supervisor.pidFile);
	if (pid !== null && isProcessAlive(pid)) return;
	const args = [
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		supervisorScriptPath(),
		"-HostPid",
		String(process.pid),
		"-NodePath",
		config.supervisor.nodePath,
		"-BinPath",
		config.supervisor.binPath,
		"-WorkDir",
		config.supervisor.workdir,
		"-LogDir",
		config.supervisor.logDir,
		"-CrashLog",
		config.supervisor.crashLog,
		"-RequestFlag",
		config.supervisor.requestFlag,
		"-PidFile",
		config.supervisor.pidFile,
		"-StateFile",
		config.supervisor.stateFile,
		"-MaxRestarts",
		String(config.supervisor.maxRestarts),
		"-BackoffStartSec",
		String(config.supervisor.backoffStartSec),
		"-BackoffMaxSec",
		String(config.supervisor.backoffMaxSec)
	];
	const restartArgs = config.supervisor.restartArgs.join(" ");
	if (restartArgs !== "") args.splice(13, 0, "-RestartArgs", restartArgs);
	const child = spawn("powershell.exe", args, {
		stdio: "ignore",
		windowsHide: true
	});
	child.on("error", (error) => {
		try {
			writeFileSync(config.supervisor.crashLog, "\n=== " + (/* @__PURE__ */ new Date()).toISOString() + " | 监督进程启动失败: " + String(error instanceof Error ? error.message : error) + " ===\n", { flag: "a" });
		} catch {}
	});
	child.unref();
}
function readPidFile(file) {
	if (!existsSync(file)) return null;
	try {
		const value = Number(readFileSync(file, "utf8").trim());
		return Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		return null;
	}
}
function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
function crashLogTail(config, lines) {
	if (!existsSync(config.supervisor.crashLog)) return [];
	try {
		return readFileSync(config.supervisor.crashLog, "utf8").split(/[\r\n]+/).filter((line) => line.trim() !== "").slice(-lines);
	} catch {
		return [];
	}
}
function buildStatus(config) {
	const supervisorPid = readPidFile(config.supervisor.pidFile);
	const supervisorAlive = supervisorPid !== null && isProcessAlive(supervisorPid);
	return {
		ok: true,
		plugin: PLUGIN_ID,
		hostPid: process.pid,
		hostStartedAt: (/* @__PURE__ */ new Date(Date.now() - process.uptime() * 1e3)).toISOString(),
		supervisor: {
			pid: supervisorPid,
			alive: supervisorAlive,
			startedAt: null
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
			backoffMaxSec: config.supervisor.backoffMaxSec
		},
		crashLogTail: crashLogTail(config, 30),
		message: supervisorAlive ? "监督进程在线" : "监督进程未运行（将在下次健康检查时拉起）"
	};
}
function sendJson(res, status, body) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Cache-Control": "no-store"
	});
	res.end(JSON.stringify(body));
}
function apply(ctx) {
	const base = defaultConfig();
	mkdirSync(base.dataDir, { recursive: true });
	const configFile = join(base.dataDir, "config.json");
	if (!existsSync(configFile)) writeFileSync(configFile, JSON.stringify(base, null, 2), "utf8");
	let fileConfig = {};
	try {
		fileConfig = JSON.parse(readFileSync(configFile, "utf8"));
	} catch {
		fileConfig = {};
	}
	const config = {
		...base,
		...fileConfig,
		supervisor: {
			...base.supervisor,
			...fileConfig.supervisor ?? {}
		},
		dataDir: base.dataDir
	};
	ensureSupervisor(config);
	const recheck = setInterval(() => ensureSupervisor(config), 3e4);
	const server = createServer((req, res) => {
		(async () => {
			try {
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				const path = url.pathname;
				if (req.method === "OPTIONS") {
					sendJson(res, 204, {});
					return;
				}
				if (path === "/api/health" && req.method === "GET") {
					sendJson(res, 200, {
						ok: true,
						plugin: PLUGIN_ID,
						port: config.port,
						dataDir: config.dataDir
					});
					return;
				}
				if (path === "/api/watchdog/status" && req.method === "GET") {
					ensureSupervisor(config);
					sendJson(res, 200, buildStatus(config));
					return;
				}
				if (path === "/api/watchdog/log" && req.method === "GET") {
					const lines = Math.min(Math.max(Number(url.searchParams.get("lines") ?? 50), 1), 500);
					sendJson(res, 200, {
						ok: true,
						lines: crashLogTail(config, lines),
						crashLog: config.supervisor.crashLog
					});
					return;
				}
				if (path === "/api/watchdog/restart" && req.method === "POST") {
					ensureSupervisor(config);
					try {
						writeFileSync(config.supervisor.requestFlag, (/* @__PURE__ */ new Date()).toISOString(), "utf8");
					} catch {}
					sendJson(res, 200, {
						ok: true,
						message: "重启请求已发送：监督进程将在 2 秒内停止并重新拉起 dsh web（浏览器会短暂断线，请稍候刷新页面）"
					});
					return;
				}
				sendJson(res, 404, { error: "未知 API 路径" });
			} catch (error) {
				sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		})();
	});
	server.listen(config.port, "127.0.0.1", () => {
		console.log("[dsh-web-watchdog] API on http://127.0.0.1:" + config.port + " (data: " + config.dataDir + ")");
	});
	server.on("error", (error) => {
		console.error("[dsh-web-watchdog] server error:", error instanceof Error ? error.message : error);
	});
	ctx.effect(() => () => {
		clearInterval(recheck);
		server.close();
	});
}
//#endregion
export { apply, name };
