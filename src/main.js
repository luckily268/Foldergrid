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

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, screen, globalShortcut } = require("electron");
app.setName("folder-grid");
const { readPreview } = require("./preview");
const { pathToFileURL } = require("url");
const { cellName, cellPath, shelfPath, atomicJson, moveOne, removeCellToDesktop } = require("./storage");
const workspace = require("./workspace");

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

const systemIconCache = new Map();
async function requestSystemIcons(files) {
  for (const file of files) {
    const key = file.path;
    if (systemIconCache.has(key)) continue;
    systemIconCache.set(key, "");
    try { systemIconCache.set(key, (await app.getFileIcon(key, {size:"normal"})).toDataURL()); } catch (_) {}
    if (systemIconCache.size > 1500) systemIconCache.delete(systemIconCache.keys().next().value);
  }
  pushState();
}
let mainWindow = null;
let compareWindows;
const requestScope = new (require("async_hooks").AsyncLocalStorage)();
function requestWindow() { return requestScope.getStore() || mainWindow; }
const draggingWindows = new Set();
let config = {};
let startup = null, layouts = null;
let watcher = null;
let refreshTimer = null;
let tray = null;
let updates = null, updateTimer = null, updateInterval = null, activeOperations = 0, dragInProgress = false;
function fileBusy() { return activeOperations > 0 || organizationBusy || dragInProgress || draggingWindows.size > 0; }
async function withOperation(task) {
  if (updates && updates.installing) throw new Error("正在安装更新，请稍候");
  activeOperations++; try { return await task(); } finally { activeOperations--; }
}
let desktop = null;
let desktopTimer = null;
let lastDesktopRect = "";
let quitting = false;
let desktopInfo = { connected: false, iconSize: 48 };
let pendingPlan = null;
let organizationBusy = false;
let peekActive = false;
let userHidden = false;
const portalWatchers = new Map();
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

const cellPatterns = require("../media/patterns");
function normalizeIcon(icon) {
  const appearance = icon && ["card", "round", "plain"].includes(icon.appearance) ? icon.appearance : "card";
  if (!icon || typeof icon !== "object") return { type: "auto", appearance };
  if (icon.type === "pattern" && Object.hasOwn(cellPatterns, icon.value)) return { type: "pattern", value: icon.value, appearance };
  if (icon.type === "image" && /^\.icons\/[a-zA-Z0-9_-]+\.png$/.test(icon.file)) return { type: "image", file: icon.file, appearance };
  if (icon.type === "emoji" && typeof icon.value === "string" && icon.value.length <= 32 && icon.value.trim()) return { type: "emoji", value: icon.value, appearance };
  return { type: "auto", appearance };
}
function imageIconBytes(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 2 * 1024 * 1024) throw new Error("封面图片无效或过大");
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("封面图片无法读取");
  return image.resize({ width: 256, height: 256 }).toPNG();
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
  const known = new Map(meta.folders.filter(f => f.kind !== "portal").map((f) => [f.name, f]));

  const next = dirNames.map((name, i) => {
    const old = known.get(name);
    if (old) {
      return { ...old, id: old.id, name, icon: normalizeIcon(old.icon), order: i };
    }
    return {
      id: makeId(),
      name: name,
      hue: PALETTE[i % PALETTE.length],
      icon: { type: "auto" },
      order: i
    };
  });

  meta.folders.filter(f => f.kind === "portal").forEach(f => next.push({ ...f, icon: normalizeIcon(f.icon) }));
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
      return { type: "image", url: pathToFileURL(full).href + "?v=" + require("crypto").createHash("sha256").update(fs.readFileSync(full)).digest("hex").slice(0,16) };
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
    const fdir = f.kind === "portal" ? f.portalPath : cellPath(dir, f.name);
    let unavailable = "";
    let entries = [];
    try {
      entries = fs.readdirSync(fdir, { withFileTypes: true });
    } catch (err) {
      entries = [];
      unavailable = "文件夹暂不可用，可在右键菜单中移除映射后重新添加";
    }

    const files = [];
    entries.forEach(function (e) {
      if (e.name.startsWith(".") || e.isSymbolicLink()) return;
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
        systemIcon: systemIconCache.get(full) || "",
        path: full,
        isDir: isDir,
        icon: style.icon,
        hue: style.hue,
        sizeLabel: isDir ? "文件夹" : formatSize(st.size),
        whenLabel: formatWhen(st.mtimeMs),
        size: st.size,
        mtimeMs: st.mtimeMs,
        extension: isDir ? "folder" : path.extname(e.name).slice(1).toLowerCase(),
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
      size: f.size, memberOrder: f.memberOrder || [], wallpaper: f.wallpaper || "",
      position: f.position, panelPosition: f.panelPosition, filePositions: f.filePositions || {}, baseColor: f.baseColor,
      bookcaseId: f.bookcaseId || null, bookcaseStyle: f.bookcaseStyle || "wood",
      note: f.note || "", sessionPath: f.sessionPath || "",
      kind: f.kind || "local",
      unavailable,
      sort: f.sort || "manual",
      files: files
    };
  });

  updatePortalWatchers(folders);
  let undoAvailable = false;
  try { undoAvailable = workspace.readHistory(historyPath()).some(b => b.entries.some(e => e.status === "moved")); } catch (err) { log(err); }
  return { root: dir, folders: out, feedback: require("./cell-details").feedback(config.feedback), desktop: { ...desktopInfo, toolbar: config.toolbar, layoutLocked: config.layoutLocked === true }, startup: startup ? startup.getState() : {}, layouts: layouts ? layouts.list(dir) : [], rules: config.rules || workspace.DEFAULT_RULES, undoAvailable, shortcuts: config.shortcuts || {}, hidden: userHidden };
}

