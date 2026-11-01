const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), source = path.join(root, 'node_modules/pdfjs-dist'), target = path.join(root, 'media/vendor/pdfjs');
fs.mkdirSync(target, { recursive: true });
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) fs.copyFileSync(path.join(source, 'build', name), path.join(target, name));
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true });
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
console.log('离线 PDF.js 资源已准备：' + require(path.join(source, 'package.json')).version);
