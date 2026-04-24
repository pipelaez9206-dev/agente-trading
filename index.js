// ════════════════════════════════════════════════════════
//  AGENTE TRADING — Railway 24/7
//  Señales a Telegram con filtros mejorados
// ════════════════════════════════════════════════════════
const fetch = require('node-fetch');

// ── CONFIG ───────────────────────────────────────────────
const POLY_KEY    = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN    = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_GROUP    = '-5187081924';
const TG_FELIPE   = '6773568382';
const INTERVAL    = 5;
const MIN_SCORE   = 70;
const BLOCK_HOURS = 8;

// ── WATCHLIST ────────────────────────────────────────────
const WATCHLIST = [
  {sym:'SOXL'},{sym:'MU'},  {sym:'AMD'}, {sym:'NFLX'},
  {sym:'TALO'},{sym:'UUUU'},{sym:'OKLO'},{sym:'SMR'},
  {sym:'SOUN'},{sym:'IONQ'},{sym:'MARA'},{sym:'RIOT'},
  {sym:'HOOD'},{sym:'SOFI'},{sym:'PLTR'},{sym:'TSLA'},
  {sym:'ACMR'},{sym:'WOLF'},{sym:'QUBT'},{sym:'CLSK'},
];

// ── ESTADO ───────────────────────────────────────────────
let scanCount     = 0;
let sigCount      = 0;
let spyStatus     = 'UNKNOWN';
let spyScore      = 0;
let marketOK      = true;
let alerted       = {};
let earningsCache = {};
let startTime     = Date.now();

// ════════════════════════════════════════════════════════
// TIEMPO
// ════════════════════════════════════════════════════════
function getET() {
  return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
}
function getSession() {
  const et   = getET();
  const d    = et.getDay();
  const mins = et.getHours()*60+et.getMinutes();
  const wk   = d>=1&&d<=5;
  return {
    isWeekend:  !wk,
    isPre:      wk&&mins>=240&&mins<570,
    isOpen:     wk&&mins>=570&&mins<960,
    isPost:     wk&&mins>=960&&mins<1200,
    isEarlyPre: wk&&mins>=240&&mins<480,
    mins,
  };
}
function log(msg) {
  const et   = getET();
  const ts   = et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const date = et.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'});
  console.log(`[${date} ${ts} ET] ${msg}`);
}

// ════════════════════════════════════════════════════════
// TELEGRAM
// ════════════════════════════════════════════════════════
async function sendTG(chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text,parse_mode:'Markdown'}),
    });
    const j = await res.json();
    if(!j.ok) log(`TG error: ${j.description}`);
    return j.ok;
  } catch(e) { log(`TG excepción: ${e.message}`); return false; }
}

