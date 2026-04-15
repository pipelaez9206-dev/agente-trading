// ════════════════════════════════════════════
//  AGENTE OPCIONES — Node.js para Railway
//  Estrategia: Salida de Bollinger 15M + Volumen
//  Activos: SPY, QQQ, TSLA, AMD
//  Señales: CALL y PUT a Telegram
// ════════════════════════════════════════════
const fetch = require('node-fetch');

// ── CONFIG ──────────────────────────────────
const POLY       = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN   = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_GROUP   = '-1003924134011';  // Grupo Trading Opciones
const TG_FELIPE  = '6773568382';
const INTERVAL   = 3;    // minutos entre escaneos (3 min para no perder breakouts)
const BB_PERIOD  = 20;   // período Bollinger
const BB_STD     = 2;    // desviaciones estándar
const BB_WIDTH_MIN = 1.5; // BB Width mínimo para confirmar volatilidad (%)
const VOL_MULT   = 1.5;  // volumen debe ser 1.5x el promedio
const BLOCK_HOURS = 2;   // horas de bloqueo por señal (opciones se mueven rápido)

// ── ACTIVOS ──────────────────────────────────
const WATCHLIST = [
  {sym:'SPY',  name:'S&P 500 ETF',      type:'index'},
  {sym:'QQQ',  name:'Nasdaq 100 ETF',   type:'index'},
  {sym:'TSLA', name:'Tesla Inc',        type:'stock'},
  {sym:'AMD',  name:'AMD Inc',          type:'stock'},
];

// ── STATE ────────────────────────────────────
let alerted   = {};
let scanCount = 0;
let sigCount  = 0;
let startTime = Date.now();
let tradeDiary = [];

// ── MATH ─────────────────────────────────────
const sma = (d,n) => {
  if(!d||d.length<n) return null;
  return d.slice(-n).reduce((a,b)=>a+b,0)/n;
};

const std = (d,n) => {
  const m = sma(d,n);
  if(!m) return null;
  return Math.sqrt(d.slice(-n).reduce((a,v)=>a+Math.pow(v-m,2),0)/n);
};

const bollinger = (closes, n=20, mult=2) => {
  if(!closes||closes.length<n) return null;
  const mid   = sma(closes,n);
  const sigma = std(closes,n);
  if(!mid||!sigma) return null;
  return {
    upper: +(mid + mult*sigma).toFixed(4),
    lower: +(mid - mult*sigma).toFixed(4),
    mid:   +mid.toFixed(4),
    width: +(sigma*mult*2/mid*100).toFixed(2), // BB Width %
    sigma: +sigma.toFixed(4)
  };
};

const smaVol = (d,n) => {
  if(!d||d.length<n) return null;
  return d.slice(-n).reduce((a,b)=>a+b,0)/n;
};

const rsi = (d,n=14) => {
  if(!d||d.length<n+1) return null;
  const sl=d.slice(-(n+1));
  let g=0,l=0;
  for(let i=1;i<sl.length;i++){
    const c=sl[i]-sl[i-1];
    c>0?g+=c:l-=c;
  }
  g/=n; l/=n;
  return l===0?100:+(100-100/(1+g/l)).toFixed(1);
};

// ── FETCH ─────────────────────────────────────
async function fetchT(url, ms=8000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), ms);
  try {
    const r = await fetch(url, {signal:controller.signal});
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── FETCH BARRAS 15M ──────────────────────────
async function fetchBars15M(sym) {
  const to   = new Date();
  const from = new Date(to - 5*864e5); // 5 días
  const fmt  = d => d.toISOString().split('T')[0];

  // Polygon 15M — precio Y volumen
  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/15/minute/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=400&apiKey=${POLY}`;
    const r = await fetchT(url, 7000);
    const d = await r.json();
    if(d?.results?.length>=25) {
      return d.results.map(b=>({
        c: +b.c.toFixed(4),  // close
        h: +b.h.toFixed(4),  // high
        l: +b.l.toFixed(4),  // low
        v: +b.v,             // volumen
        t: b.t               // timestamp
      }));
    }
  } catch(e) { log(`${sym} Polygon: ${e.message}`); }

  // Yahoo como respaldo
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=15m&range=5d`;
    const r = await fetchT(url, 7000);
    const d = await r.json();
    const result = d?.chart?.result?.[0];
    const closes  = result?.indicators?.quote?.[0]?.close;
    const volumes = result?.indicators?.quote?.[0]?.volume;
    const highs   = result?.indicators?.quote?.[0]?.high;
    const lows    = result?.indicators?.quote?.[0]?.low;
    const times   = result?.timestamp;
    if(closes?.length>=25) {
      return closes.map((c,i)=>({
        c: c ? +c.toFixed(4) : null,
        h: highs?.[i] ? +highs[i].toFixed(4) : null,
        l: lows?.[i]  ? +lows[i].toFixed(4)  : null,
        v: volumes?.[i] || 0,
        t: times?.[i] ? times[i]*1000 : null
      })).filter(b=>b.c!==null);
    }
  } catch(e) { log(`${sym} Yahoo: ${e.message}`); }

  return null;
}

