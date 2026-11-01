// Two real PDF pages with text and different shapes, no third-party test data.
module.exports = function (cjk = false) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 440] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 440] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  if (cjk) objects[4] = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [9 0 R] >>';
  const word = cjk ? '<' + [...'中文预览正常'].map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>' : '(Folder-grid PDF page 1)';
  for (const text of ['0.1 0.4 0.8 rg 30 200 220 100 re f BT /F1 24 Tf 40 350 Td ' + word + ' Tj ET', '0.7 0.2 0.3 rg 60 180 160 150 re f BT /F1 24 Tf 40 350 Td ' + (cjk ? word : '(Folder-grid PDF page 2)') + ' Tj ET']) objects.push('<< /Length ' + Buffer.byteLength(text) + ' >>\nstream\n' + text + '\nendstream');
  if (cjk) objects.push('<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>', '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 8 0 R /DW 1000 >>');
  let result = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(result)); result += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const start = Buffer.byteLength(result);
  result += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(result);
};
