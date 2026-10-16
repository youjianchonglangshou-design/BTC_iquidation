/* v0.9.7 – automatic, read-only R2 history, same pattern as SStateMarketTerminal. */
(function(){'use strict';
 const cfg=window.BTC_LIQ_CONFIG||{};
 const WORKER=String(cfg.workerUrl||'').replace(/\/+$/,'');
 const PATH='/api/btc-liq/public';
 const autoRows=rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&r.kind==='auto'&&/^20\d\d-\d\d-\d\d$/.test(r.day)&&r.id===r.day+'-20:00');
 // Do not retain legacy bearer tokens stored by older versions of this UI.
 try{localStorage.removeItem('btc-liq-r2-config-v1');}catch(_){}
 let notify=()=>{};
 let state={phase:'idle',message:'自動連線 R2 中…',lastSync:0,count:0};
 let pulling=false;
 const emit=()=>notify({...state});
 function update(phase,message,extra={}){state={...state,...extra,phase,message};emit();}
 async function api(path){
  if(!WORKER)throw Error('cloud-config.js 尚未設定 Worker 網址');
  const res=await fetch(WORKER+PATH+path,{method:'GET',cache:'no-store',headers:{'Accept':'application/json'},signal:AbortSignal.timeout(15000)});
  let body=null;try{body=await res.json();}catch(_){throw Error('雲端未回傳 JSON（HTTP '+res.status+'）');}
  if(!res.ok||body?.ok===false)throw Error(body?.error||('HTTP '+res.status));
  return body;
 }
 async function pull(){
  if(pulling)return null;
  pulling=true;update('loading','正在讀取雲端戰績…');
  try{
   let cursor=null,rows=[];
   for(let i=0;i<10;i++){
    const data=await api('/records'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    rows.push(...autoRows(data.records));
    cursor=typeof data.cursor==='string'&&data.cursor?data.cursor:null;
    if(!cursor)break;
   }
   const result=autoRows(rows);
   update('ok',`R2 雲端已同步 · ${result.length} 筆`,{lastSync:Date.now(),count:result.length});
   return result;
  }catch(e){update('error','R2 讀取失敗：'+(e.message||e));throw e;}
  finally{pulling=false;}
 }
 async function status(){return api('/status');}
 // Cloudflare Cron performs all production R2 writes. Browser never needs a write token.
 const configured=()=>Boolean(WORKER);
 const canWrite=()=>false;
 const subscribe=callback=>{notify=callback;emit();};
 window.BTCR2Records={pull,status,configured,canWrite,getState:()=>({...state}),getConfig:()=>({url:WORKER,token:''}),subscribe,autoRows,
  push:async()=>null,pushQuote:async()=>null};
})();