// ── ANALYZE BOLLINGER ─────────────────────────
function analyze(sym, bars) {
  if(!bars||bars.length<BB_PERIOD+2) return null;

  const closes  = bars.map(b=>b.c);
  const volumes = bars.map(b=>b.v);

  const price   = closes[closes.length-1];
  const prevP   = closes[closes.length-2];
  const bb      = bollinger(closes, BB_PERIOD, BB_STD);
  const bbPrev  = bollinger(closes.slice(0,-1), BB_PERIOD, BB_STD);
  const rsiV    = rsi(closes);

  if(!bb||!bbPrev) return null;

  // Volumen actual vs promedio de 20 barras
  const volCurrent = volumes[volumes.length-1];
  const volAvg     = smaVol(volumes.slice(0,-1), 20) || 1;
  const volRatio   = +(volCurrent/volAvg).toFixed(2);
  const highVol    = volRatio >= VOL_MULT;

  // Volatilidad suficiente
  const highVola   = bb.width >= BB_WIDTH_MIN;

  // ── BREAKOUT ALCISTA (CALL) ──
  // Precio rompe sobre la banda superior
  const breakoutUp = price > bb.upper && prevP <= bbPrev.upper;

  // ── BREAKOUT BAJISTA (PUT) ──
  // Precio rompe bajo la banda inferior
  const breakoutDn = price < bb.lower && prevP >= bbPrev.lower;

  // ── SEÑAL ──
  // Necesita: breakout + volumen alto + volatilidad
  const isCall = breakoutUp && highVol && highVola;
  const isPut  = breakoutDn && highVol && highVola;

  // Calcular strike sugerido (ATM)
  const strikeCall = Math.ceil(price);   // redondear arriba
  const strikePut  = Math.floor(price);  // redondear abajo

  return {
    sym, price, rsiV,
    bb, bbPrev,
    volRatio, highVol, highVola,
    breakoutUp, breakoutDn,
    isCall, isPut,
    strikeCall, strikePut,
    // Distancia desde la banda (%)
    distUpper: +(((price-bb.upper)/bb.upper)*100).toFixed(2),
    distLower: +(((bb.lower-price)/bb.lower)*100).toFixed(2),
  };
}

// ── TELEGRAM ─────────────────────────────────
async function sendTG(chatId, msg) {
  try {
    log(`Enviando TG a ${chatId}...`);
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id:chatId, text:msg})
    });
    const d = await r.json();
    if(d.ok) {
      log(`TG enviado a ${chatId}`);
    } else {
      log(`TG error ${chatId}: ${d.description} (code ${d.error_code})`);
    }
    return d.ok;
  } catch(e) {
    log(`TG excepcion: ${e.message}`);
    return false;
  }
}

