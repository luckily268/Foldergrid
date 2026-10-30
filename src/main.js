"use strict";

/*
 * 注意顺序：先用原生模块把日志打通，再 require("electron")。
 * 这样即使 electron 模块本身出问题，也一定能留下痕迹。
 * Windows 上 GUI 程序的 stdout 经常被吞掉，所以日志同时写一份到临时文件。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const LOG_PATH = path.join(os.tmpdir(), "folder-grid-debug.log");

function log() {
  const parts = [];
  for (let i = 0; i < arguments.length; i++) {
    const a = arguments[i];
    parts.push(
      a instanceof Error ? a.stack || String(a) : typeof a === "string" ? a : JSON.stringify(a)
    );
  }
  const line = new Date().toISOString() + "  " + parts.join(" ");
  try {
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch (err) {
    /* ignore */
  }
  try {
    console.log(line);
  } catch (err) {
    /* ignore */
  }
}

log("=====================================");
log("---- main.js 开始加载 ----");
log("cwd:", process.cwd());
log("__dirname:", __dirname);
log("execPath:", process.execPath);

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, screen } = require("electron");
app.setName("folder-grid");
const { readPreview } = require("./preview");
const { pathToFileURL } = require("url");
const { cellName, cellPath, shelfPath, atomicJson, moveOne, removeCellToDesktop } = require("./storage");

log("electron 模块已加载，版本", process.versions.electron);

/* ---------------- 常量 ---------------- */

const META_FILE = "grid.json";
const PALETTE = [212, 282, 330, 145, 45, 192, 160, 24];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

const ICON_RULES = [
  [/(工作|项目|project|work|job|客户)/i, "💼"],
  [/(图|照片|photo|image|pic|截图|screenshot|壁纸)/i, "🖼️"],
  [/(视频|video|movie|录屏|剪辑)/i, "🎬"],
  [/(音|music|audio|播客|podcast)/i, "🎵"],
  [/(笔记|note|文档|doc|纪要)/i, "📝"],
  [/(代码|code|src|dev|实验|lab|脚本)/i, "🧩"],
  [/(暂存|临时|tmp|temp|inbox|收件|待办|todo)/i, "🗂️"],
  [/(资料|参考|ref|read|学习|课程)/i, "📚"],
  [/(财务|发票|invoice|账|报销)/i, "🧾"]
];

const FILE_STYLES = {
  doc: { icon: "📄", hue: 212 },
  sheet: { icon: "📊", hue: 145 },
  ppt: { icon: "📽️", hue: 24 },
  pdf: { icon: "📕", hue: 4 },
  note: { icon: "📝", hue: 48 },
  img: { icon: "🖼️", hue: 282 },
  video: { icon: "🎬", hue: 330 },
  audio: { icon: "🎵", hue: 258 },
  zip: { icon: "🗜️", hue: 36 },
  code: { icon: "🧩", hue: 192 },
  dir: { icon: "📁", hue: 205 }
};

const EXT_TO_STYLE = {
  doc: "doc", docx: "doc", rtf: "doc", odt: "doc", pages: "doc",
  xls: "sheet", xlsx: "sheet", csv: "sheet", ods: "sheet", numbers: "sheet",
  ppt: "ppt", pptx: "ppt", odp: "ppt", key: "ppt",
  pdf: "pdf",
  md: "note", markdown: "note", txt: "note", log: "note",
  png: "img", jpg: "img", jpeg: "img", gif: "img", webp: "img",
  bmp: "img", ico: "img", avif: "img", tiff: "img",
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video", m4v: "video",
  mp3: "audio", wav: "audio", flac: "audio", m4a: "audio", ogg: "audio", aac: "audio",
  zip: "zip", rar: "zip", "7z": "zip", gz: "zip", tar: "zip", xz: "zip",
  js: "code", mjs: "code", cjs: "code", ts: "code", jsx: "code", tsx: "code",
  py: "code", rs: "code", go: "code", java: "code", c: "code", cpp: "code", h: "code",
  json: "code", html: "code", css: "code", scss: "code", sh: "code",
  yml: "code", yaml: "code", toml: "code", sql: "code"
};

