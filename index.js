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
  // Tus acciones principales
  {sym:'TSLA', name:'Tesla Inc',             sector:'tech'},
  {sym:'ORCL', name:'Oracle Corporation',    sector:'tech'},
  {sym:'TALO', name:'Talos Energy',          sector:'energy'},
  {sym:'AMPL', name:'Amplitude Inc',         sector:'tech'},
  {sym:'QUBT', name:'Quantum Computing',     sector:'tech'},
  {sym:'NVTS', name:'Navitas Semi',          sector:'semi'},
  {sym:'AMPX', name:'Amprius Tech',          sector:'energy'},
  {sym:'UUUU', name:'Energy Fuels',          sector:'energy'},
  {sym:'ICHR', name:'Ichor Holdings',        sector:'semi'},
  {sym:'SOXL', name:'Direxion Semi 3x',      sector:'semi'},
  {sym:'AMD',  name:'AMD Inc',               sector:'semi'},
  {sym:'PLTR', name:'Palantir',              sector:'tech'},
  {sym:'OKLO', name:'Oklo Inc',              sector:'energy'},
  {sym:'SOUN', name:'SoundHound AI',         sector:'tech'},
  {sym:'IONQ', name:'IonQ Quantum',          sector:'tech'},
  {sym:'MARA', name:'Marathon Digital',      sector:'tech'},
  {sym:'HOOD', name:'Robinhood',             sector:'tech'},
  {sym:'SOFI', name:'SoFi Technologies',     sector:'tech'},
  {sym:'SMR',  name:'NuScale Power',         sector:'energy'},
  {sym:'RIVN', name:'Rivian',                sector:'tech'},
  {sym:'COIN', name:'Coinbase Global',       sector:'tech'},
];

// Scanner dinámico — universo amplio de empresas NO en watchlist
// Tecnología, Semiconductores, Energía, IA, Biotech · Rango $3-$50
const SCANNER = [
  // ── SEMICONDUCTORES ──
  {sym:'WOLF', name:'Wolfspeed',             sector:'semi'},
  {sym:'COHU', name:'Cohu Inc',              sector:'semi'},
  {sym:'FORM', name:'FormFactor',            sector:'semi'},
  {sym:'AEHR', name:'Aehr Test Systems',     sector:'semi'},
  {sym:'ACLS', name:'Axcelis Technologies',  sector:'semi'},
  {sym:'ONTO', name:'Onto Innovation',       sector:'semi'},
  {sym:'KLIC', name:'Kulicke & Soffa',       sector:'semi'},
  {sym:'DIOD', name:'Diodes Inc',            sector:'semi'},
  {sym:'SITM', name:'SiTime Corp',           sector:'semi'},
  {sym:'POWI', name:'Power Integrations',    sector:'semi'},
  {sym:'MPWR', name:'Monolithic Power',      sector:'semi'},
  {sym:'ALGM', name:'Allegro MicroSystems',  sector:'semi'},
  {sym:'AMBA', name:'Ambarella Inc',         sector:'semi'},
  {sym:'CRUS', name:'Cirrus Logic',          sector:'semi'},
  {sym:'SMTC', name:'Semtech Corp',          sector:'semi'},
  // ── TECNOLOGÍA / IA ──
  {sym:'BBAI', name:'BigBear.ai',            sector:'tech'},
  {sym:'ASAN', name:'Asana Inc',             sector:'tech'},
  {sym:'DOMO', name:'Domo Inc',              sector:'tech'},
  {sym:'LPSN', name:'LivePerson',            sector:'tech'},
  {sym:'CLOV', name:'Clover Health',         sector:'tech'},
  {sym:'HIMS', name:'Hims & Hers Health',    sector:'tech'},
  {sym:'MAPS', name:'WM Technology',         sector:'tech'},
  {sym:'TDOC', name:'Teladoc Health',        sector:'tech'},
  {sym:'AI',   name:'C3.ai Inc',             sector:'tech'},
  {sym:'UPST', name:'Upstart Holdings',      sector:'tech'},
  {sym:'AIOT', name:'PowerFleet Inc',        sector:'tech'},
  {sym:'RCAT', name:'Red Cat Holdings',      sector:'tech'},
  {sym:'IREN', name:'Iris Energy',           sector:'tech'},
  {sym:'GFAI', name:'Guardforce AI',         sector:'tech'},
  {sym:'VNET', name:'21Vianet Group',        sector:'tech'},
  {sym:'KOSS', name:'Koss Corporation',      sector:'tech'},
  {sym:'JMIA', name:'Jumia Technologies',    sector:'tech'},
  {sym:'OPEN', name:'Opendoor Tech',         sector:'tech'},
  {sym:'COUR', name:'Coursera Inc',          sector:'tech'},
  {sym:'XMTR', name:'Xometry Inc',           sector:'tech'},
  // ── ENERGÍA LIMPIA / NUCLEAR ──
  {sym:'PLUG', name:'Plug Power',            sector:'energy'},
  {sym:'FCEL', name:'FuelCell Energy',       sector:'energy'},
  {sym:'BLNK', name:'Blink Charging',        sector:'energy'},
  {sym:'CHPT', name:'ChargePoint Holdings',  sector:'energy'},
  {sym:'BE',   name:'Bloom Energy',          sector:'energy'},
  {sym:'NKLA', name:'Nikola Corporation',    sector:'energy'},
  {sym:'CLNE', name:'Clean Energy Fuels',    sector:'energy'},
  {sym:'GEVO', name:'Gevo Inc',              sector:'energy'},
  {sym:'PNTM', name:'Pontem Energy',         sector:'energy'},
  {sym:'MVST', name:'Microvast Holdings',    sector:'energy'},
  {sym:'SUNW', name:'Sunworks Inc',          sector:'energy'},
  {sym:'SPWR', name:'SunPower Corp',         sector:'energy'},
  {sym:'ARRY', name:'Array Technologies',    sector:'energy'},
  {sym:'FLNC', name:'Fluence Energy',        sector:'energy'},
  {sym:'SHLS', name:'Shoals Technologies',   sector:'energy'},
  // ── QUANTUM / COMPUTACIÓN AVANZADA ──
  {sym:'RGTI', name:'Rigetti Computing',     sector:'tech'},
  {sym:'QBTS', name:'D-Wave Quantum',        sector:'tech'},
  {sym:'KULR', name:'KULR Technology',       sector:'tech'},
  {sym:'MVIS', name:'MicroVision',           sector:'tech'},
  {sym:'ARQQ', name:'Arqit Quantum',         sector:'tech'},
  // ── CRIPTO / BLOCKCHAIN ──
  {sym:'RIOT', name:'Riot Platforms',        sector:'tech'},
  {sym:'CIFR', name:'Cipher Mining',         sector:'tech'},
  {sym:'HUT',  name:'Hut 8 Mining',          sector:'tech'},
  {sym:'BTBT', name:'Bit Digital',           sector:'tech'},
  {sym:'CLSK', name:'CleanSpark Inc',        sector:'tech'},
  // ── FINTECH / PAGOS ──
  {sym:'DAVE', name:'Dave Inc',              sector:'tech'},
  {sym:'STEP', name:'StepStone Group',       sector:'tech'},
  {sym:'CURO', name:'Curo Group',            sector:'tech'},
  {sym:'RELY', name:'Remitly Global',        sector:'tech'},
  {sym:'FLYW', name:'Flywire Corp',          sector:'tech'},
  // ── SALUD / BIOTECH ──
  {sym:'ACMR', name:'ACM Research',          sector:'tech'},
  {sym:'EVER', name:'EverCommerce',          sector:'tech'},
  {sym:'DOCS', name:'Doximity Inc',          sector:'tech'},
  {sym:'ONEM', name:'1Life Healthcare',      sector:'tech'},
  {sym:'CERT', name:'Certara Inc',           sector:'tech'},
];

