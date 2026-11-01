const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { readZipEntry, docxToHtml, readPreview } = require('../src/preview');
function zip(text, declaredSize) {
  const input = Buffer.from(text), compressed = zlib.deflateRawSync(input), name = Buffer.from('word/document.xml');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize ?? input.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 10); end.writeUInt32LE(local.length+name.length+compressed.length, 16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
test('标准 DOCX 正文和标题可提取，XML 转义不会变成标签', () => {
  const data = zip('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题 &lt;script&gt;</w:t></w:r></w:p>');
  assert.equal(docxToHtml(data), '<h1>标题 &lt;script&gt;</h1>');
});
test('损坏和非 ZIP 文档不会抛出异常', () => {
  assert.match(docxToHtml(Buffer.from('broken')), /读不出正文/);
  assert.match(docxToHtml(Buffer.alloc(200)), /读不出正文/);
});
test('拒绝声明超过正文大小限制的 ZIP 条目', () => {
  assert.equal(readZipEntry(zip('small', 13*1024*1024), 'word/document.xml'), null);
});
test('即使 ZIP 声明大小伪造，解压上限仍生效', () => {
  const bomb=zip('a'.repeat(13*1024*1024), 1);
  assert.throws(() => readZipEntry(bomb, 'word/document.xml'));
  assert.match(docxToHtml(bomb), /读不出正文/);
});
test('不存在的文件返回明确提示', () => {
  assert.equal(readPreview(require('node:path').join(__dirname,'missing.txt')).label, '读取失败');
});