function historyPath() { return path.join(app.getPath("userData"), "organization-history.json"); }

function authorizedPath(target) {
  try { return shelfPath(ensureShelf(), target); } catch (_) { /* 检查用户通过目录选择器授权的映射 */ }
  for (const f of readMeta(ensureShelf()).folders.filter(f => f.kind === "portal")) {
    try { return workspace.portalPath(f.portalPath, target); } catch (_) { /* 下一项 */ }
  }
  throw new Error("只能访问当前格子或已映射文件夹中的内容");
}

function updatePortalWatchers(folders) {
  const paths = new Set(folders.filter(f => f.kind === "portal").map(f => f.portalPath));
  for (const [dir, watcher] of portalWatchers) if (!paths.has(dir)) { watcher.close(); portalWatchers.delete(dir); }
  for (const dir of paths) {
    if (portalWatchers.has(dir)) continue;
    try {
      const watcher = fs.watch(dir, { recursive: false }, scheduleRefresh);
      watcher.on("error", () => { watcher.close(); portalWatchers.delete(dir); scheduleRefresh(); });
      portalWatchers.set(dir, watcher);
    } catch (_) { /* 断开的磁盘允许手动刷新后恢复 */ }
  }
}

function pushState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const payload = buildState();
  mainWindow.webContents.send("fg", { type: "state", payload });
  if (compareWindows) compareWindows.broadcast(payload);
}

function send(msg) {
  const target = requestWindow(); if (!target || target.isDestroyed()) return;
  target.webContents.send("fg", msg);
}

/* ---------------- 格子操作 ---------------- */

function createCell(name, icon, dataUrl, rawDetails) {
  const details = { ...require("./cell-details").details(rawDetails), ...require("./bookcases").options(rawDetails) };
  const clean = cellName(name), dir = ensureShelf(), dest = cellPath(dir, clean);
  if (fs.existsSync(dest)) throw new Error("已有同名格子，请换一个名称");
  const meta = readMeta(dir), id = makeId();
  const bytes = icon?.type === "image" ? imageIconBytes(dataUrl) : null;
  const selection = normalizeIcon(bytes ? { ...icon, file: ".icons/" + id + ".png" } : icon);
  fs.mkdirSync(dest);
  try {
    if (bytes) { fs.mkdirSync(path.join(dir, ".icons"), { recursive: true }); fs.writeFileSync(path.join(dir, selection.file), bytes); }
    meta.folders.push({ ...details, id, name: clean, hue: PALETTE[meta.folders.length % PALETTE.length], icon: selection, order: meta.folders.length });
    writeMeta(dir, meta);
  } catch (error) { removeIconFile(dir, id); fs.rmdirSync(dest); throw error; }
  pushState();
}