// IDs de watchlist para excluir del scanner
const WATCHLIST_SYMS = new Set(WATCHLIST.map(u=>u.sym));

// ── STATE ────────────────────────────────────
let hullLock    = {};
let hullLockR   = {}; // hull lock para el radar
let alerted     = {};
let marketOK    = true;
let spyScore    = 0;
let scanCount   = 0;
let sigCount    = 0;
let startTime   = Date.now();
let radarScores = {}; // scores del radar Top5
let top5Sent    = ''; // fecha del último Top5 enviado
let openTrades  = {}; // trades abiertos monitoreando precio
let tradeDiary  = []; // historial de trades del día

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
  const from = new Date(to - 30*864e5);
  const fmt  = d => d.toISOString().split('T')[0];

  // Polygon — velas de 1 HORA con volumen
  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/hour/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=500&apiKey=${POLY}`;
    const r = await fetchT(url, 6000);
    const d = await r.json();
    if(d?.results?.length>=40) {
      log(`${sym}: ${d.results.length} velas 1H desde Polygon`);
      return {
        closes:  d.results.map(b=>+b.c.toFixed(2)),
        volumes: d.results.map(b=>b.v||0),
        highs:   d.results.map(b=>+b.h.toFixed(2)),
        lows:    d.results.map(b=>+b.l.toFixed(2)),
      };
    }
  } catch(e) {}

  // Yahoo como respaldo
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1h&range=30d`;
    const r = await fetchT(url, 6000);
    const d = await r.json();
    const q  = d?.chart?.result?.[0]?.indicators?.quote?.[0];
    const cl = q?.close?.filter(v=>v!=null&&v>0).map(v=>+v.toFixed(2));
    const vl = q?.volume?.map(v=>v||0) || [];
    const hi = q?.high?.filter(v=>v!=null).map(v=>+v.toFixed(2)) || [];
    const lo = q?.low?.filter(v=>v!=null).map(v=>+v.toFixed(2)) || [];
    if(cl?.length>=40) {
      log(`${sym}: ${cl.length} velas 1H desde Yahoo`);
      return {closes:cl, volumes:vl, highs:hi, lows:lo};
    }
  } catch(e) {}

  return null;
}

// ── ANALYZE ──────────────────────────────────
// Helper para retorno base
function returnBase(sym, price, hullUp, hullFlip, hl, score, rsiV) {
  return {
    sym, price:+price.toFixed(2),
    hullUp, hullFlip, hullBars:hl.bars,
    score, isBuy:false, rsiV, ema9Turn:false,
    t1:+(price*1.02).toFixed(2),
    t2:+(price*1.03).toFixed(2),
    sl:+(price*0.985).toFixed(2)
  };
}