async function sendSignal(sig, tipo) {
  const u    = WATCHLIST.find(u=>u.sym===sig.sym)||{name:sig.sym};
  const hora = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  const isCall = tipo==='CALL';

  // Calcular precio objetivo de la opción (estimado)
  const targetPct = isCall ? '+3%' : '-3%';
  const stopPct   = isCall ? '-50% prima' : '-50% prima';

  const emoji  = isCall ? '🟢' : '🔴';
  const dir    = isCall ? 'CALL' : 'PUT';
  const strike = isCall ? sig.strikeCall : sig.strikePut;
  const banda  = isCall ? 'SUPERIOR' : 'INFERIOR';

  const msg =
    `${emoji} OPCION ${dir} - ${sig.sym}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Activo: ${sig.sym} - ${u.name}\n`
    +`Precio: $${sig.price.toFixed(2)}\n`
    +`Banda ${banda}: $${isCall?sig.bb.upper:sig.bb.lower}\n`
    +`Volatilidad BB: ${sig.bb.width}%\n`
    +`Volumen: ${sig.volRatio}x promedio\n`
    +`RSI: ${sig.rsiV||'─'}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`COMPRAR ${dir}\n`
    +`Strike sugerido: $${strike}\n`
    +`Vencimiento: hoy o manana\n`
    +`Objetivo precio: ${targetPct} del activo\n`
    +`Stop recomendado: ${stopPct}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Bollinger 15M rompio banda ${banda}\n`
    +`Confirmar en TradingView antes de entrar\n`
    +`${hora} ET`;

  const ok = await sendTG(TG_GROUP, msg);
  if(ok) {
    sigCount++;
    // Registrar en diario
    tradeDiary.push({
      sym:sig.sym, tipo, price:sig.price, strike,
      hora, result:'OPEN', pnl:null
    });
  }
  return ok;
}

async function sendDailySummary() {
  const upMins = Math.round((Date.now()-startTime)/60000);
  const calls  = tradeDiary.filter(t=>t.tipo==='CALL').length;
  const puts   = tradeDiary.filter(t=>t.tipo==='PUT').length;

  const msg =
    `RESUMEN OPCIONES DEL DIA\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Escaneos: ${scanCount}\n`
    +`Senales: ${sigCount} (${calls} CALL / ${puts} PUT)\n`
    +`Activo: ${upMins<60?upMins+'m':Math.floor(upMins/60)+'h'}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Hasta manana`;

  await sendTG(TG_GROUP, msg);
  await sendTG(TG_FELIPE, msg);
  tradeDiary = [];
}

// ── HORA ET ──────────────────────────────────
function getET() {
  return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
}

function getMarketSession() {
  const et = getET();
  const d  = et.getDay();
  const t  = et.getHours()*60 + et.getMinutes();
  if(d===0||d===6) return 'WEEKEND';
  if(t>=570&&t<960) return 'OPEN';
  return 'CLOSED';
}

function log(msg) {
  const et   = getET();
  const time = et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const date = et.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'});
  console.log(`[OPCIONES ${date} ${time} ET] ${msg}`);
}

// ── SCAN CYCLE ───────────────────────────────
async function runScan() {
  scanCount++;
  const session = getMarketSession();

  log(`=== Scan #${scanCount} · ${session} ===`);

  if(session!=='OPEN') {
    log('Mercado cerrado · Solo senales en horario regular');
    return;
  }

  let found = 0;

  for(const u of WATCHLIST) {
    try {
      const bars = await fetchBars15M(u.sym);
      if(!bars||bars.length<BB_PERIOD+2) {
        log(`${u.sym}: datos insuficientes`);
        continue;
      }

      const sig = analyze(u.sym, bars);
      if(!sig) continue;

      log(`${u.sym}: $${sig.price} | BB Upper:${sig.bb.upper} Lower:${sig.bb.lower} Width:${sig.bb.width}% | Vol:${sig.volRatio}x | RSI:${sig.rsiV}`);

      const today = new Date().toISOString().split('T')[0];

      // Señal CALL
      if(sig.isCall) {
        const key = `CALL_${u.sym}_${today}`;
        if(!alerted[key]) {
          alerted[key] = true;
          setTimeout(()=>delete alerted[key], BLOCK_HOURS*60*60*1000);
          log(`CALL detectada: ${u.sym} precio $${sig.price} sobre banda $${sig.bb.upper}`);
          await sendSignal(sig, 'CALL');
          found++;
        }
      }

      // Señal PUT
      if(sig.isPut) {
        const key = `PUT_${u.sym}_${today}`;
        if(!alerted[key]) {
          alerted[key] = true;
          setTimeout(()=>delete alerted[key], BLOCK_HOURS*60*60*1000);
          log(`PUT detectada: ${u.sym} precio $${sig.price} bajo banda $${sig.bb.lower}`);
          await sendSignal(sig, 'PUT');
          found++;
        }
      }

    } catch(e) {
      log(`${u.sym} error: ${e.message}`);
    }
    await new Promise(r=>setTimeout(r,500));
  }

  if(found===0) log(`Sin senales · ${WATCHLIST.length} activos analizados`);
}

// ── RESUMEN AUTOMÁTICO AL CIERRE ─────────────
function scheduleDailySummary() {
  const et      = getET();
  const now     = et.getHours()*60 + et.getMinutes();
  const close   = 16*60;
  const minsLeft= close - now;
  if(minsLeft>0 && minsLeft<INTERVAL+1) {
    sendDailySummary();
  }
}

// ════════════════════════════════════════════
//  INICIO
// ════════════════════════════════════════════
async function main() {
  log('Agente Opciones iniciando en Railway...');
  log(`Activos: ${WATCHLIST.map(u=>u.sym).join(', ')}`);
  log(`Estrategia: Bollinger ${BB_PERIOD} periodos + Volumen ${VOL_MULT}x`);
  log(`Timeframe: 15 MINUTOS`);
  log(`BB Width minimo: ${BB_WIDTH_MIN}%`);
  log(`Intervalo scan: ${INTERVAL} minutos`);

  await sendTG(TG_GROUP,
    `AGENTE OPCIONES INICIADO\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Estrategia: Salida de Bollinger 15M\n`
    +`Activos: SPY QQQ TSLA AMD\n`
    +`Confirmador: Volumen ${VOL_MULT}x promedio\n`
    +`Scan cada ${INTERVAL} minutos\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Senales solo en mercado regular\n`
    +`9:30am - 4:00pm ET`
  );

  await runScan();

  setInterval(async () => {
    await runScan();
    scheduleDailySummary();
  }, INTERVAL * 60 * 1000);
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
