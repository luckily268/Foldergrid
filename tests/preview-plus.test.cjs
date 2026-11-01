const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {readPreview}=require('../src/preview');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'fg-preview-plus-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('PDF 返回受限二进制数据及文件属性，不再提示缺少渲染引擎',t=>{
 const file=path.join(fixture(t),'两页.pdf'),bytes=require('./pdf-fixture.cjs')();fs.writeFileSync(file,bytes);
 const info=readPreview(file);assert.equal(info.kind,'pdf');assert.deepEqual(Buffer.from(info.bytes),bytes);assert.equal(info.metadata.bytes,bytes.length);assert.equal(info.metadata.name,'两页.pdf');assert.ok(Date.parse(info.metadata.createdAt));assert.ok(Date.parse(info.metadata.modifiedAt));
});
test('大 PDF 和大二进制文件只显示元信息，避免无界读取',t=>{
 const root=fixture(t),pdf=path.join(root,'large.pdf'),video=path.join(root,'movie.mp4');
 for(const f of [pdf,video]){fs.writeFileSync(f,'');fs.truncateSync(f,65*1024*1024);}
 for(const f of [pdf,video]){const info=readPreview(f);assert.equal(info.kind,'properties');assert.equal(info.metadata.bytes,65*1024*1024);assert.equal(info.bytes,undefined);}
});
test('图片、压缩包、可执行文件与文件夹显示创建/修改时间且不执行文件',t=>{
 const root=fixture(t);
 for(const name of ['photo.png','archive.zip','app.exe']){const f=path.join(root,name);fs.writeFileSync(f,'test');const data=readPreview(f);assert.equal(data.kind,'properties');assert.equal(data.metadata.path,f);assert.equal(data.metadata.bytes,4);assert.ok(data.metadata.createdAt);assert.ok(data.metadata.accessedAt);}
 const folder=path.join(root,'目录');fs.mkdirSync(folder);const data=readPreview(folder);assert.equal(data.kind,'properties');assert.equal(data.metadata.isDirectory,true);assert.equal(data.metadata.bytes,null);
});
test('文字预览保留内容并附带元信息',t=>{const f=path.join(fixture(t),'readme.txt');fs.writeFileSync(f,'说明正文');const data=readPreview(f);assert.equal(data.kind,'markdown');assert.equal(data.text,'说明正文');assert.equal(data.metadata.type,'TXT 文件');});
