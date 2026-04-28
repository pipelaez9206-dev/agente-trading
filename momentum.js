// ============================================================
// MOMENTUM RADAR — Bot de señales de momentum en activos
// Basado en estrategia de masterclass: 1H + Diario + Bollinger
// Deploy: Railway con `node momentum.js`
// ============================================================
//
// Variables de entorno requeridas en Railway:
//   POLYGON_API_KEY            → tu key de Polygon.io
//   MOMENTUM_TELEGRAM_TOKEN    → token del bot de Telegram (BotFather)
//   MOMENTUM_CHAT_ID           → chat ID del grupo de Telegram
//
// Niveles de alerta:
//   🟡 WATCH      → 3/5 condiciones (setup formándose)
//   🟠 CERCA      → 4/5 condiciones (próximo a confirmar)
//   🟢 CONFIRMADO → 5/5 condiciones (entrada con momentum)
// ============================================================

const https = require('https');
const fs = require('fs');

// ============================================================
// CONFIGURACIÓN
// ============================================================

// Env vars flexibles: acepta varios nombres comunes para reutilizar
// la configuración del bot de opciones sin renombrar nada en Railway
const POLYGON_KEY = process.env.POLYGON_API_KEY
                 || process.env.POLYGON_KEY;
const TG_TOKEN = process.env.MOMENTUM_TELEGRAM_TOKEN
              || process.env.TELEGRAM_TOKEN
              || process.env.TELEGRAM_BOT_TOKEN
              || process.env.BOT_TOKEN
              || process.env.OPTIONS_TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.MOMENTUM_CHAT_ID
                || process.env.TELEGRAM_CHAT_ID
                || process.env.CHAT_ID
                || process.env.OPTIONS_CHAT_ID;
const PORT = process.env.PORT || 3000;

const STATE_FILE = '/tmp/momentum_state.json';
const SCAN_INTERVAL_MIN = 15;
const ALERT_COOLDOWN_HRS = 4;

// Universo curado por sectores emergentes
const CURATED_UNIVERSE = {
  'AI':       ['SOUN', 'BBAI', 'AI', 'PLTR', 'TEM', 'RXRX', 'PATH'],
  'QUANTUM':  ['IONQ', 'QUBT', 'RGTI', 'QBTS', 'ARQQ'],
  'NUCLEAR':  ['OKLO', 'SMR', 'NNE', 'LEU', 'BWXT', 'CCJ', 'UEC', 'UUUU', 'ASPI'],
  'CRYPTO':   ['MARA', 'RIOT', 'CLSK', 'BITF', 'HUT', 'IREN', 'WULF', 'CIFR'],
  'EV':       ['RIVN', 'LCID', 'CHPT', 'QS', 'EVGO', 'BLNK'],
  'DRONES':   ['KTOS', 'ACHR', 'JOBY', 'AVAV', 'ONDS'],
  'SPACE':    ['RKLB', 'ASTS', 'PL', 'BKSY', 'LUNR'],
  'ROBOTICS': ['SYM', 'ISRG', 'KSCP'],
  'BIOTECH':  ['CRSP', 'BEAM', 'NTLA', 'EDIT'],
  'SEMIS':    ['NVDA', 'AMD', 'AVGO', 'MRVL', 'ARM', 'SMCI', 'MU', 'TSM', 'SOXL']
};

// Mapeo activo → ETF inverso (solo los que tienen inverso líquido)
const INVERSE_MAP = {
  'SPY':  'SH',    'QQQ':  'PSQ',   'IWM':  'RWM',
  'TSLA': 'TSLZ',  'NVDA': 'NVDS',  'AAPL': 'AAPD',
  'MSFT': 'MSFD',  'META': 'METU',
  'SOXL': 'SOXS',  'XLK':  'REW',   'XLE':  'DUG',
  'AMD':  'SOXS'  // AMD usa SOXS sectorial como proxy
};

// ============================================================
// HELPERS DE FECHA / MERCADO
// ============================================================

function nowET() {
  // Devuelve hora actual en ET (asumiendo EDT UTC-4; ajusta a -5 en EST si lo necesitas)
  const d = new Date();
  return new Date(d.getTime() - 4 * 60 * 60 * 1000);
}

