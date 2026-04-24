// ════════════════════════════════════════════════════════
//  AGENTE TRADING — Railway 24/7
//  v3 — sin errores Telegram, SPY corregido
// ════════════════════════════════════════════════════════
const fetch = require('node-fetch');

const POLY_KEY    = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN    = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_GROUP    = '-1003987823131';
const TG_FELIPE   = '6773568382';
const INTERVAL    = 5;
const MIN_SCORE   = 70;
const BLOCK_HOURS = 8;

const WATCHLIST = [
  {sym:'SOXL'},{sym:'MU'},  {sym:'AMD'}, {sym:'NFLX'},
  {sym:'TALO'},{sym:'UUUU'},{sym:'OKLO'},{sym:'SMR'},
  {sym:'SOUN'},{sym:'IONQ'},{sym:'MARA'},{sym:'RIOT'},
  {sym:'HOOD'},{sym:'SOFI'},{sym:'PLTR'},{sym:'TSLA'},
  {sym:'ACMR'},{sym:'WOLF'},{sym:'QUBT'},{sym:'CLSK'},
];

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
  const ts   = et.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const date = et.toLocaleDateString('en-US',{day:'2-digit',month:'2-digit'});
  console.log(`[${date} ${ts} ET] ${msg}`);
}

// ════════════════════════════════════════════════════════
// TELEGRAM — SIN parse_mode para evitar errores de markdown
// ════════════════════════════════════════════════════════
async function sendTG(chatId, text) {
  try {
    const res = await fetch('https://api.telegram.org/bot'+TG_TOKEN+'/sendMessage',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId, text:text}),
    });
    const j = await res.json();
    if(!j.ok) log('TG error: '+j.description);
    return j.ok;
  } catch(e) { log('TG excepcion: '+e.message); return false; }
}

// ════════════════════════════════════════════════════════
// POLYGON
// ════════════════════════════════════════════════════════
async function fetchBars(sym, mult, span, days) {
  mult = mult||1; span = span||'hour'; days = days||22;
  const to   = new Date();
  const from = new Date(to); from.setDate(from.getDate()-days);
  const toS   = to.toISOString().split('T')[0];
  const fromS = from.toISOString().split('T')[0];
  const url   = 'https://api.polygon.io/v2/aggs/ticker/'+sym+'/range/'+mult+'/'+span+'/'+fromS+'/'+toS+'?adjusted=true&sort=asc&limit=200&apiKey='+POLY_KEY;
  const res   = await fetch(url);
  const j     = await res.json();
  if(j.resultsCount===0||!j.results) return [];
  return j.results;
}

// ════════════════════════════════════════════════════════
// INDICADORES
// ════════════════════════════════════════════════════════
function sma(d,n) {
  if(!d||d.length<n) return null;
  return d.slice(-n).reduce(function(a,b){return a+b;},0)/n;
}
function ema(d,n) {
  if(!d||d.length<n) return null;
  var k=2/(n+1); var v=d.slice(0,n).reduce(function(a,b){return a+b;},0)/n;
  for(var i=n;i<d.length;i++) v=d[i]*k+v*(1-k); return v;
}
function rsiCalc(d,n) {
  n=n||14;
  if(!d||d.length<n+1) return null;
  var sl=d.slice(-(n+2)); var g=0,l=0;
  for(var i=1;i<=n;i++){var x=sl[i]-sl[i-1];if(x>=0)g+=x;else l+=Math.abs(x);}
  var ag=g/n,al=l/n;
  if(sl.length>n+1){var x=sl[n+1]-sl[n];if(x>=0){ag=(ag*(n-1)+x)/n;al=al*(n-1)/n;}else{ag=ag*(n-1)/n;al=(al*(n-1)+Math.abs(x))/n;}}
  return al===0?100:+(100-100/(1+ag/al)).toFixed(1);
}
function hullMA(d,n) {
  n=n||16;
  if(!d||d.length<n*2) return null;
  var h=Math.round(n/2),sq=Math.round(Math.sqrt(n));
  var raw=[];
  for(var i=n-1;i<d.length;i++){
    var sl=d.slice(0,i+1);
    var w1=ema(sl,h),w2=ema(sl,n);
    if(w1&&w2) raw.push(2*w1-w2);
  }
  return ema(raw,sq);
}
function macdCalc(d) {
  if(!d||d.length<35) return null;
  var e12=ema(d,12),e26=ema(d,26);
  if(!e12||!e26) return null;
  var hist=[];
  for(var i=26;i<=d.length;i++){
    var sl=d.slice(0,i);var a=ema(sl,12),b=ema(sl,26);
    if(a&&b) hist.push(a-b);
  }
  if(hist.length<9) return null;
  var sig=ema(hist,9);
  if(!sig) return null;
  var ml=e12-e26;
  return{macd:+ml.toFixed(4),signal:+sig.toFixed(4),hist:+(ml-sig).toFixed(4),bullish:ml>sig};
}
function atrCalc(bars,n) {
  n=n||14;
  if(!bars||bars.length<n+1) return null;
  var sl=bars.slice(-(n+1)); var s=0;
  for(var i=1;i<sl.length;i++) s+=Math.abs(sl[i].c-sl[i-1].c);
  return s/n;
}
function getSR(bars,price) {
  if(!bars||bars.length<20) return{support:null,resistance:null,nearResistance:false};
  var sl=bars.slice(-60);
  var pH=[],pL=[];
  for(var i=2;i<sl.length-2;i++){
    if(sl[i].h>sl[i-1].h&&sl[i].h>sl[i-2].h&&sl[i].h>sl[i+1].h&&sl[i].h>sl[i+2].h) pH.push(sl[i].h);
    if(sl[i].l<sl[i-1].l&&sl[i].l<sl[i-2].l&&sl[i].l<sl[i+1].l&&sl[i].l<sl[i+2].l) pL.push(sl[i].l);
  }
  var res=pH.filter(function(v){return v>price;}).sort(function(a,b){return a-b;})[0]||null;
  var sup=pL.filter(function(v){return v<price;}).sort(function(a,b){return b-a;})[0]||null;
  return{support:sup,resistance:res,nearResistance:res&&(res-price)/price<0.015};
}

