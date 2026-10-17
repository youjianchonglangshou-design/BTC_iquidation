/* BTC CoinGlass Daily Results v1.0.0 (2026-10-17)
 * Existing BTC 39-feature forecast and Pionex freeze are reused from ./auto_jobs.js.
 * Public: read only. ADMIN_TOKEN: manual live tests only.
 */
import {__test as legacy} from './auto_jobs.js';
import {asDay, settleCandles, updateLedger, validateCoinGlass} from './results-core.js';

const KEY='btc-liq/v2/daily-results.json'; // CONSTANT R2 object name; records[] holds all dates.
const STATUS='btc-liq/v2/status.json';
const ORIGIN='https://youjianchonglangshou-design.github.io';
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const res=(x,s=200,h={})=>new Response(JSON.stringify(x),{status:s,headers:{...JSON_HEADERS,...h}});
const dateUTC=t=>new Date(t).toISOString().slice(0,10);
const nowTPE=t=>new Date(t+28800000).toISOString().replace('Z','+08:00');
const iso=t=>new Date(t).toISOString();
const boundNum=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
const errorText=e=>String(e?.message||e).slice(0,400);
function corsHeaders(req,env){
 const origin=req.headers.get('Origin');
 const allow=String(env.ALLOWED_ORIGINS||ORIGIN).split(',').map(x=>x.trim());
 if(origin&&!allow.includes(origin))return null;
 return {'Access-Control-Allow-Origin':origin||allow[0],'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'};
}
async function cgReader(){
 // Original reader is a classic browser script with `window.CoinGlassReader`.
 // Import it only after setting the global alias; Wrangler bundles the local module.
 if(!globalThis.CoinGlassReader){globalThis.window=globalThis;await import('../coinglass-decrypt.js');}
 if(!globalThis.CoinGlassReader)throw Error('CoinGlassReader was not initialized');
 return globalThis.CoinGlassReader;
}
async function captureCG(){
 const reader=await cgReader();
 const reply=await reader.fetchCoinGlass('24h');
 const raw=reader.readMaxPain(reply.data);
 if(!raw)throw Error('CoinGlass decoding succeeded but BTC levels were missing');
 return validateCoinGlass({source:'CoinGlass',sourceType:'coinglass-24h',range:'24h',
  upper:Number(raw.short),lower:Number(raw.long),referencePrice:boundNum(raw.referencePrice),
  upperAmount:boundNum(raw.shortAmount),lowerAmount:boundNum(raw.longAmount),
  version:String(reply.version),capturedAt:iso(Date.now())});
}
const emptyLedger=()=>({schemaVersion:'1.0.0',symbol:'BTCUSDT',timezone:'Asia/Taipei',
 updatedAt:null,latestDay:null,records:[]});
async function readJson(env,key){const file=await env.BTC_RECORDS.get(key);return file?JSON.parse(await file.text()):null;}
async function putJson(env,key,obj,options={}){return env.BTC_RECORDS.put(key,JSON.stringify(obj,null,2)+'\n',{
 httpMetadata:{contentType:'application/json; charset=utf-8'},...options});}
