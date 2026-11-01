// 手工验收入口：只使用独立的演示目录，关闭托盘菜单即可退出。
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const out = path.join(__dirname, '../.test-output'); fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(out, 'desktop-preview-'));
const shelf = path.join(root, 'shelf');
for (const name of ['工作', '笔记', '图片']) fs.mkdirSync(path.join(shelf,name), { recursive: true });
fs.writeFileSync(path.join(shelf,'笔记','欢迎.md'), '# folder-grid\n\n桌面图标，点击展开玻璃卡。');
fs.writeFileSync(path.join(root,'config.json'), JSON.stringify({ shelfDir:shelf }));
app.setPath('userData',root);
setTimeout(() => app.quit(), 240000);
require('../src/main');