// ════════════════════════════════════════════════════════
// FILTROS
// ════════════════════════════════════════════════════════
function chkBrkVol(bars) {
  if(!bars||bars.length<4) return{ok:true,ratio:null};
  var lv=bars[bars.length-1].v;
  var avg=(bars[bars.length-2].v+bars[bars.length-3].v+bars[bars.length-4].v)/3;
  if(!avg) return{ok:true,ratio:null};
  var r=lv/avg; return{ok:r>=1.3,ratio:+r.toFixed(2)};
}
function chkIdMove(bars,price) {
  if(!bars||bars.length<8) return{ok:true,pct:null};
  var open=bars[Math.max(0,bars.length-8)].c;
  if(!open) return{ok:true,pct:null};
  var p=(price-open)/open*100; return{ok:p<=3.5,pct:+p.toFixed(2)};
}
function chkSectExt(bars,price) {
  if(!bars||bars.length<10) return{ok:true,g:null};
  var ref=bars[bars.length-10].c;
  if(!ref) return{ok:true,g:null};
  var g=(price-ref)/ref*100; return{ok:g<=15,g:+g.toFixed(2)};
}
function chkIdRev(bars,price) {
  if(!bars||bars.length<4) return{ok:true,pct:null};
  var dh=Math.max.apply(null,bars.slice(-8).map(function(b){return b.h;}));
  if(!dh) return{ok:true,pct:null};
  var p=(dh-price)/dh*100; return{ok:p<=1.5,pct:+p.toFixed(2)};
}
function chkTwoC(bars,e16v) {
  if(!bars||bars.length<3||!e16v) return{ok:false,count:0};
  var cnt=[bars[bars.length-1].c,bars[bars.length-2].c,bars[bars.length-3].c].filter(function(v){return v>e16v;}).length;
  return{ok:cnt>=2,count:cnt};
}

// ════════════════════════════════════════════════════════
// EARNINGS
// ════════════════════════════════════════════════════════
async function checkEarnings(sym) {
  var now=Date.now();
  if(earningsCache[sym]&&now-earningsCache[sym].ts<3600000) return earningsCache[sym].d;
  try {
    var url='https://query1.finance.yahoo.com/v11/finance/quoteSummary/'+sym+'?modules=calendarEvents';
    var res=await fetch(url); var j=await res.json();
    var ev=j&&j.quoteSummary&&j.quoteSummary.result&&j.quoteSummary.result[0]&&j.quoteSummary.result[0].calendarEvents&&j.quoteSummary.result[0].calendarEvents.earnings;
    if(!ev||!ev.earningsDate||!ev.earningsDate.length){earningsCache[sym]={ts:now,d:null};return null;}
    var ts=ev.earningsDate[0].raw*1000;
    var days=Math.round((ts-now)/86400000);
    var d={daysAway:days,dateStr:new Date(ts).toLocaleDateString('en-US',{day:'2-digit',month:'short'}),warning:days>=0&&days<=7,danger:days>=0&&days<=2};
    earningsCache[sym]={ts:now,d:d}; return d;
  } catch(e){earningsCache[sym]={ts:now,d:null};return null;}
}

