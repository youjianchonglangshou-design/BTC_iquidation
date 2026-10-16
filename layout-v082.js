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
  // Apply chart semantic HA colors to the full mean-candle capsule, not only the label text.
  // This follows the already-calculated value; it never modifies the HA/model algorithm.
  const haSource=$('haColor'),haPill=$('haPill'),haWeight=$('haWeight');
  function syncHATone(){
    const tone=/^黃/.test(haSource.textContent.trim())?'yellow':/^紫/.test(haSource.textContent.trim())?'purple':'neutral';
    haSource.dataset.haTone=tone;
    haPill.closest('.metric-capsule')?.setAttribute('data-ha-tone',tone);
    haWeight.dataset.haTone=tone;
    $('weightPill').closest('.metric-capsule')?.setAttribute('data-ha-tone',tone);
  }
  new MutationObserver(syncHATone).observe(haSource,{childList:true,characterData:true,subtree:true});
  syncHATone();

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


  // v0.9.4 layout-only timeline sync: reflects 08→12→16→20 progression.
  const timelineIds=['08','12','16','20'];
  const phaseChip=$('phaseChip'), timelineStateLabel=$('timelineStateLabel');
  const TPE_CLOCK = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const timelineNodes=Object.fromEntries(timelineIds.map(k=>[k,$('timeline'+k)]));
  const timelineSegments=[
    { id:'segment08_12', start:480, end:720 },
    { id:'segment12_16', start:720, end:960 },
    { id:'segment16_20', start:960, end:1200 }
  ].map(seg=>({ ...seg, el:$(seg.id) }));
  function tpeMinuteNow(){
    const parts={};
    for(const p of TPE_CLOCK.formatToParts(new Date())) if(p.type!=='literal') parts[p.type]=p.value;
    return Number(parts.hour||0)*60 + Number(parts.minute||0);
  }
  function syncTimeline(){
    if(!timelineNodes['08']) return;
    const minute=tpeMinuteNow();
    const marks={ '08':480, '12':720, '16':960, '20':1200 };
    let active='08';
    if(minute>=marks['20']) active='20';
    else if(minute>=marks['16']) active='16';
    else if(minute>=marks['12']) active='12';
    const frozen=/20:00.*凍結|已凍結|20:00 已凍結/.test((phaseChip?.textContent||'').trim());
    for(const key of timelineIds){
      const el=timelineNodes[key]; if(!el) continue;
      el.classList.remove('is-done','is-active','is-frozen','is-pending');
      if(minute>marks[key] || (key!==active && minute>=marks[key])) el.classList.add('is-done');
      else el.classList.add('is-pending');
    }
    const activeEl=timelineNodes[active];
    if(activeEl){
      activeEl.classList.remove('is-pending');
      activeEl.classList.add(frozen && active==='20' ? 'is-frozen' : 'is-active');
    }
    for(const seg of timelineSegments){
      if(!seg.el) continue;
      seg.el.classList.remove('is-done','is-active','is-frozen');
      if(minute>=seg.end){
        seg.el.classList.add(frozen && seg.end===1200 ? 'is-frozen' : 'is-done');
      }else if(minute>=seg.start && minute<seg.end){
        seg.el.classList.add('is-active');
      }
    }
    if(timelineStateLabel){
      timelineStateLabel.textContent = frozen ? '20:00 凍結完成' : active==='20' ? '20:00 凍結視窗' : active==='16' ? '16～20 動態觀察' : active==='12' ? '12～16 累積基礎' : '08～12 起始區間';
    }
  }
  if(phaseChip){ new MutationObserver(syncTimeline).observe(phaseChip,{childList:true,characterData:true,subtree:true}); }
  syncTimeline();
  setInterval(syncTimeline, 15000);
})();