function isMarketOpen() {
  const et = nowET();
  const day = et.getUTCDay(); // 0 = domingo, 6 = sábado
  if (day === 0 || day === 6) return false;
  const totalMin = et.getUTCHours() * 60 + et.getUTCMinutes();
  return totalMin >= (9 * 60 + 30) && totalMin <= (16 * 60);
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function getSector(ticker) {
  for (const [sector, list] of Object.entries(CURATED_UNIVERSE)) {
    if (list.includes(ticker)) return sector;
  }
  return 'OTRO';
}

// ============================================================
// FETCH HELPERS — Polygon API
// ============================================================

function fetchJSON(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON: ' + data.slice(0, 100)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function fetchHourlyBars(ticker) {
  const to = formatDate(new Date());
  const from = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/hour/${from}/${to}?adjusted=true&sort=asc&limit=400&apiKey=${POLYGON_KEY}`;
  const data = await fetchJSON(url);
  if (!data.results || data.results.length < 50) return null;
  return data.results.map(b => ({
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: b.t
  }));
}

async function fetchDailyBars(ticker) {
  const to = formatDate(new Date());
  const from = formatDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=300&apiKey=${POLYGON_KEY}`;
  const data = await fetchJSON(url);
  if (!data.results || data.results.length < 50) return null;
  return data.results.map(b => ({
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: b.t
  }));
}

async function fetchTopMovers() {
  // Trae top 30 ganadores y top 30 perdedores del día
  const tickers = new Set();
  try {
    const [gainers, losers] = await Promise.all([
      fetchJSON(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${POLYGON_KEY}`),
      fetchJSON(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${POLYGON_KEY}`)
    ]);

    const filterMover = (t) => {
      const price = t.day?.c || t.lastTrade?.p || 0;
      const vol = t.day?.v || 0;
      return price >= 5 && price <= 100 && vol >= 500000;
    };

    if (gainers.tickers) {
      gainers.tickers.filter(filterMover).slice(0, 30).forEach(t => tickers.add(t.ticker));
    }
    if (losers.tickers) {
      losers.tickers.filter(filterMover).slice(0, 30).forEach(t => tickers.add(t.ticker));
    }
  } catch (e) {
    console.error('[movers] Error:', e.message);
  }
  return Array.from(tickers);
}

// ============================================================
// INDICADORES TÉCNICOS
// ============================================================

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function bollinger(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

// ============================================================
// LÓGICA DE MOMENTUM
// ============================================================

// ¿Hubo cruce reciente de A sobre B? Devuelve 'BULL' / 'BEAR' / null
function recentCross(seriesA, seriesB, lookback = 8) {
  const last = seriesA.length - 1;
  if (last < lookback || seriesA[last] == null || seriesB[last] == null) return null;
  const currentAbove = seriesA[last] > seriesB[last];
  for (let i = last - lookback; i < last; i++) {
    if (seriesA[i] == null || seriesB[i] == null) continue;
    const wasAbove = seriesA[i] > seriesB[i];
    if (currentAbove && !wasAbove) return 'BULL';
    if (!currentAbove && wasAbove) return 'BEAR';
  }
  return null;
}

// ¿La tendencia previa fue bajista (DOWN), alcista (UP) o lateral?
function priorTrend(closes, ma100, lookbackBars = 60, skipRecent = 10) {
  // Excluye las últimas `skipRecent` barras (donde está el momentum actual)
  const end = closes.length - skipRecent;
  const start = Math.max(0, end - lookbackBars);
  let below = 0, above = 0, total = 0;
  for (let i = start; i < end; i++) {
    if (ma100[i] == null) continue;
    total++;
    if (closes[i] < ma100[i]) below++;
    else above++;
  }
  if (total < 20) return 'UNKNOWN';
  const ratioBelow = below / total;
  if (ratioBelow > 0.65) return 'DOWN';
  if (ratioBelow < 0.35) return 'UP';
  return 'SIDEWAYS';
}

// ¿Las Bandas de Bollinger se están expandiendo? (volatilidad abriendo)
function bollingerExpanding(bb, lookback = 5, threshold = 1.15) {
  const last = bb.upper.length - 1;
  if (last < lookback) return false;
  const widthNow = bb.upper[last] - bb.lower[last];
  const widthPrev = bb.upper[last - lookback] - bb.lower[last - lookback];
  if (!widthNow || !widthPrev) return false;
  return widthNow > widthPrev * threshold;
}

// Análisis principal de momentum para un ticker
function analyzeMomentum(hourlyBars, dailyBars, ticker) {
  if (!hourlyBars || !dailyBars) return null;
  if (hourlyBars.length < 200 || dailyBars.length < 60) return null;

  // === 1H ===
  const hCloses = hourlyBars.map(b => b.c);
  const hEMA20 = ema(hCloses, 20);
  const hEMA40 = ema(hCloses, 40);
  const hSMA100 = sma(hCloses, 100);
  const hSMA200 = sma(hCloses, 200);
  const hLast = hCloses.length - 1;
  const price = hCloses[hLast];

  // === Diario ===
  const dCloses = dailyBars.map(b => b.c);
  const dSMA20 = sma(dCloses, 20);
  const dSMA40 = sma(dCloses, 40);
  const dBB = bollinger(dCloses, 20, 2);
  const dLast = dCloses.length - 1;

  // ============ EVALUACIÓN ALCISTA ============
  let bullChecks = {
    priorDown: priorTrend(hCloses, hSMA100) === 'DOWN',
    emaCrossUp: recentCross(hEMA20, hEMA40) === 'BULL',
    breakoutHourly: price > (hSMA100[hLast] || Infinity) && price > (hSMA200[hLast] || Infinity),
    breakoutDaily: dCloses[dLast] > (dSMA20[dLast] || Infinity) && dCloses[dLast] > (dSMA40[dLast] || Infinity),
    bbExpand: bollingerExpanding(dBB)
  };

  // ============ EVALUACIÓN BAJISTA ============
  let bearChecks = {
    priorUp: priorTrend(hCloses, hSMA100) === 'UP',
    emaCrossDown: recentCross(hEMA20, hEMA40) === 'BEAR',
    breakdownHourly: price < (hSMA100[hLast] || -Infinity) && price < (hSMA200[hLast] || -Infinity),
    breakdownDaily: dCloses[dLast] < (dSMA20[dLast] || -Infinity) && dCloses[dLast] < (dSMA40[dLast] || -Infinity),
    bbExpand: bollingerExpanding(dBB)
  };

  const bullScore = Object.values(bullChecks).filter(Boolean).length;
  const bearScore = Object.values(bearChecks).filter(Boolean).length;

  // Determinar dirección dominante
  let direction = null, score = 0, checks = {};
  if (bullScore > bearScore && bullScore >= 3) {
    direction = 'ALZA';
    score = bullScore;
    checks = bullChecks;
  } else if (bearScore > bullScore && bearScore >= 3) {
    direction = 'BAJA';
    score = bearScore;
    checks = bearChecks;
  } else {
    return null; // Sin setup claro
  }

  // Mapear score a nivel de alerta
  let level;
  if (score === 5) level = 'CONFIRMADO';
  else if (score === 4) level = 'CERCA';
  else if (score === 3) level = 'WATCH';
  else return null;

  return {
    ticker,
    direction,
    score,
    level,
    checks,
    price,
    sector: getSector(ticker),
    inverseTicker: direction === 'BAJA' ? (INVERSE_MAP[ticker] || null) : null,
    timestamp: Date.now()
  };
}

// ============================================================
// FORMATO DE MENSAJES TELEGRAM
// ============================================================

function levelEmoji(level) {
  return { 'WATCH': '🟡', 'CERCA': '🟠', 'CONFIRMADO': '🟢' }[level] || '⚪';
}

function dirEmoji(dir) {
  return dir === 'ALZA' ? '📈' : '📉';
}

function formatChecklist(direction, checks) {
  if (direction === 'ALZA') {
    return [
      `${checks.priorDown ? '✅' : '⬜'} Tendencia bajista previa`,
      `${checks.emaCrossUp ? '✅' : '⬜'} EMA20 cruzó arriba EMA40 (1H)`,
      `${checks.breakoutHourly ? '✅' : '⬜'} Rompió MA100 y MA200 (1H)`,
      `${checks.breakoutDaily ? '✅' : '⬜'} Rompió SMA20 y SMA40 (Diario)`,
      `${checks.bbExpand ? '✅' : '⬜'} Bollinger expandiendo (volatilidad)`
    ].join('\n');
  } else {
    return [
      `${checks.priorUp ? '✅' : '⬜'} Tendencia alcista previa`,
      `${checks.emaCrossDown ? '✅' : '⬜'} EMA20 cruzó debajo EMA40 (1H)`,
      `${checks.breakdownHourly ? '✅' : '⬜'} Rompió MA100 y MA200 a la baja (1H)`,
      `${checks.breakdownDaily ? '✅' : '⬜'} Rompió SMA20 y SMA40 a la baja (Diario)`,
      `${checks.bbExpand ? '✅' : '⬜'} Bollinger expandiendo (volatilidad)`
    ].join('\n');
  }
}

function formatAlert(signal) {
  const { ticker, direction, score, level, checks, price, sector, inverseTicker } = signal;
  const lvlEm = levelEmoji(level);
  const dirEm = dirEmoji(direction);

  let action;
  if (direction === 'ALZA') {
    action = `🎯 *Acción:* Comprar *${ticker}*`;
  } else {
    if (inverseTicker) {
      action = `🎯 *Acción:* Comprar *${inverseTicker}* (inverso de ${ticker})`;
    } else {
      action = `⚠️ *Sin ETF inverso líquido* — solo seguimiento`;
    }
  }

  const stop = direction === 'ALZA' ? (price * 0.96).toFixed(2) : (price * 1.04).toFixed(2);
  const target = direction === 'ALZA' ? (price * 1.08).toFixed(2) : (price * 0.92).toFixed(2);

  const et = nowET();
  const timeStr = `${String(et.getUTCHours()).padStart(2, '0')}:${String(et.getUTCMinutes()).padStart(2, '0')} ET`;

  return [
    `${lvlEm} *MOMENTUM ${level}* ${lvlEm}`,
    `━━━━━━━━━━━━━━━━━━━`,
    `${dirEm} *${ticker}* — Momentum *${direction}*`,
    `🏷️ Sector: \`${sector}\``,
    `💰 Precio: $${price.toFixed(2)}`,
    `📊 Score: ${score}/5`,
    ``,
    `*Checklist:*`,
    formatChecklist(direction, checks),
    ``,
    action,
    `🛑 Stop sugerido: $${stop}`,
    `🎯 Target sugerido: $${target}`,
    `⏰ ${timeStr}`
  ].join('\n');
}

// ============================================================
// TELEGRAM SENDER
// ============================================================

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: text,
      parse_mode: 'Markdown'
    });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(true);
        else reject(new Error(`Telegram ${res.statusCode}: ${body.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============================================================
// ESTADO PERSISTENTE (anti-spam)
// ============================================================

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) { console.error('[state] Load error:', e.message); }
  return {};
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) { console.error('[state] Save error:', e.message); }
}

let alertState = loadState();

function shouldAlert(signal) {
  const key = `${signal.ticker}_${signal.direction}`;
  const prev = alertState[key];
  const now = Date.now();
  const cooldownMs = ALERT_COOLDOWN_HRS * 60 * 60 * 1000;

  if (!prev) return true; // primera vez

  // Si subió de nivel (WATCH → CERCA → CONFIRMADO), siempre alertar
  const order = { 'WATCH': 1, 'CERCA': 2, 'CONFIRMADO': 3 };
  if (order[signal.level] > order[prev.level]) return true;

  // Si es el mismo nivel, respetar cooldown
  if (prev.level === signal.level && (now - prev.time) < cooldownMs) return false;

  return true;
}

function recordAlert(signal) {
  const key = `${signal.ticker}_${signal.direction}`;
  alertState[key] = { level: signal.level, time: Date.now(), score: signal.score };
  saveState(alertState);
}

// ============================================================
// CICLO PRINCIPAL DE ESCANEO
// ============================================================

async function buildUniverse() {
  const curated = Object.values(CURATED_UNIVERSE).flat();
  const movers = await fetchTopMovers();
  return Array.from(new Set([...curated, ...movers]));
}

async function analyzeBatch(tickers) {
  const results = await Promise.all(tickers.map(async (ticker) => {
    try {
      const [hourly, daily] = await Promise.all([
        fetchHourlyBars(ticker),
        fetchDailyBars(ticker)
      ]);
      return analyzeMomentum(hourly, daily, ticker);
    } catch (e) {
      return null;
    }
  }));
  return results.filter(r => r !== null);
}

async function scanCycle() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] === Iniciando escaneo ===`);

  if (!isMarketOpen()) {
    console.log('[scan] Mercado cerrado, saltando.');
    return;
  }

  try {
    const universe = await buildUniverse();
    console.log(`[scan] Universo: ${universe.length} tickers`);

    // Procesar en lotes paralelos de 12
    const allSignals = [];
    const BATCH_SIZE = 12;
    for (let i = 0; i < universe.length; i += BATCH_SIZE) {
      const batch = universe.slice(i, i + BATCH_SIZE);
      const signals = await analyzeBatch(batch);
      allSignals.push(...signals);
    }

    console.log(`[scan] Señales detectadas: ${allSignals.length}`);

    // Filtrar y enviar alertas
    let sent = 0;
    for (const signal of allSignals) {
      if (shouldAlert(signal)) {
        try {
          await sendTelegram(formatAlert(signal));
          recordAlert(signal);
          sent++;
          // Pequeña pausa para no saturar Telegram
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error(`[telegram] Error en ${signal.ticker}:`, e.message);
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[scan] Completado en ${elapsed}s. Alertas enviadas: ${sent}`);
  } catch (e) {
    console.error('[scan] Error fatal:', e.message);
  }
}

// ============================================================
// SERVIDOR HTTP (health check para Railway) — sin dependencias
// ============================================================

const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'running',
      bot: 'Momentum Radar',
      market_open: isMarketOpen(),
      universe_curated: Object.values(CURATED_UNIVERSE).flat().length,
      alert_states: Object.keys(alertState).length,
      next_scan_min: SCAN_INTERVAL_MIN
    }));
  } else if (req.url === '/state') {
    res.writeHead(200);
    res.end(JSON.stringify(alertState));
  } else if (req.url === '/scan') {
    res.writeHead(200);
    res.end(JSON.stringify({ triggered: true }));
    scanCycle();
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`[server] Escuchando en puerto ${PORT}`);
});

// ============================================================
// ARRANQUE
// ============================================================

async function startup() {
  console.log('=== MOMENTUM RADAR ===');
  console.log(`Universo curado: ${Object.values(CURATED_UNIVERSE).flat().length} tickers`);
  console.log(`Sectores: ${Object.keys(CURATED_UNIVERSE).join(', ')}`);
  console.log(`Intervalo: ${SCAN_INTERVAL_MIN} min`);
  console.log(`Cooldown: ${ALERT_COOLDOWN_HRS}h`);

  if (!POLYGON_KEY || !TG_TOKEN || !TG_CHAT_ID) {
    console.error('⚠️  Faltan variables de entorno. Revisa POLYGON_API_KEY, MOMENTUM_TELEGRAM_TOKEN, MOMENTUM_CHAT_ID');
    return;
  }

  // Mensaje de inicio en Telegram
  try {
    const sectors = Object.keys(CURATED_UNIVERSE).join(', ');
    await sendTelegram([
      `🚀 *MOMENTUM RADAR INICIADO*`,
      `━━━━━━━━━━━━━━━━━━━`,
      `📊 Universo curado: ${Object.values(CURATED_UNIVERSE).flat().length} tickers`,
      `🏷️ Sectores: ${sectors}`,
      `🔄 Escaneo cada ${SCAN_INTERVAL_MIN} min`,
      `⏰ Horario: 9:30 AM – 4:00 PM ET (lun-vie)`,
      ``,
      `*Niveles de alerta:*`,
      `🟡 Watch (3/5)  → setup formándose`,
      `🟠 Cerca (4/5)  → próximo a confirmar`,
      `🟢 Confirmado (5/5) → entrada con momentum`
    ].join('\n'));
  } catch (e) {
    console.error('[startup] Error enviando mensaje inicial:', e.message);
  }

  // Primer escaneo
  scanCycle();

  // Programar escaneos recurrentes
  setInterval(scanCycle, SCAN_INTERVAL_MIN * 60 * 1000);
}

startup();
