/* Pionex-only market feed. Matches BTC4HBreakoutPulse / src/feeds.js, src/tv_history.js. */
(function(g){'use strict';
const WORKER='https://white-meadow-16bc.youjianchonglangshou.workers.dev';
const SCANNER='https://scanner.tradingview.com/crypto/scan';
const SYMBOL='PIONEX:BTCUSDT.P',PAIR='BTC_USDT_PERP';
const PREFIX='~m~';
function bytes(s){return new TextEncoder().encode(String(s)).length;}
function frame(x){const str=typeof x==='string'?x:JSON.stringify(x);return PREFIX+bytes(str)+PREFIX+str;}
function encode(m,p){return frame(JSON.stringify({m,p}));}
function rid(pre){return pre+'_'+Math.random().toString(36).slice(2,14);}
function frames(text){let result=[],start=0;while(start<text.length){const at=text.indexOf(PREFIX,start);if(at<0)break;const end=text.indexOf(PREFIX,at+PREFIX.length);if(end<0)break;const size=+text.slice(at+PREFIX.length,end);if(!Number.isSafeInteger(size)||size<0)break;let p=end+PREFIX.length,k=p,n=0;while(k<text.length&&n<size){const cp=text.codePointAt(k),c=String.fromCodePoint(cp);n+=bytes(c);k+=c.length;}if(n!==size)break;result.push(text.slice(p,k));start=k;}return result;}
function row(b){const a=Array.isArray(b)?b:b?.v;if(!Array.isArray(a)||a.length<6)return null;const shift=a.length>=7?1:0;let t=+a[shift];if(t<1e12)t*=1000;const o=+a[shift+1],h=+a[shift+2],l=+a[shift+3],c=+a[shift+4],v=+a[shift+5]||0;if(![t,o,h,l,c].every(Number.isFinite)||o<=0||h<l||c<=0)return null;return {t,o,h,l,c,v};}
function tvBars(resolution='15',count=520,timeout=20000){return new Promise((resolve,reject)=>{
 const u=new URL(WORKER);u.protocol='wss:';u.pathname='/api/monitor/tv-chart-ws';const ws=new WebSocket(u.toString());
 const sess=rid('cs'),sym='symbol_1',series='series_1',items=new Map();let finished=false;
 const timer=setTimeout(()=>fail(Error('派網 TV K線逾時')),timeout);
 function cleanup(){clearTimeout(timer);try{ws.close();}catch(_){}}
 function fail(e){if(finished)return;finished=true;cleanup();reject(e);}
 function complete(){if(finished)return;const bars=[...items.values()].sort((a,b)=>a.t-b.t).slice(-count);if(bars.length<2){fail(Error('派網 K線不足'));return;}finished=true;cleanup();resolve({bars,source:'PIONEX:BTCUSDT.P / TradingView 圖表'});}
 ws.addEventListener('open',()=>{try{ws.send(encode('set_auth_token',['unauthorized_user_token']));ws.send(encode('chart_create_session',[sess,'']));ws.send(encode('switch_timezone',[sess,'Etc/UTC']));ws.send(encode('resolve_symbol',[sess,sym,'='+JSON.stringify({symbol:SYMBOL,adjustment:'splits',session:'regular'})]));ws.send(encode('create_series',[sess,series,'s1',sym,resolution,count,'']));}catch(e){fail(e);}});
 ws.addEventListener('message',async ev=>{try{let txt=ev.data instanceof Blob?await ev.data.text():typeof ev.data==='string'?ev.data:new TextDecoder().decode(ev.data);for(const p of frames(String(txt))){if(p.startsWith('~h~')){ws.send(frame(p));continue;}let j;try{j=JSON.parse(p);}catch{continue;}if(['protocol_error','critical_error','symbol_error','series_error'].includes(j.m)){fail(Error('派網 K線圖回應 '+j.m));return;}const a=j.p||[];if(j.m==='timescale_update'&&a[0]===sess)for(const b of a?.[1]?.[series]?.s||[]){const k=row(b);if(k)items.set(k.t,k);}if(j.m==='series_completed'&&a[0]===sess&&a[1]===series){complete();return;}}}catch(e){fail(e);}});
 ws.addEventListener('error',()=>fail(Error('TV 圖表 WebSocket 連線失敗')));ws.addEventListener('close',()=>{if(!finished)fail(Error('TV 圖表 WebSocket 提前關閉'));});
});}
async function json(url,options={},timeout=12000){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{...options,signal:c.signal,cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(data?.ok===false)throw Error(data.error||'Worker API error');return data;}finally{clearTimeout(timer);}}
async function restBars(interval,count){const u=new URL('/api/monitor/klines',WORKER);u.searchParams.set('symbol',PAIR);u.searchParams.set('interval',interval==='15'?'15M':interval==='240'?'4H':'1D');u.searchParams.set('limit',String(Math.min(300,count)));const j=await json(u.toString());let a=(j.klines||[]).map(r=>{const time=Array.isArray(r)?r[0]:r.time??r.ts;let t=+time;if(t>0&&t<1e12)t*=1000;const v=Array.isArray(r)?r.slice(1):[r.open,r.high,r.low,r.close,r.volume];return {t,o:+v[0],h:+v[1],l:+v[2],c:+v[3],v:+(v[4]||0)};}).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.o>0&&x.c>0).sort((a,b)=>a.t-b.t);
if(!a.length)throw Error('派網 Worker 無 K 線');return{bars:a,source:'Pionex Worker '+interval+' 備援'};}
async function klines(interval='15',count=520){let lastErr;try{return await tvBars(interval,count);}catch(e){lastErr=e;}try{const r=await restBars(interval,count);r.warning='TV 圖表不可用：'+lastErr.message;return r;}catch(e){throw Error('派網 '+interval+' K 線失敗：'+lastErr.message+' / '+e.message);}}
async function price(){let err;try{const b={filter:[],options:{lang:'en'},symbols:{query:{types:[]},tickers:[SYMBOL]},columns:['close'],range:[0,10]};const d=await json(SCANNER,{method:'POST',mode:'cors',headers:{Accept:'application/json','Content-Type':'text/plain'},body:JSON.stringify(b)},9000);const r=d?.data?.find(x=>String(x.s).toUpperCase()===SYMBOL),p=+r?.d?.[0];if(p>0)return{price:p,source:'TradingView Scanner · '+SYMBOL,ts:Date.now()};throw Error('Scanner 無此幣價');}catch(e){err=e;}try{const j=await json(WORKER+'/api/monitor/tickers?type=PERP',{},9000),r=(j.tickers||[]).find(x=>String(x.symbol).toUpperCase()===PAIR),p=+r?.price;if(p>0)return{price:p,source:'Pionex Worker PERP 價格備援',ts:Date.now(),warning:err.message};throw Error('Worker 未找到價格');}catch(e){throw Error('派網現價無法取得：'+err.message+' / '+e.message);}}
g.PionexFeed={klines,price,_test:{frames,row}};
})(window);