function analyze(sym, bars) {
  // Aceptar tanto array simple como objeto con closes/volumes
  const d = Array.isArray(bars) ? bars : bars?.closes;
  const volumes = Array.isArray(bars) ? [] : (bars?.volumes||[]);
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

  // Análisis de volumen
  const volCurrent = volumes.length>0 ? volumes[volumes.length-1] : 0;
  const volAvg20   = volumes.length>=20 ? volumes.slice(-21,-1).reduce((a,b)=>a+b,0)/20 : 0;
  const volRatio   = volAvg20>0 ? +(volCurrent/volAvg20).toFixed(2) : 0;
  const highVolume = volRatio >= 1.5; // volumen 1.5x el promedio

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
  hl.bars    = Math.floor((Date.now()-hl.flipTime)/(60*60*1000)); // barras de 1H

  // EMA9 cambio de tendencia — de bajar a subir (independiente de MA20)
  // Necesitamos 3 valores de EMA9 para detectar el cambio de dirección
  const ma9prev  = d.length>2 ? ema(d.slice(0,-1), 9) : null;
  const ma9prev2 = d.length>3 ? ema(d.slice(0,-2), 9) : null;

  // EMA9 cambia de dirección alcista:
  // Barra 2 atrás: EMA9 bajaba (ma9prev2 > ma9prev)
  // Barra actual:  EMA9 sube    (ma9 > ma9prev)
  const ema9TurnUp = !!(ma9&&ma9prev&&ma9prev2
    && ma9 > ma9prev      // ahora EMA9 está subiendo
    && ma9prev <= ma9prev2); // antes EMA9 estaba bajando o plana

  // EMA9 ya en tendencia alcista (lleva subiendo)
  const ema9Trending = !!(ma9&&ma9prev&&ma9>ma9prev);

  // Score
  let pts=0, max=0;
  const add = (ok,w) => {max+=w; if(ok) pts+=w;};
  add(hullUp,         4); // Hull16 apunta alcista
  add(ema9TurnUp,     5); // EMA9 cambió a tendencia alcista
  add(ema9Trending,   2); // EMA9 subiendo
  add(!!(ma20&&ma40&&ma20>ma40), 2); // MA20 sobre MA40
  add(!!(rsiV&&rsiV>=35&&rsiV<=68), 2); // RSI zona sana
  add(price>(h16||price), 2); // precio sobre Hull16
  add(highVolume, 3); // volumen alto — confirmador importante
  const score = max>0 ? Math.round(pts/max*100) : 50;

  // Condiciones BUY
  const session    = getMarketSession();
  const isExtended = session==='PREMARKET' || session==='POSTMARKET';
  // Extended hours: más estricto — score 80%, solo activos de alto volumen
  const HIGH_VOL   = ['TSLA','AMD','PLTR','SOXL','MARA','HOOD','SOFI','RIVN','ORCL'];
  const isHighVol  = HIGH_VOL.includes(sym);
  const minScore   = isExtended ? 80 : MIN_SCORE; // 80% en extended, 70% en regular
  const minBars    = isExtended ? 2 : 2;           // 2 barras siempre
  const rsiMin     = isExtended ? 40 : 35;
  const rsiMax     = isExtended ? 65 : 68;         // RSI más estricto en extended

  // BUY requiere:
  // 1. Hull16 flipea a alcista ↑
  // 2. EMA9 cambió de dirección a alcista ↑ (o ya viene subiendo)
  // 3. Score mínimo
  // 4. RSI en zona válida
  const ema9Ok = ema9TurnUp || ema9Trending;

  // En extended hours solo activos de alto volumen
  if(isExtended && !isHighVol) return {...returnBase(sym,price,hullUp,hullFlip,hl,score,rsiV), isBuy:false};

  const isBuy = hullFlip && hullUp
    && ema9Ok
    && score >= minScore
    && hl.bars >= minBars
    && (rsiV===null||(rsiV>=rsiMin&&rsiV<=rsiMax));

  // ATR estimado para stop dinámico
  const recentRange = d.slice(-10).map((v,i,a)=>i>0?Math.abs(v-a[i-1]):0).reduce((a,b)=>a+b,0)/10;
  const dynamicSL   = +(price - recentRange*1.5).toFixed(2);

  return {
    sym, price:+price.toFixed(2),
    hullUp, hullFlip, hullBars:hl.bars,
    score, isBuy, rsiV,
    ema9Turn: ema9TurnUp,
    volRatio, highVolume,
    t1: +(price*1.02).toFixed(2),
    t2: +(price*1.03).toFixed(2),
    t3: +(price*1.04).toFixed(2),
    sl: +(price*0.985).toFixed(2),
    dynamicSL: dynamicSL < price ? dynamicSL : +(price*0.985).toFixed(2),
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
    log(`📤 Enviando TG a ${chatId}...`);
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id:chatId, text:msg})
    });
    const d = await r.json();
    if(d.ok) {
      log(`✅ TG enviado a ${chatId}`);
    } else {
      log(`❌ TG error ${chatId}: ${d.description} (code ${d.error_code})`);
    }
    return d.ok;
  } catch(e) {
    log(`❌ TG excepcion ${chatId}: ${e.message}`);
    return false;
  }
}