// ════════════════════════════════════════════════════════
// POLYGON
// ════════════════════════════════════════════════════════
async function fetchBars(sym, mult=1, span='hour', days=22) {
  const to   = new Date();
  const from = new Date(to); from.setDate(from.getDate()-days);
  const toS   = to.toISOString().split('T')[0];
  const fromS = from.toISOString().split('T')[0];
  const url   = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/${mult}/${span}/${fromS}/${toS}?adjusted=true&sort=asc&limit=200&apiKey=${POLY_KEY}`;
  const res   = await fetch(url);
  const j     = await res.json();
  return j.results||[];
}

// ════════════════════════════════════════════════════════
// INDICADORES
// ════════════════════════════════════════════════════════
const sma = (d,n) => (!d||d.length<n)?null:d.slice(-n).reduce((a,b)=>a+b,0)/n;
function ema(d,n) {
  if(!d||d.length<n) return null;
  const k=2/(n+1); let v=d.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for(let i=n;i<d.length;i++) v=d[i]*k+v*(1-k); return v;
}
function rsiCalc(d,n=14) {
  if(!d||d.length<n+1) return null;
  const sl=d.slice(-(n+2)); let g=0,l=0;
  for(let i=1;i<=n;i++){const x=sl[i]-sl[i-1];if(x>=0)g+=x;else l+=Math.abs(x);}
  let ag=g/n,al=l/n;
  if(sl.length>n+1){const x=sl[n+1]-sl[n];if(x>=0){ag=(ag*(n-1)+x)/n;al=al*(n-1)/n;}else{ag=ag*(n-1)/n;al=(al*(n-1)+Math.abs(x))/n;}}
  return al===0?100:+(100-100/(1+ag/al)).toFixed(1);
}
function hullMA(d,n=16) {
  if(!d||d.length<n*2) return null;
  const h=Math.round(n/2),sq=Math.round(Math.sqrt(n));
  const raw=[];
  for(let i=n-1;i<d.length;i++){
    const sl=d.slice(0,i+1);
    const w1=ema(sl,h),w2=ema(sl,n);
    if(w1&&w2) raw.push(2*w1-w2);
  }
  return ema(raw,sq);
}
function macdCalc(d) {
  if(!d||d.length<35) return null;
  const e12=ema(d,12),e26=ema(d,26);
  if(!e12||!e26) return null;
  const hist=[];
  for(let i=26;i<=d.length;i++){const sl=d.slice(0,i);const a=ema(sl,12),b=ema(sl,26);if(a&&b)hist.push(a-b);}
  if(hist.length<9) return null;
  const sig=ema(hist,9);
  if(!sig) return null;
  const macdLine=e12-e26;
  return{macd:+macdLine.toFixed(4),signal:+sig.toFixed(4),hist:+(macdLine-sig).toFixed(4),bullish:macdLine>sig};
}
function atrCalc(bars,n=14) {
  if(!bars||bars.length<n+1) return null;
  const sl=bars.slice(-(n+1)); let s=0;
  for(let i=1;i<sl.length;i++) s+=Math.abs(sl[i].c-sl[i-1].c);
  return s/n;
}
function getSR(bars,price) {
  if(!bars||bars.length<20) return{support:null,resistance:null,nearResistance:false};
  const sl=bars.slice(-60);
  const pH=[],pL=[];
  for(let i=2;i<sl.length-2;i++){
    if(sl[i].h>sl[i-1].h&&sl[i].h>sl[i-2].h&&sl[i].h>sl[i+1].h&&sl[i].h>sl[i+2].h) pH.push(sl[i].h);
    if(sl[i].l<sl[i-1].l&&sl[i].l<sl[i-2].l&&sl[i].l<sl[i+1].l&&sl[i].l<sl[i+2].l) pL.push(sl[i].l);
  }
  const res=pH.filter(v=>v>price).sort((a,b)=>a-b)[0]||null;
  const sup=pL.filter(v=>v<price).sort((a,b)=>b-a)[0]||null;
  return{support:sup,resistance:res,nearResistance:res&&(res-price)/price<0.015};
}

// ════════════════════════════════════════════════════════
// FILTROS MEJORADOS
// ════════════════════════════════════════════════════════
function brkVol(bars){
  if(!bars||bars.length<4) return{ok:true,ratio:null};
  const lv=bars[bars.length-1].v;
  const avg=(bars[bars.length-2].v+bars[bars.length-3].v+bars[bars.length-4].v)/3;
  if(!avg) return{ok:true,ratio:null};
  const r=lv/avg; return{ok:r>=1.3,ratio:+r.toFixed(2)};
}
function idMove(bars,price){
  if(!bars||bars.length<8) return{ok:true,pct:null};
  const open=bars[Math.max(0,bars.length-8)].c;
  if(!open) return{ok:true,pct:null};
  const p=(price-open)/open*100; return{ok:p<=3.5,pct:+p.toFixed(2)};
}
function sectExt(bars,price){
  if(!bars||bars.length<10) return{ok:true,g:null};
  const ref=bars[bars.length-10].c;
  if(!ref) return{ok:true,g:null};
  const g=(price-ref)/ref*100; return{ok:g<=15,g:+g.toFixed(2)};
}
function idRev(bars,price){
  if(!bars||bars.length<4) return{ok:true,pct:null};
  const dh=Math.max(...bars.slice(-8).map(b=>b.h));
  if(!dh) return{ok:true,pct:null};
  const p=(dh-price)/dh*100; return{ok:p<=1.5,pct:+p.toFixed(2)};
}
function twoC(bars,e16v){
  if(!bars||bars.length<3||!e16v) return{ok:false,count:0};
  const cnt=[bars[bars.length-1].c,bars[bars.length-2].c,bars[bars.length-3].c].filter(v=>v>e16v).length;
  return{ok:cnt>=2,count:cnt};
}

// ════════════════════════════════════════════════════════
// EARNINGS
// ════════════════════════════════════════════════════════
async function checkEarnings(sym) {
  const now=Date.now();
  if(earningsCache[sym]&&now-earningsCache[sym].ts<3600000) return earningsCache[sym].d;
  try {
    const url=`https://query1.finance.yahoo.com/v11/finance/quoteSummary/${sym}?modules=calendarEvents`;
    const res=await fetch(url); const j=await res.json();
    const ev=j?.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
    if(!ev||!ev.earningsDate?.length){earningsCache[sym]={ts:now,d:null};return null;}
    const ts=ev.earningsDate[0].raw*1000;
    const days=Math.round((ts-now)/86400000);
    const d={daysAway:days,dateStr:new Date(ts).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}),warning:days>=0&&days<=7,danger:days>=0&&days<=2};
    earningsCache[sym]={ts:now,d}; return d;
  } catch(e){earningsCache[sym]={ts:now,d:null};return null;}
}

