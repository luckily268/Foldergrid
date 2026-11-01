"use strict";

// Windows remains the source of truth, including changes made in Task Manager.
function createStartup({ app, enabled, execPath = process.execPath, name = "folder-grid" }) {
  const options = { path: execPath, args: [] };
  function getState() {
    if (!enabled) return { supported: false, enabled: false, registered: false, reason: "安装版 Windows 应用可设置开机自启动" };
    try {
      const actual = app.getLoginItemSettings(options);
      // openAtLogin only queries Electron's default registry name. We use our
      // explicit name and inspect that entry so other apps cannot mask its state.
      const entry = actual.launchItems.find(item => item.name === name && item.scope === "user");
      return { supported: true, registered: !!entry,
        enabled: !!entry && entry.enabled === true,
        blocked: !!entry && entry.enabled !== true };
    } catch (error) { return { supported: false, enabled: false, registered: false, reason: "无法读取系统启动设置：" + error.message }; }
  }
  function setEnabled(value) {
    if (typeof value !== "boolean") throw new Error("启动设置无效");
    if (!enabled) throw new Error("请在安装后的 Windows 版本中设置开机自启动");
    app.setLoginItemSettings({ ...options, name, openAtLogin: value, enabled: value });
    const state = getState();
    if (!state.supported || state.registered !== value || state.enabled !== value) throw new Error(state.reason || "系统未接受启动设置，请检查 Windows 设置中的启动应用");
    return state;
  }
  return { getState, setEnabled };
}
module.exports = { createStartup };