async function sendSignal(sig) {
  const u       = WATCHLIST.find(u=>u.sym===sig.sym)||{name:sig.sym};
  const hora    = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  const session = getMarketSession();
  const sesLabel= session==='PREMARKET'  ? '⚡ PRE-MARKET'
                : session==='POSTMARKET' ? '🌙 POST-MARKET'
                : '📊 MERCADO ABIERTO';

  // Calidad de la señal
  const calidad = sig.score>=85 ? '🔥 MUY ALTA'
                : sig.score>=75 ? '✅ ALTA'
                : '🟡 MEDIA';

  // Hora óptima
  const etH = getET().getHours();
  const etM = getET().getMinutes();
  const etMin = etH*60+etM;
  const horaOptima = (etMin>=570&&etMin<=660)||(etMin>=840&&etMin<=960);
  const horaMsg = horaOptima ? '✅ Hora óptima de entrada' : '⚠️ Hora no óptima · mayor cautela';

  const sesWarn = session==='PREMARKET'
    ? '\n⚠️ PRE-MARKET · Usar orden límite · Posición reducida'
    : session==='POSTMARKET'
    ? '\n⚠️ POST-MARKET · Baja liquidez · Posición reducida'
    : '';

  const msg =
    `📈 SEÑAL DE COMPRA — ${sesLabel}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🏢 ${sig.sym} — ${u.name}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`📊 ANÁLISIS DE ENTRADA:\n`
    +`💵 Precio entrada: $${sig.price}\n`
    +`⭐ Calidad señal: ${calidad} (${sig.score}%)\n`
    +`⏰ ${horaMsg}\n`
    +`🌎 SPY: ${spyScore}% ${marketOK?'✅ Mercado alcista':'⚠️ Mercado neutral'}\n`
    +`📊 Hull16: ALCISTA ↑ · ${sig.hullBars} hora(s)\n`
    +(sig.ema9Turn?`📊 EMA9: Giró ALCISTA ↑ (señal fuerte)\n`:`📊 EMA9: Tendencia alcista\n`)
    +(sig.volRatio>0?`📦 Volumen: ${sig.volRatio}x promedio ${sig.highVolume?'✅ ALTO':'⚠️ normal'}\n`:'')
    +`📉 RSI: ${sig.rsiV||'─'} ${sig.rsiV&&sig.rsiV<50?'(zona de compra)':sig.rsiV&&sig.rsiV<65?'(zona sana)':''}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🎯 PLAN DE TRADING:\n`
    +`🟢 ENTRAR: $${sig.price}\n`
    +`📈 Target 1 (+2%): $${sig.t1} → vender 50%\n`
    +`📈 Target 2 (+3%): $${sig.t2} → vender 30%\n`
    +`📈 Target 3 (+4%): $${sig.t3} → vender 20%\n`
    +`🛑 Stop Loss: $${sig.sl} (-1.5%)\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`💡 INSTRUCCIONES:\n`
    +`1. Confirmar en TradingView\n`
    +`2. Usar máximo 2% del capital\n`
    +`3. Colocar stop en $${sig.sl} ANTES de entrar\n`
    +`4. Al llegar T1 mover stop a entrada\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`${hora} ET${sesWarn}`;

  // Enviar al grupo
  const ok = await sendTG(TG_GROUP, msg);
  if(ok) {
    log(`✅ Telegram → grupo: ${sig.sym}`);
    // Registrar trade abierto para seguimiento y diario
    const tradeRecord = {
      sym:    sig.sym,
      entry:  sig.price,
      t1:     sig.t1,
      t2:     sig.t2,
      sl:     sig.sl,
      time:   Date.now(),
      hora:   new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}),
      bars:   0,
      result: 'OPEN',
      exit:   null,
      pnl:    null
    };
    openTrades[sig.sym] = tradeRecord;
    tradeDiary.push(tradeRecord);
    log(`📋 Trade abierto: ${sig.sym} entrada $${sig.price} · T1 $${sig.t1} · Stop $${sig.sl}`);
  }
  return ok;
}

// ── TOP 5 RADAR ──────────────────────────────
async function analyzeRadar(sym, d, lock) {
  if(!d||d.length<40) return null;
  const price = d[d.length-1];

  // Filtro rango $5-$20
  if(price < 3 || price > 50) return null;

  const h16   = hma16(d);
  const h16p  = d.length>17 ? hma16(d.slice(0,-1)) : null;
  const h16pp = d.length>18 ? hma16(d.slice(0,-2)) : null;
  const ma9   = ema(d,9);
  const ma9p  = d.length>2  ? ema(d.slice(0,-1),9) : null;
  const ma9p2 = d.length>3  ? ema(d.slice(0,-2),9) : null;
  const ma20  = sma(d,20);
  const ma40  = sma(d,40);
  const rsiV  = rsi14(d);
  if(!h16||!ma20) return null;

  const hullUp   = h16p ? h16>h16p : true;
  const hullFlip = h16&&h16p&&h16pp ? ((h16>h16p)!==(h16p>h16pp)) : false;

  if(!lock[sym]) lock[sym]={dir:hullUp?'UP':'DOWN',flipTime:Date.now(),bars:0};
  else if(hullFlip){const nd=hullUp?'UP':'DOWN';if(lock[sym].dir!==nd)lock[sym]={dir:nd,flipTime:Date.now(),bars:0};}
  lock[sym].bars = Math.floor((Date.now()-lock[sym].flipTime)/(60*60*1000));

  const ema9TurnUp = !!(ma9&&ma9p&&ma9p2&&ma9>ma9p&&ma9p<=ma9p2);

  let pts=0,max=0;
  const add=(ok,w)=>{max+=w;if(ok)pts+=w;};
  add(hullUp,4);
  add(ema9TurnUp,5);
  add(!!(ma9&&ma9p&&ma9>ma9p),2);
  add(!!(ma20&&ma40&&ma20>ma40),2);
  add(!!(rsiV&&rsiV>=35&&rsiV<=68),2);
  add(price>(h16||price),2);
  const score = max>0 ? Math.round(pts/max*100) : 50;

  return {
    sym, price:+price.toFixed(2), score,
    hullUp, hullFlip, bars:lock[sym].bars,
    rsiV, ema9Turn:ema9TurnUp,
    t1:+(price*1.02).toFixed(2),
    t2:+(price*1.03).toFixed(2),
    sl:+(price*0.985).toFixed(2),
  };
}

async function runRadarTop5() {
  const today = new Date().toISOString().split('T')[0];
  if(top5Sent === today) return; // ya se envió hoy

  // Solo enviar entre 9:30am y 10:30am ET
  const et = getET();
  const t  = et.getHours()*60 + et.getMinutes();
  if(t < 570 || t > 630) return;

  log(`⭐ Scanner dinámico — ${SCANNER.length} empresas nuevas...`);
  const scores = [];

  // Escanear SOLO empresas del scanner (distintas a watchlist)
  for(let i=0; i<SCANNER.length; i+=4) {
    const batch = SCANNER.slice(i,i+4).filter(u=>!WATCHLIST_SYMS.has(u.sym));
    const res = await Promise.all(batch.map(async u => {
      try {
        const bars = await fetchBars(u.sym);
        if(bars?.length>=40) {
          const sig = await analyzeRadar(u.sym, bars, hullLockR);
          if(sig) return {...sig, sector:u.sector, name:u.name};
        }
      } catch(e){}
      return null;
    }));
    res.forEach(r=>{ if(r) scores.push(r); });
    await new Promise(r=>setTimeout(r,300));
  }

  if(!scores.length) { log('Radar: sin datos suficientes'); return; }

  // Ordenar por score y tomar Top 5
  const top5 = scores
    .sort((a,b) => b.score - a.score)
    .slice(0,5);

  const hora = et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
  const sectorIcon = {tech:'💻',semi:'🔬',energy:'⚡'};

  let msg = `👀 RADAR DIARIO — TOP 5 PARA SEGUIMIENTO\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`⚠️ ESTAS SON PARA VIGILAR, NO PARA COMPRAR\n`
    +`Esperar señal de COMPRA separada del agente\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`📊 Fuera de watchlist fija · Velas 1H\n`
    +`🌎 SPY: ${spyScore}% · ${hora} ET\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`;

  top5.forEach((s,i) => {
    const ic = sectorIcon[s.sector]||'📊';
    const estado = s.hullUp&&s.score>=65?'👀 VIGILAR':s.hullUp?'👀 VIGILAR':'⚪ ESPERAR';
    msg += `${medals[i]} ${ic} *${s.sym}* — ${s.name}\n`
      +`   ${estado} · Score: ${s.score}%\n`
      +`   💵 $${s.price} · T1: $${s.t1} · Stop: $${s.sl}\n`
      +(s.rsiV?`   RSI: ${s.rsiV}\n`:'')
      +(i<top5.length-1?`─────────────────────\n`:'');
  });

  msg += `━━━━━━━━━━━━━━━━━━━━\n`
    +`Si el agente detecta señal de COMPRA\n`
    +`te llegara un mensaje separado con:\n`
    +`📈 SEÑAL DE COMPRA — [SIMBOLO]\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`🤖 @Buyscanertradyng_bot`;

  await sendTG(TG_GROUP, msg);
  await sendTG(TG_FELIPE, msg);
  top5Sent = today;
  log(`✅ Top5 enviado: ${top5.map(s=>s.sym).join(', ')}`);
}

