const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createStartup } = require('../src/startup'), { createLayouts } = require('../src/layouts');
test('开发运行不读取或写入系统启动项', () => {
  const startup = createStartup({ app: new Proxy({}, {get() {throw Error('不可调用系统 API');}}), enabled:false });
  assert.equal(startup.getState().supported,false); assert.throws(()=>startup.setEnabled(true), /安装后/);
});
test('启动开关使用一致的 EXE 和参数，并尊重系统外部禁用', () => {
  let registered=false, permitted=false, written, read;
  const app={ getLoginItemSettings(o) {read=o;return {openAtLogin:false,executableWillLaunchAtLogin:true,launchItems:[{name:'other-app',scope:'user',enabled:true},...(registered?[{name:'folder-grid',scope:'user',enabled:permitted}]:[])]};},setLoginItemSettings(o){written=o;registered=o.openAtLogin;permitted=o.enabled;} };
  const startup=createStartup({app,enabled:true,execPath:'C:\\Program Files\\folder-grid\\folder-grid.exe'});
  assert.equal(startup.setEnabled(true).enabled,true);
  assert.deepEqual(read,{path:written.path,args:written.args}); assert.equal(written.name,'folder-grid');
  assert.deepEqual(written.args,[]);
  permitted=false;assert.equal(startup.getState().blocked,true);assert.equal(startup.getState().enabled,false);
  startup.setEnabled(true);assert.equal(startup.getState().enabled,true);
  startup.setEnabled(false);assert.equal(startup.getState().registered,false);assert.throws(()=>startup.setEnabled('true'),/无效/);
});
test('启动设置拒绝系统写入失败，并显示读取错误', () => {
  const startup=createStartup({enabled:true,app:{setLoginItemSettings(){},getLoginItemSettings(){throw Error('访问失败');}}});
  assert.match(startup.getState().reason,/访问失败/);assert.throws(()=>startup.setEnabled(true),/访问失败/);
});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-layout-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const a=path.join(dir,'A'),b=path.join(dir,'B');fs.mkdirSync(a);fs.mkdirSync(b);return {store:createLayouts(path.join(dir,'layouts.json')),a,b,file:path.join(dir,'layouts.json')};}
test('布局持久化、切换与新旧格子兼容，不更改文件内容或路径',t=>{
  const {store,a,b,file}=fixture(t);fs.mkdirSync(path.join(a,'资料'));const content=path.join(a,'资料','test.txt');fs.writeFileSync(content,'正文');
  const folders=[{id:'c1',name:'资料',baseColor:'#ffeeaa',filePositions:{'test.txt':{x:30,y:40}},sort:'manual'},{id:'c2',name:'以后删除'}];
  store.save(a,'工作',folders,[{id:'c1',position:{x:100,y:200}}],{x:500,y:12});
  assert.equal(createLayouts(file).list(a)[0].name,'工作');assert.equal(store.list(b).length,0);
  const id=store.list(a)[0].id;assert.throws(()=>store.restore(b,id,folders),/找不到/);
  const restored=store.restore(a,id,[{...folders[0],name:'资料改名',position:{x:0,y:0}},{id:'c3',name:'新格子',position:{x:777,y:888}}]);
  assert.deepEqual(restored.toolbar,{x:500,y:12});assert.deepEqual(restored.folders[0].position,{x:100,y:200});
  assert.deepEqual({...restored.folders[0].filePositions['test.txt']},{x:30,y:40});
  assert.equal(restored.folders[0].name,'资料改名');assert.equal(restored.folders[0].baseColor,'#ffeeaa');
  assert.deepEqual(restored.folders[1].position,{x:777,y:888});assert.equal(restored.folders.length,2);
  assert.equal(fs.readFileSync(content,'utf8'),'正文');assert.deepEqual(fs.readdirSync(path.dirname(content)),['test.txt']);
  store.remove(b,id);assert.equal(store.list(a).length,1);store.remove(a,id);assert.equal(store.list(a).length,0);
});
test('布局限制名称、重名、数量及坐标，避免路径或原型注入',t=>{
  const {store,a}=fixture(t);assert.throws(()=>store.save(a,' ',[],[],{}),/名称/);
  const unsafe=JSON.parse('{"../outside":{"x":1,"y":2},"__proto__":{"x":3,"y":4},"safe.txt":{"x":99999,"y":-9}}');
  store.save(a,'工作',[{id:'c1',filePositions:unsafe}],[{id:'c1',position:{x:Infinity,y:5}}],{x:1,y:2});
  const restored=store.restore(a,store.list(a)[0].id,[{id:'c1'}]);assert.equal(restored.folders[0].position,undefined);
  assert.equal(Object.getPrototypeOf(restored.folders[0].filePositions),null);assert.equal(restored.folders[0].filePositions['../outside'],undefined);
  assert.deepEqual(restored.folders[0].filePositions['safe.txt'],{x:30000,y:0});
  assert.throws(()=>store.save(a,'工作',[],[],{}),/同名/);
  for(let n=1;n<20;n++)store.save(a,'布局'+n,[],[],{});
  assert.throws(()=>store.save(a,'超限',[],[],{}),/上限/);
});
test('损坏布局文件不会被新保存覆盖',t=>{
  const {store,a,file}=fixture(t);fs.writeFileSync(file,'损坏数据');assert.throws(()=>store.save(a,'工作',[],[],{}),/读取失败/);assert.equal(fs.readFileSync(file,'utf8'),'损坏数据');
});