// ════════════════════════════════════════════════════════
// SPY — ESTADO DEL MERCADO
// ════════════════════════════════════════════════════════
async function checkSPY() {
  log('Verificando SPY...');
  try {
    var bars=await fetchBars('SPY',1,'day',60);
    if(!bars||bars.length<30) {
      log('SPY: datos insuficientes ('+( bars?bars.length:0)+' barras) - usando NEUTRAL');
      spyStatus='NEUTRAL'; marketOK=true; spyScore=50; return;
    }
    var closes=bars.map(function(b){return b.c;});
    // Usa MA20 y MA40 en lugar de MA50 para funcionar con menos barras
    var ma20=sma(closes,20);
    var ma40=closes.length>=40?sma(closes,40):null;
    var rsi=rsiCalc(closes,14);
    var last=closes[closes.length-1];
    var prev5=closes[closes.length-6]||last;
    var chg5=(last-prev5)/prev5*100;
    var bull=last>ma20&&(!ma40||ma20>ma40)&&rsi>45&&chg5>-2.5;
    var bear=(last<ma20&&rsi<50)||chg5<-2.5;
    if(bull){spyStatus='BULL';marketOK=true;spyScore=100;}
    else if(bear){spyStatus='BEAR';marketOK=false;spyScore=0;}
    else{spyStatus='NEUTRAL';marketOK=true;spyScore=50;}
    log('SPY $'+last.toFixed(2)+' -> '+spyStatus+' | MA20:$'+ma20.toFixed(2)+(ma40?' MA40:$'+ma40.toFixed(2):'')+' RSI:'+rsi+' 5d:'+chg5.toFixed(1)+'%');
  } catch(e) {
    log('SPY ERROR: '+e.message+' - usando NEUTRAL');
    spyStatus='NEUTRAL'; marketOK=true; spyScore=50;
  }
}

// ════════════════════════════════════════════════════════
// ANÁLISIS TÉCNICO
// ════════════════════════════════════════════════════════
async function analyze(sym,bars) {
  if(!bars||bars.length<40) return null;
  var closes=bars.map(function(b){return b.c;});
  var price=closes[closes.length-1];
  var prev=closes[closes.length-2]||price;
  var vol=bars[bars.length-1].v;
  var avgVol=bars.slice(-20).reduce(function(a,b){return a+b.v;},0)/20;
  var atrV=atrCalc(bars,14)||price*0.004;
  var hull=hullMA(closes,16);
  var hullSlice=closes.slice(0,closes.length-1);
  var hullP=hullMA(hullSlice,16);
  var e9=ema(closes,9);
  var e16=ema(closes,16);
  var ma20=sma(closes,20);
  var ma40=sma(closes,40);
  var rsi=rsiCalc(closes,14);
  var macdR=macdCalc(closes);
  var sr=getSR(bars,price);
  if(!hull||!e9||!e16||!ma20) return null;
  var hullBull=hull>(hullP||hull-1);
  var stackBull=e9>e16&&e16>ma20;
  var d16=(price-e16)/e16*100;
  var bv=chkBrkVol(bars);
  var im=chkIdMove(bars,price);
  var se=chkSectExt(bars,price);
  var ir=chkIdRev(bars,price);
  var tc=chkTwoC(bars,e16);
  var score=0;
  if(hullBull)              score+=30;
  if(stackBull)             score+=15;
  if(price>e16&&d16>=0.3)   score+=10;
  if(tc.ok)                 score+=10;
  if(rsi>=38&&rsi<=65)      score+=10;
  if(vol>=avgVol*1.15)      score+=8;
  if(bv.ok)                 score+=7;
  if(macdR&&macdR.bullish)  score+=5;
  if(price>ma20)            score+=3;
  if(ma40&&ma20>ma40)       score+=2;
  var keysOk=hullBull&&stackBull&&price>e16&&d16>=0.3&&tc.ok&&rsi>=38&&rsi<=65&&vol>=avgVol*1.15&&bv.ok&&im.ok&&se.ok&&ir.ok&&!sr.nearResistance;
  var isBuy=keysOk&&score>=MIN_SCORE;
  var volDay=im.pct?Math.abs(im.pct):0;
  var stopMult=(spyStatus==='NEUTRAL'||volDay>2)?0.7:1.0;
  return {
    sym:sym, price:price, prev:prev, vol:vol, avgVol:avgVol, score:score, isBuy:isBuy,
    hullBull:hullBull, e9:+e9.toFixed(2), e16:+e16.toFixed(2),
    ma20:+ma20.toFixed(2), ma40:ma40?+ma40.toFixed(2):null,
    rsi:rsi, macd:macdR, sr:sr, bv:bv, im:im, se:se, ir:ir, tc:tc,
    atrV:+atrV.toFixed(3), stopMult:stopMult,
    t1:+(price+atrV*2.5).toFixed(2),
    t2:+(price+atrV*3.5).toFixed(2),
    sl:+(price-atrV*stopMult).toFixed(2),
    entryConv:+e16.toFixed(2),
    targetConv:+(e16+atrV*3.0).toFixed(2),
    stopConv:+(e16-atrV*stopMult*0.8).toFixed(2),
  };
}

