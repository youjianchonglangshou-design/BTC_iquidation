/* BTC liquidation proxy price-only research model v2.0.0. NOT actual CoinGlass OI. */
(function(g){
  const M = {"version":"2.0.0","name":"BTC_TPE_20_to_08_proxy_first_touch_2026_10","true_oi":false,"model_type":"standardized_logistic_platt2024","objective":"P(first hit up | first hit up or down on 20:00 frozen price-only estimated liquidation levels)","feature_columns":["f_ret_0812","f_ret_1216","f_ret_0816","f_range_0812","f_range_1216","f_range_0816","f_position_16","f_16_vs_prev","f_4day_ret","f_pos_change","f_wick_up","f_wick_down","f_prior_vol","f_proxy_ratio","f_proxy_updist","f_proxy_downdist","f_proxy_distancebias","d_hour","d_16_to_now","d_since_08","d_position","d_position_change","d_early_hi_break","d_early_lo_break","d_1h_momentum","d_4h_momentum","d_rvol_15m","d_range_growth","d_16_hi_ext","d_16_lo_ext","d_near_top","d_near_bot","d_ma1_vs_ma4","d_proxy_updist","d_proxy_downdist","d_proxy_distancebias","d_proxy_ratio","d_proxy_upmag","d_proxy_downmag"],"scaler_mean":[-0.05631564035322444,0.06792148675216052,0.007967748444198855,2.2676921588291714,1.9128780379634152,3.00884548374483,0.5157974463656304,0.008288307738088708,0.5528162111866503,0.06598160677502468,0.28247558828441177,0.3199339302345258,0.3120255212754252,0.029935230722595983,0.8972193614830072,0.9261843460350154,0.02896498455200824,2.0,-0.012475136946902235,-0.003924402082859044,0.5174121860765784,0.0016147397109479106,-1.3742132021432536,1.5653712286067967,0.001054031322928748,0.026157868574660584,0.3163253615816588,0.384680726121435,-0.7670972655705036,-0.846397166216312,-1.5358875637289,1.7698680364923156,0.0015561587357456321,0.9028115345005149,0.9322708547888773,0.029459320288362515,0.03021392781338346,0.32115530392365266,0.2909413761102692],"scaler_scale":[1.6129843207571513,1.316958448820747,2.004821234859222,2.1767714807042355,1.8414709172596013,2.7591096787155407,0.25458574679146423,2.0068103726199364,6.699055378669911,1.3156841191695592,0.19407597884713038,0.20307646111659333,0.2669522530350422,0.3544717414477391,0.25718184183436094,0.2473882899745648,0.43503152792392136,1.4142135623730951,1.1059941322067786,2.3095257397246574,0.26051195093985463,0.21138717959319386,1.8005675019104852,2.2463860815066603,0.7823838934714015,1.4600466089579605,0.25953901045481853,0.9643470925265356,1.4953244314421061,1.8298338934720955,1.6616142588926988,2.109852480021396,0.6482663743608983,0.2583949896185145,0.24749344417076638,0.4326642085338131,0.3671355175965476,0.2573753270399103,0.2467510954935178],"weights":[-0.12294519947471942,-0.1513053560163703,-0.013253840685463519,-0.25205347533600897,-0.22191035986240593,0.33646513555602087,-0.11160758971623136,0.18035193956227985,0.03913530800367177,-0.017513159200376643,-0.04851642270551985,0.0736813916821495,0.05799823143436269,0.09115679374791637,0.017846047196733213,0.0019854953556337467,-0.009421135535383353,-0.0129748365883166,-0.09117698856638509,-0.008291145003776776,-0.02072142790606735,0.10887851387073536,0.026555350822963696,0.16385109791150945,-0.09521338483790096,-0.05528619774064781,-0.03850315169296226,-0.10602804142006457,0.1272186949652435,0.00187485920777031,-0.06575410438666487,0.05014531550646045,-0.006838805716737271,-0.06430468930457772,0.053520395614012756,0.06901878172536317,0.06374494108728726,0.04890614036905208,-0.04383282695003868],"intercept":0.04266527307124412,"calibration":{"slope":1.1999198590085607,"intercept":-0.041091546171178536},"train":"2017-09 through 2023-12","calibration_and_validation":"2024","untouched_test":"2025-01 through 2026-10-05","data_cutoff_utc":"2026-10-05T23:45:00Z","missing_real_oi":true,"threshold_notes":"Directional binary conditional probability only; another no-touch outcome exists."};
  function probabilities(features){
    let z=M.intercept;
    M.feature_columns.forEach((key,i)=>{
      if(!(key in features) || !Number.isFinite(Number(features[key]))) throw Error('Missing feature: '+key);
      z+=M.weights[i]*(Number(features[key])-M.scaler_mean[i])/M.scaler_scale[i];
    });
    let clamped=Math.max(-30,Math.min(30,z));
    let raw=1/(1+Math.exp(-clamped));
    let lc=M.calibration.slope*clamped+M.calibration.intercept;
    let up=1/(1+Math.exp(-Math.max(-30,Math.min(30,lc))));
    return {up,down:1-up,raw_up:raw,proxy_only:true,condition:'only if at least one frozen proxy level is reached'};
  }
  g.BTCLiqModel={metadata:M,probabilities};
})(typeof window !== 'undefined'?window:globalThis);


/* BTC 24H proxy first-touch probability engine. Matched to 2026 v2.0.0 39-feature train.py.
 * UTC 00:00 corresponds to Taiwan 08:00. IMPORTANT: No true liquidation position data.
 */