// ════════════════════════════════════════════════════════
// SPY — ESTADO DEL MERCADO
// ════════════════════════════════════════════════════════
async function checkSPY() {
  try {
    const bars=await fetchBars('SPY',1,'day',60);
    if(!bars||bars.length<50) return;
    const closes=bars.map(b=>b.c);
    const ma20=sma(closes,20),ma50=sma(closes,50),rsi=rsiCalc(closes,14);
    const last=closes[closes.length-1],prev5=closes[closes.length-6]??last;
    const chg5=(last-prev5)/prev5*100;
    if(last>ma20&&ma20>ma50&&rsi>45&&chg5>-2.5){spyStatus='BULL';marketOK=true;}
    else if(last<ma20&&rsi<50||chg5<-2.5){spyStatus='BEAR';marketOK=false;}
    else{spyStatus='NEUTRAL';marketOK=true;}
    spyScore=spyStatus==='BULL'?100:spyStatus==='BEAR'?0:50;
    log(`📊 SPY $${last.toFixed(2)} ${spyStatus} | MA20:$${ma20?.toFixed(2)} RSI:${rsi} 5d:${chg5.toFixed(1)}%`);
  } catch(e){log(`SPY err: ${e.message}`);}
}

// ════════════════════════════════════════════════════════
// ANÁLISIS
// ════════════════════════════════════════════════════════
async function analyze(sym,bars) {
  if(!bars||bars.length<40) return null;
  const closes=bars.map(b=>b.c);
  const price=closes[closes.length-1],prev=closes[closes.length-2]??price;
  const vol=bars[bars.length-1].v,avgVol=bars.slice(-20).reduce((a,b)=>a+b.v,0)/20;
  const atrV=atrCalc(bars,14)||price*0.004;
  const hull=hullMA(closes,16),hullP=hullMA(closes.slice(0,-1),16);
  const e9=ema(closes,9),e16=ema(closes,16),ma20=sma(closes,20),ma40=sma(closes,40);
  const rsi=rsiCalc(closes,14),macdR=macdCalc(closes),sr=getSR(bars,price);
  if(!hull||!e9||!e16||!ma20) return null;
  const hullBull=hull>(hullP||hull-1);
  const stackBull=e9>e16&&e16>ma20;
  const d16=(price-e16)/e16*100;
  const chg=(price-prev)/prev*100;
  const bv=brkVol(bars),im=idMove(bars,price),se=sectExt(bars,price);
  const ir=idRev(bars,price),tc=twoC(bars,e16);
  let score=0;
  if(hullBull)              score+=30;
  if(stackBull)             score+=15;
  if(price>e16&&d16>=0.3)   score+=10;
  if(tc.ok)                 score+=10;
  if(rsi>=38&&rsi<=65)      score+=10;
  if(vol>=avgVol*1.15)      score+=8;
  if(bv.ok)                 score+=7;
  if(macdR?.bullish)        score+=5;
  if(price>ma20)            score+=3;
  if(ma40&&ma20>ma40)       score+=2;
  const keysOk=hullBull&&stackBull&&price>e16&&d16>=0.3&&tc.ok&&rsi>=38&&rsi<=65&&vol>=avgVol*1.15&&bv.ok&&im.ok&&se.ok&&ir.ok&&!sr.nearResistance;
  const isBuy=keysOk&&score>=MIN_SCORE;
  const volDay=im.pct?Math.abs(im.pct):0;
  const stopMult=(spyStatus==='NEUTRAL'||volDay>2)?0.7:1.0;
  return{
    sym,price,prev,vol,avgVol,score,isBuy,
    hull,hullBull,e9:+e9.toFixed(2),e16:+e16.toFixed(2),
    ma20:+ma20.toFixed(2),ma40:ma40?+ma40.toFixed(2):null,
    rsi,macd:macdR,sr,bv,im,se,ir,tc,atrV:+atrV.toFixed(3),stopMult,
    t1:+(price+atrV*2.5).toFixed(2),t2:+(price+atrV*3.5).toFixed(2),
    sl:+(price-atrV*stopMult).toFixed(2),
    entryConv:+e16.toFixed(2),
    targetConv:+(e16+atrV*3.0).toFixed(2),
    stopConv:+(e16-atrV*stopMult*0.8).toFixed(2),
  };
}

