/* R2 record synchronization module; frontend uses a per-device access token, never a public embedded secret. */
(function(){'use strict';
 const CONFIG_KEY='btc-liq-r2-config-v1';
 const autoRows=rows=>rows.filter(r=>r&&r.kind==='auto'&&/^20\d\d-\d\d-\d\d$/.test(r.day)&&r.id===r.day+'-20:00');
 let config={url:'',token:''};
 try{config={...config,...JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')};}catch{}
 let notify=()=>{};
 let state={phase:'idle',message:config.url?'待連線':'尚未設定 R2',lastSync:0,count:0};
 let pulling=false,writing=new Map();
 const emit=()=>notify({...state});
 const base=()=>config.url.replace(/\/+$/,'').replace(/\/api\/btc-liq\/records$/,'');
 const configured=()=>Boolean(config.url&&config.token);
 function setState(phase,message,more={}){state={...state,phase,message,...more};emit();}
 function validate(url,token){
  if(!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(url))throw Error('請填 HTTPS Worker 網址');
  if(!token||token.length<24)throw Error('同步金鑰至少需要 24 個字元');
 }
 async function api(path,options={}){
  if(!configured())throw Error('尚未設定 Worker 與金鑰');
  const response=await fetch(base()+path,{...options,cache:'no-store',headers:{'Authorization':'Bearer '+config.token,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(14000)});
  let value;try{value=await response.json();}catch{throw Error('Worker 未回傳有效 JSON（HTTP '+response.status+'）');}
  if(!response.ok||value.ok===false)throw Error(value.error||('Worker HTTP '+response.status));
  return value;
 }
 async function pull(){
  if(!configured()||pulling)return [];
  pulling=true;setState('loading','R2 同步中…');
  try{
   let cursor=null,rows=[];
   for(let i=0;i<10;i++){
    const path='/api/btc-liq/records'+(cursor?'?cursor='+encodeURIComponent(cursor):'');
    const data=await api(path);
    rows.push(...autoRows(data.records||[]));cursor=data.cursor;
    if(!cursor)break;
   }
   const time=Date.now();setState('ok',`R2 已連線 · ${rows.length} 筆`,{lastSync:time,count:rows.length});
   return rows;
  }catch(e){setState('error','R2 同步失敗：'+(e.message||e));throw e;}
  finally{pulling=false;}
 }
 async function push(record){
  if(!configured()||record?.kind!=='auto')return null;
  const active=writing.get(record.id);
  if(active){
   const prior=await active;
   // Settlement arrived while the initial frozen record was still being written.
   if(record.result&&!prior?.result)return push(record);
   return prior;
  }
  const pending=(async()=>{
   const data=await api('/api/btc-liq/records/'+encodeURIComponent(record.day),{method:'PUT',body:JSON.stringify(record)});
   setState('ok','R2 已寫入 '+record.day,{lastSync:Date.now()});return data.record;
  })();
  writing.set(record.id,pending);
  try{return await pending;}
  catch(e){setState('error','R2 寫入失敗（本機暫存保留）：'+e.message);throw e;}
  finally{writing.delete(record.id);}
 }

 function save(url,token){
  const cleaned=url.trim().replace(/\/+$/,'');validate(cleaned,token.trim());
  config={url:cleaned,token:token.trim()};localStorage.setItem(CONFIG_KEY,JSON.stringify(config));
  setState('idle','設定已保存，準備連線');
 }
 function forget(){config={url:'',token:''};localStorage.removeItem(CONFIG_KEY);setState('idle','已取消本裝置 R2 設定');}
 const getConfig=()=>({...config});
 const getState=()=>({...state});
 const subscribe=callback=>{notify=callback;emit();};
 window.BTCR2Records={save,forget,pull,push,configured,getConfig,getState,subscribe,autoRows};
})();