(function(g){'use strict';
  const H=3600000,MS=900000,D=86400000;
  const LEV=[10,20,50,100],LW=[.15,.30,.35,.20];
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const ret=(a,b)=>b>0?100*(a/b-1):0;
  const safe=(a,b)=>b?a/b:0;
  const avg=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
  const stdev=a=>Math.sqrt(avg(a.map(x=>(x-avg(a))**2)));
  function linearSlope(a){const n=a.length,center=(n-1)/2,y=avg(a);let num=0,den=0;for(let i=0;i<n;i++){num+=(i-center)*(a[i]-y);den+=(i-center)**2;}return y===0?0:100*(num/den)/Math.abs(y);}
  const getDay=t=>Math.floor(t/D)*D;
  function sliceAsOf(all,t,partial){
    const prev=all.filter(c=>c.t+MS<=t).map(c=>({...c}));
    // Intrabar observation is only allowed during 16:00–20:00, never as retroactive historical data.
    if(partial && partial.t>=t-MS && partial.t<t && Number.isFinite(partial.c) && partial.c>0){
      const p=prev.findIndex(c=>c.t===partial.t);
      if(p<0)prev.push({...partial});else prev[p]={...partial};
    }
    return prev.sort((a,b)=>a.t-b.t);
  }
  function proxy(bars,asof){
    // Exactly 288 15m completed bars, equal synthetic positions. No volume / actual OI.
    const rows=bars.filter(c=>c.t+MS<=asof).slice(-288);
    if(rows.length!==288 || rows.some((x,i)=>i&&x.t-rows[i-1].t!==MS))return null;
    const n=rows.length,p=rows.at(-1).c;
    if(!Number.isFinite(p)||p<=0)return null;
    const laterHi=Array(n),laterLo=Array(n);let hh=-Infinity,ll=Infinity;
    for(let i=n-1;i>=0;i--){laterHi[i]=hh;laterLo[i]=ll;hh=Math.max(hh,rows[i].h);ll=Math.min(ll,rows[i].l);}
    const upper=new Float64Array(13),lower=new Float64Array(13),bins=.15;
    for(let i=0;i<n;i++){
      const c=rows[i].c,age=(n-1-i)*.25,decay=Math.pow(2,-age/24);
      for(let k=0;k<4;k++){
        const u=c*(1+1/LEV[k]),d=c*(1-1/LEV[k]);
        const ud=ret(u,p),dd=100*(1-d/p),w=decay*LW[k];
        if(laterHi[i]<u && ud>=.3 && ud<=1.5){const b=Math.floor(ud/bins);if(b<upper.length)upper[b]+=w;}
        if(laterLo[i]>d && dd>=.3 && dd<=1.5){const b=Math.floor(dd/bins);if(b<lower.length)lower[b]+=w;}
      }
    }
    function pick(arr,sign){let best=-Infinity,out=null;
      for(let k=0;k<arr.length;k++){
        const distance=(k+.5)*bins;
        if(distance<.3||distance>1.5)continue;
        const smooth=.25*(arr[k-1]||0)+.5*arr[k]+.25*(arr[k+1]||0);
        const mag=smooth*Math.exp(-distance/.6);
        if(mag>best){best=mag;out={price:p*(1+sign*distance/100),distance,strength:smooth,magnet:mag};}
      }
      return out;
    }
    return {upper:pick(upper,1),lower:pick(lower,-1),price:p};
  }
  function getHA(daily,asof){
    // Yesterday's HA(open) is recursively derived from completed UTC 1D futures klines.
    const day=getDay(asof);const hist=daily.filter(c=>c.t<day).sort((a,b)=>a.t-b.t);
    if(hist.length<25)return null;
    let o=(hist[0].o+hist[0].c)/2,c=(hist[0].o+hist[0].h+hist[0].l+hist[0].c)/4;
    for(let i=1;i<hist.length;i++){
      const x=hist[i],no=(o+c)/2,nc=(x.o+x.h+x.l+x.c)/4;o=no;c=nc;
    }
    const cur=daily.find(x=>x.t===day);
    if(!cur)return null;
    const prevOpen=o,prevClose=c;
    const todayOpen=(prevOpen+prevClose)/2;
    const todayClose=(cur.o+cur.h+cur.l+cur.c)/4;
    return {color:todayClose>=todayOpen?'黃':'紫',haOpen:todayOpen,haClose:todayClose,
      body:ret(todayClose,todayOpen),priorColor:prevClose>=prevOpen?'黃':'紫',pastDailyCount:hist.length};
  }
  function features(all,asof,quotePrice=null){
    // cut time range strictly 16:00..20:00 Taipei, with one synthetic 15m partial bar optional.
    const day=getDay(asof),elapsed=(asof-day)/H,cut=8+elapsed;
    if(cut<16-1e-8||cut>20+1e-8)return null;
    const closed=all.filter(c=>c.t+MS<=asof).sort((a,b)=>a.t-b.t);
    const start=closed.findIndex(c=>c.t===day);
    if(start<288||start+31>=closed.length)return null;
    const early=closed.slice(start,start+32);
    if(early.length!==32||early.some((c,i)=>c.t!==day+i*MS))return null;
    // At an exact hour, use only the candles which have actually closed.
    let today=closed.filter(c=>c.t>=day&&c.t+MS<=asof);
    if(asof%MS!==0 && Number.isFinite(quotePrice)){
      const barStart=Math.floor(asof/MS)*MS;
      const live=all.find(c=>c.t===barStart);
      const prior=today.at(-1);
      const o=live?.o??prior?.c??quotePrice;
      const l=Math.min(o,quotePrice,live?.l??o),h=Math.max(o,quotePrice,live?.h??o);
      today.push({t:barStart,o,h,l,c:quotePrice});
    }
    if(today.length<32||today[0].t!==day)return null;
    const p=today.at(-1).c,open0=today[0].o,x16=early[31].c,x0812=early.slice(0,16),x1216=early.slice(16),late=today.slice(32);
    const earlyHi=Math.max(...early.map(r=>r.h)),earlyLo=Math.min(...early.map(r=>r.l)),erng=earlyHi-earlyLo;
    const hi=Math.max(...today.map(r=>r.h)),lo=Math.min(...today.map(r=>r.l)),rng=hi-lo;
    const preClose=closed.find(c=>c.t===day-MS)?.c??open0;
    const pre4=closed.find(c=>c.t===day-3*D-MS)?.c??open0;
    const early1Hi=Math.max(...x0812.map(r=>r.h)),early1Lo=Math.min(...x0812.map(r=>r.l));
    const early2Hi=Math.max(...x1216.map(r=>r.h)),early2Lo=Math.min(...x1216.map(r=>r.l));
    const fPrior=Math.sqrt(avg(early.slice(1).map((r,i)=>Math.log(Math.max(1e-6,r.c)/Math.max(1e-6,early[i].c))**2)))*100;
    const fullPrior=closed.filter(c=>c.t+MS<=day+8*H);
    const base=proxy(fullPrior,day+8*H);
    // For partial-minute intrabar prediction, use current provisional candle as newest.
    const source=[...closed];if(today.length>closed.filter(c=>c.t>=day).length)source.push(today.at(-1));
    const curr=proxy(source,asof%MS===0?asof:Math.floor(asof/MS)*MS+MS);
    if(!base||!curr)return null;
    const bp=base.upper,bn=base.lower,up=curr.upper,dn=curr.lower;
    const close=today.map(r=>r.c);
    const logs=close.slice(1).map((v,i)=>Math.log(Math.max(v,1e-6)/Math.max(close[i],1e-6)));
    const vol=Math.sqrt(avg(logs.map(x=>x*x)))*100;
    const pos=safe(p-lo,rng),ep=safe(x16-earlyLo,erng);
    const lateHi=late.length?Math.max(...late.map(r=>r.h)):x16;
    const lateLo=late.length?Math.min(...late.map(r=>r.l)):x16;
    const d4start=today.at(-Math.min(16,today.length));
    const obj={
      f_ret_0812:ret(x0812.at(-1).c,x0812[0].o),
      f_ret_1216:ret(x1216.at(-1).c,x1216[0].o),
      f_ret_0816:ret(x16,open0),
      f_range_0812:ret(early1Hi,early1Lo),
      f_range_1216:ret(early2Hi,early2Lo),
      f_range_0816:ret(earlyHi,earlyLo),
      f_position_16:ep,
      f_16_vs_prev:ret(x16,preClose),
      f_4day_ret:ret(preClose,pre4),
      f_pos_change:ret(x16,x0812.at(-1).c),
      f_wick_up:safe(earlyHi-Math.max(x16,open0),erng),
      f_wick_down:safe(Math.min(x16,open0)-earlyLo,erng),
      f_prior_vol:fPrior,
      f_proxy_ratio:Math.log1p(bp.magnet)-Math.log1p(bn.magnet),
      f_proxy_updist:bp.distance, f_proxy_downdist:bn.distance,
      f_proxy_distancebias:bn.distance-bp.distance,
      d_hour:cut-16,
      d_16_to_now:ret(p,x16),
      d_since_08:ret(p,open0),
      d_position:pos,
      d_position_change:pos-ep,
      d_early_hi_break:ret(p,earlyHi),d_early_lo_break:ret(p,earlyLo),
      d_1h_momentum:ret(p,today.at(-5)?.c??today[0].c),
      d_4h_momentum:ret(p,d4start.o),
      d_rvol_15m:vol,
      d_range_growth:ret(hi,lo)-ret(earlyHi,earlyLo),
      d_16_hi_ext:ret(lateHi,earlyHi),
      d_16_lo_ext:ret(earlyLo,lateLo),
      d_near_top:ret(p,hi),d_near_bot:ret(p,lo),
      d_ma1_vs_ma4:ret(avg(close.slice(-4)),avg(close.slice(-16))),
      d_proxy_updist:up.distance,d_proxy_downdist:dn.distance,
      d_proxy_distancebias:dn.distance-up.distance,
      d_proxy_ratio:Math.log1p(up.magnet)-Math.log1p(dn.magnet),
      d_proxy_upmag:Math.log1p(up.magnet),d_proxy_downmag:Math.log1p(dn.magnet)
    };
    return {features:obj,foundation:{x0812:x0812.at(-1).c>=x0812[0].o?'綠':'紅',x1216:x1216.at(-1).c>=x1216[0].o?'綠':'紅',ret0816:ret(x16,open0)},modelTargets:{upper:up.price,lower:dn.price},asof,cut,partial:asof%H!==0};
  }
  function forecast(all,daily,asof,price){
    const f=features(all,asof,price);if(!f)return {ready:false,reason:'歷史 15M K 線不足（至少 4 日＋連續 72H）、或尚未完成 08:00～16:00 基礎'};
    if(!g.BTCLiqModel)return {ready:false,reason:'訓練模型權重檔未載入'};
    let model;try{model=g.BTCLiqModel.probabilities(f.features);}catch(e){return{ready:false,reason:String(e.message||e)};}
    const ha=getHA(daily,asof);
    if(!ha)return{ready:false,reason:'歷史日 K 不足；平均 K 無法安全計算，暫停正式機率輸出'};
    // Verified 2025 selected addition; 2026 125/208 -> 135/208, on 20:00 *observable* HA color.
    const delta=ha.color==='黃'?.045:-.045;
    const up=clamp(model.up+delta,0,1);
    return {...f,ready:true,modelUp:model.up,modelDown:model.down,up,down:1-up,
      haColor:ha.color,haPriorColor:ha.priorColor,haBody:ha.body,haDelta:delta,
      training:'2017–2023',validation:'2024',outOfSample:'2025–2026/10/05',source:'price-only proxy; NOT real liquidations'};
  }
  g.BTCLiqEngine={features,proxy,getHA,forecast,getDay,sliceAsOf};
})(typeof window!=='undefined'?window:globalThis);


