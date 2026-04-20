// ════════════════════════════════════════════
//  AGENTE TRADING — Node.js para Railway
//  Datos en TIEMPO REAL via Polygon WebSocket
//  Múltiples timeframes: 1D + 1H + señal
//  Stop dinámico ATR · Horario óptimo
// ════════════════════════════════════════════
const fetch     = require('node-fetch');
const WebSocket = require('ws');

// ── CONFIG ──────────────────────────────────
const POLY       = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN   = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_GROUP   = '-5187081924';
const TG_FELIPE  = '6773568382';
const INTERVAL   = 5;
const MIN_SCORE  = 40;
const BLOCK_HOURS= 8;

// ── WATCHLIST ───────────────────────────────
const WATCHLIST = [
  {sym:'TSLA', name:'Tesla Inc',           sector:'tech'},
  {sym:'ORCL', name:'Oracle Corporation',  sector:'tech'},
  {sym:'TALO', name:'Talos Energy',        sector:'energy'},
  {sym:'AMPL', name:'Amplitude Inc',       sector:'tech'},
  {sym:'QUBT', name:'Quantum Computing',   sector:'tech'},
  {sym:'NVTS', name:'Navitas Semi',        sector:'semi'},
  {sym:'AMPX', name:'Amprius Tech',        sector:'energy'},
  {sym:'UUUU', name:'Energy Fuels',        sector:'energy'},
  {sym:'ICHR', name:'Ichor Holdings',      sector:'semi'},
  {sym:'SOXL', name:'Direxion Semi 3x',    sector:'semi'},
  {sym:'AMD',  name:'AMD Inc',             sector:'semi'},
  {sym:'PLTR', name:'Palantir',            sector:'tech'},
  {sym:'OKLO', name:'Oklo Inc',            sector:'energy'},
  {sym:'SOUN', name:'SoundHound AI',       sector:'tech'},
  {sym:'IONQ', name:'IonQ Quantum',        sector:'tech'},
  {sym:'MARA', name:'Marathon Digital',    sector:'tech'},
  {sym:'HOOD', name:'Robinhood',           sector:'tech'},
  {sym:'SOFI', name:'SoFi Technologies',   sector:'tech'},
  {sym:'SMR',  name:'NuScale Power',       sector:'energy'},
  {sym:'RIVN', name:'Rivian',              sector:'tech'},
  {sym:'COIN', name:'Coinbase Global',     sector:'tech'},
  {sym:'TSLZ', name:'Tesla Inverse 2x',    sector:'tech'},
  {sym:'CONI', name:'Coinbase Inverse',     sector:'tech'},
  {sym:'PLTD', name:'Palantir Inverse',     sector:'tech'},
  {sym:'SOXS', name:'Semi Bear 3x ETF',     sector:'semi'},
  {sym:'MUD',  name:'MUD ETF',              sector:'tech'},
  {sym:'AMDD', name:'AMD Inverse 2x',       sector:'semi'},
];

const SCANNER = [
  {sym:'WOLF',name:'Wolfspeed',sector:'semi'},{sym:'COHU',name:'Cohu Inc',sector:'semi'},
  {sym:'BBAI',name:'BigBear.ai',sector:'tech'},{sym:'HIMS',name:'Hims & Hers',sector:'tech'},
  {sym:'AI',name:'C3.ai Inc',sector:'tech'},{sym:'UPST',name:'Upstart',sector:'tech'},
  {sym:'RCAT',name:'Red Cat Holdings',sector:'tech'},{sym:'IREN',name:'Iris Energy',sector:'tech'},
  {sym:'PLUG',name:'Plug Power',sector:'energy'},{sym:'FCEL',name:'FuelCell Energy',sector:'energy'},
  {sym:'BLNK',name:'Blink Charging',sector:'energy'},{sym:'CHPT',name:'ChargePoint',sector:'energy'},
  {sym:'CLNE',name:'Clean Energy',sector:'energy'},{sym:'GEVO',name:'Gevo Inc',sector:'energy'},
  {sym:'RGTI',name:'Rigetti Computing',sector:'tech'},{sym:'QBTS',name:'D-Wave Quantum',sector:'tech'},
  {sym:'KULR',name:'KULR Technology',sector:'tech'},{sym:'MVIS',name:'MicroVision',sector:'tech'},
  {sym:'RIOT',name:'Riot Platforms',sector:'tech'},{sym:'CIFR',name:'Cipher Mining',sector:'tech'},
  {sym:'HUT',name:'Hut 8 Mining',sector:'tech'},{sym:'CLSK',name:'CleanSpark',sector:'tech'},
  {sym:'DAVE',name:'Dave Inc',sector:'tech'},{sym:'RELY',name:'Remitly Global',sector:'tech'},
  {sym:'TDOC',name:'Teladoc Health',sector:'tech'},{sym:'ASAN',name:'Asana Inc',sector:'tech'},
  {sym:'DOMO',name:'Domo Inc',sector:'tech'},{sym:'OPEN',name:'Opendoor Tech',sector:'tech'},
  {sym:'ARRY',name:'Array Technologies',sector:'energy'},{sym:'FLNC',name:'Fluence Energy',sector:'energy'},
];

const WATCHLIST_SYMS = new Set(WATCHLIST.map(u=>u.sym));

// ── STATE ────────────────────────────────────
let hullLock      = {};
let alerted       = {};
let marketOK      = true;
let spyScore      = 0;
let scanCount     = 0;
let sigCount      = 0;
let startTime     = Date.now();
let openTrades    = {};
let tradeDiary    = [];
let top5Sent      = '';
let summarySentToday = '';
let morningMsgSent   = '';
let lastHourlyMsg    = 0;