/* ---------------- 运行时状态 ---------------- */

let mainWindow = null;
let config = {};
let watcher = null;
let refreshTimer = null;
let tray = null;
let desktop = null;
let desktopTimer = null;
let lastDesktopRect = "";
let quitting = false;
let desktopInfo = { connected: false, iconSize: 48 };
const windowTest = process.env.FOLDER_GRID_WINDOW_TEST === "1";

/* ---------------- 配置与目录 ---------------- */

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch (err) {
    // 改名后沿用旧版选择的目录，不移动用户文件。
    if (err.code === "ENOENT" && app.getPath("userData") === path.join(app.getPath("appData"), "folder-grid")) {
      try {
        const legacy = JSON.parse(fs.readFileSync(path.join(app.getPath("appData"), "格子", "config.json"), "utf8"));
        if (legacy && typeof legacy.shelfDir === "string") return { shelfDir: legacy.shelfDir };
      } catch (_) { /* 初次安装 */ }
    }
    return {};
  }
}

function saveConfig() {
  try {
    atomicJson(configPath(), config);
  } catch (err) {
    log("保存配置失败", err);
    throw new Error("无法保存设置：" + err.message);
  }
}

function shelfDir() {
  if (typeof config.shelfDir === "string" && config.shelfDir) return config.shelfDir;
  const legacy = path.join(app.getPath("documents"), "格子");
  return fs.existsSync(legacy) ? legacy : path.join(app.getPath("documents"), "folder-grid");
}

function ensureShelf() {
  const dir = shelfDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ---------------- 小工具 ---------------- */

function makeId() {
  return "c" + require("crypto").randomUUID().replace(/-/g, "");
}

function folderIcon(name) {
  for (let i = 0; i < ICON_RULES.length; i++) {
    if (ICON_RULES[i][0].test(name)) return ICON_RULES[i][1];
  }
  return "📁";
}

function normalizeIcon(icon) {
  if (!icon) return { type: "auto" };
  if (typeof icon === "string") return { type: "auto" };
  if (icon.type === "image" && /^\.icons\/[a-zA-Z0-9_-]+\.png$/.test(icon.file)) return { type: "image", file: icon.file };
  if (icon.type === "emoji" && icon.value) return { type: "emoji", value: icon.value };
  return { type: "auto" };
}

function fileStyle(name, isDir) {
  if (isDir) return FILE_STYLES.dir;
  const ext = path.extname(name).slice(1).toLowerCase();
  const key = EXT_TO_STYLE[ext];
  return FILE_STYLES[key] || FILE_STYLES.doc;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(1) + " GB";
}

function formatWhen(mtimeMs) {
  const diff = Date.now() - mtimeMs;
  const MIN = 60000;
  const HOUR = 3600000;
  const DAY = 86400000;
  if (diff < MIN) return "刚刚";
  if (diff < HOUR) return Math.floor(diff / MIN) + " 分钟前";
  if (diff < DAY) return Math.floor(diff / HOUR) + " 小时前";
  if (diff < 30 * DAY) return Math.floor(diff / DAY) + " 天前";
  const d = new Date(mtimeMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

/* ---------------- grid.json ---------------- */

function readMeta(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, META_FILE), "utf8"));
    if (!data || !Array.isArray(data.folders)) throw new Error("格式不正确");
    if (data.folders.some(f => !f || typeof f.name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(f.id))) throw new Error("格子记录格式不正确");
    return data;
  } catch (err) {
    if (err.code === "ENOENT") return { version: 1, folders: [] };
    throw new Error("grid.json 读取失败，请先备份并检查此文件：" + err.message);
  }
}

function writeMeta(dir, meta) {
  atomicJson(path.join(dir, META_FILE), meta);
}

