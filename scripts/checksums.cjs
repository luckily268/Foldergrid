const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const dir = path.join(__dirname, '../dist');
const artifact = 'folder-grid-setup-' + require('../package.json').version + '.exe';
const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, artifact))).digest('hex');
fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), hash + '  ' + artifact + '\n');
console.log('已生成 SHA256SUMS.txt');
