/* v0.8.2 Presentation only: source/probability routines are never modified. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const bind = (sourceId, targetId, convert = text => text) => {
    const source = $(sourceId), target = $(targetId);
    if (!source || !target) return;
    const sync = () => { target.textContent = convert(source.textContent.trim()) || '--'; };
    new MutationObserver(sync).observe(source, {childList:true, characterData:true, subtree:true});
    sync();
  };
  bind('haColor','haPill',value => value || '--');
  bind('baseProb','basePill');
  bind('dynamicDelta','deltaPill');
  bind('haWeight','weightPill');

  const host = $('chartArea'), float = $('liveTargetFloat');
  if (!host || !float) return;
  const STORE = 'btc-liq-24h-float-position-v082';
  let isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  let savedPosition = null;
  const clamp = (x,min,max) => Math.min(Math.max(x,min),max);
  function bounds() {
    return { maxX:Math.max(0,host.clientWidth-float.offsetWidth-5),
             maxY:Math.max(0,host.clientHeight-float.offsetHeight-5)};
  }
  function paint(x,y) {
    const b = bounds();
    float.style.left = clamp(x,4,b.maxX) + 'px';
    float.style.top = clamp(y,4,b.maxY) + 'px';
    float.style.bottom = 'auto';
  }
  function remember() {
    const b=bounds();
    const x=parseFloat(float.style.left) || 0, y=parseFloat(float.style.top) || 0;
    savedPosition={x:b.maxX?x/b.maxX:0,y:b.maxY?y/b.maxY:0};
    try {localStorage.setItem(STORE,JSON.stringify(savedPosition));} catch (_error) { /* Local files may block persistence. */ }
  }
  function restore() {
    if (isDragging) return;
    if (!savedPosition) {
      // Default: the lower-left of the plot, like the user's illustrated example.
      paint(13,Math.max(4,host.clientHeight-float.offsetHeight-45));
      return;
    }
    const b=bounds();paint(savedPosition.x*b.maxX,savedPosition.y*b.maxY);
  }
  try {
    const prior=JSON.parse(localStorage.getItem(STORE)||'null');
    if (prior && Number.isFinite(prior.x) && Number.isFinite(prior.y)) savedPosition=prior;
  }catch(_error){}
  float.setAttribute('title','按住拖曳，可調整即時24H資訊的位置');
  float.setAttribute('aria-description','拖曳面板可移動，鬆開後保存位置');
  float.addEventListener('pointerdown',event=>{
    if(event.target.closest?.('button'))return;
    if(event.button!==0 && event.pointerType==='mouse')return;
    isDragging=true;
    const r=float.getBoundingClientRect(), h=host.getBoundingClientRect();
    startX=event.clientX;startY=event.clientY;
    startLeft=r.left-h.left;startTop=r.top-h.top;
    float.classList.add('is-dragging');
    float.setPointerCapture(event.pointerId);
    event.stopPropagation();event.preventDefault();
  });
  float.addEventListener('pointermove',event=>{
    if(!isDragging)return;
    paint(startLeft+event.clientX-startX,startTop+event.clientY-startY);
    event.preventDefault();event.stopPropagation();
  });
  const finish=()=>{if(!isDragging)return;isDragging=false;float.classList.remove('is-dragging');remember();};
  float.addEventListener('pointerup',finish);
  float.addEventListener('pointercancel',finish);
  float.addEventListener('lostpointercapture',finish);
  new ResizeObserver(restore).observe(host);
  // Width may change when CoinGlass updates -- keep it in the chart boundaries.
  new ResizeObserver(restore).observe(float);
  requestAnimationFrame(restore);
})();