/** Standalone Cloudflare cron jobs for BTC 20:00 TPE freeze + next 08:00 settlement.
 * v0.9.1: strictly closed 15M prices at frozen decision time, same 39-feature predictor as UI.
 * PIONEX perpetual is preferred source for price and model. Binance L2 is an ESTIMATE.
 */


const MS=900000,H=3600000,D=86400000,ONE_DAY=86400000;
const R2_PREFIX='btc-liq/v1/freeze/';
const STATUS_KEY='btc-liq/v1/status/last-run.json';
const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
const round=(n,dp=2)=>finite(n)?Number(n.toFixed(dp)):'';
const dayString=(t)=>new Date(t).toISOString().slice(0,10);
const freezeMillis=day=>Date.parse(day+'T12:00:00.000Z'); // 20:00 Taiwan
const resultMillis=day=>freezeMillis(day)+12*H; // next 08:00 Taiwan
const tpeStamp=(t)=>{const d=new Date(t+8*H);return d.toISOString().replace('T',' ').slice(0,19);};
const asCsvTime=(t)=>{const d=new Date(t+8*H);return d.toISOString().slice(11,16);};
const recordKey=day=>R2_PREFIX+day+'.json';
const validFreezeDay=day=>/^20\d\d-\d\d-\d\d$/.test(day)&&!Number.isNaN(Date.parse(day+'T00:00:00Z'));
const mismatch=(a,b)=>Math.abs(a-b)>1e-6;
async function jsonFetch(url,ms=15000){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);
 try{
  const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'},cache:'no-store'});
  if(!r.ok)throw Error('HTTP '+r.status+' · '+new URL(url).hostname);
  return await r.json();
 }finally{clearTimeout(timer);}
}
function normalizePionex(rows){
 if(!Array.isArray(rows))throw Error('Pionex klines missing');
 const map=new Map();for(const r of rows){
  const ts=Number(Array.isArray(r)?r[0]:(r.time??r.ts??r.timestamp));
  const t=ts<1e12?ts*1000:ts;
  const [o,h,l,c,v]=Array.isArray(r)?r.slice(1,6):[r.open,r.high,r.low,r.close,r.volume];
  const x={t,o:+o,h:+h,l:+l,c:+c,v:+(v??0)};
  if(finite(x.t)&&x.t%MS===0&&[x.o,x.h,x.l,x.c].every(finite)&&x.o>0&&x.c>0&&x.h>=x.l)map.set(x.t,x);
 }
 return [...map.values()].sort((a,b)=>a.t-b.t);
}
async function pionexBars(interval,limit,asof){
 const q=new URL('https://api.pionex.com/api/v1/market/klines');
 q.searchParams.set('symbol','BTC_USDT_PERP');q.searchParams.set('interval',interval);
 q.searchParams.set('limit',String(limit));q.searchParams.set('endTime',String(asof-1));
 const j=await jsonFetch(q.toString());
 if(j.result===false)throw Error('Pionex '+interval+' '+(j.message||j.code||'result:false'));
 return normalizePionex(j.data?.klines??j.klines);
}
function requireClosed(bars,asof,minimum){
 const closed=bars.filter(x=>x.t+MS<=asof).slice(-500);
 if(closed.length<minimum)throw Error('Pionex 15M 只有 '+closed.length+' 根，至少需要 '+minimum);
 if(!closed.length||closed.at(-1).t!==asof-MS)throw Error('Pionex 15M 收盤不完整：截止 '+tpeStamp(asof));
 for(let i=1;i<closed.length;i++)if(closed[i].t-closed[i-1].t!==MS)throw Error('15M K線時間有缺口');
 return closed;
}
function atDayPartial(closed,day,asof){
 const start=Date.parse(day+'T00:00:00Z');
 const rows=closed.filter(r=>r.t>=start&&r.t+MS<=asof);
 const expected=(asof-start)/MS;
 if(!Number.isInteger(expected)||rows.length!==expected||rows[0].t!==start||rows.at(-1).t!==asof-MS)throw Error('08:00～決策時點的 K 線不完整');
 return {t:start,o:rows[0].o,h:Math.max(...rows.map(x=>x.h)),l:Math.min(...rows.map(x=>x.l)),c:rows.at(-1).c};
}

