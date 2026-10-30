const desktopMode = process.env.FOLDER_GRID_DESKTOP_TEST === '1';
if (!desktopMode) process.env.FOLDER_GRID_WINDOW_TEST = '1';
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const out = path.join(__dirname, '../.test-output'); fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(out, 'smoke-')), shelf = path.join(root, 'shelf');
const testDesktop = path.join(root, 'Desktop'); fs.mkdirSync(testDesktop);
app.setPath('desktop', testDesktop);
let deleteResponse = 0, deleteOptions = null;
require('electron').dialog.showMessageBox = async (_window, options) => { deleteOptions = options; return { response: deleteResponse }; };
fs.mkdirSync(path.join(shelf, '示例格子'), { recursive: true });
fs.writeFileSync(path.join(shelf, '示例格子', '预览测试.md'), '# 预览测试\n\n玻璃卡预览正常。');
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ shelfDir: shelf }));
app.setPath('userData', root);
const events = []; let finished = false;
function finish(code, error) {
  if (finished) return; finished = true;
  fs.writeFileSync(path.join(out, 'smoke-result.json'), JSON.stringify({ passed: code === 0, error: error?.stack, events, electron: process.versions.electron }, null, 2));
  if (error) console.error(error); app.exit(code);
}
setTimeout(() => finish(1, new Error('启动测试超时')), 30000);
const pause = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (_, win) => {
  win.webContents.on('preload-error', (_, p, e) => events.push(e.message));
  win.webContents.on('did-fail-load', (_, code, text) => events.push({ code, text }));
  win.webContents.on('did-finish-load', async () => {
    try {
      const js = code => win.webContents.executeJavaScript(code);
      if (desktopMode) {
        const desktop = require('../src/desktop').createWindowsDesktop();
        for (let i = 0; i < 100 && !desktop.connected(win); i++) await pause(100);
        assert.ok(desktop.connected(win), '窗口必须保持桌面归属和顶层合成');
        assert.equal(win.isAlwaysOnTop(), false);
        assert.equal(desktop.ignoresMouse(win), false, '不应切换鼠标穿透窗口样式');
      }
      for (let i = 0; i < 50; i++) { if (await js('document.querySelectorAll(".tile:not(.new)").length === 1')) break; await pause(100); }
      assert.equal(await js('typeof window.fg.send'), 'function');
      assert.equal(await js('document.title'), 'folder-grid');
      assert.ok(await js('document.querySelector(".tile-face").getBoundingClientRect().width <= 128'), '第一层使用桌面图标尺寸');
      assert.equal(await js('getComputedStyle(document.body).backgroundColor'), 'rgba(0, 0, 0, 0)');
      if (desktopMode) {
        await pause(350);
        const desktop = require('../src/desktop').createWindowsDesktop();
        const scale = require('electron').screen.getPrimaryDisplay().scaleFactor;
        assert.equal(desktop.regionContains(win, Math.round(80*scale), Math.round(180*scale)), false, '空白背景不得包含在窗口绘制区域');
        const point = await js('(()=>{const r=document.querySelector(".tile").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+24)}})()');
        win.webContents.sendInputEvent({type:'mouseMove',...point});
        await pause(250);
        assert.equal(desktop.regionContains(win, Math.round(80*scale), Math.round(180*scale)), false, '鼠标悬停后仍不得覆盖桌面空白');
        assert.equal(desktop.ignoresMouse(win), false, '悬停不得切换透明窗口样式');
        fs.writeFileSync(path.join(out, 'desktop-icons.png'), (await win.webContents.capturePage()).toPNG());
      }
      assert.equal(await js('document.querySelector(".tile-name").textContent'), '示例格子');
      await js('document.getElementById("newBtn").click()');
      assert.equal(await js('document.querySelector(".prompt-modal").parentElement.hidden'), false);
      await pause(200);
      if (desktopMode) assert.ok(require('../src/desktop').createWindowsDesktop().focused(win), '新建弹窗必须获得系统键盘焦点');
      for (const ch of '新建测试') win.webContents.sendInputEvent({type:'char',keyCode:ch});
      await pause(80);
      assert.equal(await js('document.getElementById("askInput").value'), '新建测试');
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      for (let i = 0; i < 50 && !fs.existsSync(path.join(shelf, '新建测试')); i++) await pause(100);
      assert.ok(fs.existsSync(path.join(shelf, '新建测试'))); await pause(400);
      const renamedId = await js('Array.from(document.querySelectorAll(".tile")).find(e=>e.textContent.includes("新建测试")).dataset.id');
      win.webContents.send('fg', { type:'requestRenameCell', folderId:renamedId });
      await pause(200);
      if (desktopMode) assert.ok(require('../src/desktop').createWindowsDesktop().focused(win), '重命名必须获得系统键盘焦点');
      for (const ch of '重命名测试') win.webContents.sendInputEvent({type:'char',keyCode:ch});
      await pause(80);
      assert.equal(await js('document.getElementById("askInput").value'), '重命名测试');
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      for (let i=0;i<50&&!fs.existsSync(path.join(shelf,'重命名测试'));i++) await pause(100);
      assert.ok(fs.existsSync(path.join(shelf,'重命名测试')));
      assert.equal(fs.existsSync(path.join(shelf,'新建测试')), false);
      const cellDir = path.join(shelf,'重命名测试');
      fs.writeFileSync(path.join(cellDir,'保留.txt'),'格子内文件');
      fs.writeFileSync(path.join(testDesktop,'保留.txt'),'桌面原文件');
      await js('window.fg.send({type:"deleteCell",folderId:'+JSON.stringify(renamedId)+'})');
      await pause(150);
      assert.ok(deleteOptions, '删除必须先显示确认');
      assert.match(deleteOptions.detail, /移到桌面/);
      assert.equal(deleteOptions.defaultId, 0);
      assert.ok(fs.existsSync(path.join(cellDir,'保留.txt')), '取消必须保留格子和文件');
      deleteResponse = 1;
      await js('window.fg.send({type:"deleteCell",folderId:'+JSON.stringify(renamedId)+'})');
      for (let i=0;i<50&&fs.existsSync(cellDir);i++) await pause(100);
      assert.equal(fs.existsSync(cellDir), false);
      assert.equal(fs.readFileSync(path.join(testDesktop,'保留.txt'),'utf8'), '桌面原文件');
      assert.equal(fs.readFileSync(path.join(testDesktop,'保留 (folder-grid 1).txt'),'utf8'), '格子内文件');
      await pause(250);
      await js('Array.from(document.querySelectorAll(".tile")).find(e=>e.textContent.includes("示例格子")).click()');
      await pause(600); assert.match(await js('document.getElementById("files").textContent'), /预览测试.md/);
      await js('document.getElementById("searchBtn").click(); document.getElementById("searchInput").value="不存在"; document.getElementById("searchInput").dispatchEvent(new Event("input"))');
      assert.equal(await js('document.querySelectorAll(".file").length'), 0);
      await js('document.getElementById("searchClear").click(); document.querySelector(".file").click()');
      for (let i = 0; i < 60; i++) {
        if (await js('!!document.getElementById("pvBody") && document.getElementById("pvBody").textContent.includes("玻璃卡预览正常")')) break;
        await pause(100);
      }
      assert.match(await js('document.getElementById("pvBody").textContent + " / " + document.getElementById("toast").textContent'), /玻璃卡预览正常/);
      await pause(650);
      fs.writeFileSync(path.join(out, 'preview.png'), (await win.webContents.capturePage()).toPNG());
      assert.deepEqual(events, []); finish(0);
    } catch (error) { finish(1, error); }
  });
});
require('../src/main');
