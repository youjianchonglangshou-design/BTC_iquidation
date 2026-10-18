/* BTC Liquidity Radar v1.1.1 — STEP1 / STEP2 model transparency only.
   Pure read-only presentation: no changes to probabilities, freeze, fetch, R2 or orders. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fix = (n, d=3) => Number.isFinite(n) ? Number(n).toFixed(d) : '—';
  const sign = (n,d=3) => Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(d) : '—';
  const percent = n => Number.isFinite(n) ? (n*100).toFixed(2)+'%' : '—';
  const names = {
    f_ret_0812:'08–12 K棒漲跌', f_ret_1216:'12–16 K棒漲跌',
    f_ret_0816:'08–16 累計漲跌', f_range_0812:'08–12 最高最低振幅',
    f_range_1216:'12–16 最高最低振幅', f_range_0816:'08–16 全區間振幅',
    f_position_16:'16時在08–16區間的相對位置', f_16_vs_prev:'16時相對前日收盤',
    f_4day_ret:'過去4日漲跌', f_pos_change:'16時相對12時變化',
    f_wick_up:'08–16 上影比例', f_wick_down:'08–16 下影比例',
    f_prior_vol:'08–16 波動率', f_proxy_ratio:'16時上下代理強度比',
    f_proxy_updist:'16時上代理距離', f_proxy_downdist:'16時下代理距離',
    f_proxy_distancebias:'16時上下代理距離差',
    d_hour:'16時之後經過時數', d_16_to_now:'16時到目前價格漲跌',
    d_since_08:'08時到目前價格漲跌', d_position:'目前在今日區間的位置',
    d_position_change:'相對16時區間位置變化',
    d_early_hi_break:'現價相對08–16高點價差',
    d_early_lo_break:'現價相對08–16低點價差',
    d_1h_momentum:'最近約1小時動能', d_4h_momentum:'最近約4小時動能',
    d_rvol_15m:'當日15分鐘報酬波動率', d_range_growth:'相對08–16的全日振幅增量',
    d_16_hi_ext:'16時後最高價相對早盤高點',
    d_16_lo_ext:'早盤低點相對16時後最低價',
    d_near_top:'現價距離全日最高價', d_near_bot:'現價距離全日最低價',
    d_ma1_vs_ma4:'最近4根與16根均價差',
    d_proxy_updist:'當前代理上界距離', d_proxy_downdist:'當前代理下界距離',
    d_proxy_distancebias:'當前代理上下距離差',
    d_proxy_ratio:'當前代理上下強度差',
    d_proxy_upmag:'當前上代理強度', d_proxy_downmag:'當前下代理強度'
  };
  const style = document.createElement('style');
  style.textContent = [
    '#btcStepExplain{box-sizing:border-box;color:#dcecf8;background:#091a2c;border:1px solid #426b84;border-radius:14px;width:min(780px,calc(100vw - 24px));max-height:min(85dvh,800px);padding:0;box-shadow:0 30px 95px #000a}',
    '#btcStepExplain::backdrop{background:rgba(1,8,16,.78)}',
    '#btcStepExplain .step-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#102840;border-bottom:1px solid #34516a;padding:13px 16px}',
    '#btcStepExplain .step-head strong{font-size:16px;color:#f2fcff}',
    '#btcStepExplain .step-close{color:#e6f8ff;border:1px solid #4d6c80;border-radius:7px;background:#18344b;padding:5px 12px}',
    '#btcStepExplain .step-body{padding:15px 18px;overflow:auto;max-height:calc(85dvh - 57px);font-size:13px;line-height:1.68}',
    '#btcStepExplain h3{font-size:14px;color:#7ef0d0;margin:17px 0 8px}',
    '#btcStepExplain p{margin:8px 0}',
    '#btcStepExplain .step-value{font-size:29px;color:#6eefd0;font-weight:800;font-variant-numeric:tabular-nums}',
    '#btcStepExplain .step-subtle{color:#a6bfd1}',
    '#btcStepExplain .step-warning{border-left:3px solid #e9b86b;padding:9px 12px;background:#272433;color:#e9d6ac;border-radius:3px}',
    '#btcStepExplain code{padding:2px 5px;border-radius:4px;background:#1d374a;color:#c9eeff;white-space:normal}',
    '#btcStepExplain table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:12px}',
    '#btcStepExplain th,#btcStepExplain td{padding:7px 8px;border-bottom:1px solid #28435b;text-align:left;vertical-align:top}',
    '#btcStepExplain th{color:#83abc5}',
    '#btcStepExplain td.num{text-align:right;white-space:nowrap}',
    '#btcStepExplain details{margin:9px 0;border:1px solid #28465d;border-radius:8px;padding:7px 9px}',
    '#btcStepExplain summary{cursor:pointer;color:#bde6f6;font-weight:600}',
    '#btcStepExplain a{color:#8ed3ff}',
    '#btcStepExplain .step-tags{display:flex;gap:7px;flex-wrap:wrap}',
    '#btcStepExplain .step-tag{background:#173747;padding:4px 8px;border-radius:5px;font-size:11px;color:#a5cce1}',
    '@media(max-width:550px){#btcStepExplain .step-body{padding:9px 10px;font-size:12px}#btcStepExplain th,#btcStepExplain td{padding:5px 3px;font-size:10px}#btcStepExplain .step-head{padding:9px 11px}}'
  ].join('');
  document.head.appendChild(style);
  const dialog = document.createElement('dialog');
  dialog.id='btcStepExplain';
  dialog.innerHTML='<div class="step-head"><strong id="btcStepTitle">STEP 模型透明度</strong><button type="button" class="step-close" id="btcStepClose">關閉 ×</button></div><div class="step-body" id="btcStepBody"></div>';
  document.body.appendChild(dialog);
  $('btcStepClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click', e=>{if(e.target===dialog)dialog.close();});

  function weights(meta, features){
    if(!meta || !features) return null;
    const entries=[];
    let z=meta.intercept;
    for(let i=0;i<meta.feature_columns.length;i++){
      const name=meta.feature_columns[i], x=Number(features[name]),scale=Number(meta.scaler_scale[i]);
      if(!Number.isFinite(x)||!(scale>0))return null;
      const contribution=meta.weights[i]*(x-meta.scaler_mean[i])/scale;
      z+=contribution;
      entries.push({name,label:names[name]||name,x,contribution});
    }
    const c=meta.calibration.slope*z+meta.calibration.intercept;
    return {z,c,up:1/(1+Math.exp(-Math.max(-30,Math.min(30,c)))),entries};
  }
  function table(list, extended){
    if(!list?.length) return '<p class="step-subtle">特徵資料尚未就緒。</p>';
    const head=extended?'<th>16:00</th><th>當前</th><th>Δ log-odds</th>':'<th>特徵值</th><th>log-odds 貢獻</th>';
    const body=list.map(r=>'<tr><td>'+esc(r.label)+'<div class="step-subtle">'+esc(r.name)+'</div></td>'+
      (extended?'<td class="num">'+fix(r.baseX,3)+'</td><td class="num">'+fix(r.nowX,3)+'</td><td class="num">'+sign(r.delta,4)+'</td>':
        '<td class="num">'+fix(r.x,3)+'</td><td class="num">'+sign(r.contribution,4)+'</td>')+'</tr>').join('');
    return '<table><thead><tr><th>模型特徵</th>'+head+'</tr></thead><tbody>'+body+'</tbody></table>';
  }
  function dataNow(){
    let p=null;
    try{p=window.BTC_RADAR_TEST?.getState?.()?.probability ?? null;}catch(_){}
    const meta=window.BTCLiqModel?.metadata;
    return {p,meta,base:weights(meta,p?.baseFeatures),now:weights(meta,p?.features)};
  }
  function topAbs(rows,field,n){return [...rows].sort((a,b)=>Math.abs(b[field])-Math.abs(a[field])).slice(0,n);}
  function render(stage){
    const data=dataNow(),p=data.p,meta=data.meta,b=data.base,n=data.now;
    $('btcStepTitle').textContent=stage===1?'STEP 01｜08～16 基礎機率：實際計算明細':'STEP 02｜16～20 機率差：實際計算明細';
    const common = '<p class="step-warning">目前載入的是「歷史OHLC代理清算界」訓練權重，不是直接用九年 CoinGlass 真實清算界訓練。下方是現行程式的可追溯計算明細，並非已驗證的九年市場規律。</p>'+
      '<p class="step-subtle">權重模型標示訓練 2017/09～2023/12、2024 校準、2025～2026 測試，但本 GitHub 版本沒有附上可重現的九年訓練資料與逐年回測表，不能在此聲稱其歷史勝率已被查證。</p>';
    const formula='<h3>原始計算公式（兩個 STEP 都使用）</h3>'+
      '<p><code>z = intercept + Σ[權重 × (特徵值 − 訓練均值) ÷ 訓練標準差]</code></p>'+
      '<p><code>P = sigmoid(1.199919859 × z − 0.041091546)</code></p>'+
      '<p>共 39 個特徵，含 <b>17 個 f_ 基礎特徵與 22 個 d_ 動態特徵</b>。STEP1 在16:00也會帶入當時 d_ 特徵的值，不是單靠兩根4H紅綠組合的頻率表。權重貢獻的單位是 log-odds，不是直接相加的百分點。</p>';
    const reference='<h3>研究借鑑：mindoozer／liquidation-map</h3>'+
      '<p>值得另行測試：跨交易所 OI 增量／成交量分布、各槓桿級別不同時間衰減、已被價格掃過的倉位淘汰、與相同距離的自然觸及機率比較。</p>'+
      '<p><b>不能直接將對方 OI 推估數值塞進舊39特徵模型後照用原權重。</b> 特徵分布改變後，必須重新訓練、校準及做樣本外回測。</p>'+
      '<p><a href="https://github.com/mindoozer/liquidation-map" target="_blank" rel="noopener noreferrer">查看參考研究原始碼 ↗</a></p>';
    let body = common+formula;
    if(stage===1){
      body+='<h3>STEP1 的定義</h3><p><code>P1 = 模型在16:00完整收線後的校準上掃機率（未加日線HA）</code>。每天08～12、12～16兩個4H所構成的振幅、收盤位置、K棒方向、代理上下界、歷史波動率等都在39個特徵中。</p>';
      body+='<div class="step-value">'+percent(b?.up??p?.baseUp)+'</div>';
      if(b){
        body+='<p>16:00 標準化線性分數 z = <b>'+fix(b.z,5)+'</b>；校準後 logit = <b>'+fix(b.c,5)+'</b>。</p>';
        body+='<h3>16:00 當時最主要的模型貢獻（絕對值前8名）</h3>'+table(topAbs(b.entries,'contribution',8),false);
        body+='<details><summary>展開全部 39 個特徵與各自貢獻</summary>'+table(b.entries,false)+'</details>';
      }else{
        body+='<p class="step-warning">目前沒有已保存的16:00完整特徵（可能尚未到16:00，或歷史K線不足），不能虛構此時點的分解數值。</p>';
      }
      body+='<h3>係數揭露出的待驗證假說</h3>'+
        '<p><b>假說A：整段振幅結構與兩段振幅分布有不同的訊號。</b> 模型標準化係數 f_range_0816 = +0.3365，但 f_range_0812 = −0.2521、f_range_1216 = −0.2219。三者彼此高度相關，這只是條件迴歸方向，不能單看係數宣稱「振幅大就會上掃」。</p>'+
        '<p><b>假說B：08～12、12～16 的漲跌路徑可能具有反向訊號。</b> f_ret_0812 = −0.1229，f_ret_1216 = −0.1513；必須依行情狀態與代理界距離分層，比較實際樣本數和勝率。</p>';
    }else{
      const delta=(n&&b)?(n.up-b.up)*100:(p&&Number.isFinite(p.modelUp)&&Number.isFinite(p.baseUp)?(p.modelUp-p.baseUp)*100:NaN);
      body+='<h3>STEP2 的定義</h3><p><code>P2 = P(當前) − P(16:00)</code>，顯示的是<b>百分點變化</b>，不是另一個獨立勝率模型。</p>';
      body+='<div class="step-value">'+(Number.isFinite(delta)?sign(delta,2)+' 個百分點':'—')+'</div>';
      body+='<p>16:00 原始機率 <b>'+percent(b?.up??p?.baseUp)+'</b> → 當前模型機率 <b>'+percent(n?.up??p?.modelUp)+'</b>（皆未含HA）。</p>';
      if(b&&n){
        const shifts=n.entries.map((x,i)=>({...x,baseX:b.entries[i].x,nowX:x.x,delta:x.contribution-b.entries[i].contribution}));
        body+='<p>16:00→當前的標準化線性分數變化 Δz = <b>'+sign(n.z-b.z,5)+'</b>；校準後 Δlogit = <b>'+sign(n.c-b.c,5)+'</b>。每個特徵的變化加總形成Δlogit，經過 sigmoid 才得到上方百分點變化。</p>';
        body+='<h3>導致機率變化最大的特徵（絕對值前8名）</h3>'+table(topAbs(shifts,'delta',8),true);
        body+='<details><summary>展開全部 39 個特徵的前後差異</summary>'+table(shifts,true)+'</details>';
      }else{
        body+='<p class="step-warning">尚未取得完整的16:00基準及當前39特徵；無法提供真實貢獻排行。</p>';
      }
      body+='<h3>STEP2 可研究的市場結構</h3><p>除了當前動能、16時後擴張幅度與區間位置，程式會重新估算上下代理清算帶的距離與相對強度。這些都是<b>模型輸入項</b>，並不表示它們已獨立通過九年樣本外驗證。</p>';
    }
    body+='<h3>機率輸出與真實 CoinGlass 上下界的差別</h3>'+
      '<p>最終方向 = <code>clip(模型P + HA黃/紫固定 ±4.5 個百分點)</code>。上下界若切換到 CoinGlass，<b>顯示的目標價改變，但這組39特徵模型的權重沒有同步重訓</b>。因此不得用代理界歷史勝率保證 CoinGlass 上下界的勝率。</p>'+
      '<p>要像 S0.5／S1／S2／S3 一樣形成「已證實規律」，每條規則至少需要公開：條件、樣本數、同距離基準命中率、每年命中率、無觸及率、同一根K雙觸及處理與獨立樣本外結果。</p>'+reference;
    $('btcStepBody').innerHTML=body;
  }
  let activeStage=1;
  document.addEventListener('click',e=>{
    const target=e.target?.closest?.('.context-capsules .metric-capsule');
    if(!target)return;
    const id=target.querySelector('b')?.id;
    if(id!=='basePill'&&id!=='deltaPill')return;
    // Intercept the pre-existing generic popup so STEP1/2 receive unique explanations.
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    activeStage=id==='basePill'?1:2;
    render(activeStage);
    if(!dialog.open)dialog.showModal();
  },true);
  for(const id of ['basePill','deltaPill']){
    const el=$(id);
    if(el) new MutationObserver(()=>{if(dialog.open)render(activeStage);}).observe(el,{childList:true,characterData:true,subtree:true});
  }
  window.BTCLiqStepResearch={render,weights,names};
})();