// ════════════════════════════════════════════════════════
// ENVIAR SEÑAL
// ════════════════════════════════════════════════════════
async function sendSignal(sig) {
  const hora=getET().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
  const sess=getSession();
  const sesLbl=sess.isPre?'⏰ PRE-MARKET':sess.isOpen?'📊 MERCADO ABIERTO':sess.isPost?'🌆 POST-MARKET':'';
  const stopAdj=sig.stopMult<1?' ⚡ajustado':'';
  const rsiIcon=sig.rsi>=40&&sig.rsi<=65?'✅':sig.rsi>65?'⚠️':'🔵';
  const macdTxt=sig.macd?(sig.macd.bullish?'▲ ALCISTA':'▼ BAJISTA'):'sin datos';
  const chgPct=((sig.price-sig.prev)/sig.prev*100).toFixed(2);

  const msg=
    `🟢 *SEÑAL DE COMPRA — ${sig.sym}*\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`💰 Precio: *$${sig.price}* ${sig.price>sig.prev?'▲':'▼'} ${chgPct}%\n`
   +`📊 Score: *${sig.score}/100*\n`
   +`${sesLbl}\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`⚡ *ENTRADA AGRESIVA*\n`
   +`   Entrada: $${sig.price}\n`
   +`   Target1: $${sig.t1} (+${((sig.t1-sig.price)/sig.price*100).toFixed(1)}%)\n`
   +`   Target2: $${sig.t2} (+${((sig.t2-sig.price)/sig.price*100).toFixed(1)}%)\n`
   +`   Stop🛑: $${sig.sl} (-${((sig.price-sig.sl)/sig.price*100).toFixed(1)}%)${stopAdj}\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`⏳ *ENTRADA CONSERVADORA* (espera EMA16)\n`
   +`   Entrada: $${sig.entryConv}\n`
   +`   Target: $${sig.targetConv}\n`
   +`   Stop🛑: $${sig.stopConv}${stopAdj}\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`📈 *Indicadores 1H*\n`
   +`   Hull16: ${sig.hullBull?'▲ ALCISTA':'▼ BAJISTA'}\n`
   +`   EMA9: $${sig.e9} | EMA16: $${sig.e16}\n`
   +`   MA20: $${sig.ma20}${sig.ma40?' | MA40: $'+sig.ma40:''}\n`
   +`   RSI: ${rsiIcon} ${sig.rsi}\n`
   +`   MACD: ${macdTxt}\n`
   +`   Vol: ${sig.vol>=sig.avgVol*1.15?'✅':'⚠️'} ${sig.avgVol>0?(sig.vol/sig.avgVol*100).toFixed(0)+'%':'—'}\n`
   +`   Vol ruptura: ${sig.bv.ratio??'—'}x | 2 velas: ${sig.tc.ok?'✅':'✗'}\n`
   +`   Mov.sesión: ${sig.im.pct??'—'}% | SPY: ${spyStatus}\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`⚠️ Confirma en TradingView antes de entrar\n`
   +`⏰ ${hora} ET`;

  const ok=await sendTG(TG_GROUP,msg);
  if(ok) log(`✅ TG: ${sig.sym} $${sig.price} Score:${sig.score}`);
  return ok;
}

// ════════════════════════════════════════════════════════
// RESUMEN DIARIO
// ════════════════════════════════════════════════════════
async function sendDailySummary() {
  const up=Math.round((Date.now()-startTime)/60000);
  const msg=
    `📋 *RESUMEN DEL DÍA*\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`🤖 Activo: ${up<60?up+'m':Math.floor(up/60)+'h'+up%60+'m'}\n`
   +`🔍 Escaneos: ${scanCount}\n`
   +`📈 Señales: ${sigCount}\n`
   +`🌎 SPY: ${spyStatus}\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`Hasta mañana 👋`;
  await sendTG(TG_GROUP,msg);
}

// ════════════════════════════════════════════════════════
// SCAN PRINCIPAL
// ════════════════════════════════════════════════════════
async function runScan() {
  scanCount++;
  const sess=getSession();

  if(sess.isWeekend)  {log(`=== #${scanCount} WEEKEND ===`); return;}
  if(sess.isEarlyPre) {log(`=== #${scanCount} PRE TEMPRANO <8AM ===`); return;}
  if(!sess.isPre&&!sess.isOpen&&!sess.isPost){log(`=== #${scanCount} FUERA HORARIO ===`); return;}

  const lbl=sess.isPre?'PRE':sess.isOpen?'OPEN':'POST';
  log(`=== #${scanCount} ${lbl} · SPY:${spyStatus} ===`);

  if(scanCount%3===1) await checkSPY();
  if(spyStatus==='BEAR'){log('🔴 SPY BEAR — bloqueado');return;}

  const minScore=(sess.isPre||sess.isPost)?MIN_SCORE+10:MIN_SCORE;
  let found=0;

  for(let i=0;i<WATCHLIST.length;i+=3){
    const batch=WATCHLIST.slice(i,i+3);
    const results=await Promise.all(batch.map(async w=>{
      try{
        const bars=await fetchBars(w.sym,1,'hour',22);
        if(bars?.length>=30) return analyze(w.sym,bars);
      }catch(e){log(`${w.sym} err: ${e.message}`);}
      return null;
    }));

    for(const sig of results){
      if(!sig) continue;
      // Earnings
      const earn=await checkEarnings(sig.sym);
      if(earn?.danger){log(`⚠️ ${sig.sym} bloqueado — Earnings ${earn.daysAway}d`);continue;}
      if(earn?.warning) log(`⚠️ ${sig.sym} — Earnings en ${earn.daysAway}d (${earn.dateStr})`);
      if(!sig.isBuy||sig.score<minScore) continue;

      const key=`${sig.sym}_${new Date().toISOString().split('T')[0]}`;
      if(alerted[key]) continue;
      alerted[key]=true;
      setTimeout(()=>delete alerted[key],BLOCK_HOURS*3600000);

      log(`🟢 ${sig.sym} $${sig.price} Score:${sig.score}`);
      const ok=await sendSignal(sig);
      if(ok){sigCount++;found++;}
    }
    await new Promise(r=>setTimeout(r,500));
  }

  if(found===0) log(`Sin señales · ${WATCHLIST.length} activos`);

  // Resumen al cierre
  const et=getET(),m=et.getHours()*60+et.getMinutes();
  if(sess.isOpen&&m>=955&&m<=965) await sendDailySummary();
}

