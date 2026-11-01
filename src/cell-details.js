"use strict";
const fs = require('fs'), path = require('path');
function details(value = {}) {
  const note = typeof value.note === 'string' ? value.note.trim() : '';
  const sessionPath = typeof value.sessionPath === 'string' ? value.sessionPath.trim() : '';
  if (note.length > 2000) throw new Error('备注最多 2000 字');
  if (sessionPath && (!path.isAbsolute(sessionPath) || sessionPath.startsWith('\\\\') || !fs.existsSync(sessionPath))) throw new Error('请选择存在的本地会话文件或目录');
  return { note, sessionPath };
}
function feedback(value = {}) { return { motion: value.motion !== false, sound: value.sound === true }; }
module.exports = { details, feedback };