function syncFolders(dir) {
  const meta = readMeta(dir);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error("无法读取格子目录：" + err.message);
  }

  const dirNames = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
  const known = new Map(meta.folders.map((f) => [f.name, f]));

  const next = dirNames.map((name, i) => {
    const old = known.get(name);
    if (old) {
      return { id: old.id, name: name, hue: old.hue, icon: normalizeIcon(old.icon), order: i };
    }
    return {
      id: makeId(),
      name: name,
      hue: PALETTE[i % PALETTE.length],
      icon: { type: "auto" },
      order: i
    };
  });

  if (JSON.stringify(next) !== JSON.stringify(meta.folders)) {
    writeMeta(dir, { version: 1, folders: next });
  }
  return next;
}

/* ---------------- 状态 ---------------- */

function resolveIcon(dir, rawIcon) {
  const icon = normalizeIcon(rawIcon);
  if (icon.type === "image") {
    const full = path.join(dir, icon.file);
    if (fs.existsSync(full) && shelfPath(dir, full)) {
      return { type: "image", url: pathToFileURL(full).href };
    }
    return { type: "auto" };
  }
  return icon;
}

function thumbFor(name, fullPath) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (IMAGE_EXT.indexOf(ext) === -1) return "";
  return pathToFileURL(fullPath).href;
}

function buildState() {
  const dir = ensureShelf();
  const folders = syncFolders(dir);

  const out = folders.map(function (f) {
    const fdir = path.join(dir, f.name);
    let entries = [];
    try {
      entries = fs.readdirSync(fdir, { withFileTypes: true });
    } catch (err) {
      entries = [];
    }

    const files = [];
    entries.forEach(function (e) {
      if (e.name.startsWith(".")) return;
      const full = path.join(fdir, e.name);
      let st = null;
      try {
        st = fs.statSync(full);
      } catch (err) {
        return;
      }
      const isDir = e.isDirectory();
      const style = fileStyle(e.name, isDir);
      files.push({
        name: e.name,
        path: full,
        isDir: isDir,
        icon: style.icon,
        hue: style.hue,
        sizeLabel: isDir ? "文件夹" : formatSize(st.size),
        whenLabel: formatWhen(st.mtimeMs),
        thumb: isDir ? "" : thumbFor(e.name, full)
      });
    });

    files.sort(function (a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      id: f.id,
      name: f.name,
      hue: f.hue,
      icon: resolveIcon(dir, f.icon),
      fallbackIcon: folderIcon(f.name),
      path: fdir,
      files: files
    };
  });

  return { root: dir, folders: out, desktop: desktopInfo };
}

function pushState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("fg", { type: "state", payload: buildState() });
}

function send(msg) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("fg", msg);
}

/* ---------------- 格子操作 ---------------- */

function createCell(name) {
  const clean = cellName(name);
  const dir = ensureShelf();
  const dest = cellPath(dir, clean);
  if (fs.existsSync(dest)) throw new Error("已有同名格子，请换一个名称");
  fs.mkdirSync(dest);
  pushState();
}

function renameCell(folderId, newName) {
  const clean = cellName(newName);
  const dir = ensureShelf();
  const meta = readMeta(dir);
  const target = meta.folders.find((f) => f.id === folderId);
  if (!target) return;

  if (clean === target.name) return;

  const source = cellPath(dir, target.name);
  const dest = cellPath(dir, clean);
  if (fs.existsSync(dest) && source.toLowerCase() !== dest.toLowerCase()) throw new Error("已有同名格子，请换一个名称");
  fs.renameSync(source, dest);
  target.name = clean;
  writeMeta(dir, meta);
  pushState();
}

function removeIconFile(dir, folderId) {
  try {
    fs.unlinkSync(path.join(dir, ".icons", folderId + ".png"));
  } catch (err) {
    /* 没有就算了 */
  }
}

