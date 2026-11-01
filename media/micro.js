(function(){
  'use strict';
  let settings={motion:true,sound:false}, audio, lastSound=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function motion(){return settings.motion && !reduced.matches;}
  function clear(){document.querySelectorAll('.magnetic-target').forEach(el=>{el.classList.remove('magnetic-target');el.querySelector('.tile-face')?.style.removeProperty('translate');});document.querySelectorAll('.magnet-particle').forEach(el=>el.remove());}
  function attract(tile,x,y){
    if(!motion()||tile.classList.contains('portal-tile'))return;
    const face=tile.querySelector('.tile-face'),r=face.getBoundingClientRect();
    tile.classList.add('magnetic-target');face.style.translate=Math.max(-5,Math.min(5,(x-r.x-r.width/2)*.12))+'px '+Math.max(-5,Math.min(5,(y-r.y-r.height/2)*.12))+'px';
  }
  function targetAt(x,y,exclude){return [...document.querySelectorAll('.tile[data-id]')].find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&el.dataset.id!==exclude&&!el.classList.contains('portal-tile')&&x>=r.left-10&&x<=r.right+10&&y>=r.top-10&&y<=r.bottom+10;});}
  function drag(x,y,ghost,exclude){
    clear();const tile=targetAt(x,y,exclude);
    if(tile){attract(tile,x,y);if(ghost&&motion()){const r=tile.getBoundingClientRect();ghost.style.left=(x+(r.x+r.width/2-x)*.22-28)+'px';ghost.style.top=(y+(r.y+24-y)*.22-28)+'px';}}
    return tile?.dataset.id;
  }
  function sound(){
    if(!settings.sound||Date.now()-lastSound<180)return;
    lastSound=Date.now();
    try{audio ||= new AudioContext();audio.resume().then(()=>{const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;o.type='sine';o.frequency.setValueAtTime(420,t);o.frequency.exponentialRampToValueAtTime(145,t+.13);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.06,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+.16);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.18);}).catch(()=>{});}catch(_){}
  }
  // Feedback only follows the main process's successful file-move acknowledgement.
  function landed(id,count){
    if(!count)return;clear();sound();if(!motion())return;
    const tile=document.querySelector('.tile[data-id="'+id+'"] .tile-face');
    const panel=document.getElementById('panel');
    const elements=[tile];if(panel.dataset.folderId===id&&!document.getElementById('overlay').hidden)elements.push(panel);
    elements.filter(Boolean).forEach(el=>{el.getAnimations().filter(a=>a.id==='landed').forEach(a=>a.cancel());const animation=el.animate([{transform:'scale(1)'},{transform:'translateY(4px) scale(.91,1.07)',offset:.25},{transform:'translateY(-2px) scale(1.05,.96)',offset:.62},{transform:'scale(1)'}],{duration:300,easing:'ease-out'});animation.id='landed';});
  }
  document.addEventListener('dragover',e=>{const tile=e.target.closest('.tile[data-id]');clear();if(tile)attract(tile,e.clientX,e.clientY);});
  ['drop','dragend'].forEach(type=>document.addEventListener(type,clear));
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)clear();});
  document.addEventListener('pointerdown',()=>{if(settings.sound){try{audio ||= new AudioContext();audio.resume().catch(()=>{});}catch(_){}}},{capture:true});
  window.fg.onMessage(({data:msg})=>{if(msg.type==='state'){settings=msg.payload.feedback||settings;if(!motion())clear();}if(msg.type==='filesLanded')landed(msg.folderId,msg.count);});
  window.cellMicro={motion,clear,drag,targetAt};
})();
