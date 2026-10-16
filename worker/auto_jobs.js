/** Standalone Cloudflare cron jobs for BTC 20:00 TPE freeze + next 08:00 settlement.
 * v0.9.1: strictly closed 15M prices at frozen decision time, same 39-feature predictor as UI.
 * PIONEX perpetual is preferred source for price and model. Binance L2 is an ESTIMATE.
 */
import './model_predictor.js';
import './probability_engine.js';

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
export async function readPre20CoinGlass(env,day){
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
export async function runScheduled(controller,env){
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
export const __test={readPre20CoinGlass,normalizePionex,requireClosed,binanceL2,settlementFromBars,jobForCron,makeFreeze,cloudFreeze,cloudSettle,freezeMillis,runScheduled};
