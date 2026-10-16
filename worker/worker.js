import { runScheduled, readPre20CoinGlass } from './auto_jobs.js';
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
