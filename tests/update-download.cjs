// 本地 HTTP 更新源集成测试。绝不调用安装器，不访问 GitHub，不使用个人配置。
const {app}=require('electron');
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),assert=require('assert/strict');
const {Transform}=require('stream');
const {NsisUpdater}=require('electron-updater');
const {ElectronHttpExecutor}=require('electron-updater/out/electronHttpExecutor');
const {createUpdates}=require('../src/updates');
const currentVersion=require('../package.json').version;
const [major,minor,patch]=currentVersion.split(/[.-]/).map(Number);
const nextVersion=[major,minor,patch+1].join('.');
const root=path.join(__dirname,'../.test-output/update-download');fs.mkdirSync(root,{recursive:true});
app.setPath('userData',root);
const file=path.join(__dirname,'../dist/folder-grid-setup-'+require('../package.json').version+'.exe');
const output=path.join(root,'result.json');let server;
setTimeout(()=>{fs.writeFileSync(output,JSON.stringify({passed:false,error:'timeout'}));app.exit(1)},60000);
app.whenReady().then(async()=>{
 const bytes=fs.statSync(file).size,hash=crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
 server=http.createServer((req,res)=>{
  if(req.url.includes('.yml')){res.setHeader('Content-Type','text/yaml');res.end(JSON.stringify({version:nextVersion,files:[{url:'update.exe',sha512:hash,size:bytes}],path:'update.exe',sha512:hash,releaseDate:new Date().toISOString()}));return;}
  res.setHeader('Content-Length',bytes);let first=true;
  const stream=fs.createReadStream(file);
  if(req.url.includes('/bad/'))stream.pipe(new Transform({transform(chunk,_encoding,done){if(first){first=false;chunk=Buffer.from(chunk);chunk[0]^=1;}done(null,chunk)}})).pipe(res);
  else stream.pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/';
 function instance(mode){
  const dir=fs.mkdtempSync(path.join(root,mode+'-')),config=path.join(dir,'app-update.yml');
  fs.writeFileSync(config,'updaterCacheDirName: cache\n');
  const adapter={version:require('../package.json').version,name:'folder-grid-update-test',isPackaged:true,appUpdateConfigPath:config,userDataPath:dir,baseCachePath:dir,whenReady:()=>Promise.resolve(),quit:()=>{throw Error('测试禁止退出安装')},relaunch:()=>{},onQuit:()=>{}};
  const options={provider:'generic',url:url+mode+'/'};
  const updater=new NsisUpdater(options,adapter);
  updater.httpExecutor=new ElectronHttpExecutor(()=>{});updater.setFeedURL(options);updater.disableDifferentialDownload=true;updater.logger={info:()=>{},warn:()=>{},debug:()=>{},error:()=>{}};
  return updater;
 }
 const good=instance('good'),states=[];
 const controller=createUpdates({updater:good,enabled:true,currentVersion:require('../package.json').version,prerelease:true,isBusy:()=>true,notify:s=>states.push(s),log:(...args)=>console.error(...args)});
 await controller.check(true);assert.equal(controller.getState().status,'available');
 await controller.download();assert.equal(controller.getState().status,'downloaded');assert.ok(fs.existsSync(good.installerPath));
 assert.equal(controller.install(),false,'忙碌时不能启动真实安装器');
 controller.dispose();
 const bad=instance('bad');bad.autoDownload=false;bad.autoInstallOnAppQuit=false;bad.disableWebInstaller=true;
 await bad.checkForUpdates();await assert.rejects(()=>bad.downloadUpdate(),/checksum|sha512|digest/i);
 fs.writeFileSync(output,JSON.stringify({passed:true,checks:['real-nsis-update-check','real-http-download','sha512-integrity','tampered-download-rejected','busy-install-blocked'],installerExecuted:false},null,2));
 server.close();app.exit(0);
}).catch(error=>{fs.writeFileSync(output,JSON.stringify({passed:false,error:error.stack},null,2));console.error(error);if(server)server.close();app.exit(1)});
