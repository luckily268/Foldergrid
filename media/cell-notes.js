(function(){
 'use strict';let folders=[],id=null;
 const layer=document.createElement('div');layer.className='modal-backdrop';layer.hidden=true;
 layer.innerHTML='<section class="modal notes-modal"><div class="modal-head"><strong id="noteTitle">格子备注</strong><button id="noteClose" class="modal-close">✕</button></div><div class="modal-body"><label>项目描述或会话摘记<textarea id="cellNote" maxlength="2000" rows="5" placeholder="例如：网站改版，下一步完成首页…"></textarea></label><label>关联本地会话文件 / 目录<input id="cellSession" placeholder="本地绝对路径，可选" /></label><div class="prompt-actions"><button id="noteReveal" class="btn-ghost">定位会话</button><button id="noteSave" class="btn-primary">保存备注</button></div><p id="noteFeedback" role="status"></p></div></section>';document.body.append(layer);
 const send=msg=>window.fg.send(msg);
 function open(folderId){const f=folders.find(f=>f.id===folderId);if(!f)return;id=folderId;layer.hidden=false;document.getElementById('noteTitle').textContent='备注 · '+f.name;document.getElementById('cellNote').value=f.note||'';document.getElementById('cellSession').value=f.sessionPath||'';document.getElementById('noteFeedback').textContent='备注只保存在本机，关联路径不会自动执行。';document.getElementById('cellNote').focus();}
 document.getElementById('noteClose').onclick=()=>layer.hidden=true;
 layer.onclick=e=>{if(e.target===layer)layer.hidden=true;};
 layer.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();layer.hidden=true;}});
 document.getElementById('noteSave').onclick=()=>send({type:'saveCellDetails',folderId:id,note:document.getElementById('cellNote').value,sessionPath:document.getElementById('cellSession').value});
 document.getElementById('noteReveal').onclick=()=>send({type:'revealCellSession',folderId:id});
 ['cellNote','cellSession'].forEach(key=>document.getElementById(key).onfocus=()=>send({type:'focusInput',id:key}));
 document.getElementById('cellNoteBtn').onclick=()=>open(document.getElementById('panel').dataset.folderId);
 window.fg.onMessage(({data:msg})=>{if(msg.type==='state')folders=msg.payload.folders;if(msg.type==='requestCellDetails')open(msg.folderId);if(msg.type==='cellDetailsSaved'&&msg.folderId===id)layer.hidden=true;if(msg.type==='toast'&&!layer.hidden)document.getElementById('noteFeedback').textContent=msg.message;});
})();
