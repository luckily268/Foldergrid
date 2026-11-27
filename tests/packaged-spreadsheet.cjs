process.env.FOLDER_GRID_WINDOW_TEST='1';
const {app}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const archive=path.join(__dirname,'../dist/win-unpacked/resources/app.asar');
const out=path.join(__dirname,'../.test-output'),root=fs.mkdtempSync(path.join(out,'packed-sheet-')),shelf=path.join(root,'shelf');
fs.mkdirSync(path.join(shelf,'表格验收'),{recursive:true});fs.writeFileSync(path.join(shelf,'表格验收','项目.xlsx'),require('./spreadsheet-fixture.cjs')());
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({shelfDir:shelf}));app.setPath('userData',root);
let finished=false,tested=false;
function finish(code,error){if(finished)return;finished=true;fs.writeFileSync(path.join(out,'packaged-spreadsheet-result.json'),JSON.stringify({passed:!code,error:error?.stack,checks:['asar-xlsx-worker','offline-engine','single-click','sheet-switch','formatted-values']},null,2));if(error)console.error(error);app.exit(code);}
setTimeout(()=>finish(1,Error('打包后 XLSX 预览超时')),30000);
app.on('browser-window-created',(_,win)=>{if(tested)return;tested=true;win.webContents.once('did-finish-load',async()=>{
 const js=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(check,label)=>{for(let i=0;i<100;i++){if(await check())return;await pause(80);}throw Error(label+' / '+await js('document.getElementById("pvBody")?.textContent'));};
 try{
  await until(()=>js('!!document.querySelector(".tile:not(.new)")'),'初始格子');await js('document.querySelector(".tile:not(.new)").click()');await pause(550);
  await js('document.querySelector(".file").click()');await until(()=>js('document.querySelector(".sheet-table")?.textContent.includes("25%")'),'安装包内离线表格绘制');
  await js('document.querySelectorAll(".sheet-tabs button")[1].click()');assert.match(await js('document.querySelector(".sheet-table").textContent'),/对比内容/);
  fs.writeFileSync(path.join(out,'packaged-xlsx.png'),(await win.webContents.capturePage()).toPNG());finish(0);
 }catch(error){finish(1,error);}
});});
require(path.join(archive,'src/main.js'));
