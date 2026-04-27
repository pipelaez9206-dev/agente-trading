// ════════════════════════════════════════════════════════
//  AGENTE TRADING — Railway 24/7
//  Datos: Yahoo Finance 1H + Polygon precio real
// ════════════════════════════════════════════════════════
const fetch = require('node-fetch');

const POLY_KEY    = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN    = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_CHAT     = '-1003987823131';
const INTERVAL    = 5;
const MIN_SCORE   = 60;
const BLOCK_HRS   = 8;

const WATCHLIST = [
  'SOXL','MU','AMD','NFLX','TALO','UUUU','OKLO','SMR',
  'SOUN','IONQ','MARA','RIOT','HOOD','SOFI','PLTR','TSLA',
  'ACMR','WOLF','QUBT','CLSK',
];

let scanCount   = 0;
let sigCount    = 0;
let spyStatus   = 'UNKNOWN';
let alerted     = {};
let startTime   = Date.now();

// ════════════════════════════════════════════════════════
// TIEMPO ET
// ════════════════════════════════════════════════════════
function getET() {
  return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
}
function getSession() {
  const et=getET(), d=et.getDay(), mins=et.getHours()*60+et.getMinutes(), wk=d>=1&&d<=5;
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
  const et=getET();
  const ts=et.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const dt=et.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit'});
  console.log('['+dt+' '+ts+' ET] '+msg);
}

// ════════════════════════════════════════════════════════
// TELEGRAM
// ════════════════════════════════════════════════════════
async function sendTG(text) {
  try {
    const res=await fetch('https://api.telegram.org/bot'+TG_TOKEN+'/sendMessage',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:TG_CHAT,text:text}),
    });
    const j=await res.json();
    if(!j.ok) log('TG error: '+j.description);
    return j.ok;
  } catch(e){log('TG err: '+e.message);return false;}
}

// ════════════════════════════════════════════════════════
// DATOS — Yahoo Finance 1H (funciona con cualquier plan)
// ════════════════════════════════════════════════════════
async function fetchCandles1H(sym) {
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+sym+'?interval=1h&range=30d&includePrePost=true';
  const res=await fetch(url);
  const j=await res.json();
  const r=j&&j.chart&&j.chart.result&&j.chart.result[0];
  if(!r) throw new Error('sin resultado Yahoo');
  const q=r.indicators.quote[0];
  const ts=r.timestamp||[];
  const closes=q.close||[], highs=q.high||[], lows=q.low||[], vols=q.volume||[];
  const bars=[];
  for(var i=0;i<ts.length;i++){
    if(closes[i]!=null) bars.push({
      t:ts[i]*1000, c:+closes[i].toFixed(2),
      h:+(highs[i]||closes[i]).toFixed(2),
      l:+(lows[i]||closes[i]).toFixed(2),
      v:vols[i]||0
    });
  }
  if(bars.length<20) throw new Error('pocas barras: '+bars.length);
  const meta=r.meta;
  const price=meta.postMarketPrice||meta.regularMarketPrice||bars[bars.length-1].c;
  const prev=meta.previousClose||bars[bars.length-2].c||price;
  const vol=meta.regularMarketVolume||bars[bars.length-1].v;
  const avgVol=bars.slice(-20).reduce(function(a,b){return a+b.v;},0)/20;
  return {bars:bars,price:+price.toFixed(2),prev:+prev.toFixed(2),vol:vol,avgVol:+avgVol.toFixed(0)};
}

async function fetchDailyBars(sym) {
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+sym+'?interval=1d&range=60d';
  const res=await fetch(url);
  const j=await res.json();
  const r=j&&j.chart&&j.chart.result&&j.chart.result[0];
  if(!r) return [];
  const closes=(r.indicators.quote[0].close||[]).filter(function(v){return v!=null;});
  return closes;
}

