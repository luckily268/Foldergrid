const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { cellName, cellPath, shelfPath, atomicJson, moveOne } = require('../src/storage');
const { removeCellToDesktop } = require('../src/storage');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-grid-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, '格子'); fs.mkdirSync(dest);
  const src = path.join(root, '文档.txt'); fs.writeFileSync(src, '原始内容');
  return { root, dest, src, target: path.join(dest, '文档.txt') };
}
test('中文名称可用，拒绝路径、设备名、隐藏名称和结尾点', () => {
  assert.equal(cellName(' 工作资料 '), '工作资料');
  for (const value of ['../外部', '..\\外部', '.', '..', 'a/b', 'a\\b', 'C:\\a', 'NUL', 'CON.txt', 'LPT1', '.icons', '结尾.', '', null, 'x'.repeat(101)]) assert.throws(() => cellName(value));
});
test('格子路径不会越出根目录', t => {
  const { root } = fixture(t); assert.throws(() => cellPath(root, '../外部'));
  assert.equal(cellPath(root, '新格子'), path.join(root, '新格子'));
});
test('读取只接受当前格子内的真实绝对路径', t => {
  const { root, dest, src } = fixture(t);
  assert.equal(shelfPath(root, src), fs.realpathSync(src));
  assert.throws(() => shelfPath(dest, src)); assert.throws(() => shelfPath(root, '../文档.txt'));
});
test('原子保存生成有效 JSON 且不遗留临时文件', t => {
  const { root } = fixture(t); const file = path.join(root, 'grid.json');
  atomicJson(file, { folders: [] }); atomicJson(file, { folders: [{ name: '工作' }] });
  assert.equal(JSON.parse(fs.readFileSync(file)).folders[0].name, '工作');
  assert.equal(fs.readdirSync(root).filter(n => n.endsWith('.tmp')).length, 0);
});
test('正常移动保留内容并删除源文件，同目录移动跳过', t => {
  const { src, dest, target } = fixture(t); assert.equal(moveOne(src, dest), true);
  assert.equal(fs.existsSync(src), false); assert.equal(fs.readFileSync(target, 'utf8'), '原始内容');
  assert.equal(moveOne(target, dest), false);
});
test('重名时源文件和目标文件均不变', t => {
  const { src, dest, target } = fixture(t); fs.writeFileSync(target, '已有内容');
  assert.throws(() => moveOne(src, dest));
  assert.equal(fs.readFileSync(src, 'utf8'), '原始内容'); assert.equal(fs.readFileSync(target, 'utf8'), '已有内容');
});
test('拒绝把目录移入它的子目录', t => {
  const { root, dest } = fixture(t); assert.throws(() => moveOne(root, dest)); assert.equal(fs.existsSync(dest), true);
});
test('权限错误不会触发复制或删除源文件', t => {
  const { src, dest, target } = fixture(t); const original = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('权限不足'), { code: 'EPERM' }); };
  try { assert.throws(() => moveOne(src, dest), /权限不足/); } finally { fs.renameSync = original; }
  assert.equal(fs.existsSync(src), true); assert.equal(fs.existsSync(target), false);
});
test('跨卷复制成功后才删除源文件', t => {
  const { src, dest, target } = fixture(t); const original = fs.renameSync;
  fs.renameSync = (a, b) => { if (a === src) throw Object.assign(new Error('跨卷'), { code: 'EXDEV' }); return original(a, b); };
  try { assert.equal(moveOne(src, dest), true); } finally { fs.renameSync = original; }
  assert.equal(fs.existsSync(src), false); assert.equal(fs.readFileSync(target, 'utf8'), '原始内容');
  assert.equal(fs.readdirSync(dest).some(n => n.startsWith('.fg-move-')), false);
});
test('跨卷复制失败仍完整保留源文件', t => {
  const { src, dest, target } = fixture(t); const rename = fs.renameSync, copy = fs.cpSync;
  fs.renameSync = () => { throw Object.assign(new Error('跨卷'), { code: 'EXDEV' }); };
  fs.cpSync = () => { throw new Error('磁盘空间不足'); };
  try { assert.throws(() => moveOne(src, dest), /磁盘空间不足/); } finally { fs.renameSync = rename; fs.cpSync = copy; }
  assert.equal(fs.readFileSync(src, 'utf8'), '原始内容'); assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readdirSync(dest).some(n => n.startsWith('.fg-move-')), false);
});
test('目录联接不能突破格子根目录', t => {
  const { root, dest } = fixture(t); const link = path.join(dest, '外部链接');
  try { fs.symlinkSync(root, link, 'junction'); } catch (e) { if (e.code === 'EPERM') return t.skip('账户不能创建目录联接'); throw e; }
  assert.throws(() => shelfPath(dest, link)); assert.throws(() => moveOne(link, dest));
});

