/* v0.8.9: Binance BTCUSDT futures 15M three-layer price proxy from original v0.1.0.
 * Only the SECOND NEAREST picked candidate on EACH side (L2) is exported.
 * Does not replace Pionex quotes/candles, CoinGlass, or trained model.
 */
(() => {
  'use strict';
  const LEVERAGES = [{n:25,w:.28},{n:50,w:.34},{n:75,w:.24},{n:100,w:.14}];
  const MAINTENANCE=.004;
  const KLINES=[
    {name:'Binance U本位合約',type:'futures',url:'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=288'},
    {name:'Binance 合約備用',type:'futures',url:'https://fapi1.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=288'},
    {name:'Binance 現貨備援',type:'spot',url:'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=288'}
  ];
  function parseKlines(rows){
    if(!Array.isArray(rows))throw Error('Binance 15M 非陣列');
    const map=new Map();
    for(const r of rows){
      if(!Array.isArray(r))continue;
      const v={t:Number(r[0]),o:Number(r[1]),h:Number(r[2]),l:Number(r[3]),c:Number(r[4]),v:Number(r[7])};
      if([v.t,v.o,v.h,v.l,v.c].every(Number.isFinite)&&v.o>0&&v.c>0&&v.h>=v.l&&v.t%900000===0)
        map.set(v.t,v);
    }
    const bars=[...map.values()].sort((a,b)=>a.t-b.t);
    if(bars.length<48)throw Error('Binance 15M 少於48根');
    return bars;
  }
  function buildZones(candles,current,opt={}){
    if(!Array.isArray(candles)||!candles.length||!(current>0))return {upper:[],lower:[],usedVolume:false};
    const window=candles.slice(-288);
    const validVolume=window.filter(c=>Number.isFinite(c.v)&&c.v>0);
    const useVolume=validVolume.length>window.length*.65;
    const sortedVol=validVolume.map(c=>c.v).sort((a,b)=>a-b);
    const medianVol=useVolume?sortedVol[Math.floor(sortedVol.length/2)]:1;
    const dist=opt.maxDistance??.06;
    const size=Math.max(25,Math.round(current*(opt.binRatio??.0018)/25)*25);
    const bucket={upper:new Map(),lower:new Map()};
    const newest=window[window.length-1].t;
    for(const r of window){
      const age=Math.max(0,(newest-r.t)/3600000);
      const timeWeight=Math.exp(-age/48);
      const volWeight=useVolume&&Number.isFinite(r.v)?Math.max(.25,Math.min(3,r.v/Math.max(1,medianVol))):1;
      const entry=(r.h+r.l+r.c)/3;
      if(!(entry>0))continue;
      for(const lev of LEVERAGES){
        const shortPrice=entry*(1+1/lev.n-MAINTENANCE);
        const longPrice=entry*(1-1/lev.n+MAINTENANCE);
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
    return {...sides,usedVolume:useVolume};
  }
  function chooseL2(zones){
    return {upper:zones.upper[1]||null,lower:zones.lower[1]||null};
  }
  async function fetchJSON(url,ms=8500){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);
    try{const r=await fetch(url,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
      if(!r.ok)throw Error('HTTP '+r.status);
      return await r.json();
    }finally{clearTimeout(timer);}
  }
  async function fetchLayers(options={}){
    const errors=[];
    for(const feed of KLINES){
      try{
        const klines=parseKlines(await fetchJSON(feed.url));
        if(Date.now()-klines.at(-1).t>=3600000)throw Error('15M K線超過1小時未更新');
        const price=klines.at(-1).c;  // Binance source price, NOT Pionex quote
        const zones=buildZones(klines,price,options);
        const l2=chooseL2(zones);
        if(!(l2.upper?.price>price&&l2.lower?.price<price))throw Error('上下兩側未形成完整 L2');
        return {upper:l2.upper,lower:l2.lower,all:zones,referencePrice:price,
          feed:feed.name,feedType:feed.type,at:Date.now(),lastKlineAt:klines.at(-1).t};
      }catch(e){errors.push(feed.name+': '+(e?.message||String(e)));}
    }
    throw Error('Binance L2 無法取得：'+errors.join('；'));
  }
  window.BinanceL2={buildZones,chooseL2,parseKlines,fetchLayers};
})();
