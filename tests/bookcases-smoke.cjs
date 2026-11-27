module.exports=async function(main,js,root,shelf){
 const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{BrowserWindow,dialog,Menu}=require('electron');
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,label)=>{for(let i=0;i<110;i++){if(await fn())return;await pause(70);}throw Error(label);};
 const meta=()=>JSON.parse(fs.readFileSync(path.join(shelf,'grid.json'),'utf8'));
 await js('document.getElementById("newBtn").click();document.getElementById("askInput").value="研究书柜";document.getElementById("newCellType").value="bookcase";document.getElementById("newBookcaseStyle").value="glass";document.getElementById("newIconButton").click();document.querySelector("[data-pattern=library-big]").click();document.getElementById("askOk").click()');
 await until(()=>meta().folders.some(f=>f.name==='研究书柜'),'创建书柜');const book=meta().folders.find(f=>f.name==='研究书柜'),member=meta().folders.find(f=>f.kind!=='bookcase'&&f.kind!=='portal');
 const tile=id=>'.tile[data-id="'+id+'"]';
 async function menuAction(win,selector,labels){
  let menu;const original=Menu.buildFromTemplate;
  Menu.buildFromTemplate=template=>({popup(){menu=template;}});
  try{
   await win.webContents.executeJavaScript('document.querySelector('+JSON.stringify(selector)+').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
   await until(()=>menu,'打开右键菜单');
   let item;for(const label of labels){item=menu.find(i=>i.label===label);assert.ok(item,label);menu=item.submenu;}
   assert.notEqual(item.enabled,false);await item.click();
  }finally{Menu.buildFromTemplate=original;}
 }
 assert.deepEqual(book.icon,{type:'pattern',value:'library-big',appearance:'card'});
 await until(()=>js('document.querySelector(".bookcase .pattern-icon")?.naturalWidth===24'),'新增图案离线显示');
 assert.equal(await js('!!document.querySelector(".bookcase select")'),false);
 const memberDir=path.join(shelf,member.name);fs.writeFileSync(path.join(memberDir,'保留成员.txt'),'原位置');
 await menuAction(main,tile(book.id),['收纳格子',member.name]);await until(()=>meta().folders.find(f=>f.id===member.id).bookcaseId===book.id,'收纳格子');
 assert.ok(fs.existsSync(path.join(memberDir,'保留成员.txt')));await until(()=>js('document.querySelector('+JSON.stringify('.tile[data-id="'+member.id+'"]')+').closest(".bookcase")?.dataset.bookcaseId==='+JSON.stringify(book.id)),'成员显示在书柜');
 await menuAction(main,tile(book.id),['分区样式','极简白色']);await until(()=>meta().folders.find(f=>f.id===book.id).bookcaseStyle==='minimal','切换样式');
 await menuAction(main,tile(book.id),['背景颜色','苔藓绿']);await until(()=>meta().folders.find(f=>f.id===book.id).baseColor==='#3e513e','背景颜色');
 await js('window.bookMoveEvents=[];window.fg.onMessage(e=>{if(e.data.type==="filesLanded")bookMoveEvents.push(e.data)})');
 const incoming=path.join(root,'柜内.txt');fs.writeFileSync(incoming,'书柜文件');await js('window.fg.send('+JSON.stringify({type:'move',folderId:book.id,paths:[incoming]})+')');await until(()=>js('bookMoveEvents.length===1'),'首个书柜移动完成回复');assert.ok(fs.existsSync(path.join(shelf,book.name,'柜内.txt')));
 const dropped=path.join(root,'标题拖入.txt');fs.writeFileSync(dropped,'拖入一次');await js('window.bookDropEvents=[];window.fg.onMessage(e=>{if(e.data.type==="filesLanded")bookDropEvents.push(e.data)});var bookInput=document.createElement("input");bookInput.type="file";bookInput.id="bookInput";document.body.append(bookInput)');
 main.webContents.debugger.attach('1.3');try{const doc=await main.webContents.debugger.sendCommand('DOM.getDocument'),node=await main.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#bookInput'});await main.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[dropped]});await js('(()=>{const dt=new DataTransfer();dt.items.add(bookInput.files[0]);document.querySelector('+JSON.stringify('.tile[data-id="'+book.id+'"]')+').dispatchEvent(new DragEvent("drop",{dataTransfer:dt,bubbles:true,cancelable:true}));bookInput.remove()})()');}finally{main.webContents.debugger.detach();}
 await until(()=>fs.existsSync(path.join(shelf,book.name,'标题拖入.txt')),'书柜标题拖入');await pause(100);assert.equal(await js('bookDropEvents.length'),1,'标题事件冒泡不能重复移动');
 const extras=()=>BrowserWindow.getAllWindows().filter(w=>w!==main&&!w.isDestroyed());
 await pause(200);fs.writeFileSync(path.join(root,'../bookcase.png'),(await main.webContents.capturePage()).toPNG());
 // Normal icon clicks keep the first panel and open a second cell independently.
 await js('document.querySelector('+JSON.stringify('.tile[data-id="'+member.id+'"]')+').click()');await pause(550);
 await js('document.querySelector('+JSON.stringify('.tile[data-id="'+book.id+'"]')+').click()');
 await until(()=>extras().length===1,'点击第二个图标多开');assert.equal(await js('document.getElementById("panel").dataset.folderId'),member.id);
 extras().forEach(w=>w.close());await pause(100);await js('document.getElementById("back").click()');await pause(450);
 await js('window.fg.send('+JSON.stringify({type:'openCompare',view:'cell',folderId:member.id})+');window.fg.send('+JSON.stringify({type:'openCompare',view:'cell',folderId:book.id})+')');
 await until(()=>extras().length===2,'同时打开两个格子窗口');
 const cellWin=extras().find(w=>w.fgView?.id===member.id),bookWin=extras().find(w=>w.fgView?.id===book.id);
 await until(()=>bookWin.webContents.executeJavaScript('!!document.querySelector(".bookcase-panel-members button")'),'书柜独立窗口也展示成员格子');
 await until(()=>cellWin.webContents.executeJavaScript('document.getElementById("panel").dataset.folderId === '+JSON.stringify(member.id)),'独立格子收到自己的状态');
 await menuAction(cellWin,'.file[data-path$="保留成员.txt"]',['复制']);
 await menuAction(bookWin,'#files',['粘贴']);
 await menuAction(bookWin,'#files',['粘贴']);
 assert.equal(fs.readFileSync(path.join(shelf,book.name,'保留成员.txt'),'utf8'),'原位置');
 assert.equal(fs.readFileSync(path.join(shelf,book.name,'保留成员 - 副本.txt'),'utf8'),'原位置');
 const f1=path.join(memberDir,'保留成员.txt'),f2=path.join(shelf,book.name,'柜内.txt');
 await js('window.fg.send('+JSON.stringify({type:'openCompare',view:'preview',path:f1})+');window.fg.send('+JSON.stringify({type:'openCompare',view:'preview',path:f2})+')');await until(()=>extras().length===4,'同时打开两个预览');
 const preview1=extras().find(w=>w.fgView?.path===f1),preview2=extras().find(w=>w.fgView?.path===f2);
 await until(()=>preview1.webContents.executeJavaScript('document.getElementById("pvBody")?.textContent.includes("原位置")'),'预览一内容');
 await until(()=>preview2.webContents.executeJavaScript('document.getElementById("pvBody")?.textContent.includes("书柜文件")'),'预览二内容');
 assert.equal(preview1.isResizable(),true);preview1.setBounds({x:30,y:70,width:500,height:550});preview2.setBounds({x:550,y:70,width:500,height:550});
 await pause(650);
 await until(()=>preview2.webContents.executeJavaScript('Number(getComputedStyle(document.querySelector(".preview-body")).opacity) > 0.99'),'预览内容过渡完成');
 fs.writeFileSync(path.join(root,'../compare-window-one.png'),(await preview1.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(root,'../compare-window-two.png'),(await preview2.webContents.capturePage()).toPNG());
 await js('window.fg.send('+JSON.stringify({type:'openCompare',view:'cell',folderId:member.id})+')');await pause(100);assert.equal(extras().length,4,'同一格子再次打开聚焦已有窗口');
 preview1.close();await pause(100);assert.equal(extras().length,3);assert.equal(preview2.isDestroyed(),false);assert.equal(cellWin.isDestroyed(),false);
 // Requests from different windows must not cross their replies.
 await Promise.all([cellWin.webContents.executeJavaScript('window.fg.send('+JSON.stringify({type:'preview',path:f1})+')'),preview2.webContents.executeJavaScript('window.fg.send('+JSON.stringify({type:'preview',path:f2})+')')]);await pause(100);
 assert.match(await preview2.webContents.executeJavaScript('document.getElementById("pvBody").textContent'),/书柜文件/);
 extras().forEach(w=>w.close());await pause(100);
 await menuAction(main,tile(member.id),['移出分区']);await until(()=>!meta().folders.find(f=>f.id===member.id).bookcaseId,'格子移出书柜');assert.ok(fs.existsSync(path.join(memberDir,'保留成员.txt')));
 await js('window.fg.send('+JSON.stringify({type:'assignBookcase',folderId:member.id,bookcaseId:book.id})+')');await pause(100);
 const original=dialog.showMessageBox;dialog.showMessageBox=async()=>({response:1});try{await js('window.fg.send('+JSON.stringify({type:'deleteCell',folderId:book.id})+')');await until(()=>!meta().folders.some(f=>f.id===book.id),'删除书柜');}finally{dialog.showMessageBox=original;}
 assert.equal(meta().folders.find(f=>f.id===member.id).bookcaseId,undefined);assert.ok(fs.existsSync(path.join(memberDir,'保留成员.txt')));assert.equal(fs.readFileSync(path.join(require('electron').app.getPath('desktop'),'柜内.txt'),'utf8'),'书柜文件');
 fs.writeFileSync(path.join(root,'../bookcases-result.json'),JSON.stringify({passed:true,checks:['create-bookcase','switch-style','group-cell-no-file-move','direct-file-storage','two-cell-windows','two-preview-windows','reply-isolation','duplicate-focus','independent-close','remove-member-keeps-files','delete-bookcase-release-members-and-files']},null,2));console.log('书柜样式、成员/文件保留与多格子多预览窗口验证通过');
};
