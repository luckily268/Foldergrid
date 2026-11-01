"use strict";
const STYLES = ['wood', 'glass', 'minimal'];
function options(raw = {}) {
  if (raw.kind !== undefined && !['local', 'bookcase'].includes(raw.kind)) throw new Error('分区类型无效');
  if (raw.kind !== 'bookcase') return {};
  if (raw.bookcaseStyle !== undefined && !STYLES.includes(raw.bookcaseStyle)) throw new Error('书柜样式无效');
  return { kind: 'bookcase', bookcaseStyle: raw.bookcaseStyle || 'wood' };
}
function assign(folders, id, bookcaseId) {
  const cell = folders.find(f => f.id === id);
  if (!cell || cell.kind === 'bookcase') throw new Error('只能把普通格子或文件夹映射放入书柜');
  if (bookcaseId) {
    const parent = folders.find(f => f.id === bookcaseId);
    if (!parent || parent.kind !== 'bookcase') throw new Error('书柜不存在');
    cell.bookcaseId = bookcaseId;
  } else delete cell.bookcaseId;
}
function detach(folders, bookcaseId) { for (const f of folders) if (f.bookcaseId === bookcaseId) delete f.bookcaseId; }
module.exports = { options, assign, detach, STYLES };
