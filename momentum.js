// ============================================================
// MOMENTUM RADAR v2 — Bot de señales de momentum profesional
// ============================================================
// Cambios vs v1:
//   ✅ Filtro de régimen de mercado (SPY 1H)
//   ✅ Volumen relativo (RVOL >= 1.5x promedio 20 barras)
//   ✅ RSI(14) 1H como filtro de momentum/agotamiento
//   ✅ ATR(14) 1H para stop/target dinámicos (no más % fijos)
//   ✅ Scoring ponderado 0-10 (antes 0-5)
//   ✅ Filtros anti-trampa: gaps, RSI extremo, ATR insuficiente
//   ✅ Cooldown sectorial (máx 3 señales/sector por escaneo)
//   ✅ Modo diagnóstico (DIAGNOSTIC_MODE=1) — loguea todos los scores
//   ✅ DST robusto (EDT/EST automático según fecha)
//   ✅ Niveles: WATCH 5/10, CERCA 7/10, CONFIRMADO 8/10
//
// Variables de entorno (Railway):
//   POLYGON_API_KEY             → tu key de Polygon.io
//   MOMENTUM_TELEGRAM_TOKEN     → token del bot de Telegram
//   MOMENTUM_CHAT_ID            → chat ID del grupo
//   DIAGNOSTIC_MODE (opcional)  → "1" para logs detallados
// ============================================================

const https = require('https');
const http = require('http');
const fs = require('fs');

// ============================================================
// CONFIGURACIÓN
// ============================================================

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
const DIAGNOSTIC = process.env.DIAGNOSTIC_MODE === '1';

const STATE_FILE = '/tmp/momentum_state.json';
const SCAN_INTERVAL_MIN = 15;
const ALERT_COOLDOWN_HRS = 4;
const MAX_SIGNALS_PER_SECTOR = 3;

// Umbrales de scoring (sobre 10)
const LEVEL_THRESHOLD = {
  WATCH:      5,
  CERCA:      7,
  CONFIRMADO: 8
};

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

// Mapeo activo → ETF inverso líquido
const INVERSE_MAP = {
  'SPY':  'SH',    'QQQ':  'PSQ',   'IWM':  'RWM',
  'TSLA': 'TSLZ',  'NVDA': 'NVDS',  'AAPL': 'AAPD',
  'MSFT': 'MSFD',  'META': 'METU',
  'SOXL': 'SOXS',  'XLK':  'REW',   'XLE':  'DUG',
  'AMD':  'SOXS'
};

// ============================================================
// HELPERS DE FECHA / MERCADO (DST robusto)
// ============================================================

// Calcula offset ET correcto según DST
function getETOffsetHours(d = new Date()) {
  const year = d.getUTCFullYear();
  // DST inicia: 2do domingo de marzo a las 2 AM ET
  const dstStart = new Date(Date.UTC(year, 2, 1, 7));
  dstStart.setUTCDate(1 + ((7 - dstStart.getUTCDay()) % 7) + 7);
  // DST termina: 1er domingo de noviembre a las 2 AM ET
  const dstEnd = new Date(Date.UTC(year, 10, 1, 6));
  dstEnd.setUTCDate(1 + ((7 - dstEnd.getUTCDay()) % 7));
  return (d >= dstStart && d < dstEnd) ? -4 : -5;
}

function nowET() {
  const d = new Date();
  return new Date(d.getTime() + getETOffsetHours(d) * 60 * 60 * 1000);
}

function isMarketOpen() {
  const et = nowET();
  const day = et.getUTCDay();
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
  return 'MOVER';
}

// ============================================================
// FETCH HELPERS — Massive.com API
// ============================================================

function fetchJSON(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 100))); }
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
  const url = `https://api.massive.com/v2/aggs/ticker/${ticker}/range/1/hour/${from}/${to}?adjusted=true&sort=asc&limit=400&apiKey=${POLYGON_KEY}`;
  const data = await fetchJSON(url);
  if (!data.results || data.results.length < 50) return null;
  return data.results.map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: b.t }));
}