// ════════════════════════════════════════════════════════
// INICIO
// ════════════════════════════════════════════════════════
async function main() {
  log('🚀 Agente Trading v2 iniciando...');
  log(`📊 ${WATCHLIST.length} activos | cada ${INTERVAL}min | score≥${MIN_SCORE}`);

  await sendTG(TG_GROUP,
    `🤖 *Agente Monitor v2 Iniciado*\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`✅ Railway 24/7\n`
   +`📊 ${WATCHLIST.length} activos · cada ${INTERVAL}min\n`
   +`🎯 Score ≥${MIN_SCORE}\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`🆕 Filtros nuevos:\n`
   +`✅ Racha >15% bloqueada\n`
   +`✅ Reversión >1.5% bloqueada\n`
   +`✅ Vol ruptura 1.3x requerido\n`
   +`✅ 2 velas consecutivas EMA16\n`
   +`✅ MACD confirmación\n`
   +`✅ Earnings bloqueados 2d antes\n`
   +`✅ Stop dinámico días volátiles\n`
   +`✅ SPY BEAR bloquea todo\n`
   +`━━━━━━━━━━━━━━━━━━━━\n`
   +`@Buyscanertradyng_bot`
  );

  await checkSPY();
  await runScan();
  setInterval(async()=>{try{await runScan();}catch(e){log(`Error scan: ${e.message}`);}},INTERVAL*60*1000);
}

main().catch(e=>{console.error('Fatal:',e);process.exit(1);});
