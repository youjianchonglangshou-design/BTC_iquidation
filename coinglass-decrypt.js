/* CoinGlass v0/v1/v2 reader (v0.8.4). AES-128-ECB + gzip, two-layer decoding.
   Key0: v=0 from request cache-ts-v2; v=1 from URL path; v=2 from response time.
   The endpoint is undocumented and may change. No captured private tokens embedded. */
(function(global){
'use strict';
const S=new Uint8Array(256), I=new Uint8Array(256), R=new Uint8Array(11);R[1]=1;
for(let x=2;x<11;x++)R[x]=xt(R[x-1]);
function xt(n){return ((n<<1)^((n&128)?0x1b:0))&255;}
function mul(a,b){let r=0;while(b){if(b&1)r^=a;a=xt(a);b>>=1;}return r;}
for(let n=0;n<256;n++){
 let inv=0;if(n){for(let x=1;x<256;x++)if(mul(n,x)===1){inv=x;break;}}
 let a=inv,rot=k=>((a<<k)|(a>>(8-k)))&255;
 let v=a^rot(1)^rot(2)^rot(3)^rot(4)^0x63;S[n]=v;I[v]=n;
}
function expand(k){if(k.length!==16)throw Error('AES key length invalid');const w=Uint8Array.from({length:176});w.set(k);let off=16,rc=1;while(off<176){let t=Array.from(w.slice(off-4,off));if(off%16===0){t=[t[1],t[2],t[3],t[0]].map((v,i)=>S[v]^(i===0?R[rc]:0));rc++;}for(let i=0;i<4;i++){w[off]=w[off-16]^t[i];off++;}}return w;}
function decBlock(input,k){let a=Uint8Array.from(input);for(let i=0;i<16;i++)a[i]^=k[160+i];for(let round=9;round>=0;round--){let b=a.slice();for(let row=0;row<4;row++)for(let col=0;col<4;col++)a[row+4*col]=b[row+4*((col-row+4)%4)];for(let i=0;i<16;i++)a[i]=I[a[i]];for(let i=0;i<16;i++)a[i]^=k[round*16+i];if(round){b=a.slice();for(let col=0;col<4;col++){let off=4*col;for(let row=0;row<4;row++)a[off+row]=mul(b[off+row],14)^mul(b[off+(row+1)%4],11)^mul(b[off+(row+2)%4],13)^mul(b[off+(row+3)%4],9);}}}return a;}
function decryptECB(data,key){if(data.length%16)throw Error('AES data not multiple of 16');const sched=expand(key),out=new Uint8Array(data.length);for(let i=0;i<data.length;i+=16)out.set(decBlock(data.subarray(i,i+16),sched),i);const pad=out[out.length-1];if(pad<1||pad>16)throw Error('AES padding invalid');for(let i=out.length-pad;i<out.length;i++)if(out[i]!==pad)throw Error('AES padding mismatch');return out.slice(0,-pad);}
function b64(s){const binary=atob(String(s).replace(/\s/g,''));return Uint8Array.from(binary,c=>c.charCodeAt(0));}
async function gunzip(bytes){if(typeof DecompressionStream==='undefined')throw Error('此瀏覽器不支援 GZIP DecompressionStream');const ds=new DecompressionStream('gzip');const stream=new Blob([bytes]).stream().pipeThrough(ds);return new Uint8Array(await new Response(stream).arrayBuffer());}
const td=new TextDecoder(),te=new TextEncoder();
async function decryptPayload(body,user,v,path,options={}){
 const version=String(v).trim();
 let seed;
 if(version==='0'){
  seed=String(options.cacheTs||'');
  if(!seed)throw Error('CoinGlass V0 缺少 Cache-Ts-V2（送出請求時必須保留同一值）');
 }else if(version==='1'){
  seed=path;
 }else if(version==='2'){
  seed=String(options.timeHeader||'');
  if(!seed)throw Error('CoinGlass V2 缺少可讀取的回應 Time 標頭（可能是 CORS 或 API 改版）');
 }else throw Error('CoinGlass 尚未支援加密版本 V'+version);
 // btoa() of the ASCII seed, then first 16 characters used as literal AES key bytes.
 const key0=te.encode(btoa(seed).slice(0,16));
 const keyText=td.decode(await gunzip(decryptECB(b64(user),key0))).trim();
 // Public implementation uses the decrypted sixteen-character ASCII hex key as AES key bytes.
 const key=te.encode(keyText);if(key.length!==16)throw Error('Unrecognized AES data key ('+key.length+')');
 const packed=typeof body==='string'?JSON.parse(body):body;
 if(typeof packed?.data!=='string'||!packed.data)throw Error('CoinGlass 回應無有效加密清算資料（data 為空）');
 const payload=JSON.parse(td.decode(await gunzip(decryptECB(b64(packed.data),key))));
 return payload;
}
async function fetchCoinGlass(range='24h'){
 const path='/api/liqHeatMap/list'; const url='https://fapi.coinglass.com'+path+'?range='+encodeURIComponent(range);
 const cacheTs=String(Date.now());
 const ctrl=new AbortController(),tid=setTimeout(()=>ctrl.abort(),14000);
 try{const r=await fetch(url,{mode:'cors',cache:'no-store',signal:ctrl.signal,headers:{'Accept':'application/json','Encryption':'true','Language':'zh-TW','Cache-Ts-V2':cacheTs}});
 if(!r.ok)throw Error('CoinGlass HTTP '+r.status);
 const user=r.headers.get('user'),v=r.headers.get('v'),timeHeader=r.headers.get('time'),body=await r.json();
 if(body.code!==undefined&&String(body.code)!=='0')throw Error('CoinGlass code '+body.code);
 if(!body||typeof body.data!=='string'||!body.data)throw Error('CoinGlass 回應無清算資料（data=null 或空）');
 if(!user||v===null)throw Error('缺少可讀取的 user/v 回應標頭（CORS 或 API 改版）');
 return {data:await decryptPayload(body,user,v,path,{cacheTs,timeHeader}),url,version:String(v)};
 }finally{clearTimeout(tid);}
}
function num(v){if(typeof v==='string')v=v.replaceAll(',','').replaceAll('$','');let n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
function readMaxPain(data){
 // Real liqHeatMap/list 24h response: maxLongLiquidationPrice is the upper
 // (short position liquidation) price, maxShortLiquidationPrice is the lower
 // (long position liquidation) price. Prefer exact BTC records only.
 const seen=new WeakSet();let found=null;
 function scan(obj,depth){
  if(found||!obj||typeof obj!=='object'||depth>7||seen.has(obj))return;
  seen.add(obj);
  if(!Array.isArray(obj)){
   const symbol=String(obj.symbol??obj.coin??obj.currency??obj.baseCoin??obj.baseAsset??'').toUpperCase();
   if(symbol==='BTC'||symbol==='BTCUSDT'){
    const upper=num(obj.maxLongLiquidationPrice??obj.short_max_pain_liq_price??obj.shortMaxPainLiqPrice);
    const lower=num(obj.maxShortLiquidationPrice??obj.long_max_pain_liq_price??obj.longMaxPainLiqPrice);
    if(upper&&lower&&upper>lower){
     found={short:upper,long:lower,
      shortAmount:num(obj.maxLongLiquidationLevel??obj.short_max_pain_liq_level??obj.shortMaxPainLiqLevel),
      longAmount:num(obj.maxShortLiquidationLevel??obj.long_max_pain_liq_level??obj.longMaxPainLiqLevel),
      referencePrice:num(obj.price),symbol};return;
    }
   }
  }
  for(const child of Object.values(obj))if(child&&typeof child==='object')scan(child,depth+1);
 }
 scan(data,0);return found;
}

global.CoinGlassReader={fetchCoinGlass,decryptPayload,readMaxPain,_test:{decryptECB,expand,b64}};
})(window);
