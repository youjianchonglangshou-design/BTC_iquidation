import puppeteer from '@cloudflare/puppeteer';

/** Dedicated headless browser capture. The HTML page does the parsing;
 * this Worker only reads the decoded result and stores a timestamped JSON in R2.
 * Existing btc-liq-automator Worker then freezes at 20:02 from this same R2 key.
 */
const PREFIX='btc-liq/v1/coinglass/';
const STATUS_KEY='btc-liq/v1/status/browser-capture.json';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json;charset=UTF-8','Cache-Control':'no-store'}});
const two=n=>String(n).padStart(2,'0');
function minuteWindow(now){
  const d=new Date(now);return d.getUTCHours()===11&&d.getUTCMinutes()>=55&&d.getUTCMinutes()<=59;
}
function chooseSnapshot(snap,now){
  if(!snap||snap.status!=='ready'||snap.source!=='CoinGlass'||snap.range!=='24h'||snap.symbol!=='BTC')throw Error('暫存網頁尚未產生有效 CoinGlass JSON');
  const upper=Number(snap.upper),lower=Number(snap.lower),observed=Number(snap.observedAt);
  if(!(upper>lower&&lower>0&&upper<20000000))throw Error('CoinGlass 上下界超出合理範圍');
  if(!Number.isFinite(observed)||now-observed>120000||observed>now+15000)throw Error('暫存網頁 JSON 時間過期');
  const version=String(snap.version);
  if(!/^(0|1|2|55|66|77)$/.test(version))throw Error('未支援的 CoinGlass 加密版本');
  return {source:'CoinGlass',range:'24h',upper,lower,observedAt:new Date(observed).toISOString(),
    receivedAt:new Date(now).toISOString(),version,
    referencePrice:Number(snap.referencePrice)||null,
    upperAmount:Number(snap.upperAmount)||null,lowerAmount:Number(snap.lowerAmount)||null,
    provenance:'Cloudflare Browser Run executed capture.html; observed quote, not official exchange position data'};
}
function validUrl(env){
 const value=String(env.CAPTURE_URL||''); const u=new URL(value);
 if(u.protocol!=='https:'||u.hostname!=='youjianchonglangshou-design.github.io'||u.pathname!=='/BTC_liquidation/capture.html')throw Error('CAPTURE_URL 來源不符');
 return value;
}
async function capture(env, when=Date.now(), {test=false}={}) {
  if(!env.BROWSER||!env.BTC_RECORDS)throw Error('缺少 BROWSER / BTC_RECORDS binding');
  if(!test&&!minuteWindow(when))return {ok:true,status:'outside-capture-window',at:new Date(when).toISOString()};
  let browser;
  try{
    browser=await puppeteer.launch(env.BROWSER);
    const page=await browser.newPage();
    await page.goto(validUrl(env),{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForFunction('window.__cgSnapshot && window.__cgSnapshot.status !== "loading"',{timeout:21000});
    // Cloudflare Puppeteer page.evaluate returns JSON string, not a DOM node.
    const raw=await page.evaluate(()=>JSON.stringify(window.__cgSnapshot||{}));
    const snap=JSON.parse(raw);
    if(snap.status!=='ready')throw Error('暫存網頁失敗：'+String(snap.reason||'沒有資料').slice(0,150));
    const received=Date.now(),quote=chooseSnapshot(snap,received);
    // Keyed by actual server UTC receipt minute, matching readPre20CoinGlass().
    const d=new Date(received),key=PREFIX+d.toISOString().slice(0,10)+'/'+two(d.getUTCHours())+two(d.getUTCMinutes())+'.json';
    if(!test&&!minuteWindow(received))throw Error('解析完成時已超過 19:59，不保存為當晚凍結快照');
    const saved=await env.BTC_RECORDS.put(key,JSON.stringify(quote),{
      httpMetadata:{contentType:'application/json'},
      onlyIf:new Headers({'If-None-Match':'*'})
    });
    const result={ok:true,status:saved?'stored':'already-exists',key,upper:quote.upper,lower:quote.lower,version:quote.version,at:quote.receivedAt};
    await env.BTC_RECORDS.put(STATUS_KEY,JSON.stringify(result));
    return result;
  }catch(e){
    const result={ok:false,status:'capture-failed',at:new Date().toISOString(),error:String(e?.message||e).slice(0,220)};
    try{await env.BTC_RECORDS.put(STATUS_KEY,JSON.stringify(result));}catch{}
    return result;
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
}
export {minuteWindow,chooseSnapshot,validUrl,capture};
export default {
  // Only health check available publicly; manual runs require a protected secret.
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(path==='/health'&&req.method==='GET')return json({ok:true,name:'btc-liq-browser-capture'});
    if(path==='/status'&&req.method==='GET'){
      if(!env.CAPTURE_ADMIN_SECRET||req.headers.get('Authorization')!==`Bearer ${env.CAPTURE_ADMIN_SECRET}`)return json({ok:false,error:'forbidden'},403);
      const object=await env.BTC_RECORDS.get(STATUS_KEY);
      return json({ok:true,result:object?JSON.parse(await object.text()):null});
    }
    return json({ok:false,error:'not found'},404);
  },
  async scheduled(ctrl,env,ctx){
    ctx.waitUntil(capture(env,ctrl.scheduledTime).then(r=>{if(!r.ok)console.error('BTC CoinGlass browser capture:',r.error)}));
  }
};