// ════════════════════════════════════════════════════════
// INDICADORES
// ════════════════════════════════════════════════════════
function sma(d,n){if(!d||d.length<n)return null;return d.slice(-n).reduce(function(a,b){return a+b;},0)/n;}
function ema(d,n){
  if(!d||d.length<n)return null;
  var k=2/(n+1),v=d.slice(0,n).reduce(function(a,b){return a+b;},0)/n;
  for(var i=n;i<d.length;i++)v=d[i]*k+v*(1-k);return v;
}
function rsi(d,n){
  n=n||14;if(!d||d.length<n+1)return null;
  var sl=d.slice(-(n+2)),g=0,l=0;
  for(var i=1;i<=n;i++){var x=sl[i]-sl[i-1];if(x>=0)g+=x;else l+=Math.abs(x);}
  var ag=g/n,al=l/n;
  if(sl.length>n+1){var x=sl[n+1]-sl[n];if(x>=0){ag=(ag*(n-1)+x)/n;al=al*(n-1)/n;}else{ag=ag*(n-1)/n;al=(al*(n-1)+Math.abs(x))/n;}}
  return al===0?100:+(100-100/(1+ag/al)).toFixed(1);
}
function hull(d,n){
  n=n||16;if(!d||d.length<n*2)return null;
  var h=Math.round(n/2),sq=Math.round(Math.sqrt(n)),raw=[];
  for(var i=n-1;i<d.length;i++){
    var sl=d.slice(0,i+1),w1=ema(sl,h),w2=ema(sl,n);
    if(w1&&w2)raw.push(2*w1-w2);
  }
  return ema(raw,sq);
}
function macd(d){
  if(!d||d.length<35)return null;
  var e12=ema(d,12),e26=ema(d,26);if(!e12||!e26)return null;
  var hist=[];
  for(var i=26;i<=d.length;i++){var sl=d.slice(0,i),a=ema(sl,12),b=ema(sl,26);if(a&&b)hist.push(a-b);}
  if(hist.length<9)return null;
  var sig=ema(hist,9);if(!sig)return null;
  var ml=e12-e26;return{bullish:ml>sig,hist:+(ml-sig).toFixed(4)};
}
function atr(bars,n){
  n=n||14;if(!bars||bars.length<n+1)return null;
  var sl=bars.slice(-(n+1)),s=0;
  for(var i=1;i<sl.length;i++)s+=Math.abs(sl[i].c-sl[i-1].c);
  return s/n;
}

// ════════════════════════════════════════════════════════
// SPY — ESTADO DEL MERCADO
// ════════════════════════════════════════════════════════
async function checkSPY() {
  try {
    const closes=await fetchDailyBars('SPY');
    if(!closes||closes.length<30){spyStatus='NEUTRAL';return;}
    const ma20=sma(closes,20),ma40=closes.length>=40?sma(closes,40):ma20;
    const r=rsi(closes,14),last=closes[closes.length-1];
    const prev5=closes[closes.length-6]||last,chg5=(last-prev5)/prev5*100;
    if(last>ma20&&ma20>ma40&&r>45&&chg5>-2.5) spyStatus='BULL';
    else if((last<ma20&&r<50)||chg5<-2.5) spyStatus='BEAR';
    else spyStatus='NEUTRAL';
    log('SPY $'+last.toFixed(2)+' '+spyStatus+' RSI:'+r+' 5d:'+chg5.toFixed(1)+'%');
  } catch(e){log('SPY err:'+e.message);spyStatus='NEUTRAL';}
}

