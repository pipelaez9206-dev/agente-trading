// ════════════════════════════════════════════════════════════════════
//  OPTIONS AGENT - Estrategia Bollinger 15M + Volumen alto
//  Tiempo real con WebSocket de Massive
//  Activos: TSLA, AAPL, NVDA, MU, AMZN
//  Senales: CALL (rebote alcista) / PUT (rebote bajista)
// ════════════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const https = require('https');

// ───── CONFIGURACION ─────
const API_KEY = process.env.POLYGON_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003989237990';

const ACTIVOS = ['TSLA', 'AAPL', 'NVDA', 'MU', 'AMZN'];

const BB_PERIOD = 20;
const BB_STDDEV = 2;
const VOL_MULTIPLIER = 1.5;
const SCAN_INTERVAL_MS = 60 * 1000;        // Evalua cada 1 min con precio LIVE
const REFRESH_BARS_MS = 5 * 60 * 1000;     // Refresca barras 15M cada 5 min
const COOLDOWN_MS = 15 * 60 * 1000;        // No repetir senal del mismo ticker en 15 min

if (!API_KEY) {
  console.error('FALTA POLYGON_API_KEY en variables de entorno');
  process.exit(1);
}

// ───── ESTADO EN MEMORIA ─────
const barsByTicker = {};
const lastPriceByTicker = {};
const lastSignalByTicker = {};

// ───── UTILIDADES ─────
function ahoraET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function logET(msg) {
  const ahora = ahoraET();
  const hora = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  console.log(`[${hora} ET] ${msg}`);
}

function mercadoAbierto() {
  const ahora = ahoraET();
  const dia = ahora.getDay();
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  return dia >= 1 && dia <= 5 && minutos >= 570 && minutos < 960;
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stddev(values, period, avg) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / period;
  return Math.sqrt(variance);
}

function strikeATM(price) {
  return Math.round(price / 5) * 5;
}

function vencimientoSugerido() {
  const hoy = new Date();
  const diaSemana = hoy.getDay();
  let diasHastaViernes = (5 - diaSemana + 7) % 7;
  if (diasHastaViernes < 3) diasHastaViernes += 7;
  const venc = new Date(hoy);
  venc.setDate(hoy.getDate() + diasHastaViernes);
  return venc.toISOString().split('T')[0];
}

// ───── HTTP helper ─────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ───── CARGA DE BARRAS 15M ─────
async function cargarBarras(ticker) {
  const hoy = new Date();
  const hace7dias = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().split('T')[0];
  const url = `https://api.massive.com/v2/aggs/ticker/${ticker}/range/15/minute/${fmt(hace7dias)}/${fmt(hoy)}?adjusted=true&sort=asc&limit=500&apiKey=${API_KEY}`;

  try {
    const res = await fetchJSON(url);
    if (res && res.results && res.results.length > 0) {
      barsByTicker[ticker] = res.results;
      logET(`${ticker}: ${res.results.length} barras 15M cargadas`);
    } else {
      logET(`${ticker}: sin barras devueltas`);
    }
  } catch (err) {
    logET(`${ticker}: error cargando barras - ${err.message}`);
  }
}

async function cargarTodasBarras() {
  logET('═══ Refrescando barras 15M ═══');
  for (const ticker of ACTIVOS) {
    await cargarBarras(ticker);
  }
}

// ───── WEBSOCKET TIEMPO REAL ─────
let ws = null;

function conectarWebSocket() {
  ws = new WebSocket('wss://socket.massive.com/stocks');

  ws.on('open', () => {
    logET('WebSocket conectado a Massive');
    ws.send(JSON.stringify({ action: 'auth', params: API_KEY }));
  });

  ws.on('message', (raw) => {
    try {
      const msgs = JSON.parse(raw);
      for (const m of msgs) {
        if (m.ev === 'status' && m.status === 'auth_success') {
          logET('Autenticacion WebSocket OK');
          const params = ACTIVOS.map(t => `T.${t}`).join(',');
          ws.send(JSON.stringify({ action: 'subscribe', params }));
          logET(`Suscrito a trades de: ${ACTIVOS.join(', ')}`);
        } else if (m.ev === 'T') {
          lastPriceByTicker[m.sym] = m.p;
        }
      }
    } catch (e) {}
  });

  ws.on('error', (err) => logET(`WebSocket error: ${err.message}`));
  ws.on('close', () => {
    logET('WebSocket cerrado, reconectando en 5s...');
    setTimeout(conectarWebSocket, 5000);
  });
}