// ════════════════════════════════════════════════════════
// ENVIAR SEÑAL A TELEGRAM
// ════════════════════════════════════════════════════════
async function sendSignal(sig) {
  var hora=getET().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
  var sess=getSession();
  var sesLbl=sess.isPre?'PRE-MARKET':sess.isOpen?'MERCADO ABIERTO':sess.isPost?'POST-MARKET':'';
  var stopAdj=sig.stopMult<1?' (ajustado dia volatil)':'';
  var rsiOk=sig.rsi>=40&&sig.rsi<=65?'OK':'ALTO';
  var macdTxt=sig.macd?(sig.macd.bullish?'ALCISTA':'BAJISTA'):'sin datos';
  var chgPct=((sig.price-sig.prev)/sig.prev*100).toFixed(2);
  var volPct=sig.avgVol>0?(sig.vol/sig.avgVol*100).toFixed(0)+'%':'--';
  var t1pct=((sig.t1-sig.price)/sig.price*100).toFixed(1);
  var t2pct=((sig.t2-sig.price)/sig.price*100).toFixed(1);
  var slpct=((sig.price-sig.sl)/sig.price*100).toFixed(1);

  var msg = '';
  msg += 'SEÑAL DE COMPRA - '+sig.sym+'\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += 'Precio: $'+sig.price+' ('+chgPct+'%)\n';
  msg += 'Score: '+sig.score+'/100\n';
  msg += 'Sesion: '+sesLbl+'\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += 'ENTRADA AGRESIVA:\n';
  msg += '  Entrada: $'+sig.price+'\n';
  msg += '  Target1: $'+sig.t1+' (+'+t1pct+'%)\n';
  msg += '  Target2: $'+sig.t2+' (+'+t2pct+'%)\n';
  msg += '  Stop: $'+sig.sl+' (-'+slpct+'%)'+stopAdj+'\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += 'ENTRADA CONSERVADORA (espera EMA16):\n';
  msg += '  Entrada: $'+sig.entryConv+'\n';
  msg += '  Target: $'+sig.targetConv+'\n';
  msg += '  Stop: $'+sig.stopConv+'\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += 'Indicadores 1H:\n';
  msg += '  Hull16: '+(sig.hullBull?'ALCISTA':'BAJISTA')+'\n';
  msg += '  EMA9: $'+sig.e9+' | EMA16: $'+sig.e16+'\n';
  msg += '  MA20: $'+sig.ma20+(sig.ma40?' | MA40: $'+sig.ma40:'')+'\n';
  msg += '  RSI: '+sig.rsi+' ('+rsiOk+')\n';
  msg += '  MACD: '+macdTxt+'\n';
  msg += '  Volumen: '+volPct+' promedio\n';
  msg += '  Vol ruptura: '+(sig.bv.ratio||'--')+'x | 2 velas EMA16: '+(sig.tc.ok?'SI':'NO')+'\n';
  msg += '  Mov.sesion: '+(sig.im.pct||'--')+'% | SPY: '+spyStatus+'\n';
  msg += '━━━━━━━━━━━━━━━━━━━━\n';
  msg += 'Confirma en TradingView antes de entrar\n';
  msg += 'Hora ET: '+hora;

  var ok=await sendTG(TG_GROUP,msg);
  if(ok) log('TG enviado: '+sig.sym+' $'+sig.price+' Score:'+sig.score);
  return ok;
}