async function fetchDailyBars(ticker) {
  const to = formatDate(new Date());
  const from = formatDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
  const url = `https://api.massive.com/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=300&apiKey=${POLYGON_KEY}`;
  const data = await fetchJSON(url);
  if (!data.results || data.results.length < 50) return null;
  return data.results.map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: b.t }));
}

async function fetchTopMovers() {
  const tickers = new Set();
  try {
    const [gainers, losers] = await Promise.all([
      fetchJSON(`https://api.massive.com/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${POLYGON_KEY}`),
      fetchJSON(`https://api.massive.com/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${POLYGON_KEY}`)
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

// RSI clásico (Wilder smoothing)
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  out[period] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return out;
}

// ATR clásico (Wilder smoothing)
function atr(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return out;
  const trs = [0];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    );
    trs.push(tr);
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

// ============================================================
// LÓGICA DE MOMENTUM
// ============================================================

function recentCross(seriesA, seriesB, lookback = 24) {
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

function priorTrend(closes, ma100, lookbackBars = 60, skipRecent = 10) {
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
  if (ratioBelow > 0.60) return 'DOWN';
  if (ratioBelow < 0.40) return 'UP';
  return 'SIDEWAYS';
}

function bollingerExpanding(bb, lookback = 5, threshold = 1.10) {
  const last = bb.upper.length - 1;
  if (last < lookback) return false;
  const widthNow = bb.upper[last] - bb.lower[last];
  const widthPrev = bb.upper[last - lookback] - bb.lower[last - lookback];
  if (!widthNow || !widthPrev) return false;
  return widthNow > widthPrev * threshold;
}

// Volumen relativo: volumen actual vs SMA20 de volumen
function relativeVolume(volumes, lookback = 20) {
  const last = volumes.length - 1;
  if (last < lookback) return 0;
  let sum = 0;
  for (let i = last - lookback; i < last; i++) sum += volumes[i];
  const avg = sum / lookback;
  if (!avg) return 0;
  return volumes[last] / avg;
}

// Detecta gap > thresholdPct en la última barra horaria
function hasLargeGap(bars, thresholdPct = 5) {
  const last = bars.length - 1;
  if (last < 1) return false;
  const prevClose = bars[last - 1].c;
  const currOpen = bars[last].o;
  if (!prevClose) return false;
  const gapPct = Math.abs((currOpen - prevClose) / prevClose) * 100;
  return gapPct > thresholdPct;
}

// ============================================================
// RÉGIMEN DE MERCADO (SPY)
// ============================================================

let cachedRegime = null;
let regimeCacheTime = 0;
const REGIME_CACHE_MS = 5 * 60 * 1000;       // 5 min cache si éxito
const REGIME_RETRY_MS = 60 * 1000;           // 1 min cache si falla (reintento rápido)

// Fetch SPY con logs detallados para diagnosticar
async function fetchSPYDirect() {
  const to = formatDate(new Date());
  const from = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const url = `https://api.massive.com/v2/aggs/ticker/SPY/range/1/hour/${from}/${to}?adjusted=true&sort=asc&limit=400&apiKey=${POLYGON_KEY}`;
  const data = await fetchJSON(url);
  if (!data) {
    console.error('[regime] Massive devolvió null');
    return null;
  }
  if (data.status && data.status !== 'OK' && data.status !== 'DELAYED') {
    console.error(`[regime] Massive status=${data.status} error=${data.error || data.message || 'unknown'}`);
    return null;
  }
  if (!data.results) {
    console.error(`[regime] Massive sin .results. Keys=${Object.keys(data).join(',')}`);
    return null;
  }
  if (data.results.length < 50) {
    console.error(`[regime] SPY solo ${data.results.length} barras (necesito >=50)`);
    return null;
  }
  return data.results.map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: b.t }));
}

async function getMarketRegime() {
  // Cache: 5 min si válido, 1 min si falló (para reintentar pronto sin spamear)
  const ttl = (cachedRegime && cachedRegime.state !== 'UNKNOWN')
    ? REGIME_CACHE_MS : REGIME_RETRY_MS;
  if (cachedRegime && (Date.now() - regimeCacheTime) < ttl) {
    return cachedRegime;
  }
  try {
    const spy = await fetchSPYDirect();
    if (!spy) {
      cachedRegime = { state: 'UNKNOWN', spyPrice: 0, spyMA20: 0 };
      regimeCacheTime = Date.now();
      return cachedRegime;
    }
    const closes = spy.map(b => b.c);
    const ma20 = ema(closes, 20);
    const ma50 = ema(closes, 50);
    const last = closes.length - 1;
    const price = closes[last];
    const m20 = ma20[last];
    const m50 = ma50[last];

    let state = 'NEUTRAL';
    if (price > m20 && m20 > m50) state = 'BULL';
    else if (price < m20 && m20 < m50) state = 'BEAR';

    cachedRegime = { state, spyPrice: price, spyMA20: m20 };
    regimeCacheTime = Date.now();
    return cachedRegime;
  } catch (e) {
    console.error('[regime] Excepción:', e.message);
    cachedRegime = { state: 'UNKNOWN', spyPrice: 0, spyMA20: 0 };
    regimeCacheTime = Date.now();
    return cachedRegime;
  }
}

// ============================================================
// ANÁLISIS PRINCIPAL — SCORING PONDERADO 0-10
// ============================================================

function analyzeMomentum(hourlyBars, dailyBars, ticker, regime) {
  if (!hourlyBars || !dailyBars) return null;
  if (hourlyBars.length < 200 || dailyBars.length < 60) return null;

  // === Series 1H ===
  const hCloses = hourlyBars.map(b => b.c);
  const hVolumes = hourlyBars.map(b => b.v);
  const hEMA20 = ema(hCloses, 20);
  const hEMA40 = ema(hCloses, 40);
  const hSMA100 = sma(hCloses, 100);
  const hSMA200 = sma(hCloses, 200);
  const hRSI = rsi(hCloses, 14);
  const hATR = atr(hourlyBars, 14);
  const hLast = hCloses.length - 1;
  const price = hCloses[hLast];
  const rsiNow = hRSI[hLast];
  const atrNow = hATR[hLast];
  const rvol = relativeVolume(hVolumes, 20);

  // === Series Diarias ===
  const dCloses = dailyBars.map(b => b.c);
  const dSMA20 = sma(dCloses, 20);
  const dSMA40 = sma(dCloses, 40);
  const dBB = bollinger(dCloses, 20, 2);
  const dLast = dCloses.length - 1;
  const dPrice = dCloses[dLast];

  // === Filtros anti-trampa (descartan totalmente) ===
  if (rsiNow == null || atrNow == null) return null;
  if (atrNow / price < 0.005) return null; // ATR < 0.5% = sin volatilidad útil
  if (hasLargeGap(hourlyBars, 5)) return null; // Gap >5% = noticias, impredecible
  if (rsiNow > 78 || rsiNow < 22) return null; // RSI extremo = entrada tardía

  const trend = priorTrend(hCloses, hSMA100);
  const cross = recentCross(hEMA20, hEMA40, 24);
  const bbExpand = bollingerExpanding(dBB);
  const ema20AboveEma40 = hEMA20[hLast] > hEMA40[hLast];

  // ============ EVALUACIÓN ALCISTA (max 10 pts) ============
  let bullPoints = 0;
  const bullChecks = {};

  // 1. Régimen mercado favorable (1 pt) — UNKNOWN se trata como NEUTRAL para no penalizar
  bullChecks.regimeOK = (regime.state === 'BULL' || regime.state === 'NEUTRAL' || regime.state === 'UNKNOWN');
  if (bullChecks.regimeOK) bullPoints++;

  // 2. Tendencia previa: DOWN o SIDEWAYS (1 pt) - permite reversiones y continuaciones
  bullChecks.priorContext = (trend === 'DOWN' || trend === 'SIDEWAYS');
  if (bullChecks.priorContext) bullPoints++;

  // 3. Estructura alcista: EMA20 > EMA40 (1 pt)
  bullChecks.emaStructure = ema20AboveEma40;
  if (bullChecks.emaStructure) bullPoints++;

  // 4. Cruce reciente alcista de EMAs (1 pt)
  bullChecks.emaCrossUp = (cross === 'BULL');
  if (bullChecks.emaCrossUp) bullPoints++;

  // 5. Precio sobre MA100 1H (1 pt)
  bullChecks.aboveMA100 = (hSMA100[hLast] != null && price > hSMA100[hLast]);
  if (bullChecks.aboveMA100) bullPoints++;

  // 6. Precio sobre MA200 1H (1 pt)
  bullChecks.aboveMA200 = (hSMA200[hLast] != null && price > hSMA200[hLast]);
  if (bullChecks.aboveMA200) bullPoints++;

  // 7. Breakout diario sobre SMA20 (1 pt)
  bullChecks.dailyBreakout = (dSMA20[dLast] != null && dPrice > dSMA20[dLast]);
  if (bullChecks.dailyBreakout) bullPoints++;

  // 8. RVOL >= 1.5x (1 pt) - CRÍTICO
  bullChecks.volume = (rvol >= 1.5);
  if (bullChecks.volume) bullPoints++;

  // 9. Bollinger expandiendo en diario (1 pt)
  bullChecks.bbExpand = bbExpand;
  if (bullChecks.bbExpand) bullPoints++;

  // 10. RSI alcista pero no exhausto: 50-72 (1 pt)
  bullChecks.rsiZone = (rsiNow >= 50 && rsiNow <= 72);
  if (bullChecks.rsiZone) bullPoints++;

  // ============ EVALUACIÓN BAJISTA (max 10 pts) ============
  let bearPoints = 0;
  const bearChecks = {};

  bearChecks.regimeOK = (regime.state === 'BEAR' || regime.state === 'NEUTRAL' || regime.state === 'UNKNOWN');
  if (bearChecks.regimeOK) bearPoints++;

  bearChecks.priorContext = (trend === 'UP' || trend === 'SIDEWAYS');
  if (bearChecks.priorContext) bearPoints++;

  bearChecks.emaStructure = !ema20AboveEma40;
  if (bearChecks.emaStructure) bearPoints++;

  bearChecks.emaCrossDown = (cross === 'BEAR');
  if (bearChecks.emaCrossDown) bearPoints++;

  bearChecks.belowMA100 = (hSMA100[hLast] != null && price < hSMA100[hLast]);
  if (bearChecks.belowMA100) bearPoints++;

  bearChecks.belowMA200 = (hSMA200[hLast] != null && price < hSMA200[hLast]);
  if (bearChecks.belowMA200) bearPoints++;

  bearChecks.dailyBreakdown = (dSMA20[dLast] != null && dPrice < dSMA20[dLast]);
  if (bearChecks.dailyBreakdown) bearPoints++;

  bearChecks.volume = (rvol >= 1.5);
  if (bearChecks.volume) bearPoints++;

  bearChecks.bbExpand = bbExpand;
  if (bearChecks.bbExpand) bearPoints++;

  bearChecks.rsiZone = (rsiNow >= 28 && rsiNow <= 50);
  if (bearChecks.rsiZone) bearPoints++;

  // ============ Resolver dirección dominante ============
  let direction, score, checks;
  if (bullPoints > bearPoints && bullPoints >= LEVEL_THRESHOLD.WATCH) {
    direction = 'ALZA';
    score = bullPoints;
    checks = bullChecks;
  } else if (bearPoints > bullPoints && bearPoints >= LEVEL_THRESHOLD.WATCH) {
    direction = 'BAJA';
    score = bearPoints;
    checks = bearChecks;
  } else {
    // Diagnóstico: log también las que no pasan
    if (DIAGNOSTIC) {
      console.log(`[diag] ${ticker} bull=${bullPoints} bear=${bearPoints} rsi=${rsiNow?.toFixed(1)} rvol=${rvol.toFixed(2)} trend=${trend}`);
    }
    return null;
  }

  let level;
  if (score >= LEVEL_THRESHOLD.CONFIRMADO) level = 'CONFIRMADO';
  else if (score >= LEVEL_THRESHOLD.CERCA) level = 'CERCA';
  else level = 'WATCH';

  if (DIAGNOSTIC) {
    console.log(`[diag] ✅ ${ticker} ${direction} score=${score}/10 level=${level} rvol=${rvol.toFixed(2)} rsi=${rsiNow.toFixed(1)} atr%=${(atrNow/price*100).toFixed(2)}`);
  }

  return {
    ticker,
    direction,
    score,
    level,
    checks,
    price,
    rsi: rsiNow,
    atr: atrNow,
    atrPct: atrNow / price * 100,
    rvol,
    trend,
    sector: getSector(ticker),
    inverseTicker: direction === 'BAJA' ? (INVERSE_MAP[ticker] || null) : null,
    timestamp: Date.now()
  };
}

// ============================================================
// FORMATO DE MENSAJES
// ============================================================

function levelEmoji(level) {
  return { 'WATCH': '🟡', 'CERCA': '🟠', 'CONFIRMADO': '🟢' }[level] || '⚪';
}

function dirEmoji(dir) { return dir === 'ALZA' ? '📈' : '📉'; }

function regimeEmoji(state) {
  return { 'BULL': '🟢', 'NEUTRAL': '🟡', 'BEAR': '🔴', 'UNKNOWN': '⚪' }[state] || '⚪';
}

function formatChecklist(direction, checks) {
  const mark = (b) => b ? '✅' : '⬜';
  if (direction === 'ALZA') {
    return [
      `${mark(checks.regimeOK)} Régimen mercado favorable`,
      `${mark(checks.priorContext)} Contexto previo (DOWN/SIDEWAYS)`,
      `${mark(checks.emaStructure)} EMA20 > EMA40 (1H)`,
      `${mark(checks.emaCrossUp)} Cruce reciente EMA al alza`,
      `${mark(checks.aboveMA100)} Precio > MA100 (1H)`,
      `${mark(checks.aboveMA200)} Precio > MA200 (1H)`,
      `${mark(checks.dailyBreakout)} Breakout SMA20 diario`,
      `${mark(checks.volume)} *Volumen ≥ 1.5× promedio*`,
      `${mark(checks.bbExpand)} Bollinger expandiendo`,
      `${mark(checks.rsiZone)} RSI 50–72 (alcista sano)`
    ].join('\n');
  } else {
    return [
      `${mark(checks.regimeOK)} Régimen mercado favorable`,
      `${mark(checks.priorContext)} Contexto previo (UP/SIDEWAYS)`,
      `${mark(checks.emaStructure)} EMA20 < EMA40 (1H)`,
      `${mark(checks.emaCrossDown)} Cruce reciente EMA a la baja`,
      `${mark(checks.belowMA100)} Precio < MA100 (1H)`,
      `${mark(checks.belowMA200)} Precio < MA200 (1H)`,
      `${mark(checks.dailyBreakdown)} Quiebre SMA20 diario`,
      `${mark(checks.volume)} *Volumen ≥ 1.5× promedio*`,
      `${mark(checks.bbExpand)} Bollinger expandiendo`,
      `${mark(checks.rsiZone)} RSI 28–50 (bajista sano)`
    ].join('\n');
  }
}

function formatAlert(signal) {
  const { ticker, direction, score, level, checks, price, atr,
          atrPct, rvol, rsi: rsiVal, sector, inverseTicker } = signal;
  const lvlEm = levelEmoji(level);
  const dirEm = dirEmoji(direction);

  // Stops/targets dinámicos con ATR (1.8x stop, 3.5x target = R:R ~1:2)
  const atrStop = 1.8 * atr;
  const atrTarget = 3.5 * atr;
  const stop   = direction === 'ALZA' ? (price - atrStop).toFixed(2)   : (price + atrStop).toFixed(2);
  const target = direction === 'ALZA' ? (price + atrTarget).toFixed(2) : (price - atrTarget).toFixed(2);

  let action;
  if (direction === 'ALZA') {
    action = `🎯 *Acción:* Comprar *${ticker}*`;
  } else if (inverseTicker) {
    action = `🎯 *Acción:* Comprar *${inverseTicker}* (inverso de ${ticker})`;
  } else {
    action = `⚠️ *Sin ETF inverso líquido* — solo seguimiento`;
  }

  const et = nowET();
  const timeStr = `${String(et.getUTCHours()).padStart(2, '0')}:${String(et.getUTCMinutes()).padStart(2, '0')} ET`;

  return [
    `${lvlEm} *MOMENTUM ${level}* ${lvlEm}`,
    `━━━━━━━━━━━━━━━━━━━`,
    `${dirEm} *${ticker}* — ${direction}`,
    `🏷️ Sector: \`${sector}\``,
    `💰 Precio: $${price.toFixed(2)}`,
    `📊 Score: *${score}/10*`,
    `📈 RVOL: ${rvol.toFixed(2)}× | RSI: ${rsiVal.toFixed(1)} | ATR: ${atrPct.toFixed(2)}%`,
    ``,
    `*Checklist (${score}/10):*`,
    formatChecklist(direction, checks),
    ``,
    action,
    `🛑 Stop: $${stop} (1.8× ATR)`,
    `🎯 Target: $${target} (3.5× ATR, R:R 1:2)`,
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

  if (!prev) return true;
  const order = { 'WATCH': 1, 'CERCA': 2, 'CONFIRMADO': 3 };
  if (order[signal.level] > order[prev.level]) return true;
  if (prev.level === signal.level && (now - prev.time) < cooldownMs) return false;
  return true;
}

function recordAlert(signal) {
  const key = `${signal.ticker}_${signal.direction}`;
  alertState[key] = { level: signal.level, time: Date.now(), score: signal.score };
  saveState(alertState);
}

// ============================================================
// FILTRADO SECTORIAL (anti-spam por sector)
// ============================================================

function filterBySector(signals, maxPerSector = MAX_SIGNALS_PER_SECTOR) {
  // Agrupar por sector + dirección, ordenar por score desc, top N
  const buckets = {};
  for (const s of signals) {
    const k = `${s.sector}_${s.direction}`;
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(s);
  }
  const filtered = [];
  for (const [, list] of Object.entries(buckets)) {
    list.sort((a, b) => b.score - a.score);
    filtered.push(...list.slice(0, maxPerSector));
  }
  return filtered;
}

// ============================================================
// CICLO PRINCIPAL DE ESCANEO
// ============================================================

async function buildUniverse() {
  const curated = Object.values(CURATED_UNIVERSE).flat();
  const movers = await fetchTopMovers();
  return Array.from(new Set([...curated, ...movers]));
}

async function analyzeBatch(tickers, regime) {
  const results = await Promise.all(tickers.map(async (ticker) => {
    try {
      const [hourly, daily] = await Promise.all([
        fetchHourlyBars(ticker),
        fetchDailyBars(ticker)
      ]);
      return analyzeMomentum(hourly, daily, ticker, regime);
    } catch (e) {
      if (DIAGNOSTIC) console.log(`[diag] ${ticker} ERROR: ${e.message}`);
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
    // 1. Obtener régimen de mercado
    const regime = await getMarketRegime();
    console.log(`[regime] SPY=${regime.state} (px=$${regime.spyPrice?.toFixed(2)})`);

    // 2. Construir universo
    const universe = await buildUniverse();
    console.log(`[scan] Universo: ${universe.length} tickers`);

    // 3. Analizar en lotes paralelos
    const allSignals = [];
    const BATCH_SIZE = 12;
    for (let i = 0; i < universe.length; i += BATCH_SIZE) {
      const batch = universe.slice(i, i + BATCH_SIZE);
      const signals = await analyzeBatch(batch, regime);
      allSignals.push(...signals);
    }
    console.log(`[scan] Señales detectadas (raw): ${allSignals.length}`);

    // 4. Distribución de scores (siempre, no solo en diagnóstico)
    if (allSignals.length > 0) {
      const dist = { WATCH: 0, CERCA: 0, CONFIRMADO: 0 };
      allSignals.forEach(s => dist[s.level]++);
      console.log(`[scan] Distribución: 🟡${dist.WATCH} 🟠${dist.CERCA} 🟢${dist.CONFIRMADO}`);
    }

    // 5. Filtro sectorial (top 3 por sector)
    const filtered = filterBySector(allSignals);
    if (filtered.length < allSignals.length) {
      console.log(`[scan] Tras filtro sectorial: ${filtered.length}`);
    }

    // 6. Enviar alertas con cooldown
    let sent = 0;
    for (const signal of filtered) {
      if (shouldAlert(signal)) {
        try {
          await sendTelegram(formatAlert(signal));
          recordAlert(signal);
          sent++;
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
// SERVIDOR HTTP (health check + control manual)
// ============================================================

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'running',
      bot: 'Momentum Radar v2',
      market_open: isMarketOpen(),
      universe_curated: Object.values(CURATED_UNIVERSE).flat().length,
      alert_states: Object.keys(alertState).length,
      next_scan_min: SCAN_INTERVAL_MIN,
      diagnostic_mode: DIAGNOSTIC,
      level_thresholds: LEVEL_THRESHOLD,
      cached_regime: cachedRegime
    }));
  } else if (req.url === '/state') {
    res.writeHead(200);
    res.end(JSON.stringify(alertState));
  } else if (req.url === '/scan') {
    res.writeHead(200);
    res.end(JSON.stringify({ triggered: true }));
    scanCycle();
  } else if (req.url === '/clear-state') {
    alertState = {};
    saveState(alertState);
    res.writeHead(200);
    res.end(JSON.stringify({ cleared: true }));
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
  console.log('=== MOMENTUM RADAR v2.2 (Massive.com) ===');
  console.log(`Universo curado: ${Object.values(CURATED_UNIVERSE).flat().length} tickers`);
  console.log(`Sectores: ${Object.keys(CURATED_UNIVERSE).join(', ')}`);
  console.log(`Intervalo: ${SCAN_INTERVAL_MIN} min`);
  console.log(`Cooldown: ${ALERT_COOLDOWN_HRS}h`);
  console.log(`Niveles: WATCH ${LEVEL_THRESHOLD.WATCH}/10 | CERCA ${LEVEL_THRESHOLD.CERCA}/10 | CONFIRMADO ${LEVEL_THRESHOLD.CONFIRMADO}/10`);
  console.log(`Diagnostic mode: ${DIAGNOSTIC ? 'ON' : 'OFF'}`);

  if (!POLYGON_KEY || !TG_TOKEN || !TG_CHAT_ID) {
    console.error('⚠️  Faltan variables de entorno. Revisa POLYGON_API_KEY, MOMENTUM_TELEGRAM_TOKEN, MOMENTUM_CHAT_ID');
    return;
  }

  try {
    const sectors = Object.keys(CURATED_UNIVERSE).join(', ');
    await sendTelegram([
      `🚀 *MOMENTUM RADAR v2 INICIADO*`,
      `━━━━━━━━━━━━━━━━━━━`,
      `📊 Universo curado: ${Object.values(CURATED_UNIVERSE).flat().length} tickers`,
      `🏷️ Sectores: ${sectors}`,
      `🔄 Escaneo cada ${SCAN_INTERVAL_MIN} min`,
      `⏰ Horario: 9:30 AM – 4:00 PM ET (lun-vie)`,
      ``,
      `*Sistema de scoring 0-10:*`,
      `🟡 Watch (5/10) → setup formándose`,
      `🟠 Cerca (7/10) → próximo a confirmar`,
      `🟢 Confirmado (8+/10) → entrada con momentum`,
      ``,
      `*Filtros profesionales activos:*`,
      `• Régimen SPY como contexto`,
      `• Volumen relativo ≥ 1.5×`,
      `• RSI 50-72 (ALZA) / 28-50 (BAJA)`,
      `• ATR para stop/target dinámicos`,
      `• Anti-gap, anti-sobrecompra`,
      `• Máx 3 señales por sector`
    ].join('\n'));
  } catch (e) {
    console.error('[startup] Error enviando mensaje inicial:', e.message);
  }

  scanCycle();
  setInterval(scanCycle, SCAN_INTERVAL_MIN * 60 * 1000);
}

startup();
