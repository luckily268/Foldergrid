"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { copyInto, windowsFileClipboard } = require("./file-clipboard");

function createFileMenus({ resolveFolder, authorize, notify, onChange, withOperation, scope }) {
  let clipboard;
  const getClipboard = () => clipboard ||= windowsFileClipboard();
  return function items(win, folderId, source, visible = true, relative = "") {
    const folder = resolveFolder(folderId, relative);
    const file = source ? authorize(source) : null;
    const run = task => () => scope(win, () => Promise.resolve().then(task).catch(error => notify(error.message)));
    return [
      { label: "新建文件夹…", enabled: folder.writable, click: () => win.webContents.send("fg", {type:"requestNewSubfolder",folderId}) },
      { label: "复制", visible: visible && Boolean(file), click: run(() => {
        getClipboard().write(win, authorize(file));
        notify("已复制 " + path.basename(file));
      }) },
      { label: "粘贴", visible, enabled: folder.writable && getClipboard().available(), click: run(() => withOperation(async () => {
        const destination = resolveFolder(folderId, relative);
        if (!destination.writable || destination.path !== folder.path) throw new Error("格子已变化，请重新选择粘贴位置");
        const paths = getClipboard().read();
        if (!paths.length) throw new Error("剪贴板里没有可粘贴的文件");
        let count = 0;
        const failures = [];
        for (const source of paths) {
          try {
            const current = resolveFolder(folderId, relative);
            if (current.path !== destination.path || !current.writable || !fs.existsSync(current.path)) throw new Error("目标格子已变化");
            await copyInto(source, current.path);
            count++;
          } catch (error) { failures.push(path.basename(source) + "：" + error.message); }
        }
        if (count) onChange(folderId, count);
        notify("已粘贴 " + count + " 项" + (failures.length ? "，失败 " + failures.length + " 项：" + failures.slice(0, 3).join("、") : ""));
      })) }
    ];
  };
}

module.exports = { createFileMenus };