// Precios en tiempo real via WebSocket
let rtPrices = {}; // {SYM: {price, volume, time}}

// ── MATH ─────────────────────────────────────
const sma = (d,n) => { if(!d||d.length<n) return null; return d.slice(-n).reduce((a,b)=>a+b,0)/n; };
const ema = (d,n) => {
  if(!d||d.length<n) return null;
  const k=2/(n+1); let e=d.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for(let i=n;i<d.length;i++) e=d[i]*k+e*(1-k); return e;
};
const wma = (d,n) => {
  if(!d||d.length<n) return null;
  const s=d.slice(-n); let num=0,den=0;
  for(let i=0;i<n;i++){num+=s[i]*(i+1);den+=i+1;} return num/den;
};
const hma16 = (d) => {
  if(!d||d.length<32) return null;
  const w1=wma(d,8), w2=wma(d,16); if(!w1||!w2) return null;
  const arr=[];
  for(let i=4;i>=1;i--){ const a=wma(d.slice(0,-i),8), b=wma(d.slice(0,-i),16); if(a&&b) arr.push(2*a-b); }
  arr.push(2*w1-w2); return wma(arr.slice(-4),4);
};
const rsi14 = (d) => {
  if(!d||d.length<15) return null;
  const sl=d.slice(-15); let g=0,l=0;
  for(let i=1;i<sl.length;i++){ const c=sl[i]-sl[i-1]; c>0?g+=c:l-=c; }
  g/=14; l/=14; return l===0?100:+(100-100/(1+g/l)).toFixed(1);
};
const atr14 = (bars) => {
  if(!bars||bars.length<15) return null;
  const slice = bars.slice(-15);
  let total = 0;
  for(let i=1;i<slice.length;i++){
    const high = slice[i].h||slice[i].c;
    const low  = slice[i].l||slice[i].c;
    const prev = slice[i-1].c;
    total += Math.max(high-low, Math.abs(high-prev), Math.abs(low-prev));
  }
  return +(total/14).toFixed(4);
};

// ── WEBSOCKET POLYGON TIEMPO REAL ────────────
let ws = null;
let wsConnected = false;

function connectWebSocket() {
  const syms = [...WATCHLIST.map(u=>u.sym), 'SPY'];
  log('Conectando WebSocket Polygon...');

  ws = new WebSocket('wss://socket.polygon.io/stocks');

  ws.on('open', () => {
    log('WebSocket conectado — autenticando...');
    ws.send(JSON.stringify({action:'auth', params:POLY}));
  });

  ws.on('message', (data) => {
    try {
      const msgs = JSON.parse(data);
      for(const msg of msgs) {
        // Auth exitosa — suscribir a trades en tiempo real
        if(msg.ev==='status' && msg.status==='auth_success') {
          log('WebSocket autenticado ✅ — suscribiendo a trades...');
          const subs = syms.map(s=>`T.${s}`).join(',');
          ws.send(JSON.stringify({action:'subscribe', params:subs}));
          wsConnected = true;
        }
        // Trade en tiempo real
        if(msg.ev==='T') {
          rtPrices[msg.sym] = {
            price:  +msg.p.toFixed(4),
            volume: msg.s||0,
            time:   msg.t||Date.now()
          };
        }
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    wsConnected = false;
    log('WebSocket desconectado — reconectando en 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (e) => {
    log(`WebSocket error: ${e.message}`);
  });
}

// ── FETCH CON TIMEOUT ────────────────────────
async function fetchT(url, ms=8000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), ms);
  try { const r=await fetch(url,{signal:controller.signal}); clearTimeout(timer); return r; }
  catch(e) { clearTimeout(timer); throw e; }
}

// ── FETCH BARRAS HISTÓRICAS ───────────────────
async function fetchBars(sym, timespan='hour', days=30) {
  const to   = new Date();
  const from = new Date(to - days*864e5);
  const fmt  = d => d.toISOString().split('T')[0];

  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/${timespan}/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=500&apiKey=${POLY}`;
    const r = await fetchT(url, 7000);
    const d = await r.json();
    if(d?.results?.length>=20) {
      return d.results.map(b=>({c:+b.c.toFixed(4), h:+b.h.toFixed(4), l:+b.l.toFixed(4), v:b.v||0}));
    }
  } catch(e) {}

  // Yahoo respaldo
  try {
    const range  = days<=5?'5d':days<=30?'1mo':'3mo';
    const interval = timespan==='day'?'1d':timespan==='hour'?'1h':'60m';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`;
    const r = await fetchT(url, 7000);
    const d = await r.json();
    const q = d?.chart?.result?.[0]?.indicators?.quote?.[0];
    const cl = q?.close?.filter(v=>v!=null&&v>0);
    if(cl?.length>=20) {
      return cl.map((c,i)=>({
        c:+c.toFixed(4),
        h:+(q.high?.[i]||c).toFixed(4),
        l:+(q.low?.[i]||c).toFixed(4),
        v:q.volume?.[i]||0
      }));
    }
  } catch(e) {}
  return null;
}

// ── PRECIO EN TIEMPO REAL ────────────────────
function getRTPrice(sym) {
  const rt = rtPrices[sym];
  if(!rt) return null;
  // Solo usar precio RT si es reciente (menos de 2 minutos)
  if(Date.now() - rt.time > 120000) return null;
  return rt.price;
}

