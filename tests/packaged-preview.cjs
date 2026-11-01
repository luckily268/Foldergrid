process.env.FOLDER_GRID_WINDOW_TEST='1';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const archive=path.join(__dirname,'../dist/win-unpacked/resources/app.asar');
assert.ok(fs.existsSync(archive),'请先构建安装包');
const out=path.join(__dirname,'../.test-output'),root=fs.mkdtempSync(path.join(out,'packed-preview-')),shelf=path.join(root,'shelf');
fs.mkdirSync(path.join(shelf,'PDF 验收'),{recursive:true});fs.writeFileSync(path.join(shelf,'PDF 验收','中文.pdf'),require('./pdf-fixture.cjs')(true));
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({shelfDir:shelf}));app.setPath('userData',root);
const pause=ms=>new Promise(r=>setTimeout(r,ms));let complete=false;
function finish(code,error){if(complete)return;complete=true;fs.writeFileSync(path.join(out,'packaged-preview-result.json'),JSON.stringify({passed:code===0,error:error?.stack,checks:['asar-pdf-worker','offline-cjk-cmap','cjk-text-content','canvas-render','page-navigation']},null,2));if(error)console.error(error);app.exit(code);}
setTimeout(()=>finish(1,Error('打包后 PDF 验证超时')),30000);
let tested=false;
app.on('browser-window-created',(_,win)=>{if(tested)return;tested=true;win.webContents.once('did-finish-load',async()=>{
 const js=code=>win.webContents.executeJavaScript(code);
 const until=async(fn,label)=>{for(let i=0;i<90;i++){if(await fn())return;await pause(80);}throw Error(label+' / '+await js('document.getElementById("pvBody")?.textContent'));};
 try{
  await until(()=>js('!!document.querySelector(".tile:not(.new)")'),'初始格子');
  await js('document.querySelector(".tile:not(.new)").click()');await pause(600);await js('document.querySelector(".file").click()');
  await until(()=>js('document.querySelector(".pdf-stage")?.dataset.renderedPage === "1"'),'asar 中绘制 PDF');
  const text=await js('(async()=>{const lib=await import('+JSON.stringify('file:///'+path.join(archive,'media/vendor/pdfjs/pdf.mjs').replaceAll('\\','/'))+');const task=lib.getDocument({url:'+JSON.stringify('file:///'+path.join(shelf,'PDF 验收','中文.pdf').replaceAll('\\','/'))+',cMapUrl:'+JSON.stringify('file:///'+path.join(archive,'media/vendor/pdfjs/cmaps/').replaceAll('\\','/'))+',cMapPacked:true,isEvalSupported:false});const pdf=await task.promise;try{return (await (await pdf.getPage(1)).getTextContent()).items.map(i=>i.str).join("")}finally{await task.destroy()}})()');
  assert.match(text,/中文预览正常/,'打包后的离线 CMap 必须正确解码中文');
  await pause(300);fs.writeFileSync(path.join(out,'packaged-pdf-chinese.png'),(await win.webContents.capturePage()).toPNG());
  await js('document.getElementById("pdfNext").click()');await until(()=>js('document.querySelector(".pdf-stage")?.dataset.renderedPage === "2"'),'打包后翻页');
  const second=path.join(shelf,'PDF 验收','中文对比.pdf');fs.copyFileSync(path.join(shelf,'PDF 验收','中文.pdf'),second);
  const paths=[path.join(shelf,'PDF 验收','中文.pdf'),second];
  for(const file of paths)await js('window.fg.send('+JSON.stringify({type:'openCompare',view:'preview',path:file})+')');
  const {BrowserWindow}=require('electron');
  await until(()=>BrowserWindow.getAllWindows().filter(w=>w!==win).length===2,'打包后双 PDF 窗口');
  const children=BrowserWindow.getAllWindows().filter(w=>w!==win);
  for(const child of children)await until(()=>child.webContents.executeJavaScript('document.querySelector(".pdf-stage")?.dataset.renderedPage === "1"'),'独立 PDF 绘制');
  await children[0].webContents.executeJavaScript('document.getElementById("pdfNext").click()');
  await until(()=>children[0].webContents.executeJavaScript('document.querySelector(".pdf-stage")?.dataset.renderedPage === "2"'),'独立窗口翻页');
  assert.equal(await children[1].webContents.executeJavaScript('document.querySelector(".pdf-stage").dataset.renderedPage'),'1','其他 PDF 窗口页码不受影响');children.forEach(w=>w.close());
  console.log('asar 内 PDF worker、中文 CMap、绘制翻页与双 PDF 窗口独立页码通过');finish(0);
 }catch(error){finish(1,error);}
});});
require(path.join(archive,'src/main.js'));