// ════════════════════════════════════════════════════════
// RESUMEN DIARIO
// ════════════════════════════════════════════════════════
async function sendDailySummary() {
  var up=Math.round((Date.now()-startTime)/60000);
  var msg='RESUMEN DEL DIA\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='Activo: '+(up<60?up+'m':Math.floor(up/60)+'h'+up%60+'m')+'\n';
  msg+='Escaneos: '+scanCount+'\n';
  msg+='Señales enviadas: '+sigCount+'\n';
  msg+='SPY: '+spyStatus+'\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='Hasta mañana';
  await sendTG(TG_GROUP,msg);
}

// ════════════════════════════════════════════════════════
// CICLO PRINCIPAL
// ════════════════════════════════════════════════════════
async function runScan() {
  scanCount++;
  var sess=getSession();
  if(sess.isWeekend)   {log('=== #'+scanCount+' WEEKEND ==='); return;}
  if(sess.isEarlyPre)  {log('=== #'+scanCount+' PRE <8AM ==='); return;}
  if(!sess.isPre&&!sess.isOpen&&!sess.isPost){log('=== #'+scanCount+' FUERA HORARIO ==='); return;}
  var lbl=sess.isPre?'PRE':sess.isOpen?'OPEN':'POST';
  log('=== #'+scanCount+' '+lbl+' | SPY:'+spyStatus+' ===');
  if(scanCount%3===1) await checkSPY();
  if(spyStatus==='BEAR'){log('SPY BEAR - bloqueado'); return;}
  var minScore=(sess.isPre||sess.isPost)?MIN_SCORE+10:MIN_SCORE;
  var found=0;
  for(var i=0;i<WATCHLIST.length;i+=3){
    var batch=WATCHLIST.slice(i,i+3);
    var results=await Promise.all(batch.map(async function(w){
      try{
        var bars=await fetchBars(w.sym,1,'hour',22);
        if(bars&&bars.length>=30) return analyze(w.sym,bars);
      }catch(e){log(w.sym+' err: '+e.message);}
      return null;
    }));
    for(var k=0;k<results.length;k++){
      var sig=results[k];
      if(!sig) continue;
      var earn=await checkEarnings(sig.sym);
      if(earn&&earn.danger){log('Bloqueado earnings: '+sig.sym+' en '+earn.daysAway+'d');continue;}
      if(!sig.isBuy||sig.score<minScore) continue;
      var key=sig.sym+'_'+new Date().toISOString().split('T')[0];
      if(alerted[key]) continue;
      alerted[key]=true;
      setTimeout(function(k){return function(){delete alerted[k];};}(key),BLOCK_HOURS*3600000);
      log('SEÑAL: '+sig.sym+' $'+sig.price+' Score:'+sig.score);
      var ok=await sendSignal(sig);
      if(ok){sigCount++;found++;}
    }
    await new Promise(function(r){setTimeout(r,500);});
  }
  if(found===0) log('Sin señales · '+WATCHLIST.length+' activos');
  var et=getET(),m=et.getHours()*60+et.getMinutes();
  if(sess.isOpen&&m>=955&&m<=965) await sendDailySummary();
}

// ════════════════════════════════════════════════════════
// INICIO
// ════════════════════════════════════════════════════════
async function main() {
  log('Agente Trading v3 iniciando...');
  log(WATCHLIST.length+' activos | cada '+INTERVAL+'min | score>='+MIN_SCORE);
  var msg='Agente Monitor v3 Iniciado\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='Railway 24/7\n';
  msg+=''+WATCHLIST.length+' activos | cada '+INTERVAL+'min\n';
  msg+='Score minimo: '+MIN_SCORE+'\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='Filtros activos:\n';
  msg+='OK Racha >15% bloqueada\n';
  msg+='OK Reversion >1.5% bloqueada\n';
  msg+='OK Vol ruptura 1.3x requerido\n';
  msg+='OK 2 velas consecutivas EMA16\n';
  msg+='OK MACD confirmacion\n';
  msg+='OK Earnings bloqueados 2d antes\n';
  msg+='OK Stop dinamico dias volatiles\n';
  msg+='OK SPY BEAR bloquea todo\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='@Buyscanertradyng_bot';
  await sendTG(TG_GROUP,msg);
  await checkSPY();
  await runScan();
  setInterval(async function(){
    try{await runScan();}
    catch(e){log('Error scan: '+e.message);}
  },INTERVAL*60*1000);
}

main().catch(function(e){console.error('Fatal:',e);process.exit(1);});