test('删除格子先把文件、子目录和隐藏文件移到桌面', t => {
  const { root, dest } = fixture(t), desktop = path.join(root,'Desktop');
  fs.writeFileSync(path.join(dest,'内容.txt'),'必须保留');
  fs.writeFileSync(path.join(dest,'.隐藏文件'),'隐藏内容');
  fs.mkdirSync(path.join(dest,'子目录'));
  fs.writeFileSync(path.join(dest,'子目录','文件.txt'),'子目录内容');
  assert.equal(removeCellToDesktop(dest,desktop),3);
  assert.equal(fs.existsSync(dest),false);
  assert.equal(fs.readFileSync(path.join(desktop,'内容.txt'),'utf8'),'必须保留');
  assert.equal(fs.readFileSync(path.join(desktop,'.隐藏文件'),'utf8'),'隐藏内容');
  assert.equal(fs.readFileSync(path.join(desktop,'子目录','文件.txt'),'utf8'),'子目录内容');
});
test('桌面同名文件自动改名，已有文件保持原样', t => {
  const { root,dest }=fixture(t),desktop=path.join(root,'Desktop');fs.mkdirSync(desktop);
  fs.writeFileSync(path.join(dest,'报告.txt'),'移入内容');
  fs.writeFileSync(path.join(desktop,'报告.txt'),'原文件');
  fs.writeFileSync(path.join(desktop,'报告 (folder-grid 1).txt'),'更早文件');
  removeCellToDesktop(dest,desktop);
  assert.equal(fs.readFileSync(path.join(desktop,'报告.txt'),'utf8'),'原文件');
  assert.equal(fs.readFileSync(path.join(desktop,'报告 (folder-grid 1).txt'),'utf8'),'更早文件');
  assert.equal(fs.readFileSync(path.join(desktop,'报告 (folder-grid 2).txt'),'utf8'),'移入内容');
});
test('移动失败时格子和未移动文件仍保留', t => {
  const {root,dest}=fixture(t),desktop=path.join(root,'Desktop');
  fs.writeFileSync(path.join(dest,'文件.txt'),'不能丢失');const rename=fs.renameSync;
  fs.renameSync=()=>{throw Object.assign(new Error('权限不足'),{code:'EPERM'});};
  try {assert.throws(()=>removeCellToDesktop(dest,desktop),/格子已保留/);}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(path.join(dest,'文件.txt'),'utf8'),'不能丢失');
});
test('拒绝删除桌面本身或桌面的上级目录', t => {
  const {root,dest}=fixture(t);
  assert.throws(()=>removeCellToDesktop(dest,dest));
  assert.throws(()=>removeCellToDesktop(root,dest));
  assert.ok(fs.existsSync(dest));
});
test('空格子只移除空目录', t => {
  const {root,dest}=fixture(t);assert.equal(removeCellToDesktop(dest,path.join(root,'Desktop')),0);
  assert.equal(fs.existsSync(dest),false);assert.ok(fs.existsSync(path.join(root,'文档.txt')));
});