// ── ANÁLISIS MULTI-TIMEFRAME ──────────────────
async function analyzeMultiTF(sym) {
  // 1. Barras 1H para Hull16 + EMA9 (tendencia principal)
  const bars1H = await fetchBars(sym, 'hour', 30);
  if(!bars1H||bars1H.length<40) return null;

  // 2. Precio en tiempo real (si disponible) o último close 1H
  const rtPrice = getRTPrice(sym);
  const closes1H = bars1H.map(b=>b.c);
  const price    = rtPrice || closes1H[closes1H.length-1];

  // Si tenemos precio RT, agregar al array de closes
  const closesWithRT = rtPrice ? [...closes1H.slice(0,-1), rtPrice] : closes1H;

  // ── Indicadores 1H ──
  const h16    = hma16(closesWithRT);
  const h16p   = hma16(closesWithRT.slice(0,-1));
  const h16pp  = hma16(closesWithRT.slice(0,-2));
  const ma9    = ema(closesWithRT, 9);
  const ma9p   = ema(closesWithRT.slice(0,-1), 9);
  const ma9p2  = ema(closesWithRT.slice(0,-2), 9);
  const ma20   = sma(closesWithRT, 20);
  const ma40   = sma(closesWithRT, 40);
  const rsiV   = rsi14(closesWithRT);
  const atrV   = atr14(bars1H);
  if(!h16||!ma20) return null;

  // Hull16 dirección y flip
  const hullUp   = h16p ? h16>h16p : true;
  const hullFlip = h16&&h16p&&h16pp ? ((h16>h16p)!==(h16p>h16pp)) : false;

  // Hull Lock
  if(!hullLock[sym]) {
    hullLock[sym] = {dir:hullUp?'UP':'DOWN', flipTime:Date.now(), bars:0};
  } else if(hullFlip) {
    const nd = hullUp?'UP':'DOWN';
    if(hullLock[sym].dir!==nd) hullLock[sym]={dir:nd, flipTime:Date.now(), bars:0};
  }
  const hl = hullLock[sym];
  hl.bars = Math.floor((Date.now()-hl.flipTime)/(60*60*1000));

  // EMA9 giro
  const ema9TurnUp  = !!(ma9&&ma9p&&ma9p2 && ma9>ma9p && ma9p<=ma9p2);
  const ema9Trending= !!(ma9&&ma9p && ma9>ma9p);

  // Volumen — usar datos históricos de barras (no WebSocket)
  const volumes   = bars1H.map(b=>b.v).filter(v=>v>0);
  const volCurrent= volumes.length>0 ? volumes[volumes.length-1] : 0;
  const volAvg20  = volumes.length>=5 ? volumes.slice(-21,-1).reduce((a,b)=>a+b,0)/Math.min(20,volumes.slice(-21,-1).length) : 1;
  const volRatio  = volAvg20>0 ? +(volCurrent/volAvg20).toFixed(2) : 1;
  const highVolume= volRatio >= 1.2;

  // 3. Barras 15M — momentum de entrada
  const bars15M = await fetchBars(sym, 'minute', 5); // últimos 5 días en 15M via Polygon aggs
  let trend15M   = 'NEUTRAL';
  let ema9_15M   = null;
  let rsi15M     = null;
  let vol15M_ratio = 0;
  let price15M   = null;

  // Fetch 15M separado
  try {
    const to15   = new Date();
    const from15 = new Date(to15 - 5*864e5);
    const fmt    = d => d.toISOString().split('T')[0];
    const url15  = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/15/minute/${fmt(from15)}/${fmt(to15)}?adjusted=true&sort=asc&limit=300&apiKey=${POLY}`;
    const r15    = await fetchT(url15, 7000);
    const d15    = await r15.json();
    if(d15?.results?.length>=20) {
      const bars = d15.results.map(b=>({c:+b.c.toFixed(4),h:+b.h.toFixed(4),l:+b.l.toFixed(4),v:b.v||0}));
      const cl15 = bars.map(b=>b.c);
      const vl15 = bars.map(b=>b.v);
      const h16_15  = hma16(cl15);
      const h16_15p = hma16(cl15.slice(0,-1));
      ema9_15M  = ema(cl15, 9);
      const ema9_15p= ema(cl15.slice(0,-1), 9);
      rsi15M    = rsi14(cl15);
      price15M  = getRTPrice(sym) || cl15[cl15.length-1];

      // Tendencia 15M
      if(h16_15&&h16_15p) trend15M = h16_15>h16_15p ? 'UP' : 'DOWN';

      // Volumen 15M
      const vol15Cur = vl15[vl15.length-1];
      const vol15Avg = vl15.slice(-21,-1).reduce((a,b)=>a+b,0)/20||1;
      vol15M_ratio   = +(vol15Cur/vol15Avg).toFixed(2);

      log(`${sym} 15M: $${price15M?.toFixed(2)} Hull:${trend15M} EMA9:${ema9_15M?.toFixed(2)} RSI:${rsi15M} Vol:${vol15M_ratio}x`);
    }
  } catch(e) { log(`${sym} 15M error: ${e.message}`); }

  // 4. Tendencia diaria (filtro mayor)
  const bars1D = await fetchBars(sym, 'day', 60);
  let trendDaily = 'NEUTRAL';
  if(bars1D&&bars1D.length>=20) {
    const closes1D = bars1D.map(b=>b.c);
    const h16D  = hma16(closes1D);
    const h16Dp = hma16(closes1D.slice(0,-1));
    if(h16D&&h16Dp) trendDaily = h16D>h16Dp ? 'UP' : 'DOWN';
  }

  // Score multi-timeframe — bonificadores, NO requisitos
  let pts=0, max=0;
  const add = (ok,w) => {max+=w; if(ok) pts+=w;};
  // ── 1H (base — más peso) ──
  add(hullUp,          5);  // Hull16 1H alcista
  add(ema9TurnUp,      6);  // EMA9 giró alcista en 1H — señal fuerte
  add(ema9Trending,    3);  // EMA9 subiendo en 1H
  add(!!(rsiV&&rsiV>=30&&rsiV<=75), 3); // RSI 1H sano
  add(price>(h16||price), 2); // precio sobre Hull16
  add(highVolume,      3);  // volumen 1H alto
  // ── 15M (confirmador) ──
  add(trend15M==='UP',  4); // Hull16 15M alcista
  add(!!(rsi15M&&rsi15M>=25&&rsi15M<=75), 2); // RSI 15M sano
  add(vol15M_ratio>=1.2, 2); // volumen 15M alto
  // ── Diario (bonificador) ──
  add(trendDaily==='UP', 3); // tendencia diaria alcista — bonus no requisito
  add(!!(ma20&&ma40&&ma20>ma40), 2); // MA20>MA40
  const score = max>0 ? Math.round(pts/max*100) : 50;

  // Stop dinámico basado en ATR
  const atrStop = atrV ? +(price - atrV*1.5).toFixed(2) : +(price*0.985).toFixed(2);
  const sl      = Math.max(atrStop, +(price*0.97).toFixed(2)); // mínimo 3% stop

  // Condiciones BUY
  const session    = getMarketSession();
  const isExtended = session==='PREMARKET'||session==='POSTMARKET';
  const minScore   = isExtended ? 75 : MIN_SCORE;
  const minBars    = isExtended ? 2  : 0;
  const rsiMin     = 30;
  const rsiMax     = isExtended ? 65 : 72;

  // Horario óptimo: 9:30-11am y 2:30-4pm ET
  const et    = getET();
  const etMin = et.getHours()*60+et.getMinutes();
  const horaOptima = (etMin>=570&&etMin<=660)||(etMin>=870&&etMin<=960);

  // Señal FLIP — Hull16 gira alcista
  const isBuyFlip = hullFlip && hullUp
    && (ema9TurnUp||ema9Trending)
    && score >= 40
    && (rsiV===null||(rsiV>=rsiMin&&rsiV<=rsiMax));

  // Señal CONTINUACIÓN — precio sigue Hull alcista
  const HIGH_VOL = ['TSLA','AMD','PLTR','SOXL','MARA','HOOD','SOFI','RIVN','ORCL','COIN'];
  const isBuyCont = !hullFlip && hullUp
    && hl.bars >= 1
    && ema9Trending
    && price > (h16||price)
    && score >= 48
    && (rsiV===null||(rsiV>=rsiMin&&rsiV<=75));

  // En extended hours solo activos de alto volumen
  const isHighVol = HIGH_VOL.includes(sym);
  const canTrade  = !isExtended || isHighVol;

  const isBuy = canTrade && (isBuyFlip || isBuyCont);
  const signalType = isBuyFlip ? 'FLIP' : isBuyCont ? 'CONTINUACION' : '';

  return {
    sym, price:+price.toFixed(2),
    hullUp, hullFlip, hullBars:hl.bars,
    score, isBuy, rsiV, atrV,
    ema9Turn: ema9TurnUp,
    volRatio, highVolume,
    trendDaily, trend15M, rsi15M, vol15M_ratio,
    horaOptima, signalType,
    rtPrice: !!rtPrice,
    t1: +(price*1.02).toFixed(2),
    t2: +(price*1.03).toFixed(2),
    t3: +(price*1.04).toFixed(2),
    sl, atrStop,
  };
}

// ── SPY FILTER ───────────────────────────────
async function checkSPY() {
  try {
    const bars = await fetchBars('SPY', 'hour', 30);
    if(!bars||bars.length<40) return;
    const cl  = bars.map(b=>b.c);
    const price= getRTPrice('SPY') || cl[cl.length-1];
    const h16  = hma16(cl);
    const h16p = hma16(cl.slice(0,-1));
    const ma9  = ema(cl,9); const ma20=sma(cl,20); const ma40=sma(cl,40); const rsiV=rsi14(cl);
    if(!h16||!ma20) return;
    const hullUp = h16p ? h16>h16p : true;
    let pts=0,max=0;
    const add=(ok,w)=>{max+=w;if(ok)pts+=w;};
    add(hullUp,4); add(!!(ma9&&ma20&&ma9>ma20),3); add(!!(ma20&&ma40&&ma20>ma40),2);
    add(price>h16,2); add(!!(rsiV&&rsiV>45&&rsiV<75),2);
    if(cl.length>=10) add((price-cl[cl.length-10])/cl[cl.length-10]*100>0.3,2);
    spyScore = max>0?Math.round(pts/max*100):50;
    marketOK = spyScore>=40;
    log(`SPY $${price.toFixed(2)} · Score ${spyScore}% · ${marketOK?'✅ OK':'🛑 neutral'} · RT:${!!getRTPrice('SPY')}`);
  } catch(e) { log(`SPY error: ${e.message}`); }
}

// ── TELEGRAM ─────────────────────────────────
async function sendTG(chatId, msg) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id:chatId, text:msg})
    });
    const d = await r.json();
    if(!d.ok) log(`TG error ${chatId}: ${d.description}`);
    return d.ok;
  } catch(e) { log(`TG error: ${e.message}`); return false; }
}

async function sendSignal(sig) {
  const u    = WATCHLIST.find(u=>u.sym===sig.sym)||{name:sig.sym};
  const hora = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  const session  = getMarketSession();
  const sesLabel = session==='PREMARKET'?'PRE-MARKET':session==='POSTMARKET'?'POST-MARKET':'MERCADO ABIERTO';

  const calidad = sig.score>=80?'🔥 MUY ALTA':sig.score>=70?'✅ ALTA':'🟡 MEDIA';
  const tipoSenal = sig.signalType==='FLIP'
    ? '🔄 CAMBIO DE TENDENCIA — Hull16 giró alcista'
    : '📈 CONTINUACIÓN — Precio sigue Hull16 alcista';

  const sesWarn = session==='PREMARKET'
    ? '\n⚠️ PRE-MARKET · Orden límite · Posición reducida'
    : session==='POSTMARKET'
    ? '\n⚠️ POST-MARKET · Baja liquidez · Posición reducida'
    : '';

  const msg =
    `📈 SEÑAL DE COMPRA — ${sesLabel}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🏢 ${sig.sym} — ${u.name}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`📊 ANÁLISIS DE ENTRADA:\n`
    +`💵 Precio: $${sig.price}${sig.rtPrice?' ⚡ TIEMPO REAL':''}\n`
    +`⭐ Calidad: ${calidad} (${sig.score}%)\n`
    +`🎯 Tipo: ${tipoSenal}\n`
    +`${sig.horaOptima?'✅ Hora óptima de entrada':'⚠️ Hora no óptima · mayor cautela'}\n`
    +`🌎 SPY: ${spyScore}% ${marketOK?'✅ Alcista':'⚠️ Neutral'}\n`
    +`📊 Tendencia diaria: ${sig.trendDaily==='UP'?'🟢 ALCISTA':'🔴 BAJISTA'}\n`
    +`📊 1H Hull16: ALCISTA ↑ · ${sig.hullBars} hora(s)\n`
    +(sig.ema9Turn?`📊 1H EMA9: Giró ALCISTA ↑\n`:`📊 1H EMA9: Tendencia alcista\n`)
    +`📊 15M Hull16: ${sig.trend15M==='UP'?'🟢 ALCISTA ↑':'⚠️ '+sig.trend15M}\n`
    +`📉 1H RSI: ${sig.rsiV||'─'} · 15M RSI: ${sig.rsi15M||'─'}\n`
    +`📦 Vol 1H: ${sig.volRatio}x · 15M: ${sig.vol15M_ratio}x\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🎯 PLAN DE TRADING:\n`
    +`🟢 ENTRAR: $${sig.price}\n`
    +`📈 Target 1 (+2%): $${sig.t1} → vender 50%\n`
    +`📈 Target 2 (+3%): $${sig.t2} → vender 30%\n`
    +`📈 Target 3 (+4%): $${sig.t3} → vender 20%\n`
    +`🛑 Stop ATR: $${sig.sl}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`💡 INSTRUCCIONES:\n`
    +`1. Confirmar en TradingView\n`
    +`2. Usar máximo 2% del capital\n`
    +`3. Poner stop en $${sig.sl} ANTES de entrar\n`
    +`4. Al llegar T1 mover stop a entrada\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`${hora} ET${sesWarn}`;

  const ok = await sendTG(TG_GROUP, msg);
  if(ok) {
    sigCount++;
    const tradeRecord = {
      sym:sig.sym, entry:sig.price, t1:sig.t1, t2:sig.t2, t3:sig.t3, sl:sig.sl,
      time:Date.now(),
      hora:new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}),
      bars:0, result:'OPEN', exit:null, pnl:null
    };
    openTrades[sig.sym] = tradeRecord;
    tradeDiary.push(tradeRecord);
    log(`✅ Señal enviada: ${sig.sym} $${sig.price} Score:${sig.score}% ${sig.signalType}`);
  }
  return ok;
}

