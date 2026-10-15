// v0.8.0: presentation only. Probability, feeds, CoinGlass parser and settlement untouched.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const host = $('floatingDrawer'), backdrop = $('drawerBackdrop'), title = $('drawerTitle');
  const pages = [...document.querySelectorAll('.drawer-page')];
  const titles = {model:'機率依據', levels:'CoinGlass 清算價細節', sources:'資料與設定', history:'20:00 凍結紀錄'};
  let active = null, previousFocus = null;
  function close() {
    if(!active)return;
    active=null;host.hidden=true;backdrop.hidden=true;
    pages.forEach(p=>p.hidden=true);
    previousFocus?.focus?.(); previousFocus=null;
  }
  function open(key, source) {
    if(active===key){close();return;}
    if(!(key in titles))return;
    previousFocus=source || document.activeElement;
    active=key; title.textContent=titles[key];
    pages.forEach(p=>p.hidden=p.id!=='drawer-'+key);
    host.hidden=false;backdrop.hidden=false;
    $('drawerClose').focus();
  }
  document.querySelectorAll('.popup-button[data-panel]').forEach(el=>{
    el.addEventListener('click',()=>open(el.dataset.panel,el));
    if(el.getAttribute('role')==='button')el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(el.dataset.panel,el);}});
  });
  $('drawerClose').addEventListener('click',close);
  backdrop.addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});

  // Keep small readouts synchronized with the existing model output, with no new model rules.
  const bindText = (sourceId,targetId,transform) => {
    const source=$(sourceId),target=$(targetId);if(!source||!target)return;
    const sync=()=>{target.textContent=transform(source.textContent.trim());};
    new MutationObserver(sync).observe(source,{childList:true,characterData:true,subtree:true});sync();
  };
  bindText('haColor','haMicro', t=>/^黃/.test(t)?'黃':/^紫/.test(t)?'紫':'--');
  bindText('phaseChip','freezeMicro', t=>t.includes('凍結')?'已凍結':t.includes('動態')?'動態中':'等待');
  const base=$('baseProb'),delta=$('dynamicDelta'),micro=$('phaseMicro');
  function syncPhase(){micro.textContent=base.textContent.trim()+' / '+delta.textContent.trim();}
  for(const el of [base,delta])new MutationObserver(syncPhase).observe(el,{childList:true,characterData:true,subtree:true});syncPhase();
  // Frozen/active target labels are set only by app.js, never overwritten by this UI layer.
  // The 4H/15M chart height is responsive; chart.js already has ResizeObserver.
})();
