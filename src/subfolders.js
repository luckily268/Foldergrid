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
function rename(folder, relative, source, name){
  const parent=fs.realpathSync(directory(folder,relative));
  if(typeof source!=="string"||!path.isAbsolute(source))throw new Error("文件夹路径无效");
  const info=fs.lstatSync(source),full=shelfPath(folder,source);
  if(info.isSymbolicLink()||!info.isDirectory()||path.dirname(full)!==parent)throw new Error("只能重命名当前目录内的普通文件夹");
  const target=path.join(parent,cellName(name));
  if(full===target)return {source:full,target};
  let existing;
  try{existing=fs.lstatSync(target);}catch(error){if(error.code!=="ENOENT")throw error;}
  const caseOnly=process.platform==="win32"&&full.toLowerCase()===target.toLowerCase()&&existing?.dev===info.dev&&existing?.ino===info.ino;
  if(existing&&!caseOnly)throw new Error("已有同名文件或文件夹，请换一个名称");
  fs.renameSync(full,target);
  return {source:full,target};
}
module.exports = { directory, create, rename };