// ── SCANNER DE SEÑALES EN TIEMPO REAL ────────
// Corre igual que el watchlist pero con el universo del scanner
async function runScannerSignals() {
  const session = getMarketSession();
  if(session==='WEEKEND'||session==='CLOSED') return;
  if(!marketOK && session==='OPEN') return;

  log(`🔭 Scanner dinámico: ${SCANNER.length} empresas...`);
  let found = 0;

  for(let i=0; i<SCANNER.length; i+=4) {
    const batch = SCANNER.slice(i,i+4).filter(u=>!WATCHLIST_SYMS.has(u.sym));
    const res = await Promise.all(batch.map(async u => {
      try {
        const bars = await fetchBars(u.sym);
        if(bars?.closes?.length>=40||bars?.length>=40) {
          const sig = analyze(u.sym, bars);
          if(sig) return {...sig, name:u.name, sector:u.sector};
        }
      } catch(e){}
      return null;
    }));

    for(const sig of res) {
      if(!sig||!sig.isBuy) continue;

      // Verificar precio en rango $3-$50
      if(sig.price < 3 || sig.price > 50) continue;

      // Bloqueo por símbolo
      const today = new Date().toISOString().split('T')[0];
      const key   = `SCAN_${sig.sym}_${today}`;
      if(alerted[key]) continue;
      alerted[key] = true;
      setTimeout(()=>delete alerted[key], BLOCK_HOURS*60*60*1000);

      log(`🔭 SCANNER SEÑAL: ${sig.sym} $${sig.price} Score:${sig.score}%`);

      // Enviar señal igual que watchlist pero con etiqueta SCANNER
      const hora = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
      const sectorIcon = {tech:'💻',semi:'🔬',energy:'⚡'};
      const ic = sectorIcon[sig.sector]||'📊';

      const msg =
        `🔭 *SEÑAL SCANNER — ${ic} ${sig.sym}*
`
        +`━━━━━━━━━━━━━━━━━━━━
`
        +`🏢 *${sig.sym}* — ${sig.name}
`
        +`💵 Precio: *$${sig.price}*
`
        +`📊 Confianza: *${sig.score}%*
`
        +`🌎 SPY: ${spyScore}%
`
        +`━━━━━━━━━━━━━━━━━━━━
`
        +`✅ Target +2%: *$${sig.t1}*
`
        +`✅ Target +3%: *$${sig.t2}*
`
        +`🛑 Stop -1.5%: *$${sig.sl}*
`
        +`━━━━━━━━━━━━━━━━━━━━
`
        +`🎯 Hull16 ALCISTA ↑ · ${sig.hullBars} hora(s)
`
        +(sig.ema9Turn?`📊 EMA9 giró ALCISTA ↑
`:`📊 EMA9 tendencia alcista
`)
        +`⏰ ${hora} ET
`
        +`💡 Esta acción no está en tu watchlist fija`;

      const ok = await sendTG(TG_GROUP, msg);
      if(ok) {
        sigCount++; found++;
        // Registrar en trades abiertos para seguimiento de salida
        const tradeRecord = {
          sym:sig.sym, entry:sig.price, t1:sig.t1, t2:sig.t2, sl:sig.sl,
          time:Date.now(),
          hora:new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}),
          bars:0, result:'OPEN', exit:null, pnl:null
        };
        openTrades[sig.sym] = tradeRecord;
        tradeDiary.push(tradeRecord);
      }
    }
    await new Promise(r=>setTimeout(r,400));
  }

  if(found>0) log(`🔭 Scanner: ${found} señales nuevas`);
  else log(`🔭 Scanner: sin señales nuevas · ${SCANNER.length} empresas analizadas`);
}