async function deleteCell(folderId) {
  const dir = ensureShelf();
  const before = readMeta(dir).folders.find(f => f.id === folderId);
  if (!before) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "删除格子",
    message: "要删除“" + before.name + "”吗？",
    detail: "格子里的所有文件和子文件夹都会移到桌面，不会删除。桌面已有同名内容时，会为移入项自动另起名称，原文件不会被覆盖。",
    buttons: ["取消", "删除格子并移出文件"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (result.response !== 1) return;
  if (dir !== shelfDir()) throw new Error("文件目录已切换，请重新选择要删除的格子");
  const meta = readMeta(dir), target = meta.folders.find(f => f.id === folderId);
  if (!target || target.name !== before.name) throw new Error("格子已变化，请重新确认");
  let count;
  try { count = removeCellToDesktop(cellPath(dir, target.name), app.getPath("desktop")); }
  finally { pushState(); }
  meta.folders = meta.folders.filter(f => f.id !== folderId);
  writeMeta(dir, meta);
  removeIconFile(dir, folderId);
  pushState();
  send({ type: "toast", message: "格子已删除，" + count + " 项内容已移到桌面" });
}

function setIcon(folderId, icon, dataUrl) {
  const dir = ensureShelf();
  const meta = readMeta(dir);
  const target = meta.folders.find((f) => f.id === folderId);
  if (!target) return;

  const previous = normalizeIcon(target.icon);

  if (icon && icon.type === "image") {
    if (!dataUrl) return;
    const base64 = String(dataUrl).split(",")[1] || "";
    if (!base64 || !String(dataUrl).startsWith("data:image/png;base64,") || base64.length > 2 * 1024 * 1024) throw new Error("封面图片无效或过大");
    fs.mkdirSync(path.join(dir, ".icons"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".icons", folderId + ".png"), Buffer.from(base64, "base64"));
    target.icon = { type: "image", file: ".icons/" + folderId + ".png" };
  } else if (icon && icon.type === "emoji" && icon.value) {
    target.icon = { type: "emoji", value: String(icon.value) };
    if (previous.type === "image") removeIconFile(dir, folderId);
  } else {
    target.icon = { type: "auto" };
    if (previous.type === "image") removeIconFile(dir, folderId);
  }

  writeMeta(dir, meta);
  pushState();
}

/* 渲染层传过来的是真实路径（Electron 的 webUtils 拿到的） */
function moveFiles(folderId, paths) {
  const dir = ensureShelf();
  const meta = readMeta(dir);
  const target = meta.folders.find((f) => f.id === folderId);
  if (!target) return;

  const targetDir = cellPath(dir, target.name);
  if (!Array.isArray(paths) || paths.length > 1000) throw new Error("一次最多移动 1000 个文件");
  const failed = [];
  let moved = 0;
  paths.forEach(function (src) {
    try {
      if (moveOne(src, targetDir)) moved++;
    } catch (err) {
      failed.push(path.basename(String(src)) + "（" + err.message + "）");
    }
  });

  if (failed.length) {
    send({
      type: "toast",
      message: "移动了 " + moved + " 个，失败 " + failed.length + " 个 —— " + failed.join("、")
    });
  }
  pushState();
}

/* ---------------- 文档预览 ---------------- */

/* ---------------- 文件变化监听 ---------------- */

function isInternal(rel) {
  if (!rel) return false;
  const top = rel.split(path.sep)[0];
  return rel === META_FILE || rel.startsWith(META_FILE + ".") || top === ".icons" || String(rel).split(path.sep).some(p => p.startsWith(".fg-move-"));
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(function () {
    refreshTimer = null;
    try { pushState(); } catch (err) { log("刷新失败", err); send({ type: "toast", message: err.message }); }
  }, 320);
}

function startWatcher(dir) {
  stopWatcher();
  try {
    watcher = fs.watch(dir, { recursive: true }, function (event, filename) {
      if (!filename) return;
      if (isInternal(String(filename))) return;
      scheduleRefresh();
    });
  } catch (err) {
    /* 目录不存在或系统不支持递归监听，静默降级为手动刷新 */
  }
}

function stopWatcher() {
  if (watcher) {
    try {
      watcher.close();
    } catch (err) {
      /* ignore */
    }
    watcher = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/* ---------------- 消息处理 ---------------- */

async function handleMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "ready":
    case "refresh":
      pushState();
      break;

    case "open":
      { const error = await shell.openPath(shelfPath(ensureShelf(), msg.path)); if (error) throw new Error(error); }
      break;

    case "reveal":
      shell.showItemInFolder(shelfPath(ensureShelf(), msg.path));
      break;

    case "newCell":
      createCell(msg.name);
      break;

    case "renameCell":
      renameCell(msg.folderId, msg.name);
      break;

    case "deleteCell":
      await deleteCell(msg.folderId);
      break;

    case "cellMenu": {
      const target = readMeta(ensureShelf()).folders.find(f => f.id === msg.folderId);
      if (!target) return;
      Menu.buildFromTemplate([
        { label: "重命名…", click: () => send({ type: "requestRenameCell", folderId: target.id }) },
        { label: "删除格子…", click: () => deleteCell(target.id).catch(err => send({ type: "toast", message: err.message })) }
      ]).popup({ window: mainWindow });
      break;
    }

    case "setIcon":
      setIcon(msg.folderId, msg.icon, msg.dataUrl);
      break;

    case "move":
      moveFiles(msg.folderId, msg.paths);
      break;

    case "preview":
      send({ type: "previewData", path: msg.path, payload: readPreview(shelfPath(ensureShelf(), msg.path)) });
      break;

    case "openExternal": {
      const url = new URL(msg.url);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("不支持的链接");
      await shell.openExternal(url.href);
      break;
    }

    case "desktopRegions": {
      if (!Array.isArray(msg.rects) || msg.rects.length > 512) return;
      const [width, height] = mainWindow.getContentSize();
      const rects = msg.rects.filter(r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite)).map(r => {
        const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
        return { x, y, width: Math.min(width - x, Math.ceil(r.width)), height: Math.min(height - y, Math.ceil(r.height)) };
      }).filter(r => r.width > 0 && r.height > 0);
      mainWindow.setShape(rects.length ? rects : [{ x: 0, y: 0, width: 1, height: 1 }]);
      break;
    }

    case "focusInput":
      if (!["askInput", "searchInput"].includes(msg.id)) return;
      mainWindow.focus();
      mainWindow.webContents.focus();
      send({ type: "inputFocused", id: msg.id });
      break;

    case "desktopMenu":
      if (tray) tray.popUpContextMenu();
      break;

    case "pickRoot":
      await pickRoot();
      break;

    case "openInExplorer":
      shell.openPath(shelfDir());
      break;

    default:
      break;
  }
}

