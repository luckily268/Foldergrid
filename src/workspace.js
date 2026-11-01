"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cellName, cellPath, inside, atomicJson, moveOne } = require("./storage");

const DEFAULT_RULES = [
  ["图片", "png,jpg,jpeg,gif,webp,bmp,avif,heic,svg"],
  ["文档", "pdf,doc,docx,xls,xlsx,ppt,pptx,txt,md,csv,rtf,odt"],
  ["压缩包", "zip,rar,7z,tar,gz,xz"],
  ["视频", "mp4,mov,mkv,avi,webm,m4v"],
  ["音频", "mp3,wav,flac,m4a,ogg,aac"],
  ["快捷方式", "lnk,url"]
].map(([target, extensions]) => ({ target, extensions, keyword: "", enabled: true }));

function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 100) throw new Error("最多设置 100 条规则");
  return rules.map(rule => {
    if (!rule || typeof rule.extensions !== "string" || typeof rule.keyword !== "string") throw new Error("规则格式无效");
    const extensions = rule.extensions.toLowerCase().split(/[,，;；\s]+/).filter(Boolean).map(s => s.replace(/^\./, ""));
    if (extensions.length > 100 || extensions.some(s => !/^[a-z0-9]{1,16}$/.test(s)) || rule.keyword.length > 100) throw new Error("请填写有效的扩展名和关键词");
    if (!extensions.length && !rule.keyword.trim()) throw new Error("规则至少需要扩展名或关键词");
    return { target: cellName(rule.target), extensions: [...new Set(extensions)].join(","), keyword: rule.keyword.trim(), enabled: rule.enabled !== false };
  });
}

// 两个条件同时填写时取交集；多条匹配时采用第一条，顺序可由界面调整。
function matchRule(name, rules) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return rules.find(rule => rule.enabled && (!rule.extensions || rule.extensions.split(",").includes(ext)) && (!rule.keyword || name.toLowerCase().includes(rule.keyword.toLowerCase())));
}

function fingerprint(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink()) throw new Error("仅支持普通文件");
  return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino, dev: s.dev };
}
function unchanged(file, stamp) {
  try { const current = fingerprint(file); return Object.keys(current).every(k => current[k] === stamp[k]); }
  catch (_) { return false; }
}
function directFile(dir, file) {
  return path.dirname(file) === dir && inside(dir, file) && !fs.lstatSync(file).isSymbolicLink();
}

function planOrganization(sourceDir, rootDir, rawRules) {
  const source = fs.realpathSync(sourceDir), root = fs.realpathSync(rootDir);
  if (source === root) throw new Error("收纳根目录不能同时作为整理来源，请先切换格子目录");
  const rules = validateRules(rawRules), items = [], skipped = [];
  const names = fs.readdirSync(source).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  if (names.length > 10000) throw new Error("来源目录项目过多，请先手动整理一部分");
  for (const name of names) {
    if (name.startsWith(".") || name.toLowerCase() === "desktop.ini") continue;
    const file = path.join(source, name);
    try {
      if (!directFile(source, file) || !fs.lstatSync(file).isFile()) continue;
      const rule = matchRule(name, rules);
      if (!rule) continue;
      const targetDir = cellPath(root, rule.target);
      if (fs.existsSync(targetDir) && (fs.lstatSync(targetDir).isSymbolicLink() || !fs.statSync(targetDir).isDirectory())) throw new Error("目标不是普通格子文件夹");
      const target = path.join(targetDir, name);
      if (fs.existsSync(target)) { skipped.push({ name, reason: "目标已有同名文件" }); continue; }
      items.push({ name, source: file, target, cell: rule.target, stamp: fingerprint(file) });
      if (items.length > 1000) throw new Error("一次最多整理 1000 个文件，请缩小规则范围");
    } catch (err) {
      if (items.length > 1000) throw err;
      skipped.push({ name, reason: err.message });
    }
  }
  return { id: randomUUID(), source, root, createdAt: Date.now(), items, skipped };
}

function readHistory(file) {
  try {
    const history = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(history)) throw new Error("格式无效");
    return history;
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new Error("整理记录读取失败，请先备份检查：" + err.message);
  }
}

function executeOrganization(plan, historyFile) {
  if (Date.now() - plan.createdAt > 10 * 60 * 1000) throw new Error("预览已过期，请重新预览");
  const history = readHistory(historyFile);
  const batch = { id: plan.id, source: plan.source, root: plan.root, entries: [], createdAt: Date.now() };
  history.push(batch);
  atomicJson(historyFile, history);
  const failed = [];
  for (const item of plan.items) {
    let receipt;
    try {
      if (!directFile(plan.source, item.source) || !unchanged(item.source, item.stamp)) throw new Error("来源已变化，请重新预览");
      const targetDir = cellPath(plan.root, item.cell);
      if (path.join(targetDir, item.name) !== item.target) throw new Error("目标已变化");
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir);
      if (fs.lstatSync(targetDir).isSymbolicLink()) throw new Error("目标不能是目录联接");
      receipt = { source: item.source, target: item.target, status: "pending" };
      batch.entries.push(receipt);
      atomicJson(historyFile, history); // 移动之前留记录，异常退出也能追踪。
      moveOne(item.source, targetDir);
      receipt.stamp = fingerprint(item.target);
      receipt.status = "moved";
      atomicJson(historyFile, history);
    } catch (err) {
      failed.push({ name: item.name, reason: err.message });
      if (receipt) receipt.error = err.message;
      atomicJson(historyFile, history);
    }
  }
  return { moved: batch.entries.filter(e => e.status === "moved").length, failed };
}

function undoOrganization(historyFile) {
  const history = readHistory(historyFile);
  const batch = [...history].reverse().find(b => b.entries.some(e => e.status === "moved"));
  if (!batch) return { restored: 0, failed: [] };
  const failed = [];
  let restored = 0;
  for (const item of [...batch.entries].reverse()) {
    if (item.status !== "moved") continue;
    try {
      const sourceDir = fs.realpathSync(batch.source), root = fs.realpathSync(batch.root);
      if (sourceDir !== batch.source || root !== batch.root || path.dirname(item.source) !== sourceDir || !inside(root, fs.realpathSync(item.target))) throw new Error("原目录位置已变化");
      if (!unchanged(item.target, item.stamp)) throw new Error("文件已被修改或替换，请手动移回");
      if (fs.existsSync(item.source)) throw new Error("原位置已有同名文件，未覆盖");
      moveOne(item.target, sourceDir);
      item.status = "restored";
      atomicJson(historyFile, history);
      restored++;
    } catch (err) { failed.push({ name: path.basename(item.target), reason: err.message }); }
  }
  return { restored, failed };
}

function portalPath(folder, target) {
  const root = fs.realpathSync(folder), resolved = fs.realpathSync(target);
  if (!inside(root, resolved)) throw new Error("只能访问已映射文件夹中的内容");
  return resolved;
}

module.exports = { DEFAULT_RULES, validateRules, matchRule, planOrganization, executeOrganization, undoOrganization, readHistory, portalPath };