async function sendDailySummary() {
  const upMins = Math.round((Date.now()-startTime)/60000);

  // Calcular estadísticas del diario
  const wins   = tradeDiary.filter(t=>t.result==='WIN+2'||t.result==='WIN+3');
  const losses = tradeDiary.filter(t=>t.result==='LOSS');
  const open   = tradeDiary.filter(t=>t.result==='OPEN');
  const closed = wins.length + losses.length;
  const rate   = closed>0 ? Math.round(wins.length/closed*100) : 0;
  const pnlNet = tradeDiary.filter(t=>t.pnl!==null).reduce((a,t)=>a+(t.pnl||0),0);

  let msg =
    `📋 *RESUMEN DEL DÍA*\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`;

  // Detalle de cada trade
  if(tradeDiary.length>0) {
    tradeDiary.forEach(t => {
      const icon = t.result==='WIN+2'||t.result==='WIN+3'?'✅':t.result==='LOSS'?'🛑':'⏳';
      const res  = t.result==='WIN+2'?'+2%':t.result==='WIN+3'?'+3%':t.result==='LOSS'?'-1.5%':'abierto';
      msg += `${icon} *${t.sym}* $${t.entry} → ${t.exit?'$'+t.exit:'-'} *${res}* · ${t.hora} ET\n`;
    });
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Total: ${tradeDiary.length} · ✅ ${wins.length} · 🛑 ${losses.length} · ⏳ ${open.length}\n`;
    msg += `🎯 Tasa: *${rate}%* · P&L neto: *${pnlNet>=0?'+':''}${pnlNet.toFixed(1)}%*\n`;
  } else {
    msg += `Sin trades hoy\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`
    +`🔍 Escaneos: ${scanCount} · Señales: ${sigCount}\n`
    +`🌎 SPY: ${spyScore}% · Activo ${upMins<60?upMins+'m':Math.floor(upMins/60)+'h'}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Hasta mañana 👋`;

  await sendTG(TG_GROUP, msg);
  await sendTG(TG_FELIPE, msg);

  // Limpiar diario para el día siguiente
  tradeDiary = [];
  log(`📋 Resumen enviado · ${tradeDiary.length} trades registrados`);
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

// ── MONITOREO DE SALIDAS ─────────────────────
async function checkExits() {
  const openSyms = Object.keys(openTrades);
  if(!openSyms.length) return;

  log(`👀 Monitoreando salidas: ${openSyms.join(', ')}`);

  for(const sym of openSyms) {
    const trade = openTrades[sym];
    try {
      // Obtener precio actual
      const barsData = await fetchBars(sym);
      const bars = Array.isArray(barsData) ? barsData : barsData?.closes;
      if(!bars||!bars.length) continue;
      const price = bars[bars.length-1];
      trade.bars++;

      // ── SEÑAL DE SALIDA 1: TARGET +2% ──
      if(price >= trade.t1) {
        const ganoPct = +(((price-trade.entry)/trade.entry)*100).toFixed(2);
        log(`🎯 TARGET ALCANZADO: ${sym} $${price} ≥ T1 $${trade.t1} (+${ganoPct}%)`);
        const horaExit = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
        await sendTG(TG_GROUP,
          `✅ SEÑAL DE VENTA PARCIAL — ${sym}\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`📊 TARGET +2% ALCANZADO\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`💵 Entrada:   $${trade.entry}\n`
          +`💰 Precio:    $${price.toFixed(2)}\n`
          +`📈 Ganancia:  +${ganoPct}%\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`🎯 ACCIÓN RECOMENDADA:\n`
          +`1. VENDER 50% de tu posición AHORA\n`
          +`2. Mover stop a precio de entrada $${trade.entry}\n`
          +`3. Dejar el resto correr hacia T2 $${trade.t2}\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`${horaExit} ET`
        );
        // Actualizar trade — subir stop a entrada (trailing)
        trade.sl    = trade.entry; // stop a break-even
        trade.t1Hit = true;
        log(`📋 Stop movido a entrada $${trade.entry} (break-even)`);

        // Si llega a T2 (+3%) cerrar completamente
        if(price >= trade.t2) {
          const pnl2 = +(((price-trade.entry)/trade.entry)*100).toFixed(2);
          await sendTG(TG_GROUP,
            `🏆 SEÑAL DE VENTA TOTAL — ${sym}\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`📊 TARGET +3% ALCANZADO\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`💵 Entrada:  $${trade.entry}\n`
            +`💰 Precio:   $${price.toFixed(2)}\n`
            +`📈 Ganancia: +${pnl2}%\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`🎯 ACCIÓN: CERRAR POSICIÓN COMPLETA\n`
            +`Vender el 100% restante ahora\n`
            +`Excelente trade! 🎉`
          );
          // Registrar en diario
          trade.result = 'WIN+3';
          trade.exit   = +price.toFixed(2);
          trade.pnl    = pnl2;
          delete openTrades[sym];
          log(`✅ Trade cerrado +3%: ${sym}`);
        } else {
          // Registrar T1 hit en diario
          trade.result = 'WIN+2';
          trade.exit   = +price.toFixed(2);
          trade.pnl    = ganoPct;
        }
        continue;
      }

      // ── SEÑAL DE SALIDA 2: STOP LOSS -1.5% ──
      if(price <= trade.sl) {
        const perdPct = +(((price-trade.entry)/trade.entry)*100).toFixed(2);
        log(`🛑 STOP ACTIVADO: ${sym} $${price} ≤ Stop $${trade.sl} (${perdPct}%)`);
        const horaStop = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
        await sendTG(TG_GROUP,
          `🛑 SEÑAL DE VENTA — STOP LOSS ${sym}\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`📊 STOP LOSS ACTIVADO\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`💵 Entrada:   $${trade.entry}\n`
          +`💰 Precio:    $${price.toFixed(2)}\n`
          +`📉 Resultado: ${perdPct}%\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`🎯 ACCIÓN INMEDIATA:\n`
          +`VENDER TODO ahora al precio de mercado\n`
          +`No esperar — el stop protege tu capital\n`
          +`━━━━━━━━━━━━━━━━━━━━\n`
          +`El sistema te protegió. Siguiente oportunidad!\n`
          +`${horaStop} ET`
        );
        // Registrar en diario
        trade.result = 'LOSS';
        trade.exit   = +price.toFixed(2);
        trade.pnl    = perdPct;
        delete openTrades[sym];
        log(`📋 Trade cerrado por stop: ${sym}`);
        continue;
      }

      // ── SEÑAL DE SALIDA 3: Hull16 gira bajista ──
      if(bars.length>=40) {
        const sig = analyze(sym, bars);
        if(sig && !sig.hullUp && trade.bars >= 2) {
          log(`⚠️ Hull16 giró bajista: ${sym} — considerar salida`);
          const pnlNow = +(((price-trade.entry)/trade.entry)*100).toFixed(2);
          await sendTG(TG_GROUP,
            `⚠️ ALERTA DE TENDENCIA — ${sym}\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`Hull16 GIRÓ BAJISTA\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`💵 Entrada:  $${trade.entry}\n`
            +`💰 Precio:   $${price.toFixed(2)}\n`
            +`📊 P&L:      ${pnlNow>=0?'+':''}${pnlNow}%\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`🎯 OPCIONES:\n`
            +`${pnlNow>0?'1. Salir con ganancia ahora\n2. Mover stop a precio de entrada':'1. Salir y limitar pérdida\n2. Esperar si stop no tocado'}\n`
            +`Tú decides — stop en $${trade.sl}\n`
            +`━━━━━━━━━━━━━━━━━━━━\n`
            +`Confirmar en TradingView antes de actuar`
          );
          // No cerrar automáticamente — solo avisar
        }
      }

      log(`📊 ${sym}: $${price.toFixed(2)} · Entrada $${trade.entry} · P&L ${price>=trade.entry?'+':''}${+(((price-trade.entry)/trade.entry)*100).toFixed(2)}%`);

    } catch(e) {
      log(`Exit check ${sym}: ${e.message}`);
    }
    await new Promise(r=>setTimeout(r,500));
  }
}

