(function(){
 'use strict';let folders=[];const send=msg=>window.fg.send(msg),query=new URLSearchParams(location.search);
 function panelMembers(){
  document.querySelector('.bookcase-panel-members')?.remove();
  const id=document.getElementById('panel').dataset.folderId,book=folders.find(f=>f.id===id&&f.kind==='bookcase');if(!book)return;
  const row=document.createElement('div');row.className='bookcase-panel-members';
  folders.filter(f=>f.bookcaseId===id).forEach(f=>{const b=document.createElement('button');b.textContent=(f.fallbackIcon||'📁')+' '+f.name;b.title='在独立窗口打开 '+f.name;b.onclick=()=>send({type:'openCompare',view:'cell',folderId:f.id});row.append(b);});
  if(!row.children.length)row.textContent='书柜中还没有格子，可以从桌面书柜的“收纳一个格子”添加。';
  document.getElementById('files').before(row);
 }
 function render(){
  panelMembers();
  if(query.has('view'))return;
  folders.filter(f=>f.kind==='bookcase').forEach(book=>{
    const tile=document.querySelector('.tile[data-id="'+book.id+'"]');if(!tile)return;
    const wrap=tile.parentElement;wrap.classList.add('bookcase');wrap.dataset.bookcaseId=book.id;wrap.dataset.style=book.bookcaseStyle||'wood';
    wrap.style.left=Math.max(0,Math.min(innerWidth-340,book.position?.x??28))+'px';wrap.style.top=Math.max(0,Math.min(innerHeight-180,book.position?.y??90))+'px';
    const row=document.createElement('div');row.className='bookcase-members';
    folders.filter(f=>f.bookcaseId===book.id&&f.kind!=='bookcase').forEach(f=>{
      const el=document.querySelector('.tile[data-id="'+f.id+'"]')?.parentElement;if(!el)return;
      const remove=document.createElement('button');remove.className='bookcase-remove';remove.textContent='↗';remove.title='移出书柜，返回桌面';remove.onclick=()=>send({type:'assignBookcase',folderId:f.id,bookcaseId:null});el.append(remove);row.append(el);
    });
    const controls=document.createElement('div');controls.className='bookcase-controls';
    const choose=document.createElement('select');choose.setAttribute('aria-label','选择要收纳的格子');const empty=document.createElement('option');empty.value='';empty.textContent='＋ 收纳一个格子…';choose.append(empty);
    folders.filter(f=>f.kind!=='bookcase'&&f.bookcaseId!==book.id).forEach(f=>{const o=document.createElement('option');o.value=f.id;o.textContent=f.name;choose.append(o);});choose.onchange=()=>{if(choose.value)send({type:'assignBookcase',folderId:choose.value,bookcaseId:book.id});};
    const style=document.createElement('select');style.setAttribute('aria-label','书柜样式');[['wood','温润木质'],['glass','雾面玻璃'],['minimal','极简白色']].forEach(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;style.append(o);});style.value=book.bookcaseStyle||'wood';style.onchange=()=>send({type:'setBookcaseStyle',folderId:book.id,style:style.value});
    controls.append(choose,style);wrap.append(row,controls);
    wrap.addEventListener('dragover',e=>{e.preventDefault();});wrap.addEventListener('drop',e=>{
      // Tile drop handlers already move files; only the cabinet's blank area is handled here.
      if(e.target.closest('.tile[data-id]'))return;
      e.preventDefault();e.stopPropagation();const paths=[...e.dataTransfer.files].map(f=>window.fg.pathForFile(f)).filter(Boolean);if(paths.length)send({type:'move',folderId:book.id,paths});
    });
  });
 }
 window.fg.onMessage(({data:msg})=>{if(msg.type==='state'){folders=msg.payload.folders;render();}});
 document.addEventListener('cellOpened',panelMembers);
})();