function renameCell(folderId, newName) {
  const clean = cellName(newName);
  const dir = ensureShelf();
  const meta = readMeta(dir);
  const target = meta.folders.find((f) => f.id === folderId);
  if (!target) return;

  if (clean === target.name) return;

  if (target.kind === "portal") {
    target.name = clean;
    writeMeta(dir, meta);
    pushState();
    return;
  }
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

async function deleteCell(folderId) { return withOperation(() => deleteCellImpl(folderId)); }
async function deleteCellImpl(folderId) {
  const dir = ensureShelf();
  const before = readMeta(dir).folders.find(f => f.id === folderId);
  if (!before) return;
  if (before.kind === "portal") {
    const meta = readMeta(dir);
    meta.folders = meta.folders.filter(f => f.id !== folderId);
    writeMeta(dir, meta);
    removeIconFile(dir, folderId);
    pushState();
    send({ type: "toast", message: "已移除映射，原文件夹和文件保留在原位置" });
    return;
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "删除格子",
    message: "要删除“" + before.name + "”吗？",
    detail: (before.kind === "bookcase" ? "书柜中的格子会返回桌面分区，格子内容保持原位置。书柜直接存放的文件将移到桌面。\n" : "") + "格子里的所有文件和子文件夹都会移到桌面，不会删除。桌面已有同名内容时，会为移入项自动另起名称，原文件不会被覆盖。",
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
  require("./bookcases").detach(meta.folders, folderId);
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
    const bytes = imageIconBytes(dataUrl);
    fs.mkdirSync(path.join(dir, ".icons"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".icons", folderId + ".png"), bytes);
    target.icon = normalizeIcon({ ...icon, file: ".icons/" + folderId + ".png" });
  } else if (icon && icon.type === "emoji" && icon.value) {
    target.icon = normalizeIcon(icon);
    if (previous.type === "image") removeIconFile(dir, folderId);
  } else {
    target.icon = normalizeIcon(icon);
    if (previous.type === "image") removeIconFile(dir, folderId);
  }

  writeMeta(dir, meta);
  pushState();
}

/* 渲染层传过来的是真实路径（Electron 的 webUtils 拿到的） */
function moveFiles(folderId, paths, relative = "") {
  const dir = ensureShelf();
  const meta = readMeta(dir);
  const target = meta.folders.find((f) => f.id === folderId);
  if (!target) return;

  if (target.kind === "portal") throw new Error("映射以只读方式展示，请在资源管理器中向此文件夹添加文件");
  const targetDir = require("./subfolders").directory(cellPath(dir, target.name), relative);
  if (!Array.isArray(paths) || paths.length > 1000) throw new Error("一次最多移动 1000 个文件");
  const failed = [];
  let moved = 0;
  paths.forEach(function (src) {
    try {
      if (!relative && target.kind === 'bookcase' && typeof src === 'string') {
        const member = meta.folders.find(f => f.kind !== 'portal' && path.resolve(src).toLowerCase() === path.resolve(cellPath(dir, f.name)).toLowerCase());
        if (member) { require('./bookcases').assign(meta.folders, member.id, target.id); moved++; return; }
      }
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
  if (target.kind === 'bookcase') writeMeta(dir, meta);
  pushState();
  if (moved) send({ type: "filesLanded", folderId, count: moved });
}

/* ---------------- 文档预览 ---------------- */

/* ---------------- 文件变化监听 ---------------- */

function isInternal(rel) {
  if (!rel) return false;
  const top = rel.split(path.sep)[0];
  return rel === META_FILE || rel.startsWith(META_FILE + ".") || top === ".icons" || String(rel).split(path.sep).some(p => p.startsWith(".fg-move-") || p.startsWith(".fg-copy-"));
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

const fileMenuItems = require("./file-menus").createFileMenus({
  resolveFolder(id, relative = "") {
    const dir = ensureShelf();
    const folder = readMeta(dir).folders.find(item => item.id === id);
    if (!folder) throw new Error("目标格子已不存在");
    const base=folder.kind === "portal" ? folder.portalPath : cellPath(dir, folder.name);
    return { path: require("./subfolders").directory(base, relative), writable: folder.kind !== "portal" };
  },
  scope: (win, task) => requestScope.run(win, task),
  authorize: authorizedPath,
  notify: message => send({ type: "toast", message }),
  onChange(folderId, count) { pushState(); send({ type: "filesLanded", folderId, count }); },
  withOperation
});

async function handleMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "ready":
    case "refresh":
      if (updates) updates.publish();
      pushState();
      break;

    case "open":
      { const error = await shell.openPath(authorizedPath(msg.path)); if (error) throw new Error(error); }
      break;

    case "reveal":
      shell.showItemInFolder(authorizedPath(msg.path));
      break;

    case "newCell":
      createCell(msg.name, msg.icon, msg.dataUrl, msg);
      break;

    case "renameCell":
      renameCell(msg.folderId, msg.name);
      break;

    case "deleteCell":
      await deleteCell(msg.folderId);
      break;

    case "systemIcons": {
      const paths = Array.isArray(msg.paths) ? msg.paths.slice(0,200) : [];
      const files = paths.map(file => { try { return {path:authorizedPath(file)}; } catch (_) {return null;} }).filter(Boolean);
      await requestSystemIcons(files); break;
    }
    case "workspaceMenu":
      Menu.buildFromTemplate([
        {label:"新建格子…",click:()=>send({type:"requestNewCell"})},
        {label:"新建分区…",click:()=>send({type:"requestNewBookcase"})}
      ]).popup({window:requestWindow()});break;
    case "newSubfolder": {
      const f=readMeta(ensureShelf()).folders.find(f=>f.id===msg.folderId);
      if(!f || f.kind==="portal")throw new Error("当前分区只读");
      require("./subfolders").create(cellPath(ensureShelf(),f.name),msg.relative,msg.name);pushState();break;
    }
    case "listSubfolder": {
      const f=readMeta(ensureShelf()).folders.find(f=>f.id===msg.folderId);if(!f)return;
      const base=f.kind==="portal"?f.portalPath:cellPath(ensureShelf(),f.name);
      const dir=require("./subfolders").directory(base,msg.relative);
      const files=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>!e.name.startsWith(".")&&!e.isSymbolicLink()).map(e=>{
        const full=path.join(dir,e.name),st=fs.statSync(full),style=fileStyle(e.name,e.isDirectory());
        return {name:e.name,path:full,isDir:e.isDirectory(),icon:style.icon,hue:style.hue,systemIcon:systemIconCache.get(full)||"",sizeLabel:e.isDirectory()?"文件夹":formatSize(st.size),whenLabel:formatWhen(st.mtimeMs),size:st.size,mtimeMs:st.mtimeMs,extension:path.extname(e.name).slice(1),thumb:e.isDirectory()?"":thumbFor(e.name,full)};
      });
      send({type:"subfolderState",folderId:f.id,relative:msg.relative,files});break;
    }
    case "saveBookcaseGeometry": {
      const dir=ensureShelf(),meta=readMeta(dir),f=meta.folders.find(f=>f.id===msg.folderId&&f.kind==="bookcase");if(!f||config.layoutLocked)return;
      if(msg.size && [msg.size.width,msg.size.height].every(Number.isFinite)) f.size={width:Math.round(Math.max(210,Math.min(1600,msg.size.width))),height:Math.round(Math.max(100,Math.min(1200,msg.size.height)))};
      if(Array.isArray(msg.order))f.memberOrder=[...new Set(msg.order)].filter(id=>meta.folders.some(c=>c.id===id&&c.bookcaseId===f.id));
      writeMeta(dir,meta);pushState();break;
    }
    case "setWallpaper": {
      if(msg.theme && !Object.hasOwn(require("../media/appearance"),msg.theme))return;
      const dir=ensureShelf(),meta=readMeta(dir),f=meta.folders.find(f=>f.id===msg.folderId);if(!f)return;
      f.wallpaper=msg.theme||"";writeMeta(dir,meta);pushState();break;
    }
    case "fileMenu": {
      const win = requestWindow();
      Menu.buildFromTemplate(fileMenuItems(win, msg.folderId, msg.path, true, msg.relative || "")).popup({ window: win });
      break;
    }

    case "cellMenu": {
      const dir = ensureShelf(), { folders } = readMeta(dir);
      const target = folders.find(f => f.id === msg.folderId);
      if (!target) return;
      const win = requestWindow();
      const action = payload => () => requestScope.run(win, () => {
        if (win.isDestroyed() || shelfDir() !== dir) return;
        withOperation(() => handleMessage(payload)).catch(error => send({ type: "toast", message: error.message }));
      });
      const menu = [
        {label:"新建格子…",click:()=>win.webContents.send("fg",{type:"requestNewCell"})},
        {label:"新建分区…",click:()=>win.webContents.send("fg",{type:"requestNewBookcase"})},
        {type:"separator"},
        {label:"壁纸背景",submenu:[{label:"跟随颜色",click:action({type:"setWallpaper",folderId:target.id,theme:""})},...Object.entries(require("../media/appearance")).map(([theme,[label]])=>({label,type:"radio",checked:target.wallpaper===theme,click:action({type:"setWallpaper",folderId:target.id,theme})}))]}
      ];
      if (target.kind === "bookcase") {
        const candidates = folders.filter(f => f.kind !== "bookcase" && f.bookcaseId !== target.id);
        menu.push(
          { label: "收纳格子", enabled: candidates.length > 0, submenu: candidates.map(f => ({ label: f.name, click: action({ type: "assignBookcase", folderId: f.id, bookcaseId: target.id }) })) },
          { label: "分区样式", submenu: [["wood","温润木质"],["glass","雾面玻璃"],["minimal","极简白色"]].map(([style,label]) => ({
            label, type: "radio", checked: (target.bookcaseStyle || "wood") === style,
            click: action({ type: "setBookcaseStyle", folderId: target.id, style })
          })) },
          { label: "背景颜色", submenu: [
            ...[["","跟随分区样式"],["#27394b","深海蓝"],["#3e513e","苔藓绿"],["#553b34","栗木棕"],["#4a3b59","暮色紫"],["#bfcbd6","银灰"]].map(([color,label]) => ({
              label, type: "radio", checked: (target.baseColor || "") === color,
              click: action({ type: "setColor", folderId: target.id, color })
            })),
            { type: "separator" },
            { label: "自定义颜色…", click: () => win.webContents.send("fg", { type: "requestCellColor", folderId: target.id }) }
          ] },
          ...fileMenuItems(win, target.id),
          { type: "separator" }
        );
      } else if (target.bookcaseId) {
        menu.push({ label: "移出分区", click: action({ type: "assignBookcase", folderId: target.id, bookcaseId: null }) });
      }
      menu.push(
        { label: "更换图案…", click: () => win.webContents.send("fg", { type: "requestCellIcon", folderId: target.id }) },
        { label: "在资源管理器中打开", click: action({ type: "open", path: target.kind === "portal" ? target.portalPath : cellPath(dir, target.name) }) },
        { label: "备注与本地会话…", click: () => win.webContents.send("fg", { type: "requestCellDetails", folderId: target.id }) },
        { label: "重命名…", click: () => win.webContents.send("fg", { type: "requestRenameCell", folderId: target.id }) },
        { label: target.kind === "portal" ? "移除文件夹映射" : target.kind === "bookcase" ? "删除书柜…" : "删除格子…", click: action({ type: "deleteCell", folderId: target.id }) }
      );
      Menu.buildFromTemplate(menu).popup({ window: win });
      break;
    }

    case "setIconAppearance": {
      if (!["card", "round", "plain"].includes(msg.appearance)) return;
      const dir = ensureShelf(), meta = readMeta(dir), target = meta.folders.find(f => f.id === msg.folderId);
      if (target) { target.icon = { ...normalizeIcon(target.icon), appearance: msg.appearance }; writeMeta(dir, meta); pushState(); }
      break;
    }
    case "setIcon":
      setIcon(msg.folderId, msg.icon, msg.dataUrl);
      break;

    case "move":
      moveFiles(msg.folderId, msg.paths, msg.relative);
      break;

    case "preview":
      send({ type: "previewData", path: msg.path, payload: readPreview(authorizedPath(msg.path)) });
      break;

    case "addPortal":
      await addPortal();
      break;

    case "setSort": {
      if (!["manual", "name", "type", "newest", "size"].includes(msg.sort)) return;
      const dir = ensureShelf(), meta = readMeta(dir);
      const f = meta.folders.find(f => f.id === msg.folderId);
      if (f) { f.sort = msg.sort; writeMeta(dir, meta); pushState(); }
      break;
    }

    case "saveRules": {
      const rules = workspace.validateRules(msg.rules);
      config.rules = rules;
      pendingPlan = null;
      saveConfig(); pushState();
      send({ type: "toast", message: "分类规则已保存，按从上到下的顺序匹配" });
      break;
    }

    case "planOrganization": {
      pendingPlan = workspace.planOrganization(app.getPath("desktop"), ensureShelf(), config.rules || workspace.DEFAULT_RULES);
      send({ type: "organizationPlan", payload: pendingPlan });
      break;
    }

    case "executeOrganization": {
      if (organizationBusy) throw new Error("正在处理整理操作，请稍候");
      organizationBusy = true;
      try {
      const plan = pendingPlan;
      if (!plan || msg.planId !== plan.id || plan.root !== fs.realpathSync(ensureShelf())) throw new Error("清单已变化，请重新预览");
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "question", title: "确认整理桌面", message: "将 " + plan.items.length + " 个文件移入格子？",
        detail: "来源：" + plan.source + "\n目标根目录：" + plan.root + "\n仅处理预览清单中的文件；同名不会覆盖。可通过工具条撤销，已修改或原位置重名的文件将保留供手动处理。",
        buttons: ["取消", "按清单移动"], defaultId: 0, cancelId: 0, noLink: true
      });
      if (confirmation.response !== 1) break;
      if (pendingPlan !== plan || plan.root !== fs.realpathSync(ensureShelf())) throw new Error("清单已变化，请重新预览");
      pendingPlan = null;
      const result = workspace.executeOrganization(plan, historyPath());
      pushState(); send({ type: "organizationResult", payload: result });
      } finally { organizationBusy = false; }
      break;
    }

    case "undoOrganization": {
      if (organizationBusy) throw new Error("正在处理整理操作，请稍候");
      organizationBusy = true;
      try {
      const answer = await dialog.showMessageBox(mainWindow, { type: "question", title: "撤销最近一次整理", message: "把最近一次整理的文件移回原桌面？", detail: "仅移回未被修改的文件；原位置有同名内容时跳过，绝不覆盖。", buttons: ["取消", "撤销整理"], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) break;
      const result = workspace.undoOrganization(historyPath());
      pushState(); send({ type: "organizationResult", payload: result });
      } finally { organizationBusy = false; }
      break;
    }

    case "endPeek":
      endPeek();
      break;

    case "openExternal": {
      const url = new URL(msg.url);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("不支持的链接");
      await shell.openExternal(url.href);
      break;
    }

    case "saveLayout": {
      if (config.layoutLocked && !["file", "panel"].includes(msg.kind)) throw new Error("请先解锁布局再拖动");
      const point=msg.position;
      if(!point || ![point.x,point.y].every(Number.isFinite)) return;
      const position={x:Math.max(0,Math.min(30000,Math.round(point.x))),y:Math.max(0,Math.min(30000,Math.round(point.y)))};
      if(msg.kind==="toolbar") {config.toolbar=position;saveConfig();return;}
      const dir=ensureShelf(),meta=readMeta(dir),f=meta.folders.find(f=>f.id===msg.folderId);if(!f)return;
      if(msg.kind==="file") { if(f.kind==="portal")throw new Error("映射不支持移动文件");const full=shelfPath(dir,msg.path),parent=require("./subfolders").directory(cellPath(dir,f.name),msg.relative);if(path.dirname(full)!==parent)throw new Error("文件不属于当前目录");f.sort="manual";f.filePositions=Object.assign(Object.create(null),f.filePositions||{});f.filePositions[(msg.relative?msg.relative+"/":"")+path.basename(full)]=position; }
      else if(msg.kind==="panel") f.panelPosition=position;
      else f.position=position;
      writeMeta(dir,meta);break;
    }
    case "setColor": {
      if(msg.color !== "" && !/^#[0-9a-f]{6}$/i.test(msg.color))return;
      const dir=ensureShelf(),meta=readMeta(dir),f=meta.folders.find(f=>f.id===msg.folderId);if(!f)return;
      if(msg.color) f.baseColor=msg.color; else delete f.baseColor;delete f.wallpaper;writeMeta(dir,meta);pushState();break;
    }
    case "trashFile": {
      const dir=ensureShelf(),meta=readMeta(dir),f=meta.folders.find(f=>f.id===msg.folderId);if(!f)return;
      if(f.kind==="portal")throw new Error("请在资源管理器中修改映射文件夹的内容");
      const full=shelfPath(dir,msg.path);if(path.dirname(full)!==require("./subfolders").directory(cellPath(dir,f.name),msg.relative))throw new Error("文件不属于当前目录");
      await shell.trashItem(full);pushState();break;
    }
    case "moveOut": {
      const dir=ensureShelf(),meta=readMeta(dir),f=meta.folders.find(f=>f.id===msg.folderId);if(!f)return;
      if(f.kind==="portal")throw new Error("请在资源管理器中修改映射文件夹的内容");
      const full=shelfPath(dir,msg.path);if(path.dirname(full)!==require("./subfolders").directory(cellPath(dir,f.name),msg.relative))throw new Error("文件不属于当前目录");
      let target; const visible = [mainWindow,...compareWindows.all()].filter(w => !w.isDestroyed() && w.isVisible()); visible.forEach(w => w.hide());
      try {target=desktop.dropTarget();} finally {visible.forEach(w => w.showInactive());}
      let destination;
      if(target.type==="desktop")destination=app.getPath("desktop");
      else {
        try {destination=await require("./explorer-target").explorerDirectory(target.handle);if(!path.isAbsolute(destination)||!fs.statSync(destination).isDirectory())throw Error();}
        catch (_) {const picked=await dialog.showOpenDialog({title:"确认拖出文件的存放目录",properties:["openDirectory"]});if(picked.canceled)return;destination=picked.filePaths[0];}
      }
      moveOne(full,destination);pushState();send({type:"toast",message:"已移到 "+destination});break;
    }
    case "desktopRegions": {
      if (requestWindow() !== mainWindow) break;
      if (!Array.isArray(msg.rects) || msg.rects.length > 512) return;
      const [width, height] = mainWindow.getContentSize();
      const rects = msg.rects.filter(r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite)).map(r => {
        const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
        return { x, y, width: Math.min(width - x, Math.ceil(r.width)), height: Math.min(height - y, Math.ceil(r.height)) };
      }).filter(r => r.width > 0 && r.height > 0);
      if (process.platform === "win32" || process.platform === "linux") mainWindow.setShape(rects.length ? rects : [{ x: 0, y: 0, width: 1, height: 1 }]);
      break;
    }

    case "focusInput":
      if (!["askInput", "searchInput", "globalSearchInput", "rulesInput", "layoutNameInput", "pdfPage", "newCellNote", "newCellSession", "cellNote", "cellSession"].includes(msg.id)) return;
      requestWindow().focus();
      requestWindow().webContents.focus();
      send({ type: "inputFocused", id: msg.id });
      break;

    case "openCompare": compareWindows.open(msg); break;
    case "closeCompare": if (requestWindow() !== mainWindow) requestWindow().close(); break;
    case "assignBookcase": {
      const dir = ensureShelf(), meta = readMeta(dir);
      require("./bookcases").assign(meta.folders, msg.folderId, msg.bookcaseId);
      writeMeta(dir, meta); pushState(); break;
    }
    case "setBookcaseStyle": {
      if (!require("./bookcases").STYLES.includes(msg.style)) throw new Error("书柜样式无效");
      const dir = ensureShelf(), meta = readMeta(dir), f = meta.folders.find(f => f.id === msg.folderId && f.kind === "bookcase");
      if (f) { f.bookcaseStyle = msg.style; writeMeta(dir, meta); pushState(); } break;
    }
    case "setFeedback":
      config.feedback = require("./cell-details").feedback(msg.feedback); saveConfig(); pushState(); break;
    case "saveCellDetails": {
      const value = require("./cell-details").details(msg), dir = ensureShelf(), meta = readMeta(dir), f = meta.folders.find(f => f.id === msg.folderId);
      if (!f) return; Object.assign(f, value); writeMeta(dir, meta); pushState(); send({type:"cellDetailsSaved",folderId:f.id}); break;
    }
    case "revealCellSession": {
      const f = readMeta(ensureShelf()).folders.find(f => f.id === msg.folderId);
      if (!f?.sessionPath || !fs.existsSync(f.sessionPath)) throw new Error("关联会话未设置或已被移走");
      shell.showItemInFolder(f.sessionPath); break;
    }
    case "setStartup":
      try { startup.setEnabled(msg.enabled); send({ type: "toast", message: msg.enabled ? "已开启开机自启动" : "已关闭开机自启动" }); }
      finally { pushState(); }
      break;
    case "lockLayout":
      if (dragInProgress) throw new Error("请先完成拖动");
      if (typeof msg.locked !== "boolean") return;
      config.layoutLocked = msg.locked; saveConfig(); pushState();
      break;
    case "saveLayoutPreset": {
      if (dragInProgress) throw new Error("请先完成拖动");
      const dir = ensureShelf();
      layouts.save(dir, msg.name, readMeta(dir).folders, msg.cells, msg.toolbar);
      pushState(); send({ type: "toast", message: "布局已保存" }); break;
    }
    case "applyLayoutPreset": {
      if (dragInProgress || organizationBusy) throw new Error("请先完成当前操作");
      if (config.layoutLocked) throw new Error("请先解锁布局再切换");
      const dir = ensureShelf(), meta = readMeta(dir), restored = layouts.restore(dir, msg.id, meta.folders);
      writeMeta(dir, { ...meta, folders: restored.folders });
      config.toolbar = restored.toolbar; saveConfig(); pushState();
      send({ type: "toast", message: "布局已切换，文件仍保留原处" }); break;
    }
    case "deleteLayoutPreset":
      layouts.remove(ensureShelf(), msg.id); pushState(); break;
    case "updateCheck": if (updates) await updates.check(true); break;
    case "updateDownload": if (updates) await updates.download(); break;
    case "updateInstall": if (updates) updates.install(); break;
    case "updateDismiss": if (updates) updates.dismiss(); break;
    case "dragState": if (msg.active) draggingWindows.add(requestWindow().id); else draggingWindows.delete(requestWindow().id); if (requestWindow() === mainWindow) dragInProgress = Boolean(msg.active); break;
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
  const origin = BrowserWindow.fromWebContents(event.sender);
  if (!origin || (origin !== mainWindow && !compareWindows?.owns(origin)) || event.senderFrame !== event.sender.mainFrame || !msg || typeof msg !== "object") return;
  requestScope.run(origin, () => {
  Promise.resolve()
    .then(function () {
      const mutations = ["newSubfolder","saveBookcaseGeometry","setWallpaper","assignBookcase", "setBookcaseStyle", "setFeedback", "saveCellDetails", "setIcon", "setIconAppearance", "setStartup", "lockLayout", "saveLayoutPreset", "applyLayoutPreset", "deleteLayoutPreset", "newCell", "renameCell", "deleteCell", "move", "moveOut", "trashFile", "executeOrganization", "undoOrganization", "saveRules", "setColor", "saveLayout", "addPortal", "pickRoot", "setSort"];
      return mutations.includes(msg.type) ? withOperation(() => handleMessage(msg)) : handleMessage(msg);
    })
    .catch(function (err) {
      send({ type: "toast", message: String((err && err.message) || err) });
    });
  });
});

/* ---------------- 选目录 ---------------- */

async function pickRoot() { return withOperation(pickRootImpl); }
async function pickRootImpl() {
  const result = await dialog.showOpenDialog({
    title: "选择格子存放的目录",
    defaultPath: shelfDir(),
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) return;

  config.shelfDir = result.filePaths[0];
  pendingPlan = null;
  saveConfig();

  const dir = ensureShelf();
  startWatcher(dir);
  pushState();
  send({ type: "toast", message: "格子目录已切换到 " + dir });
}

async function addPortal() { return withOperation(addPortalImpl); }
async function addPortalImpl() {
  const dir = ensureShelf();
  const result = await dialog.showOpenDialog(mainWindow, { title: "映射文件夹到桌面（保留原位置）", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths.length) return;
  if (dir !== shelfDir()) throw new Error("格子目录已切换，请重新添加");
  const folder = fs.realpathSync(result.filePaths[0]);
  const meta = readMeta(dir);
  if (meta.folders.some(f => (f.kind === "portal" ? f.portalPath : fs.realpathSync(cellPath(dir, f.name))) === folder)) throw new Error("此文件夹已经显示在桌面上");
  meta.folders.push({ id: makeId(), name: path.basename(folder) || folder, kind: "portal", portalPath: folder, hue: PALETTE[meta.folders.length % PALETTE.length], icon: { type: "auto" } });
  writeMeta(dir, meta); pushState();
  send({ type: "toast", message: "已映射文件夹，文件保留在原位置；映射中可搜索、预览和打开" });
}

function endPeek() {
  if (!mainWindow || !peekActive) return;
  peekActive = false;
  mainWindow.setAlwaysOnTop(false);
  if (desktop) desktop.lower(mainWindow);
}

function peek(search) {
  if (!mainWindow) return;
  if (peekActive && !search) { endPeek(); return; }
  userHidden = false;
  peekActive = true;
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show(); mainWindow.focus(); mainWindow.webContents.focus();
  if (search) send({ type: "requestGlobalSearch" });
}

function registerShortcuts() {
  const bindings = {
    peek: ["CommandOrControl+Shift+Space", () => peek(false)],
    search: ["CommandOrControl+Shift+F", () => peek(true)],
    hide: ["CommandOrControl+Shift+H", () => {
      if (!mainWindow) return;
      if (userHidden) { userHidden = false; mainWindow.showInactive(); connectDesktop(); }
      else { endPeek(); userHidden = true; mainWindow.hide(); }
    }]
  };
  config.shortcuts = {};
  for (const [key, [accelerator, action]] of Object.entries(bindings)) {
    config.shortcuts[key] = { accelerator, registered: globalShortcut.register(accelerator, action) };
    if (!config.shortcuts[key].registered) log("快捷键已被其他程序占用", accelerator);
  }
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
    if (!mainWindow.isVisible() && !userHidden) mainWindow.showInactive();
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
  if (process.platform === "win32" || process.platform === "linux") mainWindow.setShape([{ x: 0, y: 0, width: 1, height: 1 }]);
  mainWindow.on("blur", () => { endPeek(); if (desktop && mainWindow) desktop.lower(mainWindow); });
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => log("页面加载失败", code, desc));
  mainWindow.webContents.on("render-process-gone", (_e, details) => { dragInProgress = false; log("渲染进程退出", details); });
  mainWindow.webContents.on("console-message", event => log("[页面]", event.message));
  mainWindow.once("ready-to-show", () => {
    if (windowTest) { mainWindow.show(); return; }
    connectDesktop();
  });
  mainWindow.on("closed", () => {
    dragInProgress = false;
    mainWindow = null;
    desktopInfo.connected = false;
    // 保留托盘；桌面宿主恢复后可重新建立桌面层。
  });
  mainWindow.on("focus", () => { try { pushState(); } catch (err) { log(err); } });
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
    { label: "显示桌面图标", click: () => { if (mainWindow) { userHidden = false; mainWindow.showInactive(); connectDesktop(); } } },
    { label: "快捷呼出 / 收回    Ctrl+Shift+Space", click: () => peek(false) },
    { label: "搜索所有格子    Ctrl+Shift+F", click: () => peek(true) },
    { label: "映射外部文件夹…", click: () => addPortal().catch(err => send({ type: "toast", message: err.message })) },
    { label: "新建格子…", click: () => send({ type: "requestNewCell" }) },
    { label: "选择文件目录…", click: pickRoot },
    { label: "在资源管理器中打开", click: () => shell.openPath(shelfDir()) },
    { label: "刷新", click: () => { try { pushState(); } catch (err) { send({ type: "toast", message: err.message }); } } },
    { type: "separator" },
    { label: "设置与布局…", click: () => { if (mainWindow) { userHidden = false; mainWindow.showInactive(); mainWindow.focus(); send({ type: "requestSettings" }); } } },
    { label: "检查更新…", click: () => updates && updates.check(true) },
    { label: "下载更新", click: () => updates && updates.download() },
    { label: "重启安装更新", click: () => updates && updates.install() },
    { label: "接收开发版更新", type: "checkbox", checked: require("./updates").defaultPrerelease(app.getVersion(), config.updatePrerelease), click: item => { config.updatePrerelease = item.checked; saveConfig(); if (updates) updates.setPrerelease(item.checked); } },
    { type: "separator" },
    { label: "退出 folder-grid", click: () => app.quit() }
  ]));
  tray.on("click", () => { if (mainWindow) { userHidden = false; mainWindow.showInactive(); connectDesktop(); } });
}

