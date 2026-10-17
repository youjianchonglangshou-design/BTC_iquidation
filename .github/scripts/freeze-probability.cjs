/* BTC_iquidation v1.1.0. Add the existing 39-feature forecast to the YML's REAL captured CoinGlass JSON.
 * NO refetch/decode of CoinGlass here. Preserves the existing proven snapshot step.
 * Calculates features strictly as-of 20:00 Asia/Taipei (UTC 12:00), with no future candles.
 */
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const MS15=900000, DAY=86400000;
const isNum=x=>typeof x==='number'&&Number.isFinite(x);
function getDay(s){if(!/^20\d\d-\d\d-\d\d$/.test(s))throw Error('Invalid date');return s;}
function parseBars(payload, interval){
  if(payload.result===false)throw Error('Pionex '+interval+' rejected request: '+String(payload.message||''));
  const rows=payload?.data?.klines??payload?.klines;
  if(!Array.isArray(rows))throw Error('Pionex '+interval+' missing data.klines');
  const map=new Map();
  for(const k of rows){
    const isArray=Array.isArray(k);
    let t=Number(isArray?k[0]:k?.time??k?.ts??k?.t);
    if(t>0&&t<1e12)t*=1000;
    const o=Number(isArray?k[1]:k?.open??k?.o);
    const c=Number(isArray?k[4]:k?.close??k?.c);
    const h=Number(isArray?k[2]:k?.high??k?.h);
    const l=Number(isArray?k[3]:k?.low??k?.l);
    const v=Number(isArray?k[5]:k?.volume??k?.v??0);
    if([t,o,h,l,c].every(Number.isFinite)&&o>0&&c>0&&h>=l&&l>0)map.set(t,{t,o,h,l,c,v});
  }
  return [...map.values()].sort((a,b)=>a.t-b.t);
}
async function pionexBars(interval,limit,endTime){
  const u=new URL('https://api.pionex.com/api/v1/market/klines');
  u.searchParams.set('symbol','BTC_USDT_PERP');
  u.searchParams.set('interval',interval);
  u.searchParams.set('limit',String(limit));
  u.searchParams.set('endTime',String(endTime));
  const controller=new AbortController();const t=setTimeout(()=>controller.abort(),15000);
  try{const r=await fetch(u,{headers:{Accept:'application/json'},signal:controller.signal});
    if(!r.ok)throw Error('Pionex '+interval+' HTTP '+r.status);
    return parseBars(await r.json(),interval);
  }finally{clearTimeout(t);}
}
function getModel(){
  const ctx={window:{},console,Math};
  for(const path of ['model_predictor.js','probability_engine.js']){
    if(!fs.existsSync(path))throw Error('Missing original model file: '+path);
    vm.runInNewContext(fs.readFileSync(path,'utf8'),ctx,{filename:path,timeout:10000});
  }
  // model is attached to window by the existing implementation.
  if(!ctx.window.BTCLiqModel||!ctx.window.BTCLiqEngine)throw Error('Original 39-feature model did not initialize');
  return ctx.window.BTCLiqEngine;
}
async function forecastAt2000(day,now){
  const asof=Date.parse(day+'T12:00:00Z');
  if(now<asof)throw Error('Do not predict future 20:00');
  const [all,priorDays]=await Promise.all([
    pionexBars('15M',500,asof-1),pionexBars('1D',45,asof-1)
  ]);
  const candles=all.filter(k=>k.t+MS15<=asof);
  if(candles.length<340)throw Error('Pionex 15M history < 340 closed candles');
  if(candles.at(-1).t!==asof-MS15)throw Error('Pionex 15M latest closed candle is not 19:45 TPE');
  const today=Date.parse(day+'T00:00:00Z'); // 08:00 TPE
  const todayBars=candles.filter(k=>k.t>=today);
  if(todayBars.length!==48||todayBars.some((b,i)=>b.t!==today+i*MS15))throw Error('08:00–20:00 TPE must have 48 continuous Pionex 15M candles');
  const current={t:today,o:todayBars[0].o,h:Math.max(...todayBars.map(x=>x.h)),
    l:Math.min(...todayBars.map(x=>x.l)),c:todayBars.at(-1).c};
  const history=priorDays.filter(x=>x.t<today);
  const daily=[...history,current];
  const engine=getModel();
  const result=engine.forecast(candles,daily,asof,null);
  if(!result?.ready||!isNum(result.up)||!isNum(result.down))throw Error('39-feature model unready: '+(result?.reason||'unknown'));
  if(result.up<0||result.up>1||Math.abs(result.up+result.down-1)>0.00001)throw Error('Model probabilities invalid');
  return {upProbability:Number((result.up*100).toFixed(5)),downProbability:Number((result.down*100).toFixed(5)),
    priceAtFreeze:todayBars.at(-1).c,haColor:result.haColor,modelAsOf:new Date(asof).toISOString(),
    probabilitySource:'BTC 39-feature price-proxy logistic + daily HA v2.0.0',
    probabilityDefinition:'P(upper first | upper or lower touched), trained on price-proxy boundaries; NOT calibrated to real CoinGlass levels',
    modelFeed:'Pionex BTC_USDT_PERP 15M + 1D',modelStatus:'OK'};
}
async function main(){
  const file='data/latest.json';if(!fs.existsSync(file))throw Error('YML capture step has not produced '+file);
  const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
  const day=getDay(snapshot.observedAtTPE?.slice(0,10)||'');
  const mode=String(process.env.CAPTURE_MODE||'manual');
  const now=Date.now(),target=Date.parse(day+'T12:00:00Z');
  snapshot.captureMode=mode;
  if(mode==='daily20'){
    snapshot.scheduledForTPE=day+'T20:00:00+08:00';
    snapshot.captureDelaySeconds=Math.round((Date.parse(snapshot.observedAt)-target)/1000);
    snapshot.captureTiming=snapshot.captureDelaySeconds<0?'EARLY':snapshot.captureDelaySeconds<=300?'ON_TIME':'LATE';
    if(snapshot.source!=='CoinGlass'||snapshot.isEstimate!==false||snapshot.sourceType!=='coinglass-24h'){
      snapshot.modelStatus='SKIPPED';snapshot.modelError='CoinGlass unavailable: proxy snapshot not eligible for real CoinGlass results';
      snapshot.captureStatus='SOURCE_REJECTED';
    }else{
      try{
        const x=await forecastAt2000(day,now);Object.assign(snapshot,x);
        snapshot.captureStatus=snapshot.captureTiming==='ON_TIME'?'READY':'LATE_UNSCORED';
      }catch(e){snapshot.modelStatus='ERROR';snapshot.modelError=String(e?.message||e).slice(0,350);snapshot.captureStatus='MODEL_ERROR';
        console.error('Model unavailable. DO NOT fabricate probabilities:',snapshot.modelError);}
    }
  }
  fs.writeFileSync(file,JSON.stringify(snapshot,null,2)+'\n');
  const dated='data/'+snapshot.observedAtTPE.slice(0,19).replace('T','_').replace(/:/g,'-')+'.json';
  if(!fs.existsSync(dated))throw Error('Expected matching per-capture JSON missing: '+dated);
  fs.writeFileSync(dated,JSON.stringify(snapshot,null,2)+'\n');
  console.log('Captured CoinGlass?',snapshot.source==='CoinGlass'&&!snapshot.isEstimate,
    'Mode',mode,'State',snapshot.captureStatus,'Probability',snapshot.upProbability??'UNAVAILABLE',snapshot.downProbability??'UNAVAILABLE');
  if(mode==='daily20'&&snapshot.captureStatus!=='READY')console.warn('NOT an eligible on-time, model-ready CoinGlass observation. Record will be marked unscored.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={parseBars,forecastAt2000,main};
