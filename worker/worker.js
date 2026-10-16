/** BTC Liquidity Radar R2 snapshot bridge v0.9.0. One R2 object per Taiwan 20:00 session.
 * R2 binding: BTC_RECORDS; secret: BTC_RECORDS_TOKEN; env ALLOWED_ORIGINS optional.
 * The write token is NEVER placed in the public GitHub repo / JavaScript.
 */
const ROOT='/api/btc-liq/records';
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
    record.r2FirstSavedAt=new Date().toISOString();
    record.storageProvenance='Browser submitted; not an exchange-verified historical snapshot';
    const created=await env.BTC_RECORDS.put(key,JSON.stringify(record),{
     httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})
    });
    if(!created){const latest=await env.BTC_RECORDS.get(key);return reply({ok:true,status:'unchanged',record:JSON.parse(await latest.text())});}
    return reply({ok:true,status:'created',record},201);
   }catch(e){return reply({ok:false,error:'R2 寫入失敗',detail:String(e.message||e).slice(0,200)},502);}
  }
  return reply({ok:false,error:'找不到 API 路徑'},404);
 }
};
