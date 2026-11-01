const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
for (const dir of ['src', 'media', 'scripts', 'tests']) {
  for (const file of fs.readdirSync(path.join(__dirname, '..', dir))) {
    if (!/\.(c?js|mjs)$/.test(file)) continue;
    if (spawnSync(process.execPath, ['--check', path.join(__dirname, '..', dir, file)], { stdio: 'inherit' }).status !== 0) process.exit(1);
  }
}
const pkg = require('../package.json'), lock = require('../package-lock.json');
for (const file of ['pdf.mjs', 'pdf.worker.mjs', 'LICENSE', 'cmaps/UniGB-UCS2-H.bcmap', 'standard_fonts/LiberationSans-Regular.ttf', 'wasm/openjpeg.wasm', 'iccs/CGATS001Compat-v2-micro.icc']) {
  if (!fs.existsSync(path.join(__dirname, '../media/vendor/pdfjs', file))) throw new Error('缺少离线 PDF.js 资源，请运行 node scripts/vendor-pdf.cjs：' + file);
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== 'v' + pkg.version) throw new Error('Git 标签必须等于 v' + pkg.version);
if (lock.version !== pkg.version) throw new Error('请更新 package-lock.json');
require('node:assert/strict').deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, '开发依赖与锁文件不一致');
require('node:assert/strict').deepEqual(lock.packages[''].dependencies, pkg.dependencies, '运行时依赖与锁文件不一致');
console.log('语法、版本与锁文件检查通过');
