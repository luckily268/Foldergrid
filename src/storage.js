"use strict";
const fs = require("fs");
const path = require("path");

function cellName(value) {
  if (typeof value !== "string") throw new Error("请输入格子名称");
  const name = value.trim();
  if (!name || name.length > 100 || name.startsWith(".") || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) {
    throw new Error("名称不能包含路径、特殊字符、隐藏目录或 Windows 保留名称（最多 100 字）");
  }
  return name;
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep));
}

function shelfPath(root, target) {
  if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("文件路径无效");
  const base = fs.realpathSync(root);
  const resolved = fs.realpathSync(target);
  if (!inside(base, resolved)) throw new Error("只能操作当前格子目录中的文件");
  return resolved;
}

function cellPath(root, name) {
  const target = path.join(root, cellName(name));
  if (fs.existsSync(target)) shelfPath(root, target);
  return target;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + "." + require("crypto").randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

// 同卷使用 rename；只有跨卷错误才复制。复制完成之前绝不删除源文件。
function moveOne(source, targetDir, destinationName) {
  if (typeof source !== "string" || !path.isAbsolute(source)) throw new Error("拖入的路径无效");
  const src = fs.realpathSync(source);
  const dir = fs.realpathSync(targetDir);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error("暂不移动符号链接或目录联接，请在资源管理器中操作");
  if (path.dirname(src).toLowerCase() === dir.toLowerCase()) return false;
  if (stat.isDirectory() && inside(src, dir)) throw new Error("不能把文件夹移入自身或它的子目录");
  const destName = destinationName === undefined ? path.basename(source) : destinationName;
  if (typeof destName !== "string" || !destName || destName !== path.basename(destName) || /[/\\]/.test(destName) || destName === "." || destName === "..") throw new Error("目标名称无效");
  const dest = path.join(dir, destName);
  if (fs.existsSync(dest)) throw new Error("目标中已有同名文件");
  try {
    fs.renameSync(source, dest);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    // 独立暂存目录避免复制到一半的文件被误当成已完成。
    const stage = fs.mkdtempSync(path.join(dir, ".fg-move-"));
    const payload = path.join(stage, path.basename(source));
    try {
      fs.cpSync(source, payload, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
      if (fs.existsSync(dest)) throw new Error("目标中已有同名文件");
      fs.renameSync(payload, dest);
      try {
        fs.rmSync(source, { recursive: true });
      } catch (deleteError) {
        throw new Error("已复制到格子，但源文件未能删除，请在资源管理器中检查：" + deleteError.message);
      }
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  return true;
}

function removeCellToDesktop(cellDir, desktopDir) {
  const source = fs.realpathSync(cellDir);
  fs.mkdirSync(desktopDir, { recursive: true });
  const desktop = fs.realpathSync(desktopDir);
  if (inside(source, desktop)) throw new Error("不能删除桌面本身或包含桌面的格子");
  const entries = fs.readdirSync(source);
  let moved = 0;
  for (const name of entries) {
    try {
      const from = path.join(source, name);
      const ext = fs.lstatSync(from).isDirectory() ? "" : path.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let destName = name;
      for (let i = 1; fs.existsSync(path.join(desktop, destName)); i++) {
        const suffix = " (folder-grid " + i + ")";
        destName = stem.slice(0, Math.max(1, 255 - suffix.length - ext.length)) + suffix + ext;
      }
      if (moveOne(from, desktop, destName)) moved++;
    } catch (err) {
      throw new Error("已移到桌面 " + moved + " 项；“" + name + "”移动失败，格子已保留：" + err.message);
    }
  }
  // 只移除空目录，包括隐藏内容在内的任何文件都必须先移到桌面。
  fs.rmdirSync(source);
  return moved;
}

module.exports = { cellName, cellPath, shelfPath, inside, atomicJson, moveOne, removeCellToDesktop };
