module.exports=async function(win,js,root,shelf){
 const fs=require('fs'),path=require('path'),assert=require('assert/strict'),electron=require('electron');
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,label)=>{for(let i=0;i<110;i++){if(await fn())return;await pause(70);}throw Error('等待超时：'+label+' / '+await js('document.getElementById("pvBody")?.textContent'));};
 const meta=()=>JSON.parse(fs.readFileSync(path.join(shelf,'grid.json'),'utf8')),cell=()=>meta().folders.find(f=>f.name==='示例格子');
 const dir=path.join(shelf,'示例格子');
 for(let n=1;n<=6;n++)fs.copyFileSync(path.join(__dirname,'../media/app-icon.png'),path.join(dir,'照片0'+n+'.png'));
 fs.writeFileSync(path.join(dir,'两页.pdf'),require('./pdf-fixture.cjs')());fs.writeFileSync(path.join(dir,'损坏.pdf'),'broken pdf');fs.writeFileSync(path.join(dir,'只读属性.exe'),'not an executable');
 const closePreview=async()=>{await js('document.getElementById("pvClose")?.click()');await pause(350);};
 async function openCell(){await js('document.getElementById("back").click()');await pause(450);await js('window.fg.send({type:"refresh"})');await pause(250);await js('[...document.querySelectorAll(".tile:not(.new)")].find(e=>e.textContent.includes("示例格子")).click()');await pause(650);}
 async function preview(name){await js('[...document.querySelectorAll(".file")].find(e=>e.textContent.includes('+JSON.stringify(name)+')).click()');await pause(300);}
 await openCell();
 const coords=await js('[...document.querySelectorAll(".file")].filter(e=>e.textContent.includes("照片0")).map(e=>({x:e.offsetLeft,y:e.offsetTop}))');
 assert.equal(coords.length,6);assert.ok(coords.some((p,i)=>coords.slice(i+1).some(q=>p.y===q.y&&p.x!==q.x)),'首次打开必须横向排列，无需手动重排');
 await preview('两页.pdf');
 await until(()=>js('document.querySelector(".pdf-stage")?.dataset.renderedPage === "1"'),'真实 PDF 第一页绘制');
 assert.equal(await js('document.querySelector(".pdf-stage canvas").width > 100'),true);
 assert.equal(await js('(()=>{const c=document.querySelector(".pdf-stage canvas"),a=c.getContext("2d").getImageData(0,0,c.width,c.height).data;return a.some((v,i)=>i%4<3&&v<150)})()'),true,'PDF 页面实际有非白像素');
 await js('document.getElementById("pdfNext").click()');await until(()=>js('document.querySelector(".pdf-stage")?.dataset.renderedPage === "2"'),'PDF 第二页');
 const oldWidth=await js('document.querySelector(".pdf-stage canvas").style.width');
 await js('document.getElementById("pdfPlus").click()');await until(()=>js('document.querySelector(".pdf-stage canvas").style.width !== '+JSON.stringify(oldWidth)),'PDF 放大');
 await js('document.getElementById("pdfFit").click()');await pause(150);
 fs.writeFileSync(path.join(root,'../pdf-preview.png'),(await win.webContents.capturePage()).toPNG());
 await closePreview();await preview('损坏.pdf');await until(()=>js('document.querySelector(".pdf-status")?.textContent.includes("无法读取")'),'损坏 PDF 提示');await closePreview();
 const oldOpen=electron.shell.openPath;let opened='';electron.shell.openPath=async file=>{opened=file;return '';};
 try{
  await preview('只读属性.exe');await until(()=>js('document.getElementById("pvBody").textContent.includes("创建时间")'),'二进制文件属性');
  assert.equal(opened,'','单击属性不得启动外部程序');assert.match(await js('document.getElementById("pvBody").textContent'),/只读属性.exe/);
  await pause(450);fs.writeFileSync(path.join(root,'../file-properties.png'),(await win.webContents.capturePage()).toPNG());
  await closePreview();await js('[...document.querySelectorAll(".file")].find(e=>e.textContent.includes("只读属性.exe")).dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await until(()=>opened.endsWith('只读属性.exe'),'双击仍然打开文件');
 }finally{electron.shell.openPath=oldOpen;}
 // Move the expanded panel by its non-button header area.
 const header=await js('(()=>{let r=document.querySelector(".panel-title").getBoundingClientRect();return{x:Math.round(r.x+20),y:Math.round(r.y+r.height/2)}})()');
 win.webContents.sendInputEvent({type:'mouseMove',...header});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...header});win.webContents.sendInputEvent({type:'mouseMove',x:header.x+65,y:header.y+30});await pause(100);win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:header.x+65,y:header.y+30});
 await until(()=>!!cell().panelPosition,'面板位置持久化');const position=cell().panelPosition;
 await openCell();assert.equal(await js('parseFloat(document.getElementById("panel").style.left)'),position.x);assert.equal(await js('parseFloat(document.getElementById("panel").style.top)'),position.y);
 // New-cell icon is only committed when creation is confirmed.
 await js('document.getElementById("back").click()');await pause(450);
 await js('document.getElementById("newBtn").click();document.getElementById("askInput").value="动物收纳";document.getElementById("newIconButton").click();[...document.querySelectorAll(".emoji-btn")].find(b=>b.textContent==="🐱").click()');
 assert.equal(meta().folders.some(f=>f.name==='动物收纳'),false,'选图标之前不能提前创建格子');
 assert.equal(await js('document.getElementById("newIconPreview").textContent'),'🐱');
 await js('document.getElementById("askOk").click()');await until(()=>meta().folders.some(f=>f.name==='动物收纳'),'带图标创建格子');
 const animal=meta().folders.find(f=>f.name==='动物收纳');assert.equal(animal.icon.value,'🐱');assert.equal(animal.icon.appearance,'plain');
 await until(()=>js('!!document.querySelector('+JSON.stringify('.tile[data-id="'+animal.id+'"] .icon-plain')+')'),'动物独立图标');
 assert.equal(await js('getComputedStyle(document.querySelector('+JSON.stringify('.tile[data-id="'+animal.id+'"] .tile-face')+')).backgroundImage'),'none');
 assert.ok(await js('document.querySelector('+JSON.stringify('.tile[data-id="'+animal.id+'"] .tile-face')+').getBoundingClientRect().width <= 128'));
 // Existing image icons can change shape without losing the image file.
 const originalIcon=cell().icon;
 await js('document.querySelector('+JSON.stringify('.tile[data-id="'+cell().id+'"]')+').parentElement.querySelector(".tile-edit").click();document.getElementById("iconAppearance").value="round";document.getElementById("applyAppearance").click()');
 await until(()=>cell().icon.appearance==='round','已有图标外观设置');assert.equal(cell().icon.file,originalIcon.file);
 await js('document.getElementById("newBtn").click();document.getElementById("newIconButton").click()');
 win.webContents.debugger.attach('1.3');try{
  const doc=await win.webContents.debugger.sendCommand('DOM.getDocument'),node=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#iconFile'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path.resolve(__dirname,'../media/app-icon.png')]});await js('document.getElementById("iconFile").dispatchEvent(new Event("change"))');
 }finally{win.webContents.debugger.detach();}
 await until(()=>js('!document.getElementById("cropPreview").hidden'),'创建前选择照片');
 await js('document.getElementById("applyIcon").click();document.getElementById("askInput").value="照片收纳";document.getElementById("askOk").click()');
 await until(()=>meta().folders.some(f=>f.name==='照片收纳'),'照片图标创建');const photo=meta().folders.find(f=>f.name==='照片收纳');assert.equal(photo.icon.type,'image');assert.ok(fs.existsSync(path.join(shelf,photo.icon.file)));
 const count=meta().folders.length;
 await js('document.getElementById("newBtn").click();document.getElementById("newIconButton").click();[...document.querySelectorAll(".emoji-btn")].find(b=>b.textContent==="🐶").click();document.getElementById("askCancel").click()');await pause(150);assert.equal(meta().folders.length,count,'取消不创建任何格子');
 await pause(400);fs.writeFileSync(path.join(root,'../animal-icons.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(root,'../preview-plus-result.json'),JSON.stringify({passed:true,checks:['first-open-horizontal-layout','real-pdf-worker-render','pdf-pages','pdf-zoom','broken-pdf-message','file-properties','single-click-no-execute','double-click-open','panel-header-drag-and-reopen','new-cell-animal-icon','transparent-icon-size','change-existing-image-shape','new-cell-photo-icon','cancel-no-side-effects']},null,2));
 console.log('PDF、文件属性、顶栏拖动、创建时图标和首次横向排列验证通过');
};
