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
