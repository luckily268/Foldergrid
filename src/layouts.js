"use strict";
const fs = require("fs"), path = require("path"), { randomUUID } = require("crypto");
const { atomicJson } = require("./storage");
const point = p => p && [p.x, p.y].every(Number.isFinite) ? { x: Math.max(0, Math.min(30000, Math.round(p.x))), y: Math.max(0, Math.min(30000, Math.round(p.y))) } : undefined;
const rootKey = root => fs.realpathSync(root).toLowerCase();
const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
function cleanPositions(input) {
  const out = Object.create(null);
  for (const [name, p] of Object.entries(input || {}).slice(0, 10000)) {
    if (name && name === path.basename(name) && !/[\\/]/.test(name) && point(p)) out[name] = point(p);
  }
  return out;
}
function createLayouts(file) {
  function load() {
    try {
      if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error("文件过大");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.items) || data.items.some(i => !validId(i.id) || typeof i.root !== "string" || typeof i.name !== "string" || !Array.isArray(i.cells))) throw new Error("格式无效");
      return data;
    } catch (e) { if (e.code === "ENOENT") return { version: 1, items: [] }; throw new Error("布局记录读取失败，请先备份检查：" + e.message); }
  }
  function list(root) { return load().items.filter(i => i.root === rootKey(root)).map(({ id, name, createdAt, cells }) => ({ id, name, createdAt, count: cells.length })); }
  function save(root, name, folders, captured, toolbar) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 40) throw new Error("请输入 1–40 字的布局名称");
    const data = load(), key = rootKey(root);
    if (data.items.filter(i => i.root === key).length >= 20 || data.items.length >= 100) throw new Error("已达到布局数量上限，请先删除不用的布局");
    if (data.items.some(i => i.root === key && i.name === name.trim())) throw new Error("已有同名布局，请使用其他名称");
    if (!Array.isArray(captured) || captured.length > 10000) throw new Error("布局位置无效");
    const coords = new Map(captured.filter(c => c && validId(c.id)).map(c => [c.id, point(c.position)]));
    const cells = folders.map(f => ({ id: f.id, position: coords.get(f.id) || point(f.position), filePositions: cleanPositions(f.filePositions), sort: f.sort || "manual" }));
    data.items.push({ id: randomUUID(), name: name.trim(), root: key, createdAt: new Date().toISOString(), toolbar: point(toolbar), cells });
    atomicJson(file, data);
  }
  function restore(root, id, folders) {
    const saved = load().items.find(i => i.root === rootKey(root) && i.id === id);
    if (!saved) throw new Error("找不到当前目录下的此布局");
    const byId = new Map(saved.cells.map(c => [c.id, c]));
    return { toolbar: point(saved.toolbar), folders: folders.map(f => {
      const c = byId.get(f.id); if (!c) return { ...f };
      return { ...f, position: point(c.position), filePositions: cleanPositions(c.filePositions), sort: ["manual", "name", "type", "newest", "size"].includes(c.sort) ? c.sort : "manual" };
    }) };
  }
  function remove(root, id) {
    const data = load(), key = rootKey(root);
    data.items = data.items.filter(i => i.root !== key || i.id !== id); atomicJson(file, data);
  }
  return { list, save, restore, remove };
}
module.exports = { createLayouts, point };