// Exact v0.1.0 Binance L2 grouping and choice, copied into server-side function,
// computed only from candles already closed by the decision cutoff.
function binanceL2(bars,current,opts={}){
 const LEVERAGES=[{n:25,w:.28},{n:50,w:.34},{n:75,w:.24},{n:100,w:.14}];
 const window=bars.slice(-288),validVolume=window.filter(c=>finite(c.v)&&c.v>0);
 const useVolume=validVolume.length>window.length*.65;
 const volumes=validVolume.map(c=>c.v).sort((a,b)=>a-b),medianVol=useVolume?volumes[Math.floor(volumes.length/2)]:1;
 const dist=opts.maxDistance??.06,ratio=opts.binRatio??.0018;
 const size=Math.max(25,Math.round(current*ratio/25)*25);
 const bucket={upper:new Map(),lower:new Map()},newest=window.at(-1).t;
 for(const r of window){
  const age=Math.max(0,(newest-r.t)/H),timeWeight=Math.exp(-age/48);
  const volWeight=useVolume&&finite(r.v)?Math.max(.25,Math.min(3,r.v/Math.max(1,medianVol))):1;
  const entry=(r.h+r.l+r.c)/3;
  for(const lev of LEVERAGES){
   const shortPrice=entry*(1+1/lev.n-.004),longPrice=entry*(1-1/lev.n+.004);
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
  for(const [bin,value] of map){
   const score=value+.20*(map.get(bin-1)||0)+.20*(map.get(bin+1)||0);
   const price=bin*size,distance=Math.abs(price/current-1);
   if(distance>.001&&score>.001)items.push({price,strength:score,distance});
  }
  items.sort((a,b)=>b.strength/(.5+Math.sqrt(b.distance*100))-a.strength/(.5+Math.sqrt(a.distance*100)));
  const picked=[];
  for(const item of items){if(picked.every(x=>Math.abs(x.price-item.price)>=size*2.5)){picked.push(item);if(picked.length>=4)break;}}
  const max=Math.max(1,...picked.map(x=>x.strength));
  sides[dir]=picked.sort((a,b)=>a.distance-b.distance).slice(0,3).map(z=>({...z,score:Math.max(1,Math.round(z.strength/max*100)),width:size}));
 }
 return {upper:sides.upper[1]??null,lower:sides.lower[1]??null,all:sides};
}
function normalizeBinance(rows){
 if(!Array.isArray(rows))throw Error('Binance response invalid');
 return rows.filter(Array.isArray).map(r=>({t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[7]}))
 .filter(x=>[x.t,x.o,x.h,x.l,x.c].every(finite)&&x.t%MS===0&&x.o>0&&x.c>0).sort((a,b)=>a.t-b.t);
}
async function fetchBinanceL2(asof){
 const errors=[];
 const providers=[
  ['Binance U本位合約','https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=288'],
  ['Binance 合約備用','https://fapi1.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=288'],
  ['Binance 現貨備援','https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=288']
 ];
 for(const [source,url] of providers){
  try{
   const rows=normalizeBinance(await jsonFetch(url+'&endTime='+(asof-1)));
   const closed=requireClosed(rows,asof,288).slice(-288);
   const price=closed.at(-1).c,z=binanceL2(closed,price);
   if(!(z.upper?.price>price&&z.lower?.price<price))throw Error('L2 incomplete');
   return {upper:z.upper,lower:z.lower,source,referencePrice:price};
  }catch(e){errors.push(source+': '+String(e.message||e).slice(0,90));}
 }
 throw Error('Binance L2 unavailable: '+errors.join(' | '));
}
async function saveLog(env,status){try{
 await env.BTC_RECORDS.put(STATUS_KEY,JSON.stringify({...status,at:new Date().toISOString()}),{httpMetadata:{contentType:'application/json'}});
 }catch(_){} }
async function readRecord(env,day){
 const r=await env.BTC_RECORDS.get(recordKey(day));return r?{record:JSON.parse(await r.text()),etag:r.etag}:null;
}
async function writeFirst(env,day,record){
 const key=recordKey(day);
 const obj=await env.BTC_RECORDS.put(key,JSON.stringify(record),{
  httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})
 });
 return Boolean(obj);
}
async function updateOutcome(env,day,existing,record){
 const result={...existing.record,...record,settledAt:new Date().toISOString()};
 const written=await env.BTC_RECORDS.put(recordKey(day),JSON.stringify(result),{
  httpMetadata:{contentType:'application/json'},
  onlyIf:new Headers({'If-Match':existing.etag})
 });return Boolean(written);
}
// Read last ACTUALLY OBSERVED CoinGlass JSON not later than 20:00 TPE.
// This DOES NOT call CoinGlass or reconstruct absent historical quotations.
async function readPre20CoinGlass(env,day){
 const cutoff=freezeMillis(day);
 // Last five complete minute slots: 19:55–19:59 Asia/Taipei.
 for(let delta=1;delta<=5;delta++){
  const time=cutoff-delta*60000,iso=new Date(time).toISOString();
  const key='btc-liq/v1/coinglass/'+iso.slice(0,10)+'/'+iso.slice(11,16).replace(':','')+'.json';
  const file=await env.BTC_RECORDS.get(key);
  if(!file)continue;
  const q=JSON.parse(await file.text());const received=Date.parse(q.receivedAt);
  if(q.source==='CoinGlass'&&q.range==='24h'&&Number.isFinite(received)&&received<cutoff&&cutoff-received<=300000&&
     Number(q.upper)>Number(q.lower)&&Number(q.lower)>0){
   return q;
  }
 }
 return null;
}
function emptyTargets(forecast){return {upper:round(forecast.modelTargets.upper),lower:round(forecast.modelTargets.lower),source:'模型價格代理（Binance L2 無資料）',mode:'proxy'};}
async function makeFreeze(day,{replayed=false}={},env=null){
 if(!validFreezeDay(day))throw Error('invalid day');
 const asof=freezeMillis(day);
 const [raw,rawDaily]=await Promise.all([pionexBars('15M',500,asof),pionexBars('1D',240,asof)]);
 const bars=requireClosed(raw,asof,340);
 const dayPart=atDayPartial(bars,day,asof);
 const daily=[...rawDaily.filter(x=>x.t<asof-12*H),dayPart].sort((a,b)=>a.t-b.t);
 // At cutoff 20:00, 08:00–16:00 is complete and the 16:00–20:00 dynamic bar is complete.
 const forecast=globalThis.BTCLiqEngine.forecast(bars,daily,asof,null);
 if(!forecast.ready)throw Error('模型未就緒: '+forecast.reason);
 const day16=atDayPartial(bars,day,asof-4*H);
 const foundation=globalThis.BTCLiqEngine.forecast(bars,[...rawDaily.filter(x=>x.t<asof-12*H),day16],asof-4*H,null);
 let target,quote=null;
 if(env?.BTC_RECORDS){
  quote=await readPre20CoinGlass(env,day);
  if(quote)target={upper:Number(quote.upper),lower:Number(quote.lower),source:'CoinGlass 24H · R2 實際擷取',mode:'cg'};
 }
 if(!target){
  try{
   const bin=await fetchBinanceL2(asof);
   target={upper:bin.upper.price,lower:bin.lower.price,source:'Binance L2 · '+bin.source,mode:'binance'};
  }catch(e){target=emptyTargets(forecast);target.warning=String(e.message||e).slice(0,300);}
 }
 const price=bars.at(-1).c;
 // CoinGlass quote is kept with its observed reference and provenance even if
 // spot/contract exchange prices differ. Binance L2 requires proper sides.
 if(target.mode!=='cg'&&!(target.upper>price&&target.lower<price)) {target=emptyTargets(forecast);target.warning='Binance L2與Pionex凍結現價不在同一側，已採用模型代理目標';}
 const obj={
  id:day+'-20:00',day,created:tpeStamp(asof),kind:'auto',source:'Pionex BTC_USDT_PERP 15M (Cloudflare Cron)',
  mode:target.mode,liquidationSource:target.source,price:round(price),upper:round(target.upper),lower:round(target.lower),
  upperAll:String(round(target.upper)),lowerAll:String(round(target.lower)),
  coinGlassAt:quote? tpeStamp(Date.parse(quote.receivedAt)):'',coinGlassLevelUpper:quote?.upperAmount||'',coinGlassLevelLower:quote?.lowerAmount||'',
  upProb:round(100*forecast.up),downProb:round(100*forecast.down),rawUpProb:round(100*forecast.modelUp),
  baseUpProb:foundation.ready?round(100*foundation.modelUp):'',ha:forecast.haColor,haDelta:round(100*forecast.haDelta),
  trainedUpper:round(forecast.modelTargets.upper),trainedLower:round(forecast.modelTargets.lower),
  freezeMethod:quote?'Cloudflare Worker · 20:00 以前 R2 已保存 CoinGlass JSON':replayed?'Cloudflare Worker · 20:00 歷史K線重建（沒有 CoinGlass 快照）':'Cloudflare Worker · 20:00 收線後排程',
  confidence:'二元概率由39特徵價格代理訓練，不是 CoinGlass 實際清算機率。'+(target.warning?' Binance L2 取得失敗，使用模型代理目標。':''),
  result:'',firstHitTpe:'',correct:'',
  autoGenerated:true,cloudModel:'v2.0.0',targetSelection:'Pre-20 R2 captured CoinGlass (<=5min) > Binance L2 > trained proxy; never fabricated',
  r2FirstSavedAt:new Date().toISOString(),storageProvenance:quote?'Cloudflare Cron; browser-decoded CoinGlass JSON stored in R2 before 20:00 TPE':'Cloudflare Cron; Pionex/Binance public Klines at cutoff 20:00 TPE'
 };
 if(!(obj.upper>0&&obj.lower>0)||mismatch(Number(obj.upProb)+Number(obj.downProb),100))throw Error('invalid freeze output');
 return obj;
}
function settlementFromBars(record,bars){
 const begin=freezeMillis(record.day),end=begin+12*H;
 const window=bars.filter(x=>x.t>=begin&&x.t<end).sort((a,b)=>a.t-b.t);
 if(window.length!==48||window.some((x,i)=>x.t!==begin+i*MS))throw Error('20:00～08:00 48 根 15M K線不完整');
 const upper=Number(record.upper)||Number(record.trainedUpper),lower=Number(record.lower)||Number(record.trainedLower);
 if(!(upper>0&&lower>0&&upper>lower))throw Error('沒有可驗證的20:00凍結上/下界');
 let hi=-1,lo=-1;
 window.forEach((r,i)=>{if(hi<0&&r.h>=upper)hi=i;if(lo<0&&r.l<=lower)lo=i;});
 const result=hi<0&&lo<0?'未觸及':hi>=0&&(lo<0||hi<lo)?'上掃':lo>=0&&(hi<0||lo<hi)?'下掃':'同根雙碰';
 const first=hi>=0||lo>=0?tpeStamp(begin+Math.min(hi<0?999:hi,lo<0?999:lo)*MS).slice(11,16):'';
 const up=Number(record.upProb),correct=result==='未觸及'||result==='同根雙碰'?'不計分':!finite(up)?'不計分':
  ((result==='上掃'&&up>=50)||(result==='下掃'&&up<50))?'命中':'失敗';
 return {result,firstHitTpe:first,correct};
}
async function cloudFreeze(env,day,options={}){
 const prior=await readRecord(env,day);
 if(prior)return {status:'already-frozen',day,record:prior.record};
 const record=await makeFreeze(day,options,env);
 const created=await writeFirst(env,day,record);
 return {status:created?'created':'already-frozen-concurrent',day,record};
}
async function cloudSettle(env,day){
 let prior=await readRecord(env,day);
 if(!prior){await cloudFreeze(env,day,{replayed:true});prior=await readRecord(env,day);}
 if(!prior)throw Error('R2 no freeze record');
 if(prior.record.result)return {status:'already-settled',day,record:prior.record};
 const end=resultMillis(day);
 const raw=await pionexBars('15M',100,end);
 const bars=requireClosed(raw,end,48);
 const outcome=settlementFromBars(prior.record,bars);
 const changed=await updateOutcome(env,day,prior,outcome);
 return {status:changed?'settled':'settled-concurrent',day,...outcome};
}
function jobForCron(controller){
 const date=new Date(controller.scheduledTime);
 const hour=date.getUTCHours(),day=dayString(date.getTime());
 if(hour===12)return {task:'freeze',day};
 if(hour===0)return {task:'settle',day:dayString(date.getTime()-ONE_DAY)};
 throw Error('Unexpected cron time: '+date.toISOString());
}
async function runScheduled(controller,env){
 const job=jobForCron(controller);
 try{
  if(!env.BTC_RECORDS)throw Error('BTC_RECORDS R2 binding is not configured');
  const res=job.task==='freeze'?await cloudFreeze(env,job.day):await cloudSettle(env,job.day);
  await saveLog(env,{ok:true,task:job.task,day:job.day,status:res.status,source:res.record?.liquidationSource||'Pionex',result:res.result||''});
  return res;
 }catch(e){
  await saveLog(env,{ok:false,task:job.task,day:job.day,error:String(e.message||e).slice(0,600)});
  throw e; // Cloudflare dashboard shows failure, retries will run on next cron.
 }
}
// Pure helpers for deterministic integration tests, not exposed as network endpoints.



