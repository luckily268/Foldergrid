module.exports=async function(win,js,root,shelf,desktopMode){
 const fs=require('fs'),path=require('path'),assert=require('assert/strict'),electron=require('electron');
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const meta=()=>JSON.parse(fs.readFileSync(path.join(shelf,'grid.json'),'utf8'));
 const cell=()=>meta().folders.find(f=>f.name==='示例格子');
 async function drag(selector,dx,dy){
  const r=await js(`(()=>{let r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+Math.min(16,r.height/2))}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...r});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...r});
  win.webContents.sendInputEvent({type:'mouseMove',x:r.x+dx,y:r.y+dy});await pause(100);
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:r.x+dx,y:r.y+dy});await pause(550);
 }
 await js('document.getElementById("pvClose").click();document.getElementById("back").click()');await pause(650);
 await drag('.topbar .brand',-90,20);
 assert.ok(JSON.parse(fs.readFileSync(path.join(root,'config.json'))).toolbar,'工具条位置保存');
 await drag('.tile:not(.new)',-70,40);assert.ok(cell().position,'格子位置保存');
 await js('document.querySelector(".tile:not(.new)").click()');await pause(550);
 await js('document.getElementById("cellColor").value="#355577";document.getElementById("cellColor").dispatchEvent(new Event("change"))');await pause(200);
 assert.equal(cell().baseColor,'#355577');
 assert.equal(await js('getComputedStyle(document.getElementById("panel")).backgroundColor'),'rgb(53, 85, 119)');
 await drag('.file',90,30);assert.ok(cell().filePositions['预览测试.md'],'内部图标位置保存');
 const incoming=path.join(root,'拖入.txt');fs.writeFileSync(incoming,'拖入正文');
 await js('var featureInput=document.createElement("input");featureInput.type="file";featureInput.id="featureInput";document.body.appendChild(featureInput)');
 win.webContents.debugger.attach('1.3');
 try {
  const doc=await win.webContents.debugger.sendCommand('DOM.getDocument');
  const node=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#featureInput'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[incoming]});
  await js('var transfer=new DataTransfer();transfer.items.add(featureInput.files[0]);document.getElementById("files").dispatchEvent(new DragEvent("drop",{dataTransfer:transfer,bubbles:true,cancelable:true}));featureInput.remove()');
 }finally{win.webContents.debugger.detach();}
 await pause(350);const moved=path.join(shelf,'示例格子','拖入.txt');assert.ok(fs.existsSync(moved),'展开卡片直接拖入');assert.equal(fs.existsSync(incoming),false);
 const oldTrash=electron.shell.trashItem,trash=path.join(root,'FakeRecycleBin');fs.mkdirSync(trash);
 electron.shell.trashItem=async file=>fs.renameSync(file,path.join(trash,path.basename(file)));
 try{
  const from=await js('(()=>{let e=[...document.querySelectorAll(".file")].find(e=>e.textContent.includes("拖入.txt"));let r=e.getBoundingClientRect();return{x:Math.round(r.x+30),y:Math.round(r.y+20)}})()');
  const target=await js('(()=>{let r=document.getElementById("trashZone").getBoundingClientRect();return{x:Math.round(r.x+30),y:Math.round(r.y+15)}})()');
  await js('window.dragTrace=[];["pointerdown","pointerup","pointercancel"].forEach(t=>document.addEventListener(t,e=>dragTrace.push([t,e.target.className,e.clientX,e.clientY]),true))');
  win.webContents.sendInputEvent({type:'mouseMove',...from});await pause(50);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...from});win.webContents.sendInputEvent({type:'mouseMove',...target});await pause(100);win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...target});await pause(450);
  assert.ok(fs.existsSync(path.join(trash,'拖入.txt')),'拖入回收站调用系统回收接口: '+JSON.stringify({from,target,trace:await js('dragTrace'),positions:cell().filePositions}));
 }finally{electron.shell.trashItem=oldTrash;}
 const id=cell().id;
 async function cover(color){await js(`(()=>{let c=document.createElement('canvas');c.width=c.height=256;let x=c.getContext('2d');x.fillStyle=${JSON.stringify(color)};x.fillRect(0,0,256,256);window.fg.send({type:'setIcon',folderId:${JSON.stringify(id)},icon:{type:'image'},dataUrl:c.toDataURL()})})()`);await pause(200);return js('document.querySelector(".tile-img").src');}
 const red=await cover('#ff0000'),blue=await cover('#0000ff');assert.notEqual(red,blue,'连续照片封面地址随内容变化');
 if(desktopMode){
  const native=require('../src/desktop').createWindowsDesktop(),oldTarget=native.dropTarget;
  const api=require('../src/explorer-target'),oldDirectory=api.explorerDirectory;
  try{
   native.dropTarget=()=>({type:'desktop'});
   const src=path.join(shelf,'示例格子','桌面移出.txt');fs.writeFileSync(src,'移出正文');
   await js('window.fg.send('+JSON.stringify({type:'moveOut',folderId:id,path:src})+')');await pause(250);
   assert.ok(fs.existsSync(path.join(electron.app.getPath('desktop'),'桌面移出.txt')));assert.equal(fs.existsSync(src),false);
   const dest=path.join(root,'ExplorerTarget');fs.mkdirSync(dest);native.dropTarget=()=>({type:'explorer',handle:'1'});api.explorerDirectory=async()=>dest;
   const src2=path.join(shelf,'示例格子','资源管理器移出.txt');fs.writeFileSync(src2,'移出正文');
   await js('window.fg.send('+JSON.stringify({type:'moveOut',folderId:id,path:src2})+')');await pause(250);
   assert.ok(fs.existsSync(path.join(dest,'资源管理器移出.txt')));assert.equal(fs.existsSync(src2),false);
  }finally{native.dropTarget=oldTarget;api.explorerDirectory=oldDirectory;}
 }
 assert.equal(cell().baseColor,'#355577');assert.ok(cell().position);assert.ok(cell().filePositions['预览测试.md']);
 if(desktopMode){await pause(650);const d=require('../src/desktop').createWindowsDesktop(),scale=electron.screen.getPrimaryDisplay().scaleFactor;assert.equal(d.regionContains(win,Math.round(80*scale),Math.round(180*scale)),false,'拖动结束后恢复空白区域裁剪');}
 fs.writeFileSync(path.join(root,'../features-result.json'),JSON.stringify({passed:true,desktopMode,checks:['toolbar-drag','cell-drag','file-drag','panel-drop','recycle-drop','color','repeated-photo','move-out-routing','metadata-persistence']},null,2));
};