async function upsert(env,item,phase){
 for(let attempt=0;attempt<4;attempt++){
  const existing=await env.BTC_RECORDS.get(KEY);
  const original=existing?JSON.parse(await existing.text()):emptyLedger();
  const next=updateLedger(original,item,phase);
  const options=existing?{onlyIf:{etagMatches:existing.etag}}:{onlyIf:new Headers({'If-None-Match':'*'})};
  if(await putJson(env,KEY,next,options))return next;
 }
 throw Error('R2 concurrent write retries exceeded');
}
async function saveStatus(env,data){await putJson(env,STATUS,{...data,updatedAt:iso(Date.now())});}
function fromLegacy(raw,quote,at,legacyError=null){
 const forecastReady=typeof raw?.upProb==='number'&&Number.isFinite(raw.upProb)&&typeof raw?.downProb==='number'&&Number.isFinite(raw.downProb);
 const verifiedCoinGlass=Boolean(quote||(raw?.mode==='cg'&&raw?.upper>raw?.lower&&raw?.lower>0));
 const result={day:raw?.day||dateUTC(at),capturedAt:quote?.capturedAt||iso(at),
  scheduledForTPE:nowTPE(Date.parse((raw?.day||dateUTC(at))+'T12:00:00Z')),
  source:quote?'CoinGlass':raw?.liquidationSource||'UNAVAILABLE',
  sourceType:quote?'coinglass-24h':raw?.mode||'unavailable',
  isEstimate:!verifiedCoinGlass,upper:quote?.upper??boundNum(raw?.upper),lower:quote?.lower??boundNum(raw?.lower),
  referencePrice:quote?.referencePrice??boundNum(raw?.price),
  upperAmount:quote?.upperAmount??boundNum(Number(raw?.coinGlassLevelUpper)),
  lowerAmount:quote?.lowerAmount??boundNum(Number(raw?.coinGlassLevelLower)),
  coinGlassVersion:quote?.version||null,priceAtFreeze:boundNum(raw?.price),
  upProbability:boundNum(raw?.upProb),downProbability:boundNum(raw?.downProb),
  probabilitySource:forecastReady?'BTC 39-feature logistic/HA v2.0.0 (proxy-trained)':'unavailable',
  probabilityDefinition:'Conditional: first upper vs first lower, given at least one target touched; trained on price-proxy boundaries, NOT CoinGlass-calibrated.',
  status:forecastReady?'FROZEN':'PARTIAL',
  prediction:!forecastReady?null:(Number(raw.upProb)>=Number(raw.downProb)?'UP_FIRST':'DOWN_FIRST'),
  result:null,correct:null,firstHitAt:null,settledAt:null,
  modelStatus:legacyError?'ERROR: '+legacyError:'OK',
  provenance:quote?'CoinGlass 24H live read by Cloudflare Worker at scheduled event':'Existing 20:00 freeze; CoinGlass unavailable. Source is explicitly identified'};
 if(!(result.upper>result.lower&&result.lower>0)){result.status='ERROR';result.modelStatus='No valid upper/lower values';}
 return result;
}
// Match Pionex original frozen price series, without substituting another exchange.
async function outcomeFromPionex(item){
 const start=Date.parse(item.day+'T12:00:00Z'),end=start+12*3600000;
 const u=new URL('https://api.pionex.com/api/v1/market/klines');
 u.searchParams.set('symbol','BTC_USDT_PERP');u.searchParams.set('interval','15M');
 u.searchParams.set('limit','100');u.searchParams.set('endTime',String(end-1));
 const resp=await fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(14000)});
 if(!resp.ok)throw Error('Pionex HTTP '+resp.status);
 const body=await resp.json();if(body.result===false)throw Error('Pionex result:false '+(body.message||''));
 const candles=legacy.normalizePionex(body.data?.klines??body.klines);
 const settled=settleCandles(item,candles);
 return {...settled,settledAt:iso(Date.now())};
}
async function freeze(env,scheduledAt){
 const day=dateUTC(scheduledAt),boundaryTime=Date.parse(day+'T12:00:00Z');
 // Do not pretend a delayed/manual capture is a 20:00 quote.
 let quote=null,cgError=null;
 if(Math.abs(Date.now()-boundaryTime)<=5*60000){
  try{quote=await captureCG();}catch(e){cgError=errorText(e);}
 }else{cgError='Scheduled job late beyond 5 min; CoinGlass 20:00 snapshot not recreated';}
 let legacyRecord=null,modelError=null;
 try{
  // Reuse original 39-feature production calculation, but do not write legacy per-day R2 keys.
  legacyRecord=await legacy.makeFreeze(day,{},null);
 }catch(e){modelError=errorText(e);}
 const item=fromLegacy(legacyRecord,quote,scheduledAt,modelError);
 if(cgError)item.coinGlassError=cgError;
 // Quote is saved to the stable ledger even when the forecast exchange feed failed.
 const ledger=await upsert(env,item,'freeze');
 await saveStatus(env,{ok:item.status!=='ERROR',task:'freeze',day,cgOk:!!quote,
  modelOk:!!legacyRecord,source:item.source,cgError,modelError});
 return {ok:item.status!=='ERROR',task:'freeze',day,item:ledger.records.find(r=>r.day===day),cgError,modelError};
}
async function settle(env,scheduledAt){
 const day=dateUTC(scheduledAt-86400000);
 const ledger=await readJson(env,KEY);
 const item=ledger?.records?.find(x=>x.day===day);
 if(!item)throw Error('Previous 20:00 record missing: '+day+'; do not backfill as real forecast');
 if(item.settledAt)return {ok:true,task:'settle',day,alreadySettled:true};
 if(!(item.upper>item.lower&&item.lower>0))throw Error('Invalid frozen boundaries');
 const result=await outcomeFromPionex(item);
 const updated=await upsert(env,{day,...result},'settle');
 await saveStatus(env,{ok:true,task:'settle',day,result:result.result,correct:result.correct});
 return {ok:true,task:'settle',day,item:updated.records.find(r=>r.day===day)};
}
async function execute(env,task,at){
 try{return task==='freeze'?await freeze(env,at):await settle(env,at);}
 catch(e){let msg=errorText(e);await saveStatus(env,{ok:false,task,day:task==='freeze'?dateUTC(at):dateUTC(at-86400000),error:msg});throw e;}
}
export default {
 async scheduled(event,env,ctx){
  const at=Number(event.scheduledTime);const hour=new Date(at).getUTCHours(),min=new Date(at).getUTCMinutes();
  const task=hour===12&&min===0?'freeze':hour===0&&min===1?'settle':null;
  if(!task)throw Error('Unexpected Cron: '+iso(at));
  ctx.waitUntil(execute(env,task,at));
 },
 async fetch(req,env){
  const cors=corsHeaders(req,env);if(!cors)return res({ok:false,error:'Origin denied'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url);const p=url.pathname;
  const reply=(v,s)=>res(v,s,cors);
  if(p==='/api/btc-liq/public/health')return reply({ok:!!env.BTC_RECORDS,version:'1.0.0',r2Binding:!!env.BTC_RECORDS});
  if(!env.BTC_RECORDS)return reply({ok:false,error:'R2 BTC_RECORDS binding missing'},503);
  if(req.method==='GET'&&p==='/api/btc-liq/public/records'){
   const ledger=await readJson(env,KEY)||emptyLedger();
   return reply({ok:true,records:ledger.records.map(r=>({
    ...r,kind:'auto',id:r.day+'-20:00',upProb:r.upProbability,downProb:r.downProbability,
    price:r.priceAtFreeze,mode:r.sourceType==='coinglass-24h'?'cg':'binance',liquidationSource:r.source,coinGlassAt:r.capturedAt,freezeMethod:r.provenance,
    result:r.result==='UP_FIRST'?'上掃':r.result==='DOWN_FIRST'?'下掃':r.result==='NONE'?'未觸及':r.result==='AMBIGUOUS'?'同根雙碰':'',
    correct:r.correct===true?'命中':r.correct===false?'失敗':r.settledAt?'不計分':'',
    firstHitTpe:r.firstHitAt?String(r.firstHitAt).slice(11,16):'',created:r.scheduledForTPE?.replace('T',' ').slice(0,19)||''
   })) ,cursor:null});
  }
  if(req.method==='GET'&&p==='/api/btc-liq/public/latest')return reply({ok:true,data:await readJson(env,KEY)||emptyLedger()});
  if(req.method==='GET'&&p==='/api/btc-liq/public/status')return reply({ok:true,status:await readJson(env,STATUS)});
  if(p==='/api/btc-liq/admin/test-coinglass'&&req.method==='POST'){
   if(!env.ADMIN_TOKEN||req.headers.get('Authorization')!==`Bearer ${env.ADMIN_TOKEN}`)return reply({ok:false,error:'Unauthorized'},401);
   try{return reply({ok:true,coinGlass:await captureCG()});}catch(e){return reply({ok:false,error:errorText(e)},502);}
  }
  if(p==='/api/btc-liq/admin/run'&&req.method==='POST'){
   if(!env.ADMIN_TOKEN||req.headers.get('Authorization')!==`Bearer ${env.ADMIN_TOKEN}`)return reply({ok:false,error:'Unauthorized'},401);
   let body={};try{body=await req.json();}catch{return reply({ok:false,error:'Invalid JSON'},400);}
   if(!['freeze','settle'].includes(body.task))return reply({ok:false,error:'Use {"task":"freeze"} or {"task":"settle"}'},400);
   const n=Date.now(),curr=asDay(n),freezeAt=Date.parse(curr+'T12:00:00Z');
   // Prevent historical look-ahead and fake backtests from manual API invocations.
   if(body.task==='freeze'&&(n<freezeAt||n>freezeAt+5*60000))return reply({ok:false,error:'Freeze test permitted only 20:00–20:05 Asia/Taipei. Use test-coinglass anytime.'},409);
   if(body.task==='settle'&&(n<Date.parse(curr+'T00:01:00Z')||n>Date.parse(curr+'T01:01:00Z')))return reply({ok:false,error:'Settlement manual run permitted only 08:01–09:01 Asia/Taipei'},409);
   try{return reply(await execute(env,body.task,body.task==='freeze'?freezeAt:Date.parse(curr+'T00:01:00Z')));}catch(e){return reply({ok:false,error:errorText(e)},502);}
  }
  return reply({ok:false,error:'Not found'},404);
 }
};
export const __test={fromLegacy,outcomeFromPionex};
