const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {directory,create}=require('../src/subfolders');
const {rename}=require('../src/subfolders');

test('子文件夹支持多级新建，重名和非法名称不覆盖原内容',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'folder-grid-subfolders-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const first=create(root,'','项目');
  const nested=create(root,'项目','文档');
  fs.writeFileSync(path.join(nested,'保留.txt'),'保留');
  assert.equal(directory(root,'项目/文档'),nested);
  assert.throws(()=>create(root,'项目','文档'),/EEXIST/);
  assert.equal(fs.readFileSync(path.join(nested,'保留.txt'),'utf8'),'保留');
  assert.throws(()=>create(root,'','../逃逸'));
  assert.throws(()=>create(root,'','CON'));
  assert.ok(fs.existsSync(first));
});

test('子文件夹不能访问父目录、绝对路径或普通文件',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'folder-grid-subfolders-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'文件.txt'),'text');
  for(const relative of ['..','a/../../','a\\..',root])assert.throws(()=>directory(root,relative),/路径无效/);
  assert.throws(()=>directory(root,'文件.txt'),/目录/);
});

test('各级文件夹改名保留全部内容，重名、越界、保留名称不修改文件',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folder-grid-rename-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const original=create(root,'','原名'),nested=create(root,'原名','二级');fs.writeFileSync(path.join(nested,'内容.txt'),'保留');
 const renamed=rename(root,'',original,'新名').target;
 assert.equal(fs.readFileSync(path.join(renamed,'二级/内容.txt'),'utf8'),'保留');
 rename(root,'新名',path.join(renamed,'二级'),'资料');
 assert.equal(fs.readFileSync(path.join(renamed,'资料/内容.txt'),'utf8'),'保留');
 const duplicate=create(root,'','已存在');fs.writeFileSync(path.join(duplicate,'另一个.txt'),'原目录');
 assert.throws(()=>rename(root,'',renamed,'已存在'),/同名/);
 assert.throws(()=>rename(root,'',path.join(renamed,'资料'),'越界'),/当前目录/);
 assert.throws(()=>rename(root,'',renamed,'CON'));
 assert.equal(fs.readFileSync(path.join(duplicate,'另一个.txt'),'utf8'),'原目录');
 assert.ok(fs.existsSync(path.join(renamed,'资料/内容.txt')));
});
