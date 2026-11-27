"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { cellName, shelfPath } = require("./storage");

function directory(folder, relative = "") {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("文件夹路径无效");
  const target = path.resolve(folder, relative);
  shelfPath(folder, target);
  if (!fs.statSync(target).isDirectory()) throw new Error("目录已不存在");
  return target;
}
function create(folder, relative, name) {
  const target = path.join(directory(folder, relative), cellName(name));
  fs.mkdirSync(target);
  return target;
}
module.exports = { directory, create };
