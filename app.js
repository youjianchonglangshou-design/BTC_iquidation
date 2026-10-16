/* BTC LIQUIDITY RADAR v0.9.9 - local 20:00 freeze independent of R2, Cloudflare remote optional. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TPE_FMT = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const priceFmt = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const PRICE_INTERVAL = 10000, KLINE_INTERVAL = 60000, COINGLASS_INTERVAL = 60000, BINANCE_INTERVAL = 60000, HA_INTERVAL = 300000;
  const LEGAL_LEVERAGES = [{n:25,w:.28},{n:50,w:.34},{n:75,w:.24},{n:100,w:.14}];
  const MM_RATE_ASSUMPTION = .004; // Illustrative rate, not actual exchange liquidation schedule.
  const state = {
    candles:[],fourHCandles:[],fourHSource:'',chartTf:'4h',hoverPoint:null,price:null,priceAt:null,source:'demo',sourceLabel:'歷史示範',mode:'cg',zones:{upper:[],lower:[]},
    maxDistance:.06,binRatio:.0018,manual:{upper:[],lower:[]},oi:null,refreshIssue:'',liveAt:null,cgPain:null,cgAt:0,cgFailures:0,cgError:'尚未取得 CoinGlass 資料',cgBusy:false,cgVersion:null,refreshCGAt:0,binance:null,binanceAt:0,binanceError:'尚未讀取 Binance L2',binanceBusy:false,refreshBinanceAt:0,effectiveBoundarySource:'none',
    suppressLive:false,loading:false,refreshKAt:0,refreshPAt:0,hoverIndex:-1,
    snapshots:[],chartGeometry:null,daily:[],probability:null,baseProb:null,refreshHAAt:0,modelError:'',lastProbCalcAt:0,chartWindowKey:null
  };
  function tpeParts(d=new Date()){
    const o={}; for(const p of TPE_FMT.formatToParts(d))if(p.type!=='literal')o[p.type]=p.value;
    return {date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour),minute:Number(o.minute),text:`${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`};
  }
  function tpeTime(t,onlyHour=false){const p=tpeParts(new Date(t));return onlyHour?`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`:p.text;}
  const fmt=p=>Number.isFinite(p)?'$'+priceFmt.format(p):'--';
  const pct=(p,b)=>Number.isFinite(p)&&b>0?`${p>b?'+':''}${(((p/b)-1)*100).toFixed(2)}%`:'--';
  function normalizeKlines(rows,source){
    if(!Array.isArray(rows))throw Error('K 線不是陣列');
    const out=rows.map(r=>({t:Number(r[0]),o:Number(r[1]),h:Number(r[2]),l:Number(r[3]),c:Number(r[4]),v:r[7]!=null&&Number.isFinite(Number(r[7]))?Number(r[7]):null})).filter(r=>[r.t,r.o,r.h,r.l,r.c].every(Number.isFinite)&&r.o>0&&r.h>=r.l&&r.c>0).sort((a,b)=>a.t-b.t);
    if(out.length<48)throw Error(source+' K 線不足 48 根');
    return out.filter((r,i)=>!i||r.t!==out[i-1].t);
  }
  function readDemoDays(){return (window.BTC_DEMO_DAILY||[]).map(r=>({t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]}));}
  function readDemo(){
    const src=window.BTC_DEMO_15M||[];
    return src.map(r=>({t:Number(r[0]),o:Number(r[1]),h:Number(r[2]),l:Number(r[3]),c:Number(r[4]),v:null}));
  }
  function chooseBin(price,ratio){return Math.max(25,Math.round(price*ratio/25)*25);}
  function buildZones(candles,current,opt={}){
    if(!Array.isArray(candles)||!candles.length||!(current>0))return {upper:[],lower:[],usedVolume:false};
    const window=candles.slice(-288);
    const validVolume=window.filter(c=>Number.isFinite(c.v)&&c.v>0);
    const useVolume=validVolume.length>window.length*.65;
    const sortedVol=validVolume.map(c=>c.v).sort((a,b)=>a-b);
    const medianVol=useVolume?sortedVol[Math.floor(sortedVol.length/2)]:1;
    const dist=opt.maxDistance??state.maxDistance;
    const size=chooseBin(current,opt.binRatio??state.binRatio);
    const bucket={upper:new Map(),lower:new Map()};
    const newest=window[window.length-1].t;
    for(const r of window){
      const age=Math.max(0,(newest-r.t)/3600000);
      const timeWeight=Math.exp(-age/48);
      const volWeight=useVolume&&Number.isFinite(r.v)?Math.max(.25,Math.min(3,r.v/Math.max(1,medianVol))):1;
      const entry=(r.h+r.l+r.c)/3;
      if(!(entry>0))continue;
      for(const lev of LEGAL_LEVERAGES){
        // Simplified liquidation-price proxy, not observed liquidation positions.
        const shortPrice=entry*(1+1/lev.n-MM_RATE_ASSUMPTION);
        const longPrice=entry*(1-1/lev.n+MM_RATE_ASSUMPTION);
        const base=timeWeight*volWeight*lev.w;
        if(shortPrice>current*1.001&&shortPrice<=current*(1+dist)){
          const bin=Math.round(shortPrice/size);bucket.upper.set(bin,(bucket.upper.get(bin)||0)+base);
        }
        if(longPrice<current*.999&&longPrice>=current*(1-dist)){
          const bin=Math.round(longPrice/size);bucket.lower.set(bin,(bucket.lower.get(bin)||0)+base);
        }
      }
    }
    const sides={};
    for(const dir of ['upper','lower']){
      const map=bucket[dir],items=[];
      // Mild smoothing to make adjacent candle bins into a single visible band.
      for(const [bin,value] of map){
        const score=value+.20*(map.get(bin-1)||0)+.20*(map.get(bin+1)||0);
        const p=bin*size, distance=Math.abs(p/current-1);
        if(distance>.001&&score>.001)items.push({price:p,strength:score,distance});
      }
      items.sort((a,b)=>b.strength/(.5+Math.sqrt(b.distance*100))-a.strength/(.5+Math.sqrt(a.distance*100)));
      const picked=[];
      for(const item of items){
        if(picked.every(x=>Math.abs(x.price-item.price)>=size*2.5)){picked.push(item);if(picked.length>=4)break;}
      }
      // Select three representative candidate bands, sorted by distance. first = nearest; main = strength/distance optimum.
      const max=Math.max(1,...picked.map(x=>x.strength));
      sides[dir]=picked.sort((a,b)=>a.distance-b.distance).slice(0,3).map(z=>({...z,score:Math.max(1,Math.round(z.strength/max*100)),width:size}));
    }
    return {...sides,usedVolume:useVolume};
  }
  function parseLevels(v,side,current){
    if(!v.trim())return [];
    const numbers=v.replaceAll('，',',').split(/[,;\s]+/).map(x=>Number(x.replaceAll('$','').replaceAll('_',''))).filter(n=>Number.isFinite(n)&&n>0);
    return [...new Set(numbers)].filter(n=>side==='upper'?n>current:n<current).sort((a,b)=>side==='upper'?a-b:b-a).slice(0,6).map((p,i)=>({price:p,distance:Math.abs(p/current-1),score:null,width:Math.max(50,current*.001),manual:true}));
  }
  // Every daily session starts at 08:00 Asia/Taipei (=00:00 UTC).
  // 08:00:00–19:59:59: latest CoinGlass 24H; 20:00:00–07:59:59: that session's 20:00 snapshot.
  // NEVER substitute a later quote for a missing frozen snapshot without marking it LIVE.
  function chartSession(t=Date.now()){
    const start=Math.floor(t/86400000)*86400000;
    const frozenWindow=t>=start+12*3600000;
    return {start,day:new Date(start).toISOString().slice(0,10),frozenWindow,
      key:start+':'+(frozenWindow?'frozen':'live')};
  }
  const isValidBinance = (t=Date.now()) => Boolean(state.binance&&state.binanceAt>0&&t-state.binanceAt>=0&&t-state.binanceAt<180000&&
    state.binance.upper?.price>state.binance.referencePrice&&state.binance.lower?.price<state.binance.referencePrice);
  const isValidCoinGlass = (t=Date.now()) => Boolean(!state.cgError&&state.cgPain&&!state.suppressLive&&state.cgAt>0&&
    t-state.cgAt>=0&&t-state.cgAt<180000&&Number(state.cgPain.short)>0&&Number(state.cgPain.long)>0);
  function boundaryData(t=Date.now(),ignoreMode=false){
    const cg=isValidCoinGlass(t);
    const binance=isValidBinance(t);
    if(state.mode==='manual'&&!ignoreMode)return {source:'manual',up:null,down:null};
    if(state.mode==='binance'&&!ignoreMode)return binance?{source:'binance',up:state.binance.upper.price,down:state.binance.lower.price}: {source:'none',up:null,down:null};
    if(cg)return {source:'cg',up:state.cgPain.short,down:state.cgPain.long,
      upAmount:state.cgPain.shortAmount,downAmount:state.cgPain.longAmount};
    if(binance)return {source:'binance',up:state.binance.upper.price,down:state.binance.lower.price};
    return {source:'none',up:null,down:null};
  }
  // Local freeze is INDEPENDENT of R2. Cloud records take precedence when available;
  // a valid local 20:00 snapshot is still displayed if the network/R2 is unavailable.
  const FREEZE_CANDIDATE_KEY='btc-liq-local-pre20-v099';
  const FREEZE_WINDOW_MS=10*60000;
  function validFreezeRow(row,session){
    return Boolean(row&&row.id===session.day+'-20:00'&&row.day===session.day&&row.kind==='auto'&&
      ['cg','binance','proxy'].includes(row.mode)&&Number(row.upper)>0&&Number(row.lower)>0&&
      Number(row.upper)>Number(row.lower)&&Number(row.price)>0);
  }
  function frozenPriceRecord(session=chartSession()){
    if(!session.frozenWindow)return null;
    return state.snapshots.find(x=>validFreezeRow(x,session))||null;
  }
  function readPre20Candidate(day){
    try{
      const x=JSON.parse(localStorage.getItem(FREEZE_CANDIDATE_KEY)||'null');
      const t20=Date.parse(day+'T12:00:00.000Z');
      return x&&x.day===day&&Number(x.upper)>Number(x.lower)&&Number(x.price)>0&&
        Number(x.observedAt)<=t20&&Number(x.observedAt)>=t20-FREEZE_WINDOW_MS&&
        Number(x.sourceAt)<=t20&&Number(x.sourceAt)>=t20-FREEZE_WINDOW_MS?x:null;
    }catch{return null;}
  }
  function rememberPre20Candidate(t,picked){
    const session=chartSession(t),t20=session.start+12*3600000;
    if(session.frozenWindow||t<t20-FREEZE_WINDOW_MS||t>=t20||state.source==='demo'||
       !(state.price>0)||!picked||!(picked.up>picked.down)||picked.source==='none'||picked.source==='manual')return;
    const sourceAt=picked.source==='cg'?state.cgAt:state.binanceAt;
    if(!(sourceAt<=t20&&sourceAt>=t20-FREEZE_WINDOW_MS))return;
    const row={day:session.day,observedAt:t,sourceAt,mode:picked.source,
      upper:Number(picked.up),lower:Number(picked.down),price:Number(state.price),
      upperAmount:Number(picked.upAmount)||0,lowerAmount:Number(picked.downAmount)||0};
    try{localStorage.setItem(FREEZE_CANDIDATE_KEY,JSON.stringify(row));}catch(_){}
  }
  function calculateCurrentZones(){
    const t=Date.now(),session=chartSession(t);
    // A chosen manual source is explicitly a *manual overlay*; don't call it frozen.
    if(state.mode==='manual'){
      state.effectiveBoundarySource='manual';state.cgChartLevelMode='manual';
      state.zones={upper:state.manual.upper.map(p=>({price:p,distance:Math.abs(p/state.price-1),score:null,width:Math.max(50,state.price*.001),manual:true})).filter(z=>z.price>state.price).sort((a,b)=>a.distance-b.distance).slice(0,6),lower:state.manual.lower.map(p=>({price:p,distance:Math.abs(p/state.price-1),score:null,width:Math.max(50,state.price*.001),manual:true})).filter(z=>z.price<state.price).sort((a,b)=>a.distance-b.distance).slice(0,6)};
      return false;
    }
    const frozen=frozenPriceRecord(session);
    if(session.frozenWindow&&!frozen){
      // No historical CoinGlass quote can be reconstructed from the current price.
      // Local reconstruction is attempted by maybeAutoFreeze() after live bars load.
      state.cgChartLevelMode='awaiting-freeze';state.effectiveBoundarySource='none';
      state.zones={upper:[],lower:[]};return false;
    }
    const picked=session.frozenWindow?null:boundaryData(t);
    if(!session.frozenWindow)rememberPre20Candidate(t,picked);
    const hasFrozen=Boolean(frozen);
    const source=hasFrozen?(frozen.mode==='cg'?'cg':frozen.mode==='binance'?'binance':'proxy'):picked.source;
    const up=hasFrozen?Number(frozen.upper):picked.up,down=hasFrozen?Number(frozen.lower):picked.down;
    const basis=hasFrozen?Number(frozen.price):state.price;
    state.cgChartLevelMode=hasFrozen?'frozen':source!=='none'?'live':'none';
    state.effectiveBoundarySource=source;
    const make=(price,dir)=>({price,distance:Math.abs(price/basis-1),score:null,estimated:!!frozen?.reconstructed,
      width:Math.max(40,basis*.00085),cg:source==='cg',binance:source==='binance',proxy:source==='proxy',
      amount:hasFrozen?(dir==='upper'?Number(frozen.coinGlassLevelUpper):Number(frozen.coinGlassLevelLower)):(dir==='upper'?picked.upAmount:picked.downAmount),
      basisPrice:basis,frozen:hasFrozen,live:!hasFrozen,main:true,layer:source==='binance'?'L2':null});
    state.zones={upper:up>0?[make(up,'upper')]:[],lower:down>0?[make(down,'lower')]:[]};
    return source==='binance'&&!hasFrozen&&state.binance?.all?.usedVolume===true;
  }
  function primary(z){return z.reduce((best,x)=>!best||((x.score??70)/(.7+Math.sqrt(x.distance*100))>(best.score??70)/(.7+Math.sqrt(best.distance*100)))?x:best,null);}
  function chooseRankLabel(z,i,p){return z===p?'主要':i===0?'第一':'延伸';}
  function renderZones(){
    for(const dir of ['upper','lower']){
      const list=$(dir==='upper'?'upperList':'lowerList');list.replaceChildren();
      const z=state.zones[dir]||[];const main=primary(z);
      if(!z.length){const el=document.createElement('div');el.className='empty-state';el.textContent=state.cgChartLevelMode==='awaiting-freeze'?'等待20:00本機凍結資料（即時24H浮卡仍更新）':state.mode==='manual'?'請在右側輸入清算價位。':'CoinGlass 尚未成功或 Binance L2 尚未取得；請查看資料狀態。';list.append(el);continue;}
      z.forEach((a,i)=>{
        const row=document.createElement('div');row.className='zone-row';
        const badge=document.createElement('div');badge.className='index-chip';badge.textContent='L'+(i+1);
        const mid=document.createElement('div');mid.className='zone-center';const val=document.createElement('strong');val.textContent=fmt(a.price);mid.append(val);
        const meta=document.createElement('div');meta.className='zone-meta';meta.textContent=chooseRankLabel(a,i,main)+(a.cg?(a.frozen?' · 20:00 凍結 CoinGlass':' · CoinGlass 24H'):a.binance?(a.frozen?' · 20:00 凍結 Binance L2':' · Binance L2 · 假設清算帶'):a.proxy?' · 20:00 本機凍結代理估算':a.manual?' · 手動輸入':' · 代理候選帶');mid.append(meta);
        if(!a.manual&&!a.cg&&!a.binance){const strip=document.createElement('div');strip.className='score-strip';const fill=document.createElement('div');fill.className='score-fill';fill.style.width=Math.max(3,a.score)+'%';strip.append(fill);mid.append(strip);}
        const side=document.createElement('div');side.className='zone-right';side.append(document.createTextNode(pct(a.price,a.frozen?a.basisPrice:state.price)));const tag=document.createElement('em');tag.textContent=a.cg?(a.amount?'名目 '+(a.amount/1000000).toFixed(2)+'M USD':'預估清算位置'):a.binance?'Binance K 線估算 · 非真實清算明細':a.manual?'人工標記':`代理強度 ${a.score}/100`;side.append(tag);
        row.append(badge,mid,side);list.append(row);
      });
    }
  }
  function renderHeader(useVol){
    $('priceNow').textContent=fmt(state.price);$('priceSource').textContent=state.source==='demo'?state.sourceLabel:(state.priceSource||state.sourceLabel);
    const up=primary(state.zones.upper||[]),down=primary(state.zones.lower||[]);
    const freezeWaiting=state.cgChartLevelMode==='awaiting-freeze';
    $('boundUpper').textContent=up?fmt(up.price):'--';$('boundUpperDist').textContent=up?(up.frozen?(up.estimated?'凍結估算 · ':'凍結 · '):up.live?'即時 · ':'')+pct(up.price,up.frozen?up.basisPrice:state.price):freezeWaiting?'等待20:00快照':'尚無候選價位';
    $('boundLower').textContent=down?fmt(down.price):'--';$('boundLowerDist').textContent=down?(down.frozen?(down.estimated?'凍結估算 · ':'凍結 · '):down.live?'即時 · ':'')+pct(down.price,down.frozen?down.basisPrice:state.price):freezeWaiting?'等待20:00快照':'尚無候選價位';
    const t=Date.now(),frozenLabel=state.mode!=='manual'&&chartSession(t).frozenWindow;
    const hasFrozen=Boolean(frozenLabel&&state.zones.upper.some(z=>z.frozen));
    const effective=state.effectiveBoundarySource;
    const origin=effective==='cg'?'CoinGlass':effective==='binance'?'Binance L2':effective==='proxy'?'模型代理目標':'暫無';
    const desc=hasFrozen?(frozenPriceRecord()?.reconstructed?'20:00 代理估算 ': '20:00 凍結 ')+origin:freezeWaiting?'等待20:00凍結資料':effective==='none'?'尚未取得清算價':'即時 '+origin;
    $('frozenUpperLabel').textContent=desc+' 上界';
    $('frozenLowerLabel').textContent=desc+' 下界';
    // Floating mini-panel always tracks CURRENT source, independent of chart freeze.
    const live=boundaryData(t,state.mode==='manual'),liveSource=live.source==='cg'?'CoinGlass 24H':live.source==='binance'?'Binance L2':'清算目標';
    const sourceAt=live.source==='cg'?state.cgAt:live.source==='binance'?state.binanceAt:0;
    const liveUp=live.up>0?fmt(live.up):'--',liveDown=live.down>0?fmt(live.down):'--';
    let liveStatus=live.source==='none'?(state.cgBusy||state.binanceBusy?'讀取中…':'兩個來源均無資料'):
      '更新 '+tpeTime(sourceAt,true);
    if(live.source==='binance'&&state.mode!=='binance')liveStatus='CoinGlass失效 · '+liveStatus;
    $('liveSourceName').textContent=liveSource;
    $('liveCgUpper').textContent=liveUp;$('liveCgLower').textContent=liveDown;
    $('liveCgTime').textContent=liveStatus;
    $('liveCgTime').title=(live.source==='binance'?`Binance ${state.binance?.feed||''}；第2近清算代理層 L2；`:
      live.source==='cg'?`CoinGlass 24H · 解碼V${state.cgVersion||'?'}；`:'')+'每60秒嘗試更新；時間為最後成功讀取';
    $('liveTargetFloat').classList.toggle('stale',live.source==='none');
    $('cgFloatRetry').disabled=state.cgBusy||state.binanceBusy;
    $('cgFloatRetry').title='重新讀取 CoinGlass 和 Binance L2';
    $('drawerLiveSource').textContent=liveSource;
    $('drawerLiveUp').textContent=liveUp;$('drawerLiveDown').textContent=liveDown;
    $('drawerLiveTime').textContent=liveStatus;
    $('cgLiveDetailTime').textContent=liveStatus;
    $('oiDisplay').textContent=state.cgPain&&Number.isFinite(state.cgPain.referencePrice)?fmt(state.cgPain.referencePrice):'--';
    $('cgDiag').textContent=isValidCoinGlass(t)?'CoinGlass 24H 已取得 · '+tpeTime(state.cgAt)+ ' · V'+(state.cgVersion||'?'):
      'CoinGlass 不可用：'+(state.cgError||'資料已過期')+'；'+(isValidBinance(t)?'Binance L2 已就緒':'Binance L2：'+state.binanceError);
    $('marketPill').className='state-pill '+(state.source==='demo'||!state.liveAt||Date.now()-state.liveAt>120000?'demo':'');
    $('marketPill').innerHTML='<span class="led"></span>'+ (state.source==='demo'?'歷史資料預覽':!state.liveAt||Date.now()-state.liveAt>120000?'派網資料過期':'派網行情 · 已連線');
    $('lastUpdated').textContent=state.source==='demo'?`歷史示範 K 線截止 ${tpeTime(state.candles.at(-1)?.t)} · 非即時`:`最新行情 ${state.liveAt?tpeTime(state.liveAt):'--'} · 僅本機計算`;
    $('sourceDiag').textContent=state.sourceLabel;$('timeDiag').textContent=state.candles.length?tpeTime(state.candles.at(-1).t):'--';
    $('volumeDiag').textContent=effective==='cg'?'CoinGlass 預估金額（不使用代理成交量）':effective==='binance'?'Binance 15M K 線量價代理分數':state.mode==='manual'?'手動標記':'資料尚未取得';
    $('modelTag').textContent=state.mode==='manual'?'手動標記':(hasFrozen?'20:00 凍結 · ':'即時 · ')+origin;
    $('chartMeta').textContent=state.source==='demo'?'歷史 15M OHLC：未含成交量':`PIONEX PERP · ${state.sourceLabel}`;
    $('errorDiag').textContent=(state.refreshIssue|| (state.source==='demo'?'示範價格；非即時':'派網行情已連線'))+' ｜ CoinGlass：'+(isValidCoinGlass(t)?'已取得':state.cgError)+' ｜ Binance L2：'+(isValidBinance(t)?'已取得 '+state.binance.feed:state.binanceError);
  }
  function modelDemoAsOf(){return Date.parse('2026-10-05T12:00:00.000Z');}
  function observedTPE(now=Date.now()){
    if(state.source==='demo')return modelDemoAsOf();
    // UTC 00:00 = Taipei 08:00; after UTC midnight, a NEW day's foundation starts.
    return now;
  }
  // HA is a DAILY market indicator, not a gated 16:00 probability output.
  // Compute it at the observation time from completed Pionex daily history plus
  // the *currently forming* UTC day candle. Never borrow the future daily close.
  function currentHA(){
    if(!window.BTCLiqEngine?.getHA)return {ready:false,reason:'平均 K 引擎未載入'};
    const when=observedTPE();
    const day=Math.floor(when/86400000)*86400000;
    const prior=state.daily.filter(x=>x.t<day).sort((a,b)=>a.t-b.t);
    if(prior.length<25)return {ready:false,reason:state.modelError||'派網歷史日 K 不足 25 天'};
    const intraday=state.candles.filter(k=>k.t>=day&&k.t<when).sort((a,b)=>a.t-b.t);
    let liveDay=null;
    if(intraday.length&&intraday[0].t===day){
      liveDay={t:day,o:intraday[0].o,h:Math.max(...intraday.map(x=>x.h)),
        l:Math.min(...intraday.map(x=>x.l)),c:intraday.at(-1).c};
      // A fresh Pionex quote may update the unfinished candle before its next 15M refresh.
      if(state.source!=='demo'&&Number.isFinite(state.price)&&state.price>0&&
          Number.isFinite(state.priceAt)&&Date.now()-state.priceAt<120000){
        liveDay.c=state.price;liveDay.h=Math.max(liveDay.h,state.price);
        liveDay.l=Math.min(liveDay.l,state.price);
      }
    }else{
      // First seconds after 08:00, the 15M feed may not have its new bar yet.
      // Pionex 1D's OPEN CURRENT candle is a safe source at that point.
      const fromPionex=state.daily.find(x=>x.t===day);
      if(fromPionex)liveDay={...fromPionex};
    }
    if(!liveDay)return {ready:false,reason:state.modelError||'等待當日派網 15M／日 K'};
    const ha=window.BTCLiqEngine.getHA([...prior,liveDay],when);
    return ha?{...ha,ready:true,at:when}:{ready:false,reason:'平均 K 無法由當下資料計算'};
  }
  function showCurrentHA(){
    const ha=currentHA(),node=$('haColor');
    if(ha.ready){
      node.textContent=ha.color+(ha.priorColor?`（前日${ha.priorColor}）`:'');
      node.style.color=ha.color==='黃'?'#f5d36b':'#d3a7f8';
      node.title=`派網日線平均 K · ${tpeTime(ha.at)} 觀測；當日尚未收線，顏色可能變化`;
    }else{
      node.textContent='--';node.style.color='';
      node.title='平均 K 暫無法計算：'+ha.reason;
    }
    return ha;
  }
  function calcProbability(){
    if(!window.BTCLiqEngine||!state.candles.length)return null;
    const obs=observedTPE();const day=Math.floor(obs/86400000)*86400000;
    const t16=day+8*3600000,t20=day+12*3600000;
    if(obs<t16)return {ready:false,phase:'foundation',day,reason:'08:00～16:00 兩根 4H 尚未收完；16:00 才能確定完整基礎'};
    const asof=obs>=t20?t20:obs;
    const dailyFor=(time)=>{
      const d=Math.floor(time/86400000)*86400000;
      const ks=state.candles.filter(k=>k.t>=d&&k.t+900000<=time);
      if(!ks.length)return [];
      const x={t:d,o:ks[0].o,h:Math.max(...ks.map(k=>k.h)),l:Math.min(...ks.map(k=>k.l)),c:ks.at(-1).c};
      const openNow=state.source!=='demo'&&time===obs&&time%900000!==0&&Number.isFinite(state.price);
      if(openNow){x.c=state.price;x.h=Math.max(x.h,state.price);x.l=Math.min(x.l,state.price);}
      return [...state.daily.filter(k=>k.t<d),x];
    };
    const quote=(asof===obs && asof%900000!==0 && state.source!=='demo')?state.price:null;
    const cur=window.BTCLiqEngine.forecast(state.candles,dailyFor(asof),asof,quote);
    if(!cur.ready)return {...cur,day,phase:'missing',asof};
    const foundation=window.BTCLiqEngine.forecast(state.candles,dailyFor(t16),t16);
    return {...cur,baseUp:foundation.ready?foundation.modelUp:null,day,phase:obs>=t20?'frozen':'dynamic',asof,price:cur.features?state.candles.filter(x=>x.t+900000<=asof).at(-1)?.c:null};
  }
  function showProbability(){
    // HA is ALWAYS updated separately, including 08:00–16:00 and post-freeze.
    showCurrentHA();
    const item=calcProbability();state.probability=item;
    const chip=$('phaseChip');const note=$('probNote');
    chip.className='phase-chip';
    if(!item||!item.ready){
      $('upProb').textContent='--';$('downProb').textContent='--';$('fourH0812').textContent='--';$('fourH1216').textContent='--';$('fourH1620').textContent='--';$('baseProb').textContent='--';$('dynamicDelta').textContent='--';$('haWeight').textContent='--';$('trainedTarget').textContent='--';
      $('probUpFill').style.width='50%';chip.textContent='等待有效資料';
      $('probAsOf').textContent=state.source==='demo'?'離線示範 / 資料不足':'模型尚未就緒';
      note.textContent=item?.reason||'需要 Pionex 15M 歷史資料與日 K；不顯示猜測機率。';
      return;
    }
    const frozen=item.phase==='frozen';chip.classList.add(frozen?'frozen':'live');chip.textContent=frozen?'機率 20:00 已凍結':'16:00～20:00 動態';
    $('upProb').textContent=(item.up*100).toFixed(2)+'%';$('downProb').textContent=((1-item.up)*100).toFixed(2)+'%';
    $('probUpFill').style.width=(item.up*100).toFixed(3)+'%';
    $('fourH0812').textContent=item.foundation.x0812;
    $('fourH1216').textContent=item.foundation.x1216;
    const ret16=item.features.d_16_to_now;
    $('fourH1620').textContent=(ret16>=0?'綠 ':'紅 ')+(ret16>=0?'+':'')+ret16.toFixed(2)+'%';
    $('baseProb').textContent=Number.isFinite(item.baseUp)?(100*item.baseUp).toFixed(2)+'%':'--';
    const diff=Number.isFinite(item.baseUp)?100*(item.modelUp-item.baseUp):null;
    $('dynamicDelta').textContent=Number.isFinite(diff)?(diff>=0?'+':'')+diff.toFixed(2)+'%':'--';
    $('haWeight').textContent=(item.haDelta>0?'+':'')+(item.haDelta*100).toFixed(2)+'%';
    $('trainedTarget').textContent=fmt(item.modelTargets.upper)+' / '+fmt(item.modelTargets.lower);
    $('probAsOf').textContent=`${tpeTime(item.asof)} · ${state.source==='demo'?'離線研究快照':frozen?'凍結時點':'即時觀察'}`;
    note.textContent=`原模型 ${(item.modelUp*100).toFixed(2)}% → HA ${item.haColor} ${(item.haDelta>=0?'+':'')+(item.haDelta*100).toFixed(2)}% → 最終上掃 ${(item.up*100).toFixed(2)}% ／ 下掃 ${((1-item.up)*100).toFixed(2)}%。條件：20:00 至隔日08:00至少一側「訓練代理清算層」被觸及。${frozen?'已在20:00鎖定，不隨後續價格更新。':item.partial?'每10秒重算為訓練整點間的盤中插值，需視為探索值。':'此時點為整點模型快照。'}${'目前 PIONEX 行情與原訓練樣本的交易來源不同，機率尚待重新樣本外驗證。'}`;
  }
  function redraw(){const useVol=calculateCurrentZones();renderHeader(useVol);renderZones();showProbability();drawChart();renderSnapshot();}
  const canvas=$('priceChart'),tooltip=$('chartTooltip');
  const priceText=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // 4H drawing is independent from the 15M model: no change to prediction input.
  function groupAs4H(bars){
    const groups=new Map();
    for(const b of bars){const t=Math.floor(b.t/14400000)*14400000;
      let r=groups.get(t);
      if(!r){r={t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v||0};groups.set(t,r);}
      else{r.h=Math.max(r.h,b.h);r.l=Math.min(r.l,b.l);r.c=b.c;r.v+=(b.v||0);}
    }
    return [...groups.values()].sort((a,b)=>a.t-b.t);
  }
  function chartSeries(){
    const use4h=state.chartTf==='4h';
    const src=use4h&&state.source!=='demo'&&state.fourHCandles.length>3?state.fourHCandles:use4h?groupAs4H(state.candles):state.candles;
    const maxCount=use4h?(window.innerWidth<540?26:50):(window.innerWidth<540?55:110);
    const bars=src.slice(-maxCount).map(b=>({...b}));
    const last=bars.at(-1);
    if(last&&state.source!=='demo'&&state.price>0&&Date.now()>=last.t&&Date.now()<last.t+(use4h?14400000:900000)){
      last.c=state.price;last.h=Math.max(last.h,state.price);last.l=Math.min(last.l,state.price);last.forming=true;
    }
    return bars;
  }
  function chartOhlcText(k){
    if(!k)return '滑入 K 棒查看開高低收';
    const change=k.o>0?(k.c/k.o-1)*100:0;
    const pct=(change>=0?'+':'')+change.toFixed(2)+'%';
    const date=tpeTime(k.t).replaceAll('-','/');
    return `${date}　開 ${priceText(k.o)}　高 ${priceText(k.h)}　低 ${priceText(k.l)}　收 ${priceText(k.c)} ${pct}${k.v?'　量 '+(k.v>1000?(k.v/1000).toFixed(2)+'K':k.v.toFixed(2)):''}`;
  }
  function updateChartOhlc(ks,index){
    const k=ks[index>=0&&index<ks.length?index:ks.length-1];
    const el=$('chartOhlc');el.textContent=chartOhlcText(k);el.dataset.tone=!k?'neutral':k.c>=k.o?'up':'down';
  }
  function roundRect(ctx,x,y,w,h,r,fill,stroke){
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
    if(stroke){ctx.lineWidth=1.2;ctx.strokeStyle=stroke;ctx.stroke();}
  }
  function axisTag(ctx,geometry,price,color,kind,top=false){
    const g=geometry,yy=g.y(price),height=24,tagY=clamp(yy-height/2,g.T,g.bottom-height),x=g.axisX,w=g.axisWidth;
    roundRect(ctx,x,tagY,w,height,5,kind==='hover'?'#273a4d':kind==='now'?'#073e4d':kind==='upper'?'#135649':'#67313d',color);
    ctx.fillStyle=kind==='hover'?'#ffffff':kind==='now'?'#c9ffff':kind==='upper'?'#e4fff6':'#fff0f3';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=kind==='hover'?'bold 12px Arial':'bold 11px Arial';
    ctx.fillText((kind==='now'?'NOW ':'')+priceText(price),x+w/2,tagY+height/2,w-6);
    return {y:tagY+height/2,actualY:yy,kind};
  }
  function drawChart(){
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height||!(state.price>0))return;
    const ks=chartSeries();if(ks.length<2)return;
    const dpr=clamp(window.devicePixelRatio||1,1,2.25),W=rect.width,H=rect.height;
    canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#081d30';ctx.fillRect(0,0,W,H);
    const L=12,R=W<640?105:131,T=W<640?67:58,B=44,plotR=W-R,bottom=H-B,pw=plotR-L,ph=bottom-T;
    const hi=state.zones.upper.map(z=>z.price),lo=state.zones.lower.map(z=>z.price);
    const prices=[state.price,...ks.flatMap(k=>[k.h,k.l]),...hi,...lo];
    let min=Math.min(...prices),max=Math.max(...prices);const pad=Math.max(state.price*.003,(max-min)*.085);min-=pad;max+=pad;
    const y=p=>T+(max-p)/(max-min)*ph;
    const step=pw/ks.length;
    const g={L,R,T,B,plotR,bottom,pw,ph,W,H,ks,min,max,y,step,axisX:plotR+10,axisWidth:R-19};
    state.chartGeometry=g;
    $('chartSymbol').textContent=`PIONEX:BTCUSDT.P · 最近 ${ks.length} 根 ${state.chartTf==='4h'?'4H':'15M'}`;
    $('chartFeedSource').textContent=state.source==='demo'?'PIONEX · 歷史展示':(state.chartTf==='4h'?(state.fourHSource||'PIONEX · 15M合成4H'):'PIONEX · TV 15M');
    updateChartOhlc(ks,state.hoverPoint?.index??-1);
    // Right scale has its own background. Labels are painted after candle / level lines.
    ctx.fillStyle='#071827';ctx.fillRect(plotR+5,T-12,R-8,ph+26);
    ctx.strokeStyle='#30516a';ctx.lineWidth=1;ctx.setLineDash([4,6]);ctx.beginPath();ctx.moveTo(plotR+5,T-6);ctx.lineTo(plotR+5,bottom+8);ctx.stroke();ctx.setLineDash([]);
    const ticks=[];
    for(let i=0;i<6;i++){
      const v=max-(max-min)*i/5,py=y(v);ticks.push({v,py});
      ctx.strokeStyle='#244157';ctx.lineWidth=1;ctx.setLineDash([3,7]);ctx.beginPath();ctx.moveTo(L,py);ctx.lineTo(plotR,py);ctx.stroke();ctx.setLineDash([]);
    }
    for(let i=0;i<=8;i++){
      const x=L+pw*i/8;ctx.strokeStyle='#1b344b';ctx.beginPath();ctx.moveTo(x,T);ctx.lineTo(x,bottom);ctx.stroke();
    }
    // Inexact liquidation bands remain translucent, below candles.
    const levels=[];
    for(const dir of ['upper','lower']){
      const up=dir==='upper',arr=state.zones[dir]||[],main=primary(arr);
      for(const z of arr){
        const yy=y(z.price),w=Math.max(3,Math.abs(y(z.price+(z.width||35)/2)-y(z.price-(z.width||35)/2)));
        ctx.fillStyle=up?'rgba(43,215,184,.075)':'rgba(241,116,137,.075)';ctx.fillRect(L,yy-w/2,pw,w);
        levels.push({price:z.price,yy,dir,main:z===main,live:!!z.live,estimated:!!z.estimated,color:up?'#35dcb8':'#f47c8a'});
      }
    }
    const bodyW=clamp(step*.63,2.6,21);
    ks.forEach((b,i)=>{
      const x=L+(i+.5)*step,green=b.c>=b.o,col=green?'#29c79f':'#ec7c89';
      if(b.forming){ctx.fillStyle='rgba(22,119,98,.13)';ctx.fillRect(x-step*.46,T,step*.92,ph);}
      ctx.strokeStyle=col;ctx.lineWidth=Math.max(1.2,bodyW*.09);ctx.beginPath();ctx.moveTo(x,y(b.h));ctx.lineTo(x,y(b.l));ctx.stroke();
      const cy=Math.min(y(b.o),y(b.c)),h=Math.max(2,Math.abs(y(b.o)-y(b.c)));
      ctx.fillStyle=col;ctx.fillRect(x-bodyW/2,cy,bodyW,h);
    });
    // Time scale normal labels.
    const slots=W<540?3:W<850?4:8;const labelIndices=[0,...Array.from({length:slots-1},(_,j)=>Math.floor((j+1)*ks.length/slots)),ks.length-1];
    ctx.textBaseline='alphabetic';ctx.font='10px Arial';ctx.textAlign='center';
    for(const i of new Set(labelIndices)){
      const x=clamp(L+(i+.5)*step,L+36,plotR-35);
      ctx.fillStyle='#81a3ba';ctx.fillText(tpeTime(ks[i].t).slice(5,16),x,bottom+28);
    }
    // Dashed levels deliberately over candles, extended all the way to the right scale.
    for(const lev of levels){
      ctx.strokeStyle=lev.color;ctx.lineWidth=lev.live?1.45:(lev.main?1.8:1.25);ctx.setLineDash(lev.live?[3,6]:(lev.main?[8,6]:[4,6]));
      ctx.beginPath();ctx.moveTo(L,lev.yy);ctx.lineTo(g.axisX+4,lev.yy);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=lev.color;ctx.beginPath();ctx.arc(plotR+5,lev.yy,lev.main?3.5:2.4,0,Math.PI*2);ctx.fill();
    }
    const nowY=y(state.price);
    ctx.strokeStyle='#22d8ef';ctx.lineWidth=1.6;ctx.setLineDash([8,7]);ctx.beginPath();ctx.moveTo(L,nowY);ctx.lineTo(g.axisX+4,nowY);ctx.stroke();ctx.setLineDash([]);
    ctx.shadowBlur=10;ctx.shadowColor='#2ee8f9';ctx.fillStyle='#eaffff';ctx.beginPath();ctx.arc(plotR+5,nowY,4,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    // Cursor is a separate overlay: its price tag is painted LAST, above everything.
    const point=state.hoverPoint,hover=point&&point.index>=0&&point.index<ks.length&&point.y>=T&&point.y<=bottom;
    const hPrice=hover?max-(point.y-T)/ph*(max-min):null;
    if(hover){
      ctx.strokeStyle='#a9c4dd';ctx.lineWidth=1;ctx.globalAlpha=.9;ctx.setLineDash([5,5]);
      ctx.beginPath();ctx.moveTo(point.x,T);ctx.lineTo(point.x,bottom);ctx.moveTo(L,point.y);ctx.lineTo(g.axisX+5,point.y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
    }
    // Hide ordinary price ticks behind ANY price tag to avoid unreadable collisions.
    const reserved=[nowY,...levels.map(l=>l.yy),...(hover?[point.y]:[])];
    ctx.fillStyle='#85a4bf';ctx.font='11px Arial';ctx.textAlign='left';ctx.textBaseline='alphabetic';
    for(const t of ticks){if(reserved.some(py=>Math.abs(py-t.py)<15))continue;ctx.fillText(priceText(t.v),g.axisX+6,t.py+4);}
    // NOW goes underneath liquidation labels, then cursor overrides both.
    axisTag(ctx,g,state.price,'#21d8f0','now');
    // Every level gets its own price badge; on overlap move non-focused badges minimally.
    const occupied=[{y:clamp(nowY,T+12,bottom-12),kind:'now'}];
    const sorted=[...levels].sort((a,b)=>a.yy-b.yy);
    for(const lev of sorted){
      let ideal=clamp(lev.yy,T+12,bottom-12),place=ideal;
      for(let n=0;n<30&&occupied.some(o=>Math.abs(o.y-place)<25);n++){
        const plus=clamp(ideal+25*Math.ceil((n+1)/2),T+12,bottom-12);
        const minus=clamp(ideal-25*Math.ceil((n+1)/2),T+12,bottom-12);
        place=(n%2===0)?plus:minus;
      }
      occupied.push({y:place,kind:lev.dir});
      if(Math.abs(place-lev.yy)>2){ctx.strokeStyle=lev.color;ctx.lineWidth=.85;ctx.beginPath();ctx.moveTo(plotR+5,lev.yy);ctx.lineTo(g.axisX,place);ctx.stroke();}
      const bg=lev.dir==='upper'?'#115849':'#6d3640';
      roundRect(ctx,g.axisX,place-11,g.axisWidth,22,4,bg,lev.color);
      ctx.fillStyle=lev.dir==='upper'?'#e1fff3':'#fff0f3';ctx.textBaseline='middle';ctx.textAlign='center';ctx.font='bold 11px Arial';
      ctx.fillText((lev.live?'即時 ':lev.estimated?'估算凍結 ':'凍結 ')+priceText(lev.price),g.axisX+g.axisWidth/2,place,g.axisWidth-6);
    }
    if(hover){
      // Date/time badge (reference screenshot lower red rectangle).
      const date=tpeTime(ks[point.index].t).slice(5,16),dx=clamp(point.x-57,L,plotR-114);
      roundRect(ctx,dx,bottom+7,114,23,5,'#24394d','#7c98b0');
      ctx.fillStyle='#f4faff';ctx.font='bold 11px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(date,dx+57,bottom+18.5);
      // HIGHEST PAINT LAYER: crosshair price label, above CoinGlass, grid and NOW.
      axisTag(ctx,g,hPrice,'#cadcef','hover',true);
    }
  }
  function onMove(e){
    const g=state.chartGeometry;if(!g)return;
    const b=canvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;
    const inside=x>=g.L&&x<=g.plotR&&y>=g.T&&y<=g.bottom;
    state.hoverPoint=inside?{x,y,index:clamp(Math.floor((x-g.L)/g.step),0,g.ks.length-1)}:null;
    state.hoverIndex=state.hoverPoint?.index??-1;
    tooltip.hidden=true;drawChart();
  }
  canvas.addEventListener('pointermove',onMove);
  canvas.addEventListener('pointerleave',()=>{state.hoverPoint=null;state.hoverIndex=-1;tooltip.hidden=true;drawChart();});
  new ResizeObserver(()=>drawChart()).observe($('chartArea'));
  function setChartTf(tf){
    state.chartTf=tf;state.hoverPoint=null;state.hoverIndex=-1;
    [['chart4hBtn','4h'],['chart15mBtn','15m']].forEach(([id,v])=>{$(id).classList.toggle('active',tf===v);$(id).setAttribute('aria-pressed',String(tf===v));});
    drawChart();
    if(tf==='4h'&&state.source!=='demo'&&!state.fourHCandles.length)refreshFourH();
  }
  $('chart4hBtn').onclick=()=>setChartTf('4h');$('chart15mBtn').onclick=()=>setChartTf('15m');
  function loadLocalSnapshots(){try{const data=JSON.parse(localStorage.getItem('btc-liq-boundaries-v050')||'[]');return Array.isArray(data)?data.filter(x=>x&&x.day&&x.created).slice(-120):[];}catch{return [];}}
  function persistSnapshots(){try{localStorage.setItem('btc-liq-boundaries-v050',JSON.stringify(state.snapshots.slice(-120)));return true;}catch{return false;}}
  // R2 records are the cross-device source of truth; localStorage remains an offline cache.
  const cloud=window.BTCR2Records;
  let cloudPulling=false;
  const cloudStatus=()=>{
    const data=cloud?.getState(),label=$('r2SyncStatus');
    if(label&&data){label.textContent=data.message;label.dataset.phase=data.phase;}
  };
  function applyCloudRecords(rows){
    // R2 is the canonical source for a record WHEN IT EXISTS. A failed or empty
    // R2 response must never delete this device's genuine local 20:00 freeze.
    const byId=new Map(state.snapshots.map(r=>[r.id,r]));
    for(const r of rows)byId.set(r.id,r);
    state.snapshots=[...byId.values()].sort((a,b)=>String(a.day).localeCompare(String(b.day))||String(a.created).localeCompare(String(b.created))).slice(-120);
    persistSnapshots();renderSnapshot();redraw();
  }
  async function updateCloudJobStatus(){
    const el=$('cloudJobStatus');if(!el||!cloud?.configured())return;
    try{
      const response=await cloud.status(),x=response.status;
      el.textContent=x?(x.ok?'雲端排程最近一次成功':'雲端排程最近一次失敗')+' · '+(x.task==='freeze'?'20:00 凍結':x.task==='settle'?'08:00 結算':'檢查')+' · '+(x.day||'')+' · '+(x.at||''):'雲端排程尚無執行紀錄';
      el.dataset.phase=x?(x.ok?'ok':'error'):'idle';
    }catch(e){el.textContent='無法確認雲端排程：'+String(e.message||e);el.dataset.phase='error';}
  }
  async function pullCloud(){
    if(!cloud?.configured()||cloudPulling)return;
    cloudPulling=true;
    try{const rows=await cloud.pull();if(rows)applyCloudRecords(rows);await updateCloudJobStatus();}
    catch(_){/* keep last local cache, while displaying real connection error */}
    finally{cloudPulling=false;cloudStatus();}
  }
  function pushCloud(record){
    // v0.9.7: Cloudflare Cron is the writer. No client-side token and no
    // local record is ever uploaded over a public read-only connection.
    return null;
  }
  function setupCloudUI(){
    if(!cloud)return;
    cloud.subscribe(cloudStatus);
    const refresh=$('r2Refresh');if(refresh)refresh.onclick=pullCloud;
    if(cloud.configured())setTimeout(pullCloud,400);
    const interval=Number(window.BTC_LIQ_CONFIG?.historySyncIntervalMs)||180000;
    setInterval(()=>{if(cloud.configured()&&!document.hidden)pullCloud();},Math.max(60000,interval));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)pullCloud();});
  }
  function captureSnapshot(kind){
    const pr=state.probability;
    if(kind==='auto'&&state.source==='demo')return;
    if(!(state.price>0))return;
    const now=Date.now(),session=chartSession(now),isAt20=kind==='auto';
    if(isAt20&&!session.frozenWindow)return;
    const day=isAt20?session.day:tpeParts().date;
    const id=isAt20?day+'-20:00':day+'-'+now;
    if(state.snapshots.some(x=>x.id===id))return;
    const t20=session.start+12*3600000;
    const rows=isAt20?state.candles.filter(x=>x.t+900000<=t20):state.candles;
    const saved=isAt20?readPre20Candidate(day):null;
    const complete20=Boolean(rows.length&&rows.at(-1).t+900000===t20);
    if(isAt20&&!saved&&!complete20)return; // Never use yesterday's bars to label today's 20:00 freeze.
    const atPrice=isAt20?(complete20?rows.at(-1).c:saved?.price):state.price;
    if(!(atPrice>0))return;
    // A browser opening at 23:00 must NOT silently freeze the 23:00 CoinGlass quote.
    // Local 20:00 observation > historical 20:00 proxy reconstruction > missing.
    const cgOK=Boolean(saved&&saved.mode==='cg');
    const binOK=Boolean(saved&&saved.mode==='binance');
    const freezeMode=cgOK?'cg':binOK?'binance':'proxy';
    const estimated=isAt20&&!saved;
    const computed=estimated?buildZones(rows,atPrice):null;
    const proxyUp=estimated?computed?.upper?.find(x=>x.price>atPrice)?.price:null;
    const proxyDown=estimated?computed?.lower?.find(x=>x.price<atPrice)?.price:null;
    const rawUp=estimated?(proxyUp??pr?.modelTargets?.upper):saved?.upper;
    const rawDown=estimated?(proxyDown??pr?.modelTargets?.lower):saved?.lower;
    // Historical proxy must straddle the real 20:00 reference price.
    const up=isAt20?Number(rawUp):Number(primary(state.zones.upper)?.price);
    const down=isAt20?Number(rawDown):Number(primary(state.zones.lower)?.price);
    if(!(up>atPrice&&down<atPrice&&up>down))return;
    const created=tpeParts(new Date(isAt20?t20:now)).text;
    const row={id,day,created,kind,source:state.sourceLabel,
      mode:isAt20?freezeMode:state.mode,
      liquidationSource:isAt20?(cgOK?'CoinGlass 24H · 20:00前本機已取得':binOK?'Binance L2 · 20:00前本機已取得':'20:00歷史價格代理估算（非CoinGlass）'):(state.effectiveBoundarySource||'unknown'),
      price:+Number(atPrice).toFixed(2),upper:+up.toFixed(2),lower:+down.toFixed(2),
      upperAll:String(up),lowerAll:String(down),coinGlassAt:cgOK?tpeTime(saved.sourceAt):'',
      coinGlassLevelUpper:cgOK?saved.upperAmount:'',coinGlassLevelLower:cgOK?saved.lowerAmount:'',
      upProb:pr?.ready?+(pr.up*100).toFixed(2):'',downProb:pr?.ready?+((1-pr.up)*100).toFixed(2):'',
      rawUpProb:pr?.ready?+(pr.modelUp*100).toFixed(2):'',baseUpProb:pr?.ready&&Number.isFinite(pr.baseUp)?+(pr.baseUp*100).toFixed(2):'',
      ha:pr?.ready?pr.haColor:'',haDelta:pr?.ready?pr.haDelta*100:'',
      trainedUpper:pr?.ready?pr.modelTargets.upper:'',trainedLower:pr?.ready?pr.modelTargets.lower:'',
      freezeMethod:isAt20?(saved?'本機保存20:00前清算界（無須R2）':'本機回溯20:00歷史K線代理界；非CoinGlass實測'):'手動',
      reconstructed:estimated,
      confidence:'概率仍由價格代理模型訓練；歷史代理價並非 CoinGlass 20:00 實際快照。'};
    state.snapshots.push(row);state.snapshots.sort((a,b)=>String(a.day).localeCompare(String(b.day))||String(a.created).localeCompare(String(b.created)));
    persistSnapshots();renderSnapshot();if(isAt20)redraw();
  }
  function renderSnapshot(){
    const list=state.snapshots,latest=list.at(-1),today=tpeParts().date,auto=list.find(x=>x.kind==='auto'&&x.day===today);
    $('snapshotStatus').textContent=auto?(auto.r2FirstSavedAt?'今日 20:00 雲端已凍結':auto.reconstructed?'20:00 本機代理推估（非CoinGlass快照）':'今日 20:00 本機已凍結（R2非必要）'):latest?'已保存 '+list.length+' 筆':'尚未凍結';
    const d=$('snapshotContent');
    if(!latest){d.textContent='目前沒有快照。按下「儲存目前畫面」可以測試保存。';$('snapshotHistory').replaceChildren();return;}
    const title=latest.kind==='auto'?'20:00 凍結快照':'手動測試快照';
    const htmlText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    d.innerHTML=`<b>${title} · ${htmlText(latest.created)}</b><div>當時價格 ${fmt(latest.price)}　│　上界 <span style="color:#35e1bb">${latest.upper?fmt(Number(latest.upper)):'--'}</span>　│　下界 <span style="color:#ff8187">${latest.lower?fmt(Number(latest.lower)):'--'}</span></div><div><b>上掃 ${latest.upProb!==''?htmlText(latest.upProb)+'%':'--'} ｜ 下掃 ${latest.downProb!==''?htmlText(latest.downProb)+'%':'--'}</b> · HA ${htmlText(latest.ha||'--')} · 模型代理目標 ${latest.trainedUpper?fmt(Number(latest.trainedUpper)):'--'} / ${latest.trainedLower?fmt(Number(latest.trainedLower)):'--'}</div><div>保存方式：${htmlText(latest.freezeMethod||'舊版紀錄')} · 清算來源：${String(latest.liquidationSource||latest.mode).replace(/[<>&]/g,'')} · ${latest.r2FirstSavedAt?'R2 雲端紀錄':latest.reconstructed?'本機20:00代理估算':'本機20:00凍結；未依賴 R2'}</div>`;
    renderSnapshotHistory();
  }
  function renderSnapshotHistory(){
    const host=$('snapshotHistory');host.replaceChildren();
    const items=state.snapshots.filter(x=>x.kind==='auto').slice(-14).reverse();
    if(!items.length)return;
    const table=document.createElement('table');
    const headings=['凍結日','上掃','下掃','08:00後驗證','成敗'];
    const thead=document.createElement('thead'),head=document.createElement('tr');
    for(const k of headings){const th=document.createElement('th');th.textContent=k;head.appendChild(th);}thead.append(head);table.append(thead);
    const body=document.createElement('tbody');
    for(const x of items){const row=document.createElement('tr');
      const fields=[x.day,Number.isFinite(+x.upProb)?x.upProb+'%':'--',Number.isFinite(+x.downProb)?x.downProb+'%':'--',x.result||'待08:00結算',x.correct||'--'];
      fields.forEach((t,i)=>{const td=document.createElement('td');td.textContent=t;if(i===4)td.className=t==='命中'?'ok':t==='失敗'?'bad':'neutral';row.append(td);});body.append(row);
    }
    table.append(body);host.append(table);
  }
  function scoreSettlements(){ /* cloud Cron settles at 08:10; never score historical R2 data on the client */ }
  function maybeAutoFreeze(){
    // Web UI freeze NEVER needs R2. The independent cloud Cron continues to
    // write cross-device results; browsers do not write to the public read API.
    const session=chartSession();
    if(!session.frozenWindow||state.source==='demo'||frozenPriceRecord(session))return;
    captureSnapshot('auto');
  }
  function exportCSV(){
    if(!state.snapshots.length){window.alert('目前還沒有保存的快照。');return;}
    const keys=['day','created','kind','source','mode','liquidationSource','price','upper','lower','upperAll','lowerAll','upProb','downProb','rawUpProb','baseUpProb','ha','haDelta','trainedUpper','trainedLower','freezeMethod','result','firstHitTpe','correct','confidence','coinGlassAt','coinGlassLevelUpper','coinGlassLevelLower'];
    const csv='\uFEFF'+[keys.join(','),...state.snapshots.map(r=>keys.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n');
    const u=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='BTC_20點機率與清算價快照_'+tpeParts().date+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);
  }
  // Pionex-only data, identical market pair to BTC4HBreakoutPulse.
  let feedBusy=false;
  let fourHBusy=false;
  async function refreshFourH(){
    if(fourHBusy||state.suppressLive)return;fourHBusy=true;
    try{
      const raw=await window.PionexFeed.klines('240',90);
      const candles=normalizeNativeBars(raw.bars,'派網4H');
      if(candles.length<3)throw Error('派網4H根數不足');
      state.fourHCandles=candles;state.fourHSource=raw.source;
      if(state.chartTf==='4h')drawChart();
    }catch(e){state.fourHSource='派網15M合成4H（4H直取不可用）';state.refreshIssue='派網4H圖表備援：'+String(e.message||e);if(state.chartTf==='4h')drawChart();}
    finally{fourHBusy=false;}
  }
  async function loadRealtime(){
    if(state.loading||state.suppressLive)return;
    state.loading=true;$('refreshButton').disabled=true;
    try{
      const raw=await window.PionexFeed.klines('15',520);
      const arr=normalizeNativeBars(raw.bars,'派網15M');
      if(Date.now()-arr.at(-1).t>3600000)throw Error('Pionex 15M 歷史過期超過一小時');
      if(state.source==='demo')state.daily=[]; // Never pass offline demo HA history to live Pionex.
      state.source='pionex';state.sourceLabel=raw.source;state.candles=arr;
      state.price=arr.at(-1).c;state.priceAt=Date.now();state.liveAt=Date.now();state.refreshKAt=Date.now();
      state.suppressLive=false;state.refreshIssue=raw.warning||'';
      await refreshDaily();redraw();refreshFourH();await refreshTick();maybeAutoFreeze();scoreSettlements();
    }catch(e){
      const message='Pionex 15M 讀取失敗：'+String(e.message||e);
      state.refreshIssue=message;
      if(state.source==='demo'){state.sourceLabel='歷史離線示範；非派網即時行情';state.candles=readDemo();state.daily=readDemoDays();state.fourHCandles=[];state.price=state.candles.at(-1).c;}
      redraw();
    }finally{state.loading=false;$('refreshButton').disabled=false;}
  }
  function normalizeNativeBars(rows,name){
    const filtered=(rows||[]).map(r=>({t:Number(r.t??r.ts),o:+(r.o??r.open),h:+(r.h??r.high),l:+(r.l??r.low),c:+(r.c??r.close),v:+(r.v??r.volume??0)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.o>0&&x.c>0&&x.h>=x.l).sort((a,b)=>a.t-b.t);
    const unique=[...new Map(filtered.map(x=>[x.t,x])).values()];if(unique.length<2)throw Error(name+' 無有效K線');return unique;
  }
  async function refreshTick(){
    if(state.source==='demo'||state.suppressLive)return;
    try{
      const q=await window.PionexFeed.price();const price=Number(q.price);
      if(!(price>0))throw Error('價格格式錯誤');
      state.price=price;state.priceAt=Date.now();state.liveAt=Date.now();state.refreshPAt=Date.now();
      state.priceSource=q.source;state.refreshIssue=q.warning||'';
      // Chart-only provisional candle; the engine excludes incomplete candle on freeze.
      const last=state.candles.at(-1);
      if(last&&Date.now()-last.t<900000){last.c=price;last.h=Math.max(last.h,price);last.l=Math.min(last.l,price);}
      redraw();maybeAutoFreeze();
    }catch(e){state.refreshIssue='Pionex 即時報價失敗，保留前次價格：'+String(e.message||e);redraw();}
  }
  async function refreshDaily(){
    if(state.source==='demo'||state.suppressLive)return;
    try{
      const raw=await window.PionexFeed.klines('1D',240);
      state.daily=normalizeNativeBars(raw.bars,'派網日K');state.refreshHAAt=Date.now();state.modelError='';
      if(raw.warning)state.refreshIssue=raw.warning;
    }catch(e){state.modelError='派網日K無法更新 '+String(e.message||e);/* Keep any previously validated Pionex day history on transient failure. */}
  }
  async function loadBinance(){
    if(state.binanceBusy||state.suppressLive||!window.BinanceL2)return;
    state.binanceBusy=true;state.refreshBinanceAt=Date.now();
    try{
      const data=await window.BinanceL2.fetchLayers({maxDistance:state.maxDistance,binRatio:state.binRatio});
      state.binance=data;state.binanceAt=data.at;state.binanceError='';
    }catch(e){state.binanceError=String(e?.message||e);}
    finally{state.binanceBusy=false;redraw();maybeAutoFreeze();}
  }
  const CG_CACHE_KEY='btc-cg24h-last-success-v083';
  function restoreCoinGlassCache(){
    try{
      const prev=JSON.parse(localStorage.getItem(CG_CACHE_KEY)||'null');
      if(prev&&Number.isFinite(prev.at)&&prev.at<=Date.now()&&Date.now()-prev.at<86400000&&
          Number(prev.data?.short)>0&&Number(prev.data?.long)>0&&Number(prev.data.short)>Number(prev.data.long)){
        state.cgPain=prev.data;state.cgAt=prev.at;state.cgVersion=/^(?:0|1|2|55|66|77)$/.test(String(prev.version))?String(prev.version):null;
        state.cgError='上次保存的價格；正在重新連線';
      }
    }catch(_){}
  }
  let lastObservedJson=null;
  let lastQuoteUploadedMinute='';
  let quoteSending=false;
  const mirrorQuoteJson=(quote)=>{
    lastObservedJson=quote;
    const el=$('capturedQuoteJson');
    if(el)el.value=JSON.stringify(quote,null,2);
    const status=$('quoteJsonStatus');
    if(status)status.textContent='頁面即時觀測（R2 由雲端排程寫入）';
  };
  async function syncObservedQuote(quote){
    // No browser writes: Cloudflare Browser Capture + Worker Cron own R2 persistence.
    return null;
  }
  async function loadCoinGlass(){
    if(state.cgBusy||state.suppressLive)return;
    state.cgBusy=true;state.refreshCGAt=Date.now();redraw();
    try{
      if(!window.CoinGlassReader)throw Error('CoinGlass 解碼器未載入');
      const raw=await window.CoinGlassReader.fetchCoinGlass('24h');
      const result=window.CoinGlassReader.readMaxPain(raw.data);
      if(!result||!(result.short>0&&result.long>0))throw Error('CoinGlass JSON 沒有有效 BTC 上下界');
      state.cgPain=result;state.cgAt=Date.now();state.cgVersion=raw.version;state.cgError='';state.cgFailures=0;
      try{localStorage.setItem(CG_CACHE_KEY,JSON.stringify({at:state.cgAt,data:result,version:state.cgVersion}));}catch(_){}
      // This is the REAL observed data path, not a reconstructed/estimated CoinGlass quote.
      const captured={source:'CoinGlass',range:'24h',observedAt:state.cgAt,
        upper:Number(result.short),lower:Number(result.long),
        upperAmount:Number(result.shortAmount)||null,lowerAmount:Number(result.longAmount)||null,
        referencePrice:Number(result.referencePrice)||null,version:String(raw.version||'unknown')};
      mirrorQuoteJson(captured);
      void syncObservedQuote(captured);
    }catch(e){
      state.cgFailures++;
      if(!state.suppressLive&&Date.now()-state.refreshBinanceAt>=15000)loadBinance();
      const msg=e?.name==='AbortError'?'讀取逾時（14 秒）':String(e?.message||e);
      state.cgError=msg;
      // Preserve last valid values with clearly marked stale state, never invent live data.
      // Do not promote cached values into the 20:00 freeze record.
    }finally{state.cgBusy=false;redraw();maybeAutoFreeze();}
  }
  function setMode(mode){
    state.mode=mode;const manual=mode==='manual',proxy=mode==='binance';
    $('manualConfig').hidden=!manual;$('autoConfig').hidden=!proxy;$('cgConfig').hidden=mode!=='cg';
    [['cgMode','cg'],['autoMode','binance'],['manualMode','manual']].forEach(([id,value])=>{const active=mode===value;$(id).classList.toggle('switch-active',active);$(id).setAttribute('aria-pressed',String(active));});redraw();
  }
  $('cgMode').onclick=()=>setMode('cg');$('autoMode').onclick=()=>{setMode('binance');loadBinance();};$('manualMode').onclick=()=>setMode('manual');
  $('cgRetry').onclick=()=>{state.cgError='重新嘗試中';loadCoinGlass();loadBinance();};
  $('cgFloatRetry').onclick=(event)=>{event.stopPropagation();state.cgError='重新嘗試中';loadCoinGlass();loadBinance();};
  $('applyManual').onclick=()=>{const upper=parseLevels($('manualUpper').value,'upper',state.price),lower=parseLevels($('manualLower').value,'lower',state.price);if(!upper.length&&!lower.length){window.alert('請輸入高於現價的上方價格或低於現價的下方價格');return;}state.manual={upper:upper.map(x=>x.price),lower:lower.map(x=>x.price)};redraw();};
  $('maxDistance').onchange=e=>{state.maxDistance=Number(e.target.value)/100;loadBinance();redraw();};
  $('zoneWidth').onchange=e=>{state.binRatio=Number(e.target.value)/100;loadBinance();redraw();};
  $('saveSnapshot').onclick=()=>captureSnapshot('manual');$('exportSnapshots').onclick=exportCSV;
  $('clearSnapshots').onclick=()=>{if(window.confirm('只清除這台裝置的本機快取，R2 雲端紀錄不會刪除，確定？')){state.snapshots=[];persistSnapshots();renderSnapshot();}};
  $('refreshButton').onclick=()=>{state.suppressLive=false;loadRealtime();loadCoinGlass();loadBinance();};
  $('demoButton').onclick=()=>{state.suppressLive=true;state.source='demo';state.sourceLabel='歷史離線示範；非派網即時行情';state.candles=readDemo();state.daily=readDemoDays();state.fourHCandles=[];state.price=state.candles.at(-1).c;state.cgPain=null;state.refreshIssue='已切換歷史示範模式';redraw();};
  let lastAwaitingFreezePoll=0;
  function clockTick(){
    const now=tpeParts();$('twClock').textContent='台灣時間 '+now.text;
    if(!state.suppressLive){const t=Date.now();
      if(!state.loading&&t-state.refreshKAt>KLINE_INTERVAL){state.refreshKAt=t;loadRealtime();}
      else if(state.source!=='demo'&&t-state.refreshPAt>=PRICE_INTERVAL){state.refreshPAt=t;refreshTick();}
      if(t-state.refreshHAAt>HA_INTERVAL&&state.source!=='demo'){state.refreshHAAt=t;refreshDaily().then(redraw);}
      if(t-state.refreshCGAt>COINGLASS_INTERVAL){state.refreshCGAt=t;loadCoinGlass();}
      if(t-state.refreshBinanceAt>BINANCE_INTERVAL){state.refreshBinanceAt=t;loadBinance();}
    }
    // Re-evaluate the chart ON THE EXACT 08:00/20:00 phase change,
    // even if quote/API requests fail and there is no price-update redraw.
    const key=chartSession().key;
    if(state.chartWindowKey!==key){state.chartWindowKey=key;redraw();}
    // Cloud freeze is stored at 20:02 (or retry at 20:07/12). Poll briefly
    // until that authoritative snapshot arrives, even if the UI stays open.
    const session=chartSession(),clock=Date.now();
    if(session.frozenWindow&&!frozenPriceRecord(session)&&cloud?.configured()&&
        !cloudPulling&&clock-lastAwaitingFreezePoll>=15000){
      lastAwaitingFreezePoll=clock;void pullCloud();
    }
    maybeAutoFreeze();
  }
  
  setupCloudUI();restoreCoinGlassCache();state.snapshots=loadLocalSnapshots();state.candles=readDemo();state.daily=readDemoDays();state.price=state.candles.at(-1).c;redraw();clockTick();setInterval(clockTick,1000);
  setTimeout(loadRealtime,400);setTimeout(loadCoinGlass,700);setTimeout(loadBinance,1200);
  window.BTC_RADAR_TEST={buildZones,parseLevels,tpeParts,scoreSettlements,loadCoinGlass,refreshTick,loadRealtime,chartSession,forceRedraw:redraw,clockTick,getState:()=>({liveCGUpper:state.cgPain?.short??null,liveCGLower:state.cgPain?.long??null,liveCGAt:state.cgAt,chartTf:state.chartTf,chart4HCount:state.fourHCandles.length,price:state.price,source:state.source,sourceLabel:state.sourceLabel,mode:state.mode,zones:state.zones,cgPain:state.cgPain,cgAt:state.cgAt,cgVersion:state.cgVersion,cgError:state.cgError,binance:state.binance,binanceAt:state.binanceAt,binanceError:state.binanceError,effectiveBoundarySource:state.effectiveBoundarySource,snapshots:state.snapshots,r2:cloud?.getState(),cgChartLevelMode:state.cgChartLevelMode,frozenRecord:frozenPriceRecord(),probability:state.probability,refreshIssue:state.refreshIssue})};
})();
