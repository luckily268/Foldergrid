const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const w = require('../src/workspace');
const view = require('../media/file-view');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foldergrid-workspace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const desktop = path.join(dir, 'Desktop'), root = path.join(dir, 'Shelf'), history = path.join(dir, 'history.json');
  fs.mkdirSync(desktop); fs.mkdirSync(root);
  return { dir, desktop, root, history, file: (name, data = name) => { const p = path.join(desktop, name); fs.writeFileSync(p, data); return p; } };
}

test('Windows 目录联接目标不参与分类，映射不能穿过联接越界', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  f.file('联接验收.txt', '不能移动到外部');
  fs.symlinkSync(f.desktop, path.join(f.root, '文档'), 'junction');
  const plan = w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES);
  assert.equal(plan.items.length, 0);
  assert.ok(plan.skipped.length > 0);
  assert.throws(() => w.portalPath(f.root, path.join(f.root, '文档', '联接验收.txt')));
  assert.equal(fs.readFileSync(path.join(f.desktop, '联接验收.txt'), 'utf8'), '不能移动到外部');
});
test('规则按优先级匹配；关键词和后缀取交集，名称符合 Windows 要求', () => {
  const rules = w.validateRules([{ target: '报销', extensions: '.PDF，docx', keyword: '发票' }, ...w.DEFAULT_RULES]);
  assert.equal(w.matchRule('发票.PDF', rules).target, '报销');
  assert.equal(w.matchRule('其他.PDF', rules).target, '文档');
  assert.equal(w.matchRule('发票.exe', rules), undefined);
  assert.throws(() => w.validateRules([{ target: '../越界', extensions: 'txt', keyword: '' }]));
  assert.throws(() => w.validateRules([{ target: 'CON', extensions: 'txt', keyword: '' }]));
  assert.throws(() => w.validateRules([{ target: '资料', extensions: '', keyword: '' }]));
  assert.throws(() => w.validateRules([{ target: '资料', extensions: '*', keyword: '' }]));
});
test('预览不移动内容，忽略目录和隐藏内容；同名跳过', t => {
  const f = fixture(t); f.file('报告.pdf'); f.file('照片.JPG'); f.file('.隐藏.txt'); f.file('未匹配.exe');
  fs.mkdirSync(path.join(f.desktop, '保留目录')); fs.mkdirSync(path.join(f.root, '文档')); fs.writeFileSync(path.join(f.root, '文档', '报告.pdf'), '原有文件');
  const p = w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES);
  assert.deepEqual(p.items.map(i => i.name), ['照片.JPG']);
  assert.equal(p.skipped.length, 1); assert.ok(fs.existsSync(path.join(f.desktop, '照片.JPG')));
  assert.equal(fs.readdirSync(f.root).length, 1);
});
test('执行后可从持久记录撤销，空格子保留', t => {
  const f = fixture(t); f.file('示例.txt'); f.file('photo.png');
  const p = w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES);
  assert.equal(w.executeOrganization(p, f.history).moved, 2);
  assert.equal(fs.existsSync(path.join(f.desktop, '示例.txt')), false);
  assert.equal(w.readHistory(f.history)[0].entries.length, 2);
  const undone = w.undoOrganization(f.history);
  assert.equal(undone.restored, 2); assert.deepEqual(undone.failed, []);
  assert.equal(fs.readFileSync(path.join(f.desktop, '示例.txt'), 'utf8'), '示例.txt');
  assert.equal(w.undoOrganization(f.history).restored, 0);
});
test('预览后的文件修改与目标同名均跳过，不覆盖', t => {
  const f = fixture(t); f.file('变动.txt'); f.file('重名.txt');
  const p = w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES);
  f.file('变动.txt', '已修改的正文'); fs.mkdirSync(path.join(f.root, '文档')); fs.writeFileSync(path.join(f.root, '文档', '重名.txt'), '不能覆盖');
  const result = w.executeOrganization(p, f.history);
  assert.equal(result.moved, 0); assert.equal(result.failed.length, 2);
  assert.equal(fs.readFileSync(path.join(f.root, '文档', '重名.txt'), 'utf8'), '不能覆盖');
  assert.ok(fs.existsSync(path.join(f.desktop, '变动.txt')));
});
test('撤销保留被修改文件和原位重名，其他文件仍可恢复', t => {
  const f = fixture(t); f.file('修改.txt'); f.file('重名.txt'); f.file('正常.txt');
  w.executeOrganization(w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES), f.history);
  fs.writeFileSync(path.join(f.root, '文档', '修改.txt'), '之后又编辑过'); f.file('重名.txt', '新的桌面文件');
  const result = w.undoOrganization(f.history);
  assert.equal(result.restored, 1); assert.equal(result.failed.length, 2);
  assert.equal(fs.readFileSync(path.join(f.desktop, '重名.txt'), 'utf8'), '新的桌面文件');
  assert.ok(fs.existsSync(path.join(f.root, '文档', '修改.txt')));
});
test('映射边界阻止越界；断开的目录报错', t => {
  const f = fixture(t); f.file('示例.txt');
  assert.equal(w.portalPath(f.desktop, path.join(f.desktop, '示例.txt')), fs.realpathSync(path.join(f.desktop, '示例.txt')));
  assert.throws(() => w.portalPath(f.desktop, f.root));
  assert.throws(() => w.portalPath(path.join(f.dir, 'missing'), f.root));
});
test('符号链接来源和目标不参与整理，映射不能穿过链接越界', { skip: process.platform === 'win32' ? '普通权限 Windows 可能无法创建符号链接' : false }, t => {
  const f = fixture(t); const outside = path.join(f.dir, 'outside.txt'); fs.writeFileSync(outside, '保持原位');
  fs.symlinkSync(outside, path.join(f.desktop, 'link.txt'));
  assert.equal(w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES).items.length, 0);
  assert.throws(() => w.portalPath(f.desktop, path.join(f.desktop, 'link.txt')));
  f.file('普通.txt'); fs.symlinkSync(f.desktop, path.join(f.root, '文档'));
  assert.equal(w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES).items.length, 0);
});
test('过期预览与损坏历史均不修改文件', t => {
  const f = fixture(t); f.file('示例.txt');
  const p = w.planOrganization(f.desktop, f.root, w.DEFAULT_RULES); p.createdAt = 0;
  assert.throws(() => w.executeOrganization(p, f.history), /过期/);
  fs.writeFileSync(f.history, 'broken');
  assert.throws(() => w.undoOrganization(f.history), /读取失败/);
  assert.ok(fs.existsSync(path.join(f.desktop, '示例.txt')));
});
test('跨格子搜索支持多词、类型筛选与稳定排序，不改变原数据', () => {
  const files = [{ name: '报告10.PDF', extension: 'pdf', folderName: '工作', size: 10, mtimeMs: 100 }, { name: '报告2.pdf', extension: 'pdf', folderName: '工作', size: 20, mtimeMs: 200 }, { name: '照片.jpg', extension: 'jpg', folderName: '生活', size: 40, mtimeMs: 300 }];
  assert.deepEqual(view.select(files, '工作 报告', 'document', 'name').map(f => f.name), ['报告2.pdf', '报告10.PDF']);
  assert.equal(view.select(files, '', 'all', 'newest')[0].name, '照片.jpg');
  assert.equal(view.select(files, '', 'document', 'size')[0].name, '报告2.pdf');
  assert.equal(files[0].name, '报告10.PDF');
});
