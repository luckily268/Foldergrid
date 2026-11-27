const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const XLSX=require('../media/vendor/xlsx/xlsx.mini.min.js');
const {readWorkbook}=require('../media/sheet-data');
const fixture=require('./spreadsheet-fixture.cjs');
test('XLSX 离线读取多表、中文、格式化金额、百分比、日期和公式保存值',()=>{
 const result=readWorkbook(fixture(),XLSX);
 assert.deepEqual(result.sheets.map(s=>s.name),['项目总览','明细']);
 assert.deepEqual(result.sheets[0].rows[1],['研发','1,234.50','25%','2024-01-01']);
 assert.equal(result.sheets[0].rows[2][1],'1,234.50');
 assert.equal(result.sheets[0].rows[2][0],'<img src=x onerror=alert(1)>');
 assert.equal(result.sheets[1].rows[1][0],'对比内容');
});
test('XLSX 预览限制行列数量，损坏文件返回错误，原文件保持字节不变',t=>{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(Array.from({length:510},(_,r)=>Array.from({length:55},(_,c)=>r+':'+c)));
 XLSX.utils.book_append_sheet(book,sheet,'大表');
 const result=readWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),XLSX);
 assert.equal(result.sheets[0].rows.length,500);assert.equal(result.sheets[0].columns.length,50);assert.equal(result.sheets[0].truncated,true);
 assert.throws(()=>readWorkbook(Buffer.from('broken'),XLSX),/损坏/);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folder-grid-xlsx-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'内容.xlsx'),bytes=fixture();fs.writeFileSync(file,bytes);
 const preview=require('../src/preview').readPreview(file);assert.equal(preview.kind,'spreadsheet');
 readWorkbook(preview.bytes,XLSX);assert.deepEqual(fs.readFileSync(file),Buffer.from(bytes));
});