ipcMain.on("fg", function (event, msg) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !msg || typeof msg !== "object") return;
  Promise.resolve()
    .then(function () {
      return handleMessage(msg);
    })
    .catch(function (err) {
      send({ type: "toast", message: String((err && err.message) || err) });
    });
});

/* ---------------- 选目录 ---------------- */

async function pickRoot() {
  const result = await dialog.showOpenDialog({
    title: "选择格子存放的目录",
    defaultPath: shelfDir(),
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return;

  config.shelfDir = result.filePaths[0];
  saveConfig();

  const dir = ensureShelf();
  startWatcher(dir);
  pushState();
  send({ type: "toast", message: "格子目录已切换到 " + dir });
}

/* ---------------- 窗口与菜单 ---------------- */

function desktopRect() {
  const display = screen.getPrimaryDisplay();
  return screen.dipToScreenRect(null, display.workArea);
}

function connectDesktop() {
  if (!mainWindow || mainWindow.isDestroyed() || windowTest) return;
  try {
    const metrics = desktop.metrics();
    if (!desktop.connected(mainWindow)) {
      const attached = desktop.attach(mainWindow, desktopRect());
      log("桌面已连接", attached);
      lastDesktopRect = JSON.stringify(desktopRect());
    } else if (lastDesktopRect !== JSON.stringify(desktopRect())) {
      desktop.layout(mainWindow, desktopRect());
      lastDesktopRect = JSON.stringify(desktopRect());
    }
    const changed = !desktopInfo.connected || metrics.iconSize !== desktopInfo.iconSize;
    desktopInfo = { connected: true, iconSize: metrics.iconSize };
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    if (changed) pushState();
    if (tray) tray.setToolTip("folder-grid · 桌面文件收纳");
  } catch (err) {
    if (desktopInfo.connected) log("桌面连接中断", err);
    desktopInfo.connected = false;
    if (tray) tray.setToolTip("folder-grid · 等待桌面就绪");
  }
}

function createWindow() {
  const bounds = windowTest ? { width: 1180, height: 780 } : screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: "folder-grid",
    icon: path.join(__dirname, "..", "media", "app-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setShape([{ x: 0, y: 0, width: 1, height: 1 }]);
  mainWindow.on("blur", () => { if (desktop && mainWindow) desktop.lower(mainWindow); });
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => log("页面加载失败", code, desc));
  mainWindow.webContents.on("render-process-gone", (_e, details) => log("渲染进程退出", details));
  mainWindow.webContents.on("console-message", event => log("[页面]", event.message));
  mainWindow.once("ready-to-show", () => {
    if (windowTest) { mainWindow.show(); return; }
    connectDesktop();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    desktopInfo.connected = false;
    // 保留托盘；桌面宿主恢复后可重新建立桌面层。
  });
  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
}

function buildTray() {
  Menu.setApplicationMenu(null);
  if (windowTest) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "media", "app-icon.png"));
  tray = new Tray(icon.resize({ width: 20, height: 20 }));
  tray.setToolTip("folder-grid · 桌面文件收纳");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "folder-grid", enabled: false },
    { type: "separator" },
    { label: "显示桌面图标", click: () => { if (mainWindow) { mainWindow.showInactive(); connectDesktop(); } } },
    { label: "新建格子…", click: () => send({ type: "requestNewCell" }) },
    { label: "选择文件目录…", click: pickRoot },
    { label: "在资源管理器中打开", click: () => shell.openPath(shelfDir()) },
    { label: "刷新", click: () => { try { pushState(); } catch (err) { send({ type: "toast", message: err.message }); } } },
    { type: "separator" },
    { label: "退出 folder-grid", click: () => app.quit() }
  ]));
  tray.on("click", () => { if (mainWindow) { mainWindow.showInactive(); connectDesktop(); } });
}