/** BTC Liquidity Radar R2 snapshot bridge v0.9.0. One R2 object per Taiwan 20:00 session.
 * R2 binding: BTC_RECORDS; secret: BTC_RECORDS_TOKEN; env ALLOWED_ORIGINS optional.
 * The write token is NEVER placed in the public GitHub repo / JavaScript.
 */
const ROOT='/api/btc-liq/records';
const QUOTES_ROOT='/api/btc-liq/quotes';
const QUOTES_PREFIX='btc-liq/v1/coinglass/';
const PREFIX='btc-liq/v1/freeze/';
const DATE_RE=/^20\d\d-\d\d-\d\d$/;
const TEXT_FIELDS=['id','day','created','kind','source','mode','liquidationSource','coinGlassAt','ha','freezeMethod','confidence'];
const VALUE_FIELDS=['price','upper','lower','upperAll','lowerAll','upProb','downProb','rawUpProb','baseUpProb','haDelta','trainedUpper','trainedLower','coinGlassLevelUpper','coinGlassLevelLower'];
const RESULT_FIELDS=['result','firstHitTpe','correct'];
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
function validDay(day){
 if(!DATE_RE.test(day))return false;
 const d=new Date(day+'T00:00:00.000Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===day;
}
function originHeaders(req,env){
 const origin=req.headers.get('Origin');
 const allowed=String(env.ALLOWED_ORIGINS||'https://youjianchonglangshou-design.github.io').split(',').map(x=>x.trim());
 if(origin&&!(allowed.includes(origin)||(origin==='null'&&String(env.ALLOW_LOCAL_FILE)==='true')))return null;
 return {'Access-Control-Allow-Origin':origin||allowed[0], 'Access-Control-Allow-Methods':'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'3600','Vary':'Origin'};
}
async function tokenMatch(provided,secret){
 if(!secret||!provided||provided.length>512)return false;
 const encoder=new TextEncoder(),crypt=crypto.subtle;
 const [a,b]=await Promise.all([crypt.digest('SHA-256',encoder.encode(provided)),crypt.digest('SHA-256',encoder.encode(secret))]);
 const x=new Uint8Array(a),y=new Uint8Array(b);let different=0;
 for(let i=0;i<x.length;i++)different|=x[i]^y[i];
 return different===0;
}
function cleanRecord(rec,day){
 if(!rec||typeof rec!=='object'||Array.isArray(rec)||rec.kind!=='auto'||rec.id!==day+'-20:00'||rec.day!==day)throw Error('快照日期或識別碼不一致');
 const out={};
 for(const key of TEXT_FIELDS){const v=rec[key];out[key]=typeof v==='string'?v.slice(0,350):'';}
 for(const key of VALUE_FIELDS){const v=rec[key];out[key]=(typeof v==='number'&&Number.isFinite(v))?v:(typeof v==='string'&&v.length<180?v:'');}
 for(const key of RESULT_FIELDS){const v=rec[key];out[key]=typeof v==='string'?v.slice(0,120):'';}
 if(typeof out.created!=='string'||!/^20\d\d-\d\d-\d\d \d\d:\d\d:\d\d$/.test(out.created))throw Error('快照時間格式錯誤');
 if(out.upProb!==''&&out.downProb!==''&&Math.abs(Number(out.upProb)+Number(out.downProb)-100)>.06)throw Error('上下機率總和不符 100%');
 return out;
}
export default {
 async fetch(request,env){
  const cors=originHeaders(request,env);
  if(!cors)return json({ok:false,error:'來源不允許'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const reply=(value,status=200)=>json(value,status,cors);
  if(!env.BTC_RECORDS||!env.BTC_RECORDS_TOKEN)return reply({ok:false,error:'Worker 尚未設定 BTC_RECORDS R2 綁定及 BTC_RECORDS_TOKEN Secret'},503);
  const authorization=request.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer ')||!await tokenMatch(authorization.slice(7),String(env.BTC_RECORDS_TOKEN)))return reply({ok:false,error:'授權失敗；請確認此裝置的 R2 同步金鑰'},401);
  const path=new URL(request.url).pathname;
  if(path===QUOTES_ROOT&&request.method==='PUT'){
   // Browser captures are accepted only near their actual receipt time.
   // Server-received UTC time determines the immutable minute key.
   let raw;try{const body=await request.text();if(body.length>3000)throw Error('payload too large');raw=JSON.parse(body);}catch{return reply({ok:false,error:'JSON 格式無效'},400);}
   const at=Number(raw.observedAt),now=Date.now(),upper=Number(raw.upper),lower=Number(raw.lower);
   const version=String(raw.version||'unknown');
   if(raw.source!=='CoinGlass'||raw.range!=='24h'||!Number.isFinite(at)||Math.abs(now-at)>120000||
     !(Number.isFinite(upper)&&Number.isFinite(lower)&&upper>lower&&lower>0)||upper>20000000||
     !/^(0|1|2|55|66|77)$/.test(version))return reply({ok:false,error:'無效或過期的 CoinGlass 擷取資料'},400);
   const recv=new Date(now),day=recv.toISOString().slice(0,10),minute=recv.toISOString().slice(11,16).replace(':','');
   const key=QUOTES_PREFIX+day+'/'+minute+'.json';
   const item={source:'CoinGlass',range:'24h',upper,lower,observedAt:new Date(at).toISOString(),
    receivedAt:recv.toISOString(),version,referencePrice:Number(raw.referencePrice)||null,
    upperAmount:Number(raw.upperAmount)||null,lowerAmount:Number(raw.lowerAmount)||null,
    provenance:'Browser-decoded live data; not verified by CoinGlass API'};
   try{
    const result=await env.BTC_RECORDS.put(key,JSON.stringify(item),{
     httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
    return reply({ok:true,status:result?'saved':'minute-exists',quote:item},result?201:200);
   }catch(e){return reply({ok:false,error:'CoinGlass JSON 寫入 R2 失敗：'+String(e.message||e).slice(0,180)},502);}
  }
  if(path==='/api/btc-liq/status'&&request.method==='GET'){
   const status=await env.BTC_RECORDS.get('btc-liq/v1/status/last-run.json');
   return reply({ok:true,status:status?JSON.parse(await status.text()):null});
  }
  if(path===ROOT&&request.method==='GET'){
   const pageSize=200;
   const cursor=new URL(request.url).searchParams.get('cursor');
   const options={prefix:PREFIX,limit:pageSize};
   if(cursor)options.cursor=cursor;
   try{
    const listed=await env.BTC_RECORDS.list(options);
    const rows=await Promise.all(listed.objects.map(async obj=>{
      try{const item=await env.BTC_RECORDS.get(obj.key);return item?JSON.parse(await item.text()):null;}catch{return null;}
    }));
    return reply({ok:true,records:rows.filter(Boolean).sort((a,b)=>a.day.localeCompare(b.day)),cursor:listed.truncated?listed.cursor:null});
   }catch(e){return reply({ok:false,error:'R2 讀取失敗',detail:String(e.message||e).slice(0,200)},502);}
  }
  const match=path.match(/^\/api\/btc-liq\/records\/(20\d\d-\d\d-\d\d)$/);
  if(match&&request.method==='PUT'){
   const day=match[1];if(!validDay(day))return reply({ok:false,error:'無效的日期'},400);
   const size=Number(request.headers.get('content-length')||0);
   if(size>18000)return reply({ok:false,error:'紀錄太大'},413);
   let raw;try{const body=await request.text();if(body.length>18000)return reply({ok:false,error:'紀錄太大'},413);raw=JSON.parse(body);}catch{return reply({ok:false,error:'JSON 格式無效'},400);}
   let record;try{record=cleanRecord(raw,day);}catch(e){return reply({ok:false,error:e.message},400);}
   const key=PREFIX+day+'.json';
   try{
    const previous=await env.BTC_RECORDS.get(key);
    if(previous){
      const prior=JSON.parse(await previous.text());
      // First freeze wins: later writes cannot rewrite upper/lower/odds/mode even from another browser.
      // A later 08:00 settlement can only fill missing outcome fields.
      if(!prior.result&&record.result){
       for(const k of RESULT_FIELDS)prior[k]=record[k]||'';
       prior.settledAt=new Date().toISOString();
       const updated=await env.BTC_RECORDS.put(key,JSON.stringify(prior),{
        httpMetadata:{contentType:'application/json'},
        ...(previous.etag?{onlyIf:new Headers({'If-Match':previous.etag})}:{})
       });
       if(!updated){const latest=await env.BTC_RECORDS.get(key);return reply({ok:true,status:'conflict',record:JSON.parse(await latest.text())});}
       return reply({ok:true,status:'settlement-updated',record:prior});
      }
      return reply({ok:true,status:'unchanged',record:prior});
    }
    // If browser also froze the day, use the server-stored pre-20 CoinGlass
    // observation instead of trusting a later Binance fallback or client fields.
    const pre20=await readPre20CoinGlass(env,day);
    if(pre20){
      record.mode='cg';record.liquidationSource='CoinGlass 24H · R2 20:00前保存';
      record.upper=Number(pre20.upper);record.lower=Number(pre20.lower);
      record.upperAll=String(pre20.upper);record.lowerAll=String(pre20.lower);
      record.coinGlassAt=new Date(Date.parse(pre20.receivedAt)+28800000).toISOString().replace('T',' ').slice(0,19);
      record.coinGlassLevelUpper=pre20.upperAmount||'';record.coinGlassLevelLower=pre20.lowerAmount||'';
      record.freezeMethod='Worker 使用 20:00 前 R2 CoinGlass JSON';
    }else if(!(Number(record.upper)>0&&Number(record.lower)>0)){
      return reply({ok:false,error:'本機凍結缺少有效上下界，請等待 Worker 排程補存'},422);
    }
    record.r2FirstSavedAt=new Date().toISOString();
    record.storageProvenance=pre20?'R2 pre-20 CoinGlass JSON; browser supplied probability':'Browser submitted; not an exchange-verified historical snapshot';
    const created=await env.BTC_RECORDS.put(key,JSON.stringify(record),{
     httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})
    });
    if(!created){const latest=await env.BTC_RECORDS.get(key);return reply({ok:true,status:'unchanged',record:JSON.parse(await latest.text())});}
    return reply({ok:true,status:'created',record},201);
   }catch(e){return reply({ok:false,error:'R2 寫入失敗',detail:String(e.message||e).slice(0,200)},502);}
  }
  return reply({ok:false,error:'找不到 API 路徑'},404);
 },
 async scheduled(controller,env,ctx){
  ctx.waitUntil(runScheduled(controller,env));
 }
};
