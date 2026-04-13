// ════════════════════════════════════════════
//  AGENTE TRADING — Node.js para Railway
//  Corre 24/7 en la nube · Señales a Telegram
// ════════════════════════════════════════════
const fetch = require('node-fetch');

// ── CONFIG ──────────────────────────────────
const POLY       = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN   = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_GROUP   = '-5187081924';   // Grupo Trading Señales
const TG_FELIPE  = '6773568382';    // Chat personal Felipe
const INTERVAL   = 5;              // minutos entre escaneos
const MIN_SCORE  = 70;             // confianza mínima %
const BLOCK_HOURS= 8;              // horas de bloqueo por símbolo

// ── WATCHLIST ───────────────────────────────
const WATCHLIST = [
  {sym:'TALO', name:'Talos Energy'},
  {sym:'AMPL', name:'Amplitude Inc'},
  {sym:'QUBT', name:'Quantum Computing'},
  {sym:'NVTS', name:'Navitas Semi'},
  {sym:'AMPX', name:'Amprius Tech'},
  {sym:'UUUU', name:'Energy Fuels'},
  {sym:'ICHR', name:'Ichor Holdings'},
  {sym:'SOXL', name:'Direxion Semi 3x'},
  {sym:'AMD',  name:'AMD Inc'},
  {sym:'PLTR', name:'Palantir'},
  {sym:'OKLO', name:'Oklo Inc'},
  {sym:'SOUN', name:'SoundHound AI'},
  {sym:'IONQ', name:'IonQ Quantum'},
  {sym:'MARA', name:'Marathon Digital'},
  {sym:'HOOD', name:'Robinhood'},
  {sym:'SOFI', name:'SoFi'},
  {sym:'SMR',  name:'NuScale Power'},
  {sym:'RIVN', name:'Rivian'},
];

// ── STATE ────────────────────────────────────
let hullLock  = {};
let alerted   = {};
let marketOK  = true;
let spyScore  = 0;
let scanCount = 0;
let sigCount  = 0;
let startTime = Date.now();

// ── MATH ─────────────────────────────────────
const sma = (d,n) => {
  if(!d||d.length<n) return null;
  return d.slice(-n).reduce((a,b)=>a+b,0)/n;
};
const ema = (d,n) => {
  if(!d||d.length<n) return null;
  const k=2/(n+1);
  let e=d.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for(let i=n;i<d.length;i++) e=d[i]*k+e*(1-k);
  return e;
};
const wma = (d,n) => {
  if(!d||d.length<n) return null;
  const s=d.slice(-n);
  let num=0,den=0;
  for(let i=0;i<n;i++){num+=s[i]*(i+1);den+=i+1;}
  return num/den;
};
const hma16 = (d) => {
  if(!d||d.length<32) return null;
  const w1=wma(d,8), w2=wma(d,16);
  if(!w1||!w2) return null;
  const arr=[];
  for(let i=4;i>=1;i--){
    const a=wma(d.slice(0,-i),8), b=wma(d.slice(0,-i),16);
    if(a&&b) arr.push(2*a-b);
  }
  arr.push(2*w1-w2);
  return wma(arr.slice(-4),4);
};
const rsi14 = (d) => {
  if(!d||d.length<15) return null;
  const sl=d.slice(-15);
  let g=0,l=0;
  for(let i=1;i<sl.length;i++){
    const c=sl[i]-sl[i-1];
    c>0 ? g+=c : l-=c;
  }
  g/=14; l/=14;
  return l===0 ? 100 : +(100-100/(1+g/l)).toFixed(1);
};

// ── FETCH CON TIMEOUT ────────────────────────
async function fetchT(url, ms=7000) {
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

// ── FETCH BARRAS ─────────────────────────────
async function fetchBars(sym) {
  const to   = new Date();
  const from = new Date(to - 20*864e5);
  const fmt  = d => d.toISOString().split('T')[0];

  // Polygon primero (plan pagado)
  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/15/minute/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=400&apiKey=${POLY}`;
    const r = await fetchT(url, 6000);
    const d = await r.json();
    if(d?.results?.length>=20) {
      return d.results.map(b=>+b.c.toFixed(2));
    }
  } catch(e) {}

  // Yahoo como respaldo
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=15m&range=5d`;
    const r = await fetchT(url, 6000);
    const d = await r.json();
    const cl = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
      ?.filter(v=>v!=null&&v>0).map(v=>+v.toFixed(2));
    if(cl?.length>=20) return cl;
  } catch(e) {}

  return null;
}

// ── ANALYZE ──────────────────────────────────
function analyze(sym, d) {
  if(!d||d.length<40) return null;
  const price  = d[d.length-1];
  const h16    = hma16(d);
  const h16p   = d.length>17 ? hma16(d.slice(0,-1)) : null;
  const h16pp  = d.length>18 ? hma16(d.slice(0,-2)) : null;
  const ma9    = ema(d,9);
  const ma20   = sma(d,20);
  const ma40   = sma(d,40);
  const rsiV   = rsi14(d);
  if(!h16||!ma20) return null;

  const hullUp   = h16p ? h16>h16p : true;
  const hullFlip = h16&&h16p&&h16pp ? ((h16>h16p)!==(h16p>h16pp)) : false;

  // Lock de dirección
  if(!hullLock[sym]) {
    hullLock[sym] = {dir:hullUp?'UP':'DOWN', flipTime:Date.now(), bars:0};
  } else if(hullFlip) {
    const nd = hullUp?'UP':'DOWN';
    if(hullLock[sym].dir!==nd) {
      hullLock[sym] = {dir:nd, flipTime:Date.now(), bars:0};
    }
  }
  const hl   = hullLock[sym];
  hl.bars    = Math.floor((Date.now()-hl.flipTime)/(15*60*1000));

  // Score
  let pts=0, max=0;
  const add = (ok,w) => {max+=w; if(ok) pts+=w;};
  add(hullUp,                                          4);
  add(!!(ma9&&ma20&&ma9>ma20),                         3);
  add(!!(ma20&&ma40&&ma20>ma40),                       2);
  add(!!(rsiV&&rsiV>=35&&rsiV<=68),                   2);
  add(price>(h16||price),                             2);
  const score = max>0 ? Math.round(pts/max*100) : 50;

  // Condiciones BUY — más permisivas en pre/post market
  const session = getMarketSession();
  const isExtended = session==='PREMARKET' || session==='POSTMARKET';
  const minScore = isExtended ? MIN_SCORE-5 : MIN_SCORE; // 65% en extendido, 70% en abierto
  const minBars  = isExtended ? 1 : 2; // 1 barra en extendido, 2 en abierto
  const rsiMin   = isExtended ? 30 : 35;
  const rsiMax   = isExtended ? 72 : 68;

  const isBuy = hullFlip && hullUp
    && score >= minScore
    && hl.bars >= minBars
    && !!(ma9&&ma20&&ma9>ma20)
    && (rsiV===null||(rsiV>=rsiMin&&rsiV<=rsiMax));

  return {
    sym, price:+price.toFixed(2),
    hullUp, hullFlip, hullBars:hl.bars,
    score, isBuy, rsiV,
    t1: +(price*1.02).toFixed(2),
    t2: +(price*1.03).toFixed(2),
    sl: +(price*0.985).toFixed(2)
  };
}

// ── SPY FILTER ───────────────────────────────
async function checkSPY() {
  try {
    const bars = await fetchBars('SPY');
    if(!bars||bars.length<40) return;
    const price = bars[bars.length-1];
    const h16   = hma16(bars);
    const h16p  = hma16(bars.slice(0,-1));
    const ma9   = ema(bars,9);
    const ma20  = sma(bars,20);
    const ma40  = sma(bars,40);
    const rsiV  = rsi14(bars);
    if(!h16||!ma20) return;

    const hullUp = h16p ? h16>h16p : true;
    let pts=0, max=0;
    const add=(ok,w)=>{max+=w;if(ok)pts+=w;};
    add(hullUp,4);
    add(!!(ma9&&ma20&&ma9>ma20),3);
    add(!!(ma20&&ma40&&ma20>ma40),2);
    add(price>h16,2);
    add(!!(rsiV&&rsiV>45&&rsiV<75),2);
    if(bars.length>=10) add((price-bars[bars.length-10])/bars[bars.length-10]*100>0.3,2);

    spyScore = max>0 ? Math.round(pts/max*100) : 50;
    marketOK = spyScore>=45;

    log(`SPY $${price.toFixed(2)} · Score ${spyScore}% · Mercado ${marketOK?'✅ OK':'🛑 bloqueado'}`);
  } catch(e) {
    log(`SPY error: ${e.message}`);
  }
}

// ── TELEGRAM ─────────────────────────────────
async function sendTG(chatId, msg) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id:chatId, text:msg, parse_mode:'Markdown'})
    });
    const d = await r.json();
    return d.ok;
  } catch(e) {
    log(`TG error: ${e.message}`);
    return false;
  }
}

async function sendSignal(sig) {
  const u = WATCHLIST.find(u=>u.sym===sig.sym)||{name:sig.sym};
  const hora    = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  const session = getMarketSession();
  const sesLabel= session==='PREMARKET'  ? '⚡ PRE-MARKET'
                : session==='POSTMARKET' ? '🌙 POST-MARKET'
                : '📊 MERCADO ABIERTO';
  const sesWarn = session==='PREMARKET'
    ? '\n⚠️ Pre-market: menor volumen · Spread más amplio'
    : session==='POSTMARKET'
    ? '\n⚠️ Post-market: menor liquidez · Spreads altos'
    : '';

  const msg =
    `📈 *SEÑAL DE COMPRA — ${sesLabel}*\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🏢 *${sig.sym}* — ${u.name}\n`
    +`💵 Precio: *$${sig.price}*\n`
    +`📊 Confianza: *${sig.score}%*\n`
    +(session==='OPEN'?`🌎 SPY: ${spyScore}% ${marketOK?'✅':'⚠️'}\n`:'')
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`✅ Target +2%: *$${sig.t1}*\n`
    +`✅ Target +3%: *$${sig.t2}*\n`
    +`🛑 Stop -1.5%: *$${sig.sl}*\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🎯 Hull16 ALCISTA ↑ · ${sig.hullBars} barra(s)\n`
    +`⏰ ${hora} ET${sesWarn}`;

  // Enviar al grupo
  const ok = await sendTG(TG_GROUP, msg);
  if(ok) log(`✅ Telegram → grupo: ${sig.sym}`);
  return ok;
}

async function sendDailySummary() {
  const upMins = Math.round((Date.now()-startTime)/60000);
  const msg =
    `📋 *RESUMEN DEL DÍA*\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🤖 Agente activo ${upMins < 60 ? upMins+'m' : Math.floor(upMins/60)+'h'+upMins%60+'m'}\n`
    +`🔍 Escaneos: ${scanCount}\n`
    +`📈 Señales enviadas: ${sigCount}\n`
    +`🌎 SPY final: ${spyScore}%\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Hasta mañana 👋`;
  await sendTG(TG_GROUP, msg);
  await sendTG(TG_FELIPE, msg);
}

// ── HORA ET ──────────────────────────────────
function getET() {
  return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
}
function getMarketSession() {
  const et = getET();
  const d  = et.getDay();
  const t  = et.getHours()*60 + et.getMinutes();

  if(d===0 || d===6) return 'WEEKEND'; // fin de semana

  if(t>=240  && t<570)  return 'PREMARKET';  // 4:00am - 9:30am ET
  if(t>=570  && t<960)  return 'OPEN';       // 9:30am - 4:00pm ET
  if(t>=960  && t<1200) return 'POSTMARKET'; // 4:00pm - 8:00pm ET
  return 'CLOSED'; // noche
}
function isMarketOpen() {
  const s = getMarketSession();
  return s==='OPEN';
}
function isExtendedHours() {
  const s = getMarketSession();
  return s==='PREMARKET' || s==='POSTMARKET';
}

// ── LOG ──────────────────────────────────────
function log(msg) {
  const et   = getET();
  const time = et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const date = et.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'});
  console.log(`[${date} ${time} ET] ${msg}`);
}

// ── SCAN CYCLE ───────────────────────────────
async function runScan() {
  scanCount++;
  const session = getMarketSession();
  const open    = session==='OPEN';
  const extended= session==='PREMARKET' || session==='POSTMARKET';

  log(`=== Escaneo #${scanCount} · ${session} ===`);

  // Fin de semana — no escanear
  if(session==='WEEKEND' || session==='CLOSED') {
    log('Fuera de horario · Próximo scan en horario extendido (4am ET)');
    return;
  }

  // SPY cada 3 ciclos (solo en mercado abierto)
  if(scanCount%3===1 && open) await checkSPY();

  // Pre/Post market — el SPY no aplica igual
  if(extended) {
    log(`⚡ HORARIO EXTENDIDO (${session}) · Señales activas con criterios ajustados`);
    // En horario extendido no requerimos SPY favorable
    marketOK = true;
  } else if(!marketOK) {
    log(`SPY ${spyScore}% — señales bloqueadas`);
    return;
  }

  // Escanear en batches de 3
  const syms = WATCHLIST.map(u=>u.sym);
  let found  = 0;

  for(let i=0; i<syms.length; i+=3) {
    const batch = syms.slice(i, i+3);
    const results = await Promise.all(batch.map(async sym => {
      try {
        const bars = await fetchBars(sym);
        if(bars?.length>=40) return analyze(sym, bars);
      } catch(e) { log(`${sym} error: ${e.message}`); }
      return null;
    }));

    for(const sig of results) {
      if(!sig || !sig.isBuy) continue;

      // Bloqueo por símbolo (1 señal por día)
      const today = new Date().toISOString().split('T')[0];
      const key   = `${sig.sym}_${today}`;
      if(alerted[key]) continue;
      alerted[key] = true;
      setTimeout(()=>delete alerted[key], BLOCK_HOURS*60*60*1000);

      log(`🟢 SEÑAL: ${sig.sym} $${sig.price} Score:${sig.score}% Hull:${sig.hullBars}barras`);
      const ok = await sendSignal(sig);
      if(ok) { sigCount++; found++; }
    }

    await new Promise(r=>setTimeout(r,500));
  }

  if(found===0) log(`Sin señales · ${WATCHLIST.length} activos analizados`);
}

// ── RESUMEN AUTOMÁTICO AL CIERRE ─────────────
function scheduleDailySummary() {
  const et      = getET();
  const now     = et.getHours()*60 + et.getMinutes();
  const close   = 16*60; // 4pm ET
  const minsLeft= close - now;
  if(minsLeft>0 && minsLeft<INTERVAL+2) {
    sendDailySummary();
  }
}

// ════════════════════════════════════════════
//  INICIO
// ════════════════════════════════════════════
async function main() {
  log('🚀 Agente Trading iniciando en Railway...');
  log(`📊 Watchlist: ${WATCHLIST.length} activos`);
  log(`⏱  Intervalo: ${INTERVAL} minutos`);
  log(`🎯 Score mínimo: ${MIN_SCORE}%`);
  log(`🔒 Bloqueo: ${BLOCK_HOURS} horas por señal`);

  // Mensaje de inicio al grupo
  await sendTG(TG_GROUP,
    `🤖 *Agente Monitor Iniciado*\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`✅ Corriendo en la nube 24/7\n`
    +`📊 ${WATCHLIST.length} activos monitoreados\n`
    +`⏱ Escaneo cada ${INTERVAL} minutos\n`
    +`🎯 Score mínimo: ${MIN_SCORE}%\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`⏰ *Horarios activos (ET):*\n`
    +`⚡ Pre-market: 4:00am - 9:30am\n`
    +`📊 Mercado: 9:30am - 4:00pm\n`
    +`🌙 Post-market: 4:00pm - 8:00pm\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🤖 @Buyscanertradyng_bot`
  );

  // SPY inicial
  await checkSPY();

  // Primer scan
  await runScan();

  // Loop cada N minutos
  setInterval(async () => {
    await runScan();
    scheduleDailySummary();
  }, INTERVAL * 60 * 1000);
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
