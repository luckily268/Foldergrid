(function(){
 'use strict';let folders=[],dragging=false;const send=msg=>window.fg.send(msg),query=new URLSearchParams(location.search);
 function drag(active){dragging=active;document.dispatchEvent(new CustomEvent('sectionDrag',{detail:active}));send({type:'dragState',active});}
 function panelMembers(){
  document.querySelector('.bookcase-panel-members')?.remove();
  const id=document.getElementById('panel').dataset.folderId,book=folders.find(f=>f.id===id&&f.kind==='bookcase');if(!book)return;
  const row=document.createElement('div');row.className='bookcase-panel-members';
  folders.filter(f=>f.bookcaseId===id).forEach(f=>{const b=document.createElement('button');b.textContent=(f.fallbackIcon||'📁')+' '+f.name;b.title='在独立窗口打开 '+f.name;b.onclick=()=>send({type:'openCompare',view:'cell',folderId:f.id});row.append(b);});
  if(!row.children.length)return;
  document.getElementById('files').before(row);
 }
 function render(){
  panelMembers();
  if(query.has('view'))return;
  folders.filter(f=>f.kind==='bookcase').forEach(book=>{
    const tile=document.querySelector('.tile[data-id="'+book.id+'"]');if(!tile)return;
    const wrap=tile.parentElement;
    // The grid defers rebuilding while dragging; do not bind the old section twice.
    if(wrap.classList.contains('bookcase'))return;
    wrap.classList.add('bookcase');wrap.dataset.bookcaseId=book.id;wrap.dataset.style=book.bookcaseStyle||'wood';
    if(book.wallpaper && window.cellThemes[book.wallpaper])wrap.style.setProperty('--bookcase-background',window.cellThemes[book.wallpaper][1]);
    else if(book.baseColor)wrap.style.setProperty('--bookcase-background',book.baseColor);
    if(book.size){wrap.style.setProperty('--book-width',book.size.width+'px');wrap.style.setProperty('--book-height',book.size.height+'px');}
    const index=folders.filter(f=>f.kind==='bookcase').indexOf(book);
    wrap.style.left=Math.max(0,Math.min(innerWidth-(book.size?.width||248),book.position?.x??(28+index%3*258)))+'px';
    wrap.style.top=Math.max(0,Math.min(innerHeight-(book.size?.height||76),book.position?.y??(90+Math.floor(index/3)*132)))+'px';
    const row=document.createElement('div');row.className='bookcase-members';
    const order=book.memberOrder||[];
    folders.filter(f=>f.bookcaseId===book.id&&f.kind!=='bookcase').sort((a,b)=>{
      const ai=order.indexOf(a.id),bi=order.indexOf(b.id);
      return (ai<0?10000:ai)-(bi<0?10000:bi);
    }).forEach(f=>{
      const el=document.querySelector('.tile[data-id="'+f.id+'"]')?.parentElement;if(!el)return;
      row.append(el);
      const handle=el.querySelector('.tile');
      handle.addEventListener('pointerdown',event=>{
        if(event.button!==0||document.body.classList.contains('layout-locked'))return;
        event.stopImmediatePropagation();
        const startX=event.clientX,startY=event.clientY;
        let moved=false;
        handle.setPointerCapture(event.pointerId);
        drag(true);
        function move(e){
          if(Math.hypot(e.clientX-startX,e.clientY-startY)<7&&!moved)return;
          moved=true;el.classList.add('dragging');
          const target=[...row.children].find(item=>{const r=item.getBoundingClientRect();return item!==el&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;});
          if(target){const items=[...row.children],a=items.indexOf(el),b=items.indexOf(target);items[a]=target;items[b]=el;row.replaceChildren(...items);}
        }
        function finish(e){
          document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',finish,true);document.removeEventListener('pointercancel',finish,true);
          if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
          el.classList.remove('dragging');drag(false);
          if(moved){el.dataset.skipClickUntil=String(performance.now()+400);send({type:'saveBookcaseGeometry',folderId:book.id,order:[...row.children].map(item=>item.querySelector('.tile').dataset.id)});}
        }
        document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',finish,true);document.addEventListener('pointercancel',finish,true);
      },true);
      handle.addEventListener('click',event=>{if(performance.now()<Number(el.dataset.skipClickUntil||0))event.stopImmediatePropagation();},true);
    });
    if(row.children.length)wrap.append(row);
    const grip=document.createElement('div');grip.className='resize-handle';grip.title='拖动调整分区大小';wrap.append(grip);
    grip.onpointerdown=event=>{
      if(event.button!==0||document.body.classList.contains('layout-locked'))return;
      event.preventDefault();event.stopPropagation();const rect=wrap.getBoundingClientRect(),x=event.clientX,y=event.clientY;
      grip.setPointerCapture(event.pointerId);drag(true);
      grip.onpointermove=e=>{wrap.style.setProperty('--book-width',Math.max(210,Math.min(innerWidth-rect.x,e.clientX-x+rect.width))+'px');wrap.style.setProperty('--book-height',Math.max(100,Math.min(innerHeight-rect.y,e.clientY-y+rect.height))+'px');};
      const finish=()=>{
        grip.onpointermove=null;grip.onpointerup=null;grip.onpointercancel=null;
        if(grip.hasPointerCapture(event.pointerId))grip.releasePointerCapture(event.pointerId);
        drag(false);
        const bounds=wrap.getBoundingClientRect();send({type:'saveBookcaseGeometry',folderId:book.id,size:{width:bounds.width,height:bounds.height}});
      };
      grip.onpointerup=finish;grip.onpointercancel=finish;
    };
    wrap.addEventListener('contextmenu',event=>{
      if(event.target.closest('.tile[data-id]'))return;
      event.preventDefault();
      send({type:'cellMenu',folderId:book.id});
    });
    wrap.addEventListener('dragover',e=>{e.preventDefault();});wrap.addEventListener('drop',e=>{
      // Tile drop handlers already move files; only the cabinet's blank area is handled here.
      if(e.target.closest('.tile[data-id]'))return;
      e.preventDefault();e.stopPropagation();const paths=[...e.dataTransfer.files].map(f=>window.fg.pathForFile(f)).filter(Boolean);if(paths.length)send({type:'move',folderId:book.id,paths});
    });
  });
 }
 window.fg.onMessage(({data:msg})=>{if(msg.type==='state'&&!dragging){folders=msg.payload.folders;render();}});
 document.addEventListener('cellOpened',panelMembers);
})();