// ════════════════════════════════════════════════════════
// ANÁLISIS TÉCNICO
// ════════════════════════════════════════════════════════
function analyze(sym, data) {
  const bars=data.bars, price=data.price, prev=data.prev;
  const vol=data.vol, avgVol=data.avgVol;
  const closes=bars.map(function(b){return b.c;});
  const hullNow=hull(closes,16);
  const hullPrev=hull(closes.slice(0,-1),16);
  const e9=ema(closes,9), e16=ema(closes,16);
  const ma20=sma(closes,20), ma40=closes.length>=40?sma(closes,40):null;
  const r=rsi(closes,14), m=macd(closes), atrV=atr(bars,14)||price*0.004;
  if(!e9||!e16||!ma20) return null;

  const hullUp   = hullNow ? hullNow>(hullPrev||hullNow-0.01) : e9>e16;
  const stackBull= e9>e16&&e16>ma20;
  const d16      = (price-e16)/e16*100;
  const chg      = (price-prev)/prev*100;
  const volOk    = avgVol>0&&vol>=avgVol*1.1;

  // Score
  let score=0;
  if(hullUp)              score+=30;
  if(stackBull)           score+=20;
  if(price>e16&&d16>=0.2) score+=12;
  if(r&&r>=35&&r<=68)     score+=12;
  if(volOk)               score+=10;
  if(m&&m.bullish)        score+=8;
  if(price>ma20)          score+=5;
  if(ma40&&ma20>ma40)     score+=3;

  // Condiciones clave mínimas
  const ok = hullUp && stackBull && price>e16 && d16>=0.2 && r && r>=35 && r<=68 && volOk;
  const stopMult = spyStatus==='NEUTRAL'?0.75:1.0;

  return {
    sym, price, prev, chg:+chg.toFixed(2), vol, avgVol, score,
    isBuy: ok && score>=MIN_SCORE,
    hullUp, stackBull, e9:+e9.toFixed(2), e16:+e16.toFixed(2),
    ma20:+ma20.toFixed(2), ma40:ma40?+ma40.toFixed(2):null,
    rsi:r, macd:m, atrV:+atrV.toFixed(3), stopMult,
    t1:+(price+atrV*2.5).toFixed(2),
    t2:+(price+atrV*3.5).toFixed(2),
    sl:+(price-atrV*stopMult).toFixed(2),
    ec:+e16.toFixed(2),
    tc:+(e16+atrV*3.0).toFixed(2),
    sc:+(e16-atrV*stopMult*0.8).toFixed(2),
  };
}

// ════════════════════════════════════════════════════════
// ENVIAR SEÑAL
// ════════════════════════════════════════════════════════
async function sendSignal(sig) {
  const hora=getET().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
  const sess=getSession();
  const lbl=sess.isPre?'PRE-MARKET':sess.isOpen?'MERCADO ABIERTO':'POST-MARKET';
  const volPct=sig.avgVol>0?(sig.vol/sig.avgVol*100).toFixed(0)+'%':'--';
  const stopAdj=sig.stopMult<1?' (ajustado)':'';
  var msg='';
  msg+='SEÑAL DE COMPRA - '+sig.sym+'\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='Precio: $'+sig.price+' ('+sig.chg+'%)\n';
  msg+='Score:  '+sig.score+'/100\n';
  msg+='Sesion: '+lbl+'\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='AGRESIVA (entra ahora):\n';
  msg+='  Entrada: $'+sig.price+'\n';
  msg+='  Target1: $'+sig.t1+' (+'+((sig.t1-sig.price)/sig.price*100).toFixed(1)+'%)\n';
  msg+='  Target2: $'+sig.t2+' (+'+((sig.t2-sig.price)/sig.price*100).toFixed(1)+'%)\n';
  msg+='  Stop:    $'+sig.sl+' (-'+((sig.price-sig.sl)/sig.price*100).toFixed(1)+'%)'+stopAdj+'\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='CONSERVADORA (espera EMA16 $'+sig.ec+'):\n';
  msg+='  Target: $'+sig.tc+'\n';
  msg+='  Stop:   $'+sig.sc+'\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='Hull16:  '+(sig.hullUp?'ALCISTA':'BAJISTA')+'\n';
  msg+='EMA9/16: $'+sig.e9+' / $'+sig.e16+'\n';
  msg+='MA20:    $'+sig.ma20+(sig.ma40?' | MA40: $'+sig.ma40:'')+'\n';
  msg+='RSI:     '+sig.rsi+'\n';
  msg+='MACD:    '+(sig.macd?(sig.macd.bullish?'ALCISTA':'BAJISTA'):'sin datos')+'\n';
  msg+='Vol:     '+volPct+' del promedio\n';
  msg+='SPY:     '+spyStatus+'\n';
  msg+='━━━━━━━━━━━━━━━━━━━━\n';
  msg+='Confirma en TradingView\n';
  msg+='Hora ET: '+hora;
  const ok=await sendTG(msg);
  if(ok) log('TG enviado: '+sig.sym+' $'+sig.price+' Score:'+sig.score);
  return ok;
}