// ── SCAN CYCLE ───────────────────────────────
async function runScan() {
  scanCount++;
  const session = getMarketSession();
  const open    = session==='OPEN';
  const extended= session==='PREMARKET' || session==='POSTMARKET';

  log(`=== Escaneo #${scanCount} · ${session} · Trades abiertos: ${Object.keys(openTrades).length} ===`);

  // Verificar salidas de trades abiertos PRIMERO
  await checkExits();

  // Fin de semana — no escanear
  if(session==='WEEKEND' || session==='CLOSED') {
    log('Fuera de horario · Próximo scan en horario extendido (4am ET)');
    return;
  }

  // SPY cada 3 ciclos (solo en mercado abierto)
  if(scanCount%3===1 && open) await checkSPY();

  // Pre/Post market — señales activas con criterios ajustados
  if(extended) {
    log(`⚡ HORARIO EXTENDIDO (${session}) · Score mínimo ${MIN_SCORE+10}% · RSI 40-65`);
    marketOK = true; // Sin filtro SPY en extended hours
  } else if(!open) {
    log(`${session} · Fuera de horario`);
    return;
  } else if(!marketOK) {
    log(`SPY ${spyScore}% — señales bloqueadas`);
    return;
  }

  // En horario extendido solo activos de alto volumen
  const allSyms = WATCHLIST.map(u=>u.sym);
  const highVol = ['TSLA', 'AMD', 'PLTR', 'SOXL', 'MARA', 'HOOD', 'SOFI', 'RIVN', 'IONQ', 'SOUN'];
  const syms = extended ? allSyms.filter(s=>highVol.includes(s)) : allSyms;
  if(extended) log(`⚡ Extended hours: escaneando ${syms.length} activos de alto volumen`);
  let found  = 0;

  for(let i=0; i<syms.length; i+=3) {
    const batch = syms.slice(i, i+3);
    const results = await Promise.all(batch.map(async sym => {
      try {
        const bars = await fetchBars(sym);
        if(bars?.closes?.length>=40||bars?.length>=40) return analyze(sym, bars);
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

// ── REPORTE HORARIO ───────────────────────────
async function sendHourlyStatus() {
  const session = getMarketSession();
  if(session==='WEEKEND'||session==='CLOSED') return;

  const now = Date.now();
  // Solo enviar cada 60 minutos
  if(now - lastHourlyMsg < 58*60*1000) return;
  lastHourlyMsg = now;

  const hora = getET().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});

  // Top 3 de watchlist por score
  const watchScores = [];
  for(const u of WATCHLIST.slice(0,21)) {
    try {
      const bars = await fetchBars(u.sym);
      if(bars?.closes?.length>=40||bars?.length>=40) {
        const sig = analyze(u.sym, bars);
        if(sig) watchScores.push({...sig, name:u.name, sector:u.sector||'tech'});
      }
    } catch(e){}
    await new Promise(r=>setTimeout(r,300));
  }

  // Top 3 del scanner por score
  const scanScores = [];
  const scanSample = SCANNER.filter(u=>!WATCHLIST_SYMS.has(u.sym)).slice(0,20);
  for(const u of scanSample) {
    try {
      const bars = await fetchBars(u.sym);
      if(bars?.closes?.length>=40||bars?.length>=40) {
        const sig = analyze(u.sym, bars);
        if(sig && sig.price>=3 && sig.price<=50) {
          scanScores.push({...sig, name:u.name, sector:u.sector||'tech'});
        }
      }
    } catch(e){}
    await new Promise(r=>setTimeout(r,300));
  }

  const top3Watch = watchScores.sort((a,b)=>b.score-a.score).slice(0,3);
  const top3Scan  = scanScores.sort((a,b)=>b.score-a.score).slice(0,3);

  const sesLabel = session==='PREMARKET'?'PRE-MARKET':session==='POSTMARKET'?'POST-MARKET':'MERCADO ABIERTO';

  let msg = `🤖 AGENTE ACTIVO — ${sesLabel}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`✅ Funcionando sin problemas\n`
    +`⏰ ${hora} ET · Scan #${scanCount}\n`
    +`🌎 SPY: ${spyScore}% ${marketOK?'✅ Alcista':'⚠️ Neutral'}\n`
    +`📈 Señales hoy: ${sigCount}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`;

  // Top 3 watchlist
  if(top3Watch.length>0) {
    msg += `📋 MEJORES DE TU WATCHLIST:\n`;
    top3Watch.forEach((s,i)=>{
      const estado = s.score>=75?'🟢':s.score>=65?'🟡':'⚪';
      const vol = s.volRatio>0?` · Vol ${s.volRatio}x`:'';
      msg += `${i+1}. ${estado} ${s.sym} $${s.price} · Score ${s.score}%${vol}\n`;
    });
    msg += `─────────────────────\n`;
  }

  // Top 3 scanner
  if(top3Scan.length>0) {
    msg += `🔭 MEJORES DEL RADAR:\n`;
    top3Scan.forEach((s,i)=>{
      const estado = s.score>=75?'🟢':s.score>=65?'🟡':'⚪';
      msg += `${i+1}. ${estado} ${s.sym} — ${s.name}\n`
           + `   $${s.price} · Score ${s.score}% · RSI ${s.rsiV||'─'}\n`;
    });
    msg += `─────────────────────\n`;
  }

  msg += `⚠️ Estas son para VIGILAR\n`
    +`Señal de COMPRA llega por separado\n`
    +`🤖 @Buyscanertradyng_bot`;

  await sendTG(TG_GROUP, msg);
  log(`📊 Reporte horario enviado · ${hora} ET`);
}

// ── RESUMEN AUTOMÁTICO AL CIERRE ─────────────
let summarySentToday = '';
let morningMsgSent   = '';
let lastHourlyMsg    = 0; // timestamp del último mensaje horario
let lastResults      = {}; // últimos resultados del scan para el reporte horario
function scheduleDailySummary() {
  const et    = getET();
  const today = et.toISOString().split('T')[0];
  const hour  = et.getHours();
  const min   = et.getMinutes();

  // Buenos dias — 9:25am ET (5 min antes de abrir mercado)
  if(hour===9 && min>=25 && min<=35 && morningMsgSent!==today) {
    morningMsgSent = today;
    const fecha = et.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'});
    sendTG(TG_GROUP,
      `Buenos dias equipo! Agente activo
`
      +`━━━━━━━━━━━━━━━━━━━━
`
      +`Fecha: ${fecha}
`
      +`Watchlist: ${WATCHLIST.length} activos
`
      +`Scanner: ${SCANNER.length} empresas
`
      +`SPY: ${spyScore}% ${marketOK?'Mercado OK':'Mercado neutral'}
`
      +`━━━━━━━━━━━━━━━━━━━━
`
      +`Mercado abre en 5 minutos
`
      +`Escaneo cada ${INTERVAL} minutos
`
      +`Buenas operaciones!`
    );
    log('Buenos dias enviado al grupo');
  }

  // Resumen cierre — 4:00pm a 4:10pm ET
  if(hour===16 && min<=10 && summarySentToday!==today) {
    summarySentToday = today;
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
  log(`📊 Timeframe: 1 HORA · Hull16 + EMA9 en velas de 60min`);
  log(`🎯 Score mínimo: ${MIN_SCORE}%`);
  log(`🔒 Bloqueo: ${BLOCK_HOURS} horas por señal`);

  // Mensaje de inicio al grupo
  await sendTG(TG_GROUP,
    `🤖 Agente Monitor Iniciado\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Corriendo en la nube 24/7\n`
    +`Watchlist: ${WATCHLIST.length} activos\n`
    +`Escaneo cada ${INTERVAL} minutos\n`
    +`Timeframe: velas de 1 HORA\n`
    +`Score minimo: ${MIN_SCORE}%\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Horarios activos ET:\n`
    +`Pre-market: 4:00am - 9:30am\n`
    +`Mercado: 9:30am - 4:00pm\n`
    +`Post-market: 4:00pm - 8:00pm\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Bot: @Buyscanertradyng_bot`
  );

  // SPY inicial
  await checkSPY();

  // Primer scan
  await runScan();

  // Loop cada N minutos
  setInterval(async () => {
    await runScan();           // Watchlist fija
    await runScannerSignals(); // Scanner dinámico — misma estrategia
    await runRadarTop5();      // Top5 resumen matutino
    await sendHourlyStatus();  // Reporte horario con mejores oportunidades
    scheduleDailySummary();
  }, INTERVAL * 60 * 1000);
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
