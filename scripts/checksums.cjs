const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const dir = path.join(__dirname, '../dist');
const artifact = 'folder-grid-setup-' + require('../package.json').version + '.exe';
const files = [artifact, artifact + '.blockmap', 'latest.yml'];
const channel = require('../package.json').version.split('-')[1]?.split('.')[0];
if (channel && /^[a-z0-9-]+$/i.test(channel)) { fs.copyFileSync(path.join(dir,'latest.yml'),path.join(dir,channel+'.yml')); if(channel!=='latest')files.push(channel+'.yml'); }
fs.mkdirSync(path.join(dir,'update'),{recursive:true});
for(const name of fs.readdirSync(path.join(dir,'update'))) { if (/^[a-z0-9-]+\.yml$/i.test(name)) fs.unlinkSync(path.join(dir,'update',name)); }
for(const name of files){if(!fs.existsSync(path.join(dir,name)))throw new Error('缺少更新产物：'+name);if(name.endsWith('.yml'))fs.copyFileSync(path.join(dir,name),path.join(dir,'update',name));}
fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), files.map(n => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex') + '  ' + n).join('\n') + '\n');
console.log('已生成 SHA256SUMS.txt');
