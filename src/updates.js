"use strict";

// 与 Electron 分离的状态机；下载、检查均去重，安装必须显式触发。
function createUpdates({ updater, enabled, currentVersion, prerelease = false, isBusy, notify, prepareInstall = () => {}, cancelInstall = () => {}, log = () => {} }) {
  let state = { status: enabled ? "idle" : "disabled", currentVersion, version: "", percent: 0, message: enabled ? "尚未检查更新" : "开发运行时不执行自动更新", visible: false };
  let checking = false, downloading = false, disposed = false;
  const listeners = [];
  function set(patch) { if (!disposed) { state = { ...state, ...patch }; notify({ ...state }); } }
  function error(err, visible = state.visible) {
    log("更新错误", err);
    if (state.status === "installing") { cancelInstall(); set({ status: "downloaded", message: "未能启动安装，请重试或手动安装", visible: true }); }
    else set({ status: "error", message: "更新服务暂不可用，请稍后重试", visible });
  }
  if (enabled) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = prerelease;
    updater.disableWebInstaller = true;
    const on = (name, cb) => { updater.on(name, cb); listeners.push([name, cb]); };
    on("checking-for-update", () => set({ status: "checking", message: "正在检查更新…" }));
    on("update-available", info => set({ status: "available", version: info.version, percent: 0, message: "发现新版本 " + info.version, visible: true }));
    on("update-not-available", () => set({ status: "current", message: "当前已是最新版本" }));
    on("download-progress", p => { const percent = Math.max(0, Math.min(100, Math.floor(p.percent || 0))); if (percent !== state.percent) set({ status: "downloading", percent, message: "正在下载更新：" + percent + "%", visible: true }); });
    on("update-downloaded", info => set({ status: "downloaded", version: info.version, percent: 100, message: "更新已下载，可重启安装", visible: true }));
    on("error", err => error(err));
  }
  return {
    getState: () => ({ ...state }),
    get installing() { return state.status === "installing"; },
    async check(manual = false) {
      if (!enabled) { if (manual) set({ visible: true }); return; }
      if (checking || downloading || ["downloaded", "installing"].includes(state.status)) { if (manual) set({ visible: true }); return; }
      checking = true; set({ visible: manual, status: "checking", message: "正在检查更新…" });
      try {
        const receiveDev = updater.allowPrerelease;
        try { await updater.checkForUpdates(); }
        catch (err) { if (!receiveDev || !String(currentVersion).includes("-")) throw err; }
        // 自定义 dev 通道没有更高开发版时，也检查是否已转为正式版。
        if (receiveDev && String(currentVersion).includes("-") && ["current", "error", "checking"].includes(state.status)) {
          updater.allowPrerelease = false;
          try { await updater.checkForUpdates(); } finally { updater.allowPrerelease = receiveDev; }
        }
      } catch (err) { error(err, manual); } finally { checking = false; }
    },
    async download() {
      if (!enabled || downloading || state.status !== "available") return;
      downloading = true; set({ status: "downloading", percent: 0, message: "正在下载更新…", visible: true });
      try { await updater.downloadUpdate(); } catch (err) { error(err, true); } finally { downloading = false; }
    },
    install() {
      if (!enabled || state.status !== "downloaded") return false;
      if (isBusy()) { set({ message: "正在处理文件或拖动，请完成后再重启更新", visible: true }); return false; }
      set({ status: "installing", message: "正在退出并安装更新…", visible: true });
      try { prepareInstall(); updater.quitAndInstall(true, true); return state.status === "installing"; }
      catch (err) { log(err); cancelInstall(); set({ status: "downloaded", message: "未能启动安装，请重试或手动安装", visible: true }); return false; }
    },
    setPrerelease(value) { if (enabled && !checking && !downloading && !["downloaded", "installing"].includes(state.status)) updater.allowPrerelease = Boolean(value); },
    dismiss() { set({ visible: false }); },
    publish() { notify({ ...state }); },
    dispose() { disposed = true; for (const [event, cb] of listeners) updater.removeListener(event, cb); }
  };
}
function defaultPrerelease(version, preference) { return typeof preference === "boolean" ? preference : String(version).includes("-"); }
module.exports = { createUpdates, defaultPrerelease };