/* ---------------- 启动 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { mainWindow.showInactive(); connectDesktop(); } });
  app.on("before-quit", () => {
    quitting = true;
    if (desktopTimer) clearInterval(desktopTimer);
    stopWatcher();
    if (tray) tray.destroy();
  });
  app.whenReady().then(() => {
    if (process.platform !== "win32" && !windowTest) throw new Error("桌面模式目前仅支持 Windows");
    config = loadConfig();
    if (!windowTest) desktop = require("./desktop").createWindowsDesktop();
    buildTray();
    startWatcher(ensureShelf());
    createWindow();
    if (!windowTest) {
      desktopTimer = setInterval(() => {
        if (quitting) return;
        if (!mainWindow) { if (desktop.findHost()) createWindow(); }
        else connectDesktop();
      }, 3000);
      const resize = () => { if (mainWindow) connectDesktop(); };
      screen.on("display-metrics-changed", resize);
      screen.on("display-added", resize);
      screen.on("display-removed", resize);
    }
  }).catch(err => {
    log("folder-grid 启动失败", err);
    dialog.showErrorBox("folder-grid 启动失败", err.message);
    app.quit();
  });
  app.on("window-all-closed", () => { if (windowTest) app.quit(); });
}

process.on("uncaughtException", function (err) {
  log("[folder-grid] 未捕获异常：", err);
  try {
    dialog.showErrorBox("folder-grid 遇到错误", String((err && err.message) || err));
  } catch (e) {
    /* ignore */
  }
});