/* ---------------- 启动 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { userHidden = false; mainWindow.showInactive(); connectDesktop(); } });
  app.on("before-quit", event => {
    if (fileBusy()) { event.preventDefault(); send({ type: "toast", message: "正在处理文件或拖动，请完成后再退出" }); return; }
    if (updateTimer) clearTimeout(updateTimer);
    if (updateInterval) clearInterval(updateInterval);
    if (updates) updates.dispose();
    quitting = true;
    if (compareWindows) compareWindows.closeAll();
    if (desktopTimer) clearInterval(desktopTimer);
    stopWatcher();
    for (const watcher of portalWatchers.values()) watcher.close();
    globalShortcut.unregisterAll();
    if (tray) tray.destroy();
  });
  app.whenReady().then(() => {
    if (process.platform !== "win32" && !windowTest) throw new Error("桌面模式目前仅支持 Windows");
    config = loadConfig();
    compareWindows = require("./compare-windows").createCompareWindows({ BrowserWindow, screen, preload: path.join(__dirname,"preload.js"), index: path.join(__dirname,"../index.html"), state: buildState, authorize: authorizedPath, log });
    app.on("browser-window-created", (_event, win) => win.on("closed", () => draggingWindows.delete(win.id)));
    startup = require("./startup").createStartup({ app, enabled: app.isPackaged && !windowTest && process.platform === "win32" });
    layouts = require("./layouts").createLayouts(path.join(app.getPath("userData"), "layout-presets.json"));
    if (!windowTest) desktop = require("./desktop").createWindowsDesktop();
    updates = require("./updates").createUpdates({
      updater: app.isPackaged && !windowTest ? require("electron-updater").autoUpdater : null,
      enabled: app.isPackaged && !windowTest && process.platform === "win32", currentVersion: app.getVersion(),
      prerelease: require("./updates").defaultPrerelease(app.getVersion(), config.updatePrerelease), isBusy: fileBusy, notify: payload => send({ type: "updateState", payload }), log,
      prepareInstall: () => { quitting = true; }, cancelInstall: () => { quitting = false; }
    });
    if (app.isPackaged && !windowTest) {
      updateTimer = setTimeout(() => updates.check(false), 30000); updateTimer.unref();
      updateInterval = setInterval(() => updates.check(false), 6 * 60 * 60 * 1000); updateInterval.unref();
    }
    buildTray();
    startWatcher(ensureShelf());
    createWindow();
    if (!windowTest) registerShortcuts();
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
