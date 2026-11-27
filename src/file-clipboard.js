"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inside } = require("./storage");

function windowsFileClipboard() {
  const koffi = require("koffi");
  const user = koffi.load("user32.dll");
  const kernel = koffi.load("kernel32.dll");
  const shell = koffi.load("shell32.dll");
  const open = user.func("int __stdcall OpenClipboard(uintptr_t window)");
  const close = user.func("int __stdcall CloseClipboard()");
  const empty = user.func("int __stdcall EmptyClipboard()");
  const available = user.func("int __stdcall IsClipboardFormatAvailable(uint format)");
  const get = user.func("void * __stdcall GetClipboardData(uint format)");
  const set = user.func("void * __stdcall SetClipboardData(uint format, void *memory)");
  const alloc = kernel.func("void * __stdcall GlobalAlloc(uint flags, size_t bytes)");
  const lock = kernel.func("void * __stdcall GlobalLock(void *memory)");
  const unlock = kernel.func("int __stdcall GlobalUnlock(void *memory)");
  const free = kernel.func("void * __stdcall GlobalFree(void *memory)");
  const query = shell.func("uint __stdcall DragQueryFileW(void *drop, uint index, _Out_ void *buffer, uint capacity)");
  const fileDrop = 15;

  return {
    available: () => Boolean(available(fileDrop)),
    write(win, file) {
      const names = Buffer.from(file + "\0\0", "utf16le");
      const header = Buffer.alloc(20);
      header.writeUInt32LE(20);
      header.writeUInt32LE(1, 16);
      const payload = Buffer.concat([header, names]);
      let memory = alloc(2, payload.length);
      if (!memory) throw new Error("无法分配文件剪贴板");
      try {
        const address = lock(memory);
        if (!address) throw new Error("无法写入文件剪贴板");
        try { payload.copy(Buffer.from(koffi.view(address, payload.length))); }
        finally { unlock(memory); }
        const handle = win.getNativeWindowHandle();
        const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE();
        if (!open(hwnd)) throw new Error("剪贴板正忙，请重试");
        try {
          if (!empty() || !set(fileDrop, memory)) throw new Error("无法复制文件到剪贴板");
          memory = null; // Windows takes ownership after SetClipboardData succeeds.
        } finally { close(); }
      } finally { if (memory) free(memory); }
    },
    read() {
      if (!open(0)) throw new Error("剪贴板正忙，请重试");
      try {
        const drop = get(fileDrop);
        if (!drop) return [];
        const count = query(drop, 0xffffffff, null, 0);
        if (count > 1000) throw new Error("一次最多粘贴 1000 项");
        return Array.from({ length: count }, (_, index) => {
          const size = query(drop, index, null, 0);
          const name = Buffer.alloc((size + 1) * 2);
          const length = query(drop, index, name, size + 1);
          return name.toString("utf16le", 0, length * 2);
        });
      } finally { close(); }
    }
  };
}

async function copyInto(source, destination) {
  if (!path.isAbsolute(source)) throw new Error("剪贴板文件路径无效");
  const dir = await fs.promises.realpath(destination);
  const stat = await fs.promises.lstat(source);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error("只支持复制普通文件和文件夹");
  const real = await fs.promises.realpath(source);
  if (stat.isDirectory() && inside(process.platform === "win32" ? real.toLowerCase() : real, process.platform === "win32" ? dir.toLowerCase() : dir)) {
    throw new Error("不能将文件夹复制到自身或子目录");
  }
  const name = path.basename(source);
  const ext = stat.isDirectory() ? "" : path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let index = 0; index < 10000; index++) {
    const suffix = index ? " - 副本" + (index > 1 ? " (" + index + ")" : "") : "";
    const target = path.join(dir, suffix ? stem.slice(0, Math.max(1, 255 - suffix.length - ext.length)) + suffix + ext : name);
    if (path.relative(dir, target) === "" || path.dirname(target) !== dir) throw new Error("目标路径无效");
    try { await fs.promises.lstat(target); continue; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try {
      if (stat.isFile()) await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      else {
        const stage = await fs.promises.mkdtemp(path.join(dir, ".fg-copy-"));
        try {
          const payload = path.join(stage, "payload");
          await fs.promises.cp(source, payload, { recursive: true, preserveTimestamps: true, filter: async entry => {
            const item = await fs.promises.lstat(entry);
            if (!item.isFile() && !item.isDirectory()) throw new Error("文件夹包含链接或特殊文件");
            return true;
          } });
          await fs.promises.lstat(target).then(() => { throw Object.assign(new Error("目标已存在"), { code: "EEXIST" }); }, error => { if (error.code !== "ENOENT") throw error; });
          await fs.promises.rename(payload, target);
        } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
      }
      return target;
    } catch (error) { if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error; }
  }
  throw new Error("同名副本过多，请先整理目标格子");
}

module.exports = { windowsFileClipboard, copyInto };