// ───── TELEGRAM ─────
function enviarTelegram(texto) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: CHAT_ID,
      text: texto
    });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function formatearMensaje(s) {
  return `🚨 SEÑAL DE OPCIONES — ${s.signalType}
━━━━━━━━━━━━━━━━━━━━
📊 Ticker: ${s.ticker}
💵 Precio actual: $${s.price.toFixed(2)} ⚡
🎯 Direccion esperada: ${s.direccionEsperada}
━━━━━━━━━━━━━━━━━━━━
📌 PLAN DE TRADING:
   Comprar: ${s.signalType} $${s.strike}
   Vencimiento: ${s.vencimiento}
━━━━━━━━━━━━━━━━━━━━
🎯 SALIDAS:
   ✅ Take Profit: $${s.takeProfit.toFixed(2)} (+${s.gananciaEsperada.toFixed(2)}%)
   🛑 Stop Loss: $${s.stopLoss.toFixed(2)} (-${s.riesgoEsperado.toFixed(2)}%)
━━━━━━━━━━━━━━━━━━━━
📈 Bandas Bollinger:
   Superior: $${s.bbUpper.toFixed(2)}
   Media:    $${s.bbMid.toFixed(2)}
   Inferior: $${s.bbLower.toFixed(2)}
   %B: ${s.percentB.toFixed(1)}%
📦 Volumen: ${s.volRatio.toFixed(2)}x
━━━━━━━━━━━━━━━━━━━━
💡 ${s.reason}
🤖 Options Agent · Railway`;
}

// ───── EVALUAR SENAL ─────
function evaluar(ticker) {
  const bars = barsByTicker[ticker];
  const priceLive = lastPriceByTicker[ticker];

  if (!bars || bars.length < BB_PERIOD + 5) return null;
  if (!priceLive) return null;

  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v);
  const lastBar = bars[bars.length - 1];

  const bbMid = sma(closes, BB_PERIOD);
  const bbDev = stddev(closes, BB_PERIOD, bbMid);
  if (!bbMid || !bbDev) return null;

  const bbUpper = bbMid + (BB_STDDEV * bbDev);
  const bbLower = bbMid - (BB_STDDEV * bbDev);
  const bbWidth = bbUpper - bbLower;
  const percentB = (priceLive - bbLower) / bbWidth * 100;

  const volAvg = sma(volumes.slice(0, -1), 20);
  if (!volAvg) return null;
  const volRatio = lastBar.v / volAvg;
  const highVolume = volRatio >= VOL_MULTIPLIER;

  let signalType = null;
  let reason = '';
  let direccionEsperada = '';
  let takeProfit = 0;
  let stopLoss = 0;

  if (priceLive <= bbLower && highVolume) {
    signalType = 'CALL';
    direccionEsperada = 'ARRIBA';
    reason = `Precio toco banda inferior con volumen ${volRatio.toFixed(1)}x`;
    takeProfit = bbMid;
    stopLoss = bbLower - (bbWidth * 0.1);
  } else if (priceLive >= bbUpper && highVolume) {
    signalType = 'PUT';
    direccionEsperada = 'ABAJO';
    reason = `Precio toco banda superior con volumen ${volRatio.toFixed(1)}x`;
    takeProfit = bbMid;
    stopLoss = bbUpper + (bbWidth * 0.1);
  }

  logET(`${ticker}: $${priceLive.toFixed(2)} | BB[${bbLower.toFixed(2)} - ${bbUpper.toFixed(2)}] | %B:${percentB.toFixed(1)} | Vol:${volRatio.toFixed(2)}x | Senal:${signalType || '-'}`);

  if (!signalType) return null;

  const strike = strikeATM(priceLive);
  const gananciaEsperada = Math.abs(priceLive - takeProfit) / priceLive * 100;
  const riesgoEsperado = Math.abs(priceLive - stopLoss) / priceLive * 100;

  return {
    ticker,
    signalType,
    price: priceLive,
    direccionEsperada,
    strike,
    vencimiento: vencimientoSugerido(),
    takeProfit,
    stopLoss,
    bbUpper,
    bbLower,
    bbMid,
    percentB,
    volRatio,
    reason,
    gananciaEsperada,
    riesgoEsperado
  };
}

// ───── BUCLE PRINCIPAL ─────
async function bucleEvaluacion() {
  if (!mercadoAbierto()) {
    logET('Mercado cerrado, no evaluo');
    return;
  }

  logET('─── Escaneo activos ───');
  for (const ticker of ACTIVOS) {
    const signal = evaluar(ticker);
    if (signal) {
      const ultima = lastSignalByTicker[ticker] || 0;
      const ahora = Date.now();
      if (ahora - ultima < COOLDOWN_MS) {
        logET(`${ticker}: senal detectada pero en cooldown (${Math.round((COOLDOWN_MS - (ahora - ultima)) / 60000)} min restantes)`);
        continue;
      }

      const mensaje = formatearMensaje(signal);
      try {
        await enviarTelegram(mensaje);
        lastSignalByTicker[ticker] = ahora;
        logET(`🚨 SENAL ENVIADA: ${ticker} ${signal.signalType} @ $${signal.price.toFixed(2)}`);
      } catch (err) {
        logET(`Error enviando Telegram: ${err.message}`);
      }
    }
  }
}

// ───── ARRANQUE ─────
(async () => {
  logET('════════════════════════════════════════');
  logET('  OPTIONS AGENT - Bollinger 15M + Vol');
  logET(`  Activos: ${ACTIVOS.join(', ')}`);
  logET('════════════════════════════════════════');

  await cargarTodasBarras();
  conectarWebSocket();
  setInterval(cargarTodasBarras, REFRESH_BARS_MS);
  setInterval(bucleEvaluacion, SCAN_INTERVAL_MS);

  logET('Bot inicializado. Esperando datos...');
})();
