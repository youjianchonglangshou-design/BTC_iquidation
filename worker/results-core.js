// Pure testable logic for the one-file R2 ledger; no exchange/API calls here.
export const asDay=ms=>new Date(ms).toISOString().slice(0,10);
const goodDate=s=>/^20\d\d-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(s));
export function validateCoinGlass(x){
 if(x.source!=='CoinGlass'||x.range!=='24h'||!(Number.isFinite(x.upper)&&Number.isFinite(x.lower)&&x.upper>x.lower&&x.lower>0&&x.upper<20000000))throw Error('CoinGlass 24H invalid upper/lower');
 return x;
}
export function updateLedger(old,row,phase){
 if(!goodDate(row.day))throw Error('Invalid day');
 const base=old&&Array.isArray(old.records)?old:{schemaVersion:'1.0.0',symbol:'BTCUSDT',timezone:'Asia/Taipei',records:[]};
 const records=base.records.map(r=>({...r}));
 const pos=records.findIndex(x=>x.day===row.day);
 if(phase==='freeze'){
  if(pos<0)records.push({...row}); // Frozen first-write wins; prevents live quote rewrites.
 }else if(phase==='settle'){
  if(pos<0)throw Error('Settlement without prior freeze');
  if(!records[pos].settledAt){
   const {result,correct,firstHitAt,settledAt,high,low,hitUpperAt,hitLowerAt}=row;
   records[pos]={...records[pos],result,correct,firstHitAt,settledAt,high,low,hitUpperAt,hitLowerAt,
    status:records[pos].status==='ERROR'?'ERROR':'SETTLED'};
  }
 }else throw Error('Unknown phase');
 records.sort((a,b)=>a.day.localeCompare(b.day));
 return {...base,records,latestDay:records.at(-1)?.day||null,updatedAt:new Date().toISOString(),schemaVersion:'1.0.0'};
}
export function settleCandles(record,bars){
 const start=Date.parse(record.day+'T12:00:00Z'),end=start+12*3600000;
 const rows=bars.filter(b=>b.t>=start&&b.t<end).sort((a,b)=>a.t-b.t);
 if(rows.length!==48||rows.some((b,i)=>b.t!==start+i*900000))throw Error('Need 48 consecutive closed 15M candles');
 const upper=Number(record.upper),lower=Number(record.lower);
 if(!(upper>lower&&lower>0))throw Error('Invalid frozen bounds');
 let iu=-1,il=-1,high=-Infinity,low=Infinity;
 for(let i=0;i<rows.length;i++){
  if(!Number.isFinite(rows[i].h)||!Number.isFinite(rows[i].l))throw Error('Invalid OHLC');
  high=Math.max(high,rows[i].h);low=Math.min(low,rows[i].l);
  if(iu<0&&rows[i].h>=upper)iu=i;
  if(il<0&&rows[i].l<=lower)il=i;
 }
 const result=iu<0&&il<0?'NONE':iu>=0&&(il<0||iu<il)?'UP_FIRST':il>=0&&(iu<0||il<iu)?'DOWN_FIRST':'AMBIGUOUS';
 const hitAt=index=>index<0?null:new Date(start+index*900000+28800000).toISOString().replace('Z','+08:00');
 const first=iu<0?il:il<0?iu:Math.min(iu,il);
 const prediction=record.prediction;
 const correct=result==='UP_FIRST'&&prediction==='UP_FIRST'?true:
  result==='DOWN_FIRST'&&prediction==='DOWN_FIRST'?true:
  ['UP_FIRST','DOWN_FIRST'].includes(result)&&['UP_FIRST','DOWN_FIRST'].includes(prediction)?false:null;
 return {result,correct,firstHitAt:hitAt(first),hitUpperAt:hitAt(iu),hitLowerAt:hitAt(il),high,low};
}
export function outcomeSummary(records){
 const resolved=records.filter(r=>typeof r.correct==='boolean');
 const won=resolved.filter(r=>r.correct).length;
 return {won,total:resolved.length,accuracy:resolved.length?100*won/resolved.length:null};
}
