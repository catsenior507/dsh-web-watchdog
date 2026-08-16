window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-client-plugin-web-watchdog",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_dom_client = require("react-dom/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		const API_BASE = "http://127.0.0.1:4795";
		async function request(path, init) {
			const res = await fetch(API_BASE + path, {
				...init,
				headers: {
					"Content-Type": "application/json",
					...init?.headers ?? {}
				}
			});
			const text = await res.text();
			let body = {};
			if (text.trim() !== "") try {
				body = JSON.parse(text);
			} catch {
				body = { raw: text };
			}
			if (!res.ok) {
				const error = body.error ?? "HTTP " + res.status;
				throw new Error(error);
			}
			return body;
		}
		const api = {
			base: API_BASE,
			health: () => request("/api/health"),
			status: () => request("/api/watchdog/status"),
			log: (lines = 60) => request("/api/watchdog/log?lines=" + lines),
			restart: () => request("/api/watchdog/restart", { method: "POST" })
		};
		//#endregion
		//#region \0dsh-css:src/client/styles.module.css.mjs
		const css = "._0K34_a_launcher{z-index:2147482990;cursor:pointer;background:linear-gradient(145deg,#15243a,#0d1726);border:1px solid #8fc3ff73;border-radius:50%;justify-content:center;align-items:center;width:52px;height:52px;font-size:22px;transition:transform .15s,box-shadow .15s;display:flex;position:fixed;bottom:22px;right:84px;box-shadow:0 6px 24px #00000073,0 0 0 3px #7298982e}._0K34_a_launcher:hover{transform:translateY(-2px)scale(1.05);box-shadow:0 10px 28px #0000008c,0 0 0 4px #8fc3ff59}._0K34_a_panel{z-index:2147482991;color:#d8e2ee;background:linear-gradient(160deg,#101824f7,#090e15f7);border:1px solid #8fc3ff40;border-radius:14px;flex-direction:column;width:min(560px,100vw - 44px);height:min(520px,100vh - 120px);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;font-size:13px;display:flex;position:fixed;bottom:84px;right:22px;overflow:hidden;box-shadow:0 24px 64px #0009}._0K34_a_titlebar{background:linear-gradient(90deg,#72989833,#8fc3ff14);border-bottom:1px solid #8fc3ff29;flex:none;align-items:center;gap:10px;padding:10px 14px;display:flex}._0K34_a_title{color:#dce9f7;font-size:14px;font-weight:700}._0K34_a_spacer{flex:1}._0K34_a_winBtn{color:#9fc3bd;cursor:pointer;background:#ffffff0a;border:1px solid #8fc3ff33;border-radius:8px;width:26px;height:26px;font-size:13px}._0K34_a_winBtn:hover{color:#e6fff2;background:#8fc3ff29}._0K34_a_body{scrollbar-width:thin;scrollbar-color:#8fc3ff4d transparent;flex:1;padding:12px;overflow:auto}._0K34_a_card{background:#ffffff09;border:1px solid #8fc3ff24;border-radius:12px;margin-bottom:10px;padding:12px 14px}._0K34_a_cardTitle{color:#dce9f7;margin-bottom:8px;font-size:13px;font-weight:650}._0K34_a_grid{grid-template-columns:140px 1fr;align-items:center;gap:6px 10px;display:grid}._0K34_a_row{align-items:center;gap:8px;display:flex}._0K34_a_chip{color:#9fc3bd;white-space:nowrap;background:#ffffff0a;border:1px solid #8fc3ff40;border-radius:999px;padding:2px 8px;font-size:10.5px}._0K34_a_chipGreen{color:#9ef0bd;border-color:#85e3ae73}._0K34_a_chipAmber{color:#f3c979;border-color:#f3c97973}._0K34_a_muted{color:#7fa39e;font-size:11.5px}._0K34_a_mono{font-family:Cascadia Code,Consolas,monospace;font-size:11.5px}._0K34_a_dot{border-radius:50%;width:8px;height:8px;margin-right:6px;display:inline-block}._0K34_a_dotOk{background:#85e3ae;box-shadow:0 0 6px #85e3aecc}._0K34_a_dotBad{background:#ff9d8a;box-shadow:0 0 6px #ff9d8acc}._0K34_a_logBox{color:#b9cdd9;white-space:pre-wrap;background:#00000052;border:1px solid #8fc3ff29;border-radius:8px;max-height:220px;margin:0;padding:8px 10px;font-size:11px;overflow:auto}._0K34_a_btn{color:#dce9f7;cursor:pointer;background:#7298982e;border:1px solid #8fc3ff4d;border-radius:8px;padding:5px 12px;font-size:12px}._0K34_a_btn:hover{background:#8fc3ff38}._0K34_a_btnDanger{color:#ffb4a6;background:#d674191a;border-color:#ff9d8a66}._0K34_a_btnDanger:hover{background:#d6741940}._0K34_a_btnSmall{padding:2px 8px;font-size:11px}._0K34_a_errorBanner{color:#ffc9a0;white-space:pre-wrap;background:#d6741929;border:1px solid #d6741966;border-radius:10px;margin-bottom:10px;padding:10px 12px;font-size:12.5px}";
		const tagId = "@dsh-external/dsh-client-plugin-web-watchdog/styles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-external/dsh-client-plugin-web-watchdog";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var styles_module_css_default = {
			"body": "_0K34_a_body",
			"btn": "_0K34_a_btn",
			"btnDanger": "_0K34_a_btnDanger",
			"btnSmall": "_0K34_a_btnSmall",
			"card": "_0K34_a_card",
			"cardTitle": "_0K34_a_cardTitle",
			"chip": "_0K34_a_chip",
			"chipAmber": "_0K34_a_chipAmber",
			"chipGreen": "_0K34_a_chipGreen",
			"dot": "_0K34_a_dot",
			"dotBad": "_0K34_a_dotBad",
			"dotOk": "_0K34_a_dotOk",
			"errorBanner": "_0K34_a_errorBanner",
			"grid": "_0K34_a_grid",
			"launcher": "_0K34_a_launcher",
			"logBox": "_0K34_a_logBox",
			"mono": "_0K34_a_mono",
			"muted": "_0K34_a_muted",
			"panel": "_0K34_a_panel",
			"row": "_0K34_a_row",
			"spacer": "_0K34_a_spacer",
			"title": "_0K34_a_title",
			"titlebar": "_0K34_a_titlebar",
			"winBtn": "_0K34_a_winBtn"
		};
		//#endregion
		//#region src/client/panel.tsx
		function WatchdogPanel() {
			const [open, setOpen] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [confirming, setConfirming] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const refresh = (0, react.useCallback)(async () => {
				try {
					setStatus(await api.status());
					setError(null);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				refresh();
				const timer = setInterval(() => void refresh(), 1e4);
				return () => clearInterval(timer);
			}, [open, refresh]);
			const restart = async () => {
				setBusy(true);
				setNotice(null);
				try {
					const res = await api.restart();
					setNotice(res.message);
					setConfirming(false);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			};
			const sv = status?.supervisor;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: styles_module_css_default.launcher,
				title: "dsh web 看护（崩溃记录 + 自动重启）",
				onClick: () => setOpen((value) => !value),
				children: "🛡"
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				id: "dsh-watchdog-panel",
				className: styles_module_css_default.panel,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles_module_css_default.titlebar,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: styles_module_css_default.title,
							children: "🛡 dsh web 看护"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: styles_module_css_default.spacer }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles_module_css_default.winBtn,
							title: "关闭",
							onClick: () => setOpen(false),
							children: "✕"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles_module_css_default.body,
					children: [
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles_module_css_default.errorBanner,
							children: ["看护服务不可达：", error]
						}),
						notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `${styles_module_css_default.chip} ${styles_module_css_default.chipGreen}`,
							style: {
								marginBottom: 8,
								display: "inline-flex"
							},
							children: ["✔ ", notice]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles_module_css_default.card,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: styles_module_css_default.cardTitle,
								children: "📡 状态"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles_module_css_default.grid,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: styles_module_css_default.muted,
										children: "宿主进程（dsh web）"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: styles_module_css_default.mono,
										children: ["PID ", status?.hostPid ?? "—"]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: styles_module_css_default.muted,
										children: "监督进程"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${styles_module_css_default.dot} ${sv?.alive === true ? styles_module_css_default.dotOk : styles_module_css_default.dotBad}` }),
										sv?.alive === true ? `在线（PID ${sv.pid}）` : "离线",
										" ",
										sv?.alive === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${styles_module_css_default.chip} ${styles_module_css_default.chipGreen}`,
											children: "自动重启已启用"
										})
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: styles_module_css_default.muted,
										children: "崩溃日志"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: styles_module_css_default.mono,
										children: status?.config.crashLog ?? "—"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: styles_module_css_default.muted,
										children: "连续重启上限"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										status?.config.maxRestarts ?? "—",
										" 次（退避 ",
										status?.config.backoffStartSec ?? "—",
										"s → ",
										status?.config.backoffMaxSec ?? "—",
										"s）"
									] })
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles_module_css_default.card,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: styles_module_css_default.cardTitle,
								children: "📜 崩溃记录（最近 30 条）"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								className: styles_module_css_default.logBox,
								children: (status?.crashLogTail ?? []).join("\n") || "（暂无记录）"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSmall}`,
								onClick: () => void refresh(),
								children: "↻ 刷新"
							}), confirming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `${styles_module_css_default.chip} ${styles_module_css_default.chipAmber}`,
									children: "确认计划重启 dsh web？（浏览器将短暂断线，监督进程会自动拉起）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${styles_module_css_default.btn} ${styles_module_css_default.btnDanger} ${styles_module_css_default.btnSmall}`,
									disabled: busy,
									onClick: () => void restart(),
									children: "确认重启"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSmall}`,
									onClick: () => setConfirming(false),
									children: "取消"
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${styles_module_css_default.btn} ${styles_module_css_default.btnDanger} ${styles_module_css_default.btnSmall}`,
								onClick: () => setConfirming(true),
								children: "⚡ 计划重启"
							})]
						})
					]
				})]
			})] });
		}
		//#endregion
		//#region src/client/index.tsx
		function apply(ctx) {
			const mount = document.createElement("div");
			mount.dataset.dshWatchdogRoot = "";
			mount.setAttribute("aria-label", "dsh web watchdog");
			document.body.append(mount);
			let root = null;
			try {
				root = (0, react_dom_client.createRoot)(mount);
				root.render(react.default.createElement(WatchdogPanel));
			} catch {
				mount.remove();
				throw new Error("[dsh-web-watchdog] 挂载面板失败：React root 创建出错");
			}
			ctx.effect(() => () => {
				root?.unmount();
				mount.remove();
			}, "ui-dsh-web-watchdog: panel lifecycle");
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map