// ── MONITOREO DE SALIDAS ─────────────────────
async function checkExits() {
  const openSyms = Object.keys(openTrades);
  if(!openSyms.length) return;
  log(`👀 Monitoreando: ${openSyms.join(', ')}`);

  for(const sym of openSyms) {
    const trade = openTrades[sym];
    try {
      // Usar precio RT si disponible
      const rtP   = getRTPrice(sym);
      let price   = rtP;
      if(!price) {
        const bars = await fetchBars(sym, 'hour', 5);
        if(!bars||!bars.length) continue;
        price = bars[bars.length-1].c;
      }
      trade.bars++;
      const pnl = +(((price-trade.entry)/trade.entry)*100).toFixed(2);
      const hora = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});

      log(`📊 ${sym}: $${price.toFixed(2)} · P&L ${pnl>=0?'+':''}${pnl}% · Stop $${trade.sl}${rtP?' ⚡':''}`);

      // TARGET +2%
      if(price >= trade.t1 && !trade.t1Hit) {
        trade.t1Hit = true;
        trade.sl    = trade.entry; // mover stop a break-even
        trade.result= 'WIN+2';
        trade.exit  = +price.toFixed(2);
        trade.pnl   = pnl;
        await sendTG(TG_GROUP,
          `✅ SEÑAL DE VENTA PARCIAL — ${sym}\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`📊 TARGET +2% ALCANZADO\n`
          +`💵 Entrada: $${trade.entry}\n`
          +`💰 Precio:  $${price.toFixed(2)}${rtP?' ⚡':''}\n`
          +`📈 Ganancia: +${pnl}%\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`🎯 ACCIÓN:\n`
          +`1. VENDER 50% ahora\n`
          +`2. Mover stop a entrada $${trade.entry}\n`
          +`3. Dejar resto hacia T2 $${trade.t2}\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`${hora} ET`
        );
      }

      // TARGET +3%
      if(price >= trade.t2) {
        const pnl2 = +(((price-trade.entry)/trade.entry)*100).toFixed(2);
        trade.result= 'WIN+3';
        trade.exit  = +price.toFixed(2);
        trade.pnl   = pnl2;
        await sendTG(TG_GROUP,
          `🏆 SEÑAL DE VENTA TOTAL — ${sym}\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`📊 TARGET +3% ALCANZADO\n`
          +`💵 Entrada: $${trade.entry}\n`
          +`💰 Precio:  $${price.toFixed(2)}${rtP?' ⚡':''}\n`
          +`📈 Ganancia: +${pnl2}%\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`🎯 CERRAR POSICIÓN COMPLETA\n`
          +`Vender el 100% ahora. Excelente trade!\n`
          +`${hora} ET`
        );
        delete openTrades[sym];
        continue;
      }

      // STOP LOSS
      if(price <= trade.sl) {
        const perdPct = +(((price-trade.entry)/trade.entry)*100).toFixed(2);
        trade.result= 'LOSS';
        trade.exit  = +price.toFixed(2);
        trade.pnl   = perdPct;
        await sendTG(TG_GROUP,
          `🛑 SEÑAL DE VENTA — STOP LOSS ${sym}\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`💵 Entrada:   $${trade.entry}\n`
          +`💰 Precio:    $${price.toFixed(2)}${rtP?' ⚡':''}\n`
          +`📉 Resultado: ${perdPct}%\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`🎯 VENDER TODO ahora al precio de mercado\n`
          +`El sistema te protegió. Siguiente oportunidad!\n`
          +`${hora} ET`
        );
        delete openTrades[sym];
        continue;
      }

      // Hull16 gira bajista
      const bars1H = await fetchBars(sym, 'hour', 10);
      if(bars1H&&bars1H.length>=20 && trade.bars>=2) {
        const cl  = bars1H.map(b=>b.c);
        const h16 = hma16(cl);
        const h16p= hma16(cl.slice(0,-1));
        if(h16&&h16p&&h16<h16p) {
          await sendTG(TG_GROUP,
            `⚠️ ALERTA DE TENDENCIA — ${sym}\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`Hull16 GIRÓ BAJISTA\n`
            +`💵 Entrada:  $${trade.entry}\n`
            +`💰 Precio:   $${price.toFixed(2)}\n`
            +`📊 P&L:      ${pnl>=0?'+':''}${pnl}%\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`${pnl>0?'Considera salir con ganancia\nO mover stop a entrada':'Evalúa salir si stop no activado'}\n`
            +`Stop actual: $${trade.sl}\n`
            +`Confirmar en TradingView`
          );
        }
      }
    } catch(e) { log(`Exit ${sym}: ${e.message}`); }
    await new Promise(r=>setTimeout(r,400));
  }
}

// ── TOP 5 RADAR ──────────────────────────────
async function runRadarTop5() {
  const today = new Date().toISOString().split('T')[0];
  if(top5Sent===today) return;
  const et = getET();
  const t  = et.getHours()*60+et.getMinutes();
  if(t<570||t>630) return;

  const scores = [];
  for(let i=0;i<SCANNER.length;i+=4) {
    const batch = SCANNER.slice(i,i+4).filter(u=>!WATCHLIST_SYMS.has(u.sym));
    await Promise.all(batch.map(async u=>{
      try {
        const bars = await fetchBars(u.sym,'hour',30);
        if(!bars||bars.length<40) return;
        const cl    = bars.map(b=>b.c);
        const price = cl[cl.length-1];
        if(price<3||price>50) return;
        const h16  = hma16(cl);
        const h16p = hma16(cl.slice(0,-1));
        const ma20 = sma(cl,20); const ma40=sma(cl,40); const rsiV=rsi14(cl);
        if(!h16||!ma20) return;
        const hullUp = h16p?h16>h16p:true;
        let pts=0,max=0;
        const add=(ok,w)=>{max+=w;if(ok)pts+=w;};
        add(hullUp,4); add(!!(ma20&&ma40&&ma20>ma40),2);
        add(!!(rsiV&&rsiV>=35&&rsiV<=68),2); add(price>h16,2);
        const score=max>0?Math.round(pts/max*100):50;
        scores.push({sym:u.sym,name:u.name,price:+price.toFixed(2),score,hullUp,
          t1:+(price*1.02).toFixed(2),sl:+(price*0.985).toFixed(2),rsiV});
      } catch(e){}
    }));
    await new Promise(r=>setTimeout(r,300));
  }

  if(!scores.length) return;
  const top5 = scores.sort((a,b)=>b.score-a.score).slice(0,5);
  const hora  = et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
  const medals= ['🥇','🥈','🥉','4️⃣','5️⃣'];

  let msg = `👀 RADAR DIARIO — TOP 5 PARA SEGUIMIENTO\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`⚠️ VIGILAR, NO COMPRAR todavía\n`
    +`Esperar SEÑAL DE COMPRA separada\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🌎 SPY: ${spyScore}% · ${hora} ET\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`;

  top5.forEach((s,i)=>{
    msg += `${medals[i]} ${s.sym} — ${s.name}\n`
      +`   👀 VIGILAR · Score: ${s.score}%\n`
      +`   $${s.price} · T1: $${s.t1} · Stop: $${s.sl}\n`
      +(s.rsiV?`   RSI: ${s.rsiV}\n`:'')
      +(i<4?`─────────────────────\n`:'');
  });

  msg += `━━━━━━━━━━━━━━━━━━━━\n`
    +`Señal de COMPRA llega por separado:\n`
    +`📈 SEÑAL DE COMPRA — [SIMBOLO]\n`
    +`🤖 @Buyscanertradyng_bot`;

  await sendTG(TG_GROUP, msg);
  top5Sent = today;
  log(`✅ Top5 enviado`);
}

// ── REPORTE HORARIO ───────────────────────────
async function sendHourlyStatus() {
  const session = getMarketSession();
  if(session==='WEEKEND'||session==='CLOSED') return;
  const now = Date.now();
  if(now-lastHourlyMsg < 58*60*1000) return;
  lastHourlyMsg = now;

  const hora = getET().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
  const watchScores = [];

  for(const u of WATCHLIST.slice(0,10)) {
    try {
      const sig = await analyzeMultiTF(u.sym);
      if(sig) watchScores.push({...sig, name:u.name});
    } catch(e){}
    await new Promise(r=>setTimeout(r,300));
  }

  const top3 = watchScores.sort((a,b)=>b.score-a.score).slice(0,3);
  const sesLabel = session==='PREMARKET'?'PRE-MARKET':session==='POSTMARKET'?'POST-MARKET':'MERCADO ABIERTO';

  let msg = `🤖 AGENTE ACTIVO — ${sesLabel}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`✅ Funcionando sin problemas\n`
    +`⏰ ${hora} ET · Scan #${scanCount}\n`
    +`🌎 SPY: ${spyScore}% ${marketOK?'✅ Alcista':'⚠️ Neutral'}\n`
    +`⚡ WebSocket: ${wsConnected?'✅ Tiempo real':'⚠️ REST API'}\n`
    +`📈 Señales hoy: ${sigCount}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`;

  if(top3.length>0) {
    msg += `📋 MEJORES AHORA:\n`;
    top3.forEach((s,i)=>{
      const est = s.score>=70?'🟢':s.score>=60?'🟡':'⚪';
      msg += `${i+1}. ${est} ${s.sym} $${s.price} · Score ${s.score}%\n`
           + `   Hull:${s.hullUp?'↑':'↓'} · RSI:${s.rsiV||'─'} · Vol:${s.volRatio}x · Día:${s.trendDaily==='UP'?'🟢':'🔴'}\n`;
    });
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  }

  msg += `⚠️ Solo para VIGILAR\n`
    +`Señal de COMPRA llega por separado\n`
    +`🤖 @Buyscanertradyng_bot`;

  await sendTG(TG_GROUP, msg);
  log(`📊 Reporte horario enviado`);
}

// ── RESUMEN DIARIO ────────────────────────────
async function sendDailySummary() {
  const upMins = Math.round((Date.now()-startTime)/60000);
  const wins   = tradeDiary.filter(t=>t.result==='WIN+2'||t.result==='WIN+3');
  const losses = tradeDiary.filter(t=>t.result==='LOSS');
  const open   = tradeDiary.filter(t=>t.result==='OPEN');
  const closed = wins.length+losses.length;
  const rate   = closed>0?Math.round(wins.length/closed*100):0;
  const pnlNet = tradeDiary.filter(t=>t.pnl!==null).reduce((a,t)=>a+(t.pnl||0),0);

  let msg = `📋 RESUMEN DEL DÍA\n━━━━━━━━━━━━━━━━━━━━\n`;

  if(tradeDiary.length>0) {
    tradeDiary.forEach(t=>{
      const icon = t.result==='WIN+2'||t.result==='WIN+3'?'✅':t.result==='LOSS'?'🛑':'⏳';
      const res  = t.result==='WIN+2'?'+2%':t.result==='WIN+3'?'+3%':t.result==='LOSS'?'-1.5%':'abierto';
      msg += `${icon} ${t.sym} $${t.entry} → ${t.exit?'$'+t.exit:'-'} ${res} · ${t.hora} ET\n`;
    });
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Total: ${tradeDiary.length} · ✅ ${wins.length} · 🛑 ${losses.length} · ⏳ ${open.length}\n`;
    msg += `🎯 Tasa: ${rate}% · P&L neto: ${pnlNet>=0?'+':''}${pnlNet.toFixed(1)}%\n`;
  } else {
    msg += `Sin trades hoy\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`
    +`🔍 Escaneos: ${scanCount} · Señales: ${sigCount}\n`
    +`🌎 SPY: ${spyScore}% · Activo ${upMins<60?upMins+'m':Math.floor(upMins/60)+'h'}\n`
    +`⚡ WebSocket: ${wsConnected?'✅ Tiempo real':'⚠️ REST'}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Hasta mañana 👋`;

  await sendTG(TG_GROUP, msg);
  await sendTG(TG_FELIPE, msg);
  tradeDiary = [];
}

// ── HORA ET ──────────────────────────────────
function getET() { return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})); }
function getMarketSession() {
  const et=getET(); const d=et.getDay(); const t=et.getHours()*60+et.getMinutes();
  if(d===0||d===6) return 'WEEKEND';
  if(t>=240&&t<570)  return 'PREMARKET';
  if(t>=570&&t<960)  return 'OPEN';
  if(t>=960&&t<1200) return 'POSTMARKET';
  return 'CLOSED';
}
function log(msg) {
  const et=getET();
  const time=et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const date=et.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'});
  console.log(`[${date} ${time} ET] ${msg}`);
}

// ── SCAN PRINCIPAL ────────────────────────────
async function runScan() {
  scanCount++;
  const session = getMarketSession();
  const open    = session==='OPEN';
  const extended= session==='PREMARKET'||session==='POSTMARKET';

  log(`=== Scan #${scanCount} · ${session} · Trades: ${Object.keys(openTrades).length} · RT: ${wsConnected?'✅':'⚠️'} ===`);

  await checkExits();

  if(session==='WEEKEND'||session==='CLOSED') {
    log('Fuera de horario');
    return;
  }

  if(scanCount%3===1 && open) await checkSPY();

  if(extended) {
    marketOK = true;
  } else if(!open) {
    return;
  } else if(!marketOK) {
    log(`SPY ${spyScore}% — señales pausadas`);
    return;
  }

  const HIGH_VOL = ['TSLA','AMD','PLTR','SOXL','MARA','HOOD','SOFI','RIVN','ORCL','COIN'];
  const allSyms  = WATCHLIST.map(u=>u.sym);
  const syms     = extended ? allSyms.filter(s=>HIGH_VOL.includes(s)) : allSyms;

  let found = 0;

  for(let i=0;i<syms.length;i+=3) {
    const batch = syms.slice(i,i+3);
    const results = await Promise.all(batch.map(async sym=>{
      try { return await analyzeMultiTF(sym); } catch(e) { return null; }
    }));

    for(const sig of results) {
      if(sig) log(`📊 ${sig.sym}: $${sig.price}${sig.rtPrice?'⚡':''} score:${sig.score}% hull:${sig.hullUp?'↑':'↓'} flip:${sig.hullFlip} bars:${sig.hullBars} rsi:${sig.rsiV} vol:${sig.volRatio}x día:${sig.trendDaily} buy:${sig.isBuy}(${sig.signalType||'─'})`);
      if(!sig||!sig.isBuy) continue;

      const today = new Date().toISOString().split('T')[0];
      const key   = `${sig.sym}_${today}`;
      if(alerted[key]) continue;
      alerted[key] = true;
      setTimeout(()=>delete alerted[key], BLOCK_HOURS*60*60*1000);

      const ok = await sendSignal(sig);
      if(ok) { sigCount++; found++; }
    }
    await new Promise(r=>setTimeout(r,500));
  }

  if(found===0) log(`Sin señales · ${syms.length} activos analizados`);
}

// ── SCHEDULER ────────────────────────────────
function scheduleDailySummary() {
  const et    = getET();
  const today = et.toISOString().split('T')[0];
  const hour  = et.getHours();
  const min   = et.getMinutes();

  // Reset Hull Lock bars diario al abrir mercado
  if(hour===9&&min===30) {
    Object.keys(hullLock).forEach(sym => {
      if(hullLock[sym].bars > 12) {
        hullLock[sym].bars = 0;
        hullLock[sym].flipTime = Date.now();
      }
    });
    log('🔄 Hull Lock reseteado para el nuevo día');
  }

  // Buenos días 9:25am ET
  if(hour===9&&min>=25&&min<=35&&morningMsgSent!==today) {
    morningMsgSent = today;
    const fecha = et.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'});
    sendTG(TG_GROUP,
      `Buenos dias equipo! Agente activo\n`
      +`━━━━━━━━━━━━━━━━━━━━\n`
      +`Fecha: ${fecha}\n`
      +`Watchlist: ${WATCHLIST.length} activos\n`
      +`SPY: ${spyScore}% ${marketOK?'Mercado OK':'Mercado neutral'}\n`
      +`WebSocket: ${wsConnected?'Tiempo real activo':'REST API'}\n`
      +`━━━━━━━━━━━━━━━━━━━━\n`
      +`Mercado abre en 5 minutos\n`
      +`Buenas operaciones!`
    );
  }

  // Resumen 4pm ET
  if(hour===16&&min<=10&&summarySentToday!==today) {
    summarySentToday = today;
    sendDailySummary();
  }
}

// ════════════════════════════════════════════
//  INICIO
// ════════════════════════════════════════════
async function main() {
  log('🚀 Agente Trading PRO iniciando...');
  log(`📊 Watchlist: ${WATCHLIST.length} activos`);
  log(`⚡ Datos: Polygon WebSocket tiempo real`);
  log(`📊 Multi-timeframe: 1D + 1H`);
  log(`🎯 Score mínimo: ${MIN_SCORE}%`);
  log(`🛑 Stop: ATR dinámico`);

  // Conectar WebSocket para datos en tiempo real
  connectWebSocket();

  // Mensaje de inicio
  await sendTG(TG_GROUP,
    `🤖 Agente Trading PRO iniciado\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`✅ Corriendo en la nube 24/7\n`
    +`⚡ Polygon WebSocket tiempo real\n`
    +`📊 Analisis multi-timeframe 1D + 1H\n`
    +`🛑 Stop dinamico por ATR\n`
    +`📊 ${WATCHLIST.length} activos monitoreados\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Horarios ET:\n`
    +`Pre-market: 4:00am - 9:30am\n`
    +`Mercado: 9:30am - 4:00pm\n`
    +`Post-market: 4:00pm - 8:00pm\n`
    +`🤖 @Buyscanertradyng_bot`
  );

  await checkSPY();
  await runScan();

  setInterval(async () => {
    await runScan();
    await runRadarTop5();
    await sendHourlyStatus();
    scheduleDailySummary();
  }, INTERVAL*60*1000);
}

main().catch(e=>{
  console.error('Error fatal:', e);
  process.exit(1);
});