// ════════════════════════════════════════════════════════
// SCAN PRINCIPAL
// ════════════════════════════════════════════════════════
async function runScan() {
  scanCount++;
  const sess=getSession();
  if(sess.isWeekend)   {log('=== #'+scanCount+' WEEKEND ===');return;}
  if(sess.isEarlyPre)  {log('=== #'+scanCount+' PRE <8AM ===');return;}
  if(!sess.isPre&&!sess.isOpen&&!sess.isPost){log('=== #'+scanCount+' FUERA HORARIO ===');return;}

  const lbl=sess.isPre?'PRE':sess.isOpen?'OPEN':'POST';
  log('=== #'+scanCount+' '+lbl+' | SPY:'+spyStatus+' ===');
  if(scanCount%3===1) await checkSPY();
  if(spyStatus==='BEAR'){log('SPY BEAR - bloqueado');return;}

  const minScore=sess.isPre||sess.isPost ? MIN_SCORE+8 : MIN_SCORE;
  let found=0, analyzed=0, candidate=0;

  for(let i=0;i<WATCHLIST.length;i+=4){
    const batch=WATCHLIST.slice(i,i+4);
    const results=await Promise.all(batch.map(async function(sym){
      try{
        const data=await fetchCandles1H(sym);
        const sig=analyze(sym,data);
        if(sig) log(sym+' $'+sig.price+' Score:'+sig.score+' Hull:'+(sig.hullUp?'UP':'DN')+' RSI:'+sig.rsi+' Vol:'+(sig.avgVol>0?(sig.vol/sig.avgVol*100).toFixed(0)+'%':'--'));
        return sig;
      }catch(e){
        log(sym+' err: '+e.message);
        return null;
      }
    }));

    for(const sig of results){
      if(!sig) continue;
      analyzed++;
      if(!sig.isBuy||sig.score<minScore) continue;
      candidate++;
      const key=sym+'_'+new Date().toISOString().split('T')[0];
      const sym=sig.sym;
      const k=sym+'_'+new Date().toISOString().split('T')[0];
      if(alerted[k]) continue;
      alerted[k]=true;
      setTimeout(function(x){return function(){delete alerted[x];};}(k),BLOCK_HRS*3600000);
      log('SEÑAL: '+sym+' $'+sig.price+' Score:'+sig.score);
      const ok=await sendSignal(sig);
      if(ok){sigCount++;found++;}
    }
    await new Promise(function(r){setTimeout(r,300);});
  }
  log('Resultado: '+found+' señales | Analizados:'+analyzed+'/'+WATCHLIST.length+' | score>='+minScore);

  // Resumen cierre
  const et=getET(),m=et.getHours()*60+et.getMinutes();
  if(sess.isOpen&&m>=955&&m<=965){
    const up=Math.round((Date.now()-startTime)/60000);
    await sendTG('RESUMEN DEL DIA\n'+'━━━━━━━━━━━━━━━━━━━━\n'+'Escaneos: '+scanCount+'\nSeñales: '+sigCount+'\nSPY: '+spyStatus+'\nActivo: '+(up<60?up+'m':Math.floor(up/60)+'h')+'\n'+'Hasta mañana');
  }
}

// ════════════════════════════════════════════════════════
// INICIO
// ════════════════════════════════════════════════════════
async function main(){
  log('Agente Trading iniciando...');
  log(WATCHLIST.length+' activos | cada '+INTERVAL+'min | score>='+MIN_SCORE);
  await checkSPY();
  await sendTG('Agente Trading Iniciado\n'+'━━━━━━━━━━━━━━━━━━━━\n'+WATCHLIST.length+' activos | cada '+INTERVAL+'min\nScore minimo: '+MIN_SCORE+'\nDatos: Yahoo Finance 1H\nSPY: '+spyStatus+'\n'+'━━━━━━━━━━━━━━━━━━━━\n@Buyscanertradyng_bot');
  await runScan();
  setInterval(async function(){
    try{await runScan();}
    catch(e){log('Error: '+e.message);}
  },INTERVAL*60*1000);
}

main().catch(function(e){console.error('Fatal:',e);process.exit(1);});
