// ════════════════════════════════════════════
//  AGENTE OPCIONES PRO — Node.js para Railway
//  Estrategia: Ruptura MA20 1H + confirmación 15M
//  Entrada + Salida + Mejor contrato real
//  Activos: TSLA, MU, AVGO, AAPL + 7 Magníficas
// ════════════════════════════════════════════
const fetch = require('node-fetch');

const POLY     = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_GROUP = '-1003924134011'; // Grupo Trading Opciones
const INTERVAL = 5;
const BLOCK_H  = 2;

const ASSETS = [
  {sym:'TSLA', name:'Tesla Inc'},
  {sym:'MU',   name:'Micron Technology'},
  {sym:'AVGO', name:'Broadcom Inc'},
  {sym:'AAPL', name:'Apple Inc'},
  {sym:'NVDA', name:'NVIDIA Corp'},
  {sym:'MSFT', name:'Microsoft Corp'},
  {sym:'AMZN', name:'Amazon Inc'},
  {sym:'META', name:'Meta Platforms'},
  {sym:'GOOGL',name:'Alphabet Inc'},
  {sym:'SPY',  name:'S&P 500 ETF'},
  {sym:'QQQ',  name:'Nasdaq 100 ETF'},
];

let alerted    = {};
let openTrades = {}; // trades abiertos para seguimiento de salida
let scanCount  = 0;
let sigCount   = 0;
let startTime  = Date.now();
let tradeDiary = [];
let summarySent= '';

// ── MATH ─────────────────────────────────────
const sma = (d,n) => { if(!d||d.length<n) return null; return d.slice(-n).reduce((a,b)=>a+b,0)/n; };
const ema = (d,n) => {
  if(!d||d.length<n) return null;
  const k=2/(n+1); let e=d.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for(let i=n;i<d.length;i++) e=d[i]*k+e*(1-k); return e;
};

// ── FETCH ─────────────────────────────────────
async function fetchT(url, ms=8000) {
  const ctrl = new AbortController();
  const t    = setTimeout(()=>ctrl.abort(), ms);
  try { const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(t); return r; }
  catch(e) { clearTimeout(t); throw e; }
}

async function fetchBars(sym, timespan='hour', days=30) {
  const to   = new Date();
  const from = new Date(to - days*864e5);
  const fmt  = d => d.toISOString().split('T')[0];
  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/${timespan}/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=500&apiKey=${POLY}`;
    const r = await fetchT(url, 7000);
    const d = await r.json();
    if(d?.results?.length>=20) return d.results.map(b=>({
      c:+b.c.toFixed(4), h:+b.h.toFixed(4), l:+b.l.toFixed(4), v:b.v||0, o:+b.o.toFixed(4)
    }));
  } catch(e) { log(`${sym} ${timespan} error: ${e.message}`); }
  return null;
}

// ── BUSCAR MEJOR CONTRATO DE OPCION ──────────
async function findBestContract(sym, tipo, price) {
  try {
    // Calcular fecha de vencimiento — preferir 0DTE o 1DTE
    const et      = getET();
    const today   = et.toISOString().split('T')[0];
    const tomorrow= new Date(et.getTime()+864e5).toISOString().split('T')[0];

    // Strike ATM — redondear al strike más cercano
    const strikeStep = price < 50 ? 1 : price < 200 ? 5 : price < 500 ? 5 : 10;
    const strikeATM  = Math.round(price/strikeStep)*strikeStep;
    const strikeOTM  = tipo==='CALL' ? strikeATM+strikeStep : strikeATM-strikeStep;

    // Buscar contratos reales via Polygon Options API
    const contractType = tipo==='CALL' ? 'call' : 'put';
    const url = `https://api.polygon.io/v3/snapshot/options/${sym}?contract_type=${contractType}&expiration_date.lte=${tomorrow}&expiration_date.gte=${today}&strike_price.gte=${strikeATM-strikeStep*2}&strike_price.lte=${strikeATM+strikeStep*2}&limit=10&apiKey=${POLY}`;

    const r = await fetchT(url, 7000);
    const d = await r.json();

    if(d?.results?.length>0) {
      // Ordenar por volumen y open interest
      const contracts = d.results
        .filter(c=>c.day?.volume>0||c.open_interest>0)
        .sort((a,b)=>(b.day?.volume||0)-(a.day?.volume||0));

      if(contracts.length>0) {
        const best = contracts[0];
        const details = best.details||{};
        const greeks  = best.greeks||{};
        const day     = best.day||{};
        const lastQuote = best.last_quote||{};

        return {
          ticker:      best.ticker||`O:${sym}${today.replace(/-/g,'')}C${strikeATM*1000}`,
          strike:      details.strike_price||strikeATM,
          expiration:  details.expiration_date||today,
          type:        details.contract_type||contractType,
          lastPrice:   day.last||lastQuote.midpoint||null,
          bid:         lastQuote.bid||null,
          ask:         lastQuote.ask||null,
          midpoint:    lastQuote.midpoint||null,
          volume:      day.volume||0,
          openInterest:best.open_interest||0,
          delta:       greeks.delta ? +greeks.delta.toFixed(3) : null,
          iv:          best.implied_volatility ? +(best.implied_volatility*100).toFixed(1) : null,
          // Costo real del contrato (1 contrato = 100 acciones)
          costPerContract: lastQuote.midpoint ? +(lastQuote.midpoint*100).toFixed(2) : null,
        };
      }
    }

    // Si no hay datos reales — estimado
    return {
      strike:      strikeATM,
      expiration:  today,
      type:        contractType,
      lastPrice:   null,
      estimado:    true,
      // Strike alternativo OTM para menos costo
      strikeOTM,
    };
  } catch(e) {
    log(`Opciones ${sym}: ${e.message}`);
    return null;
  }
}

// ── ANALYZE ───────────────────────────────────
function analyze(sym, bars1H, bars15M) {
  if(!bars1H||bars1H.length<25) return null;

  const cl1H  = bars1H.map(b=>b.c);
  const price  = cl1H[cl1H.length-1];
  const prevC  = cl1H[cl1H.length-2];
  const ma20   = sma(cl1H, 20);
  const ma20p  = sma(cl1H.slice(0,-1), 20);
  const ma9    = ema(cl1H, 9);
  if(!ma20||!ma20p) return null;

  // Volumen
  const vols   = bars1H.map(b=>b.v).filter(v=>v>0);
  const volCur = vols[vols.length-1]||0;
  const volAvg = vols.slice(-21,-1).reduce((a,b)=>a+b,0)/Math.max(1,vols.slice(-21,-1).length);
  const volRatio = volAvg>0 ? +(volCur/volAvg).toFixed(2) : 1;
  const highVol  = volRatio >= 1.3;

  // Ruptura MA20
  const breakUp = prevC < ma20p && price > ma20;
  const breakDn = prevC > ma20p && price < ma20;

  // Vela confirmación
  const lastBar    = bars1H[bars1H.length-1];
  const bullCandle = lastBar.c > lastBar.o;
  const bearCandle = lastBar.c < lastBar.o;

  // 15M
  let trend15M = 'NEUTRAL';
  if(bars15M&&bars15M.length>=25) {
    const cl15   = bars15M.map(b=>b.c);
    const ma20_15= sma(cl15, 20);
    const ma9_15 = ema(cl15, 9);
    const p15    = cl15[cl15.length-1];
    if(ma20_15&&ma9_15) {
      if(p15>ma20_15&&ma9_15>ma20_15) trend15M='UP';
      else if(p15<ma20_15&&ma9_15<ma20_15) trend15M='DOWN';
    }
  }

  const isCall = breakUp && bullCandle && highVol && trend15M==='UP';
  const isPut  = breakDn && bearCandle && highVol && trend15M==='DOWN';

  // Targets del subyacente
  const callT1 = +(price*1.02).toFixed(2);
  const callT2 = +(price*1.04).toFixed(2);
  const callSL = +(price*0.985).toFixed(2);
  const putT1  = +(price*0.98).toFixed(2);
  const putT2  = +(price*0.96).toFixed(2);
  const putSL  = +(price*1.015).toFixed(2);

  // Señal de SALIDA — precio volvió bajo MA20 (CALL) o sobre MA20 (PUT)
  const exitCall = price < ma20;  // para trades CALL abiertos
  const exitPut  = price > ma20;  // para trades PUT abiertos

  return {
    sym, price:+price.toFixed(2),
    ma20:+ma20.toFixed(2), ma9:ma9?+ma9.toFixed(2):null,
    volRatio, highVol,
    breakUp, breakDn, bullCandle, bearCandle,
    trend15M, isCall, isPut,
    exitCall, exitPut,
    callT1, callT2, callSL,
    putT1, putT2, putSL,
  };
}

// ── TELEGRAM ─────────────────────────────────
async function sendTG(chatId, msg) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id:chatId, text:msg})
    });
    const d = await r.json();
    if(!d.ok) log(`TG error: ${d.description}`);
    return d.ok;
  } catch(e) { log(`TG error: ${e.message}`); return false; }
}

// ── ENVIAR SEÑAL DE ENTRADA ───────────────────
async function sendEntrySignal(sig, tipo, contrato) {
  const hora   = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  const isCall = tipo==='CALL';
  const name   = ASSETS.find(a=>a.sym===sig.sym)?.name||sig.sym;

  // Info del contrato
  let contratoInfo = '';
  if(contrato) {
    if(contrato.estimado) {
      contratoInfo =
        `CONTRATO SUGERIDO (estimado)\n`
        +`Strike ATM: $${contrato.strike}\n`
        +`Vencimiento: ${contrato.expiration} (hoy)\n`
        +`Nota: Verificar precio en broker\n`;
    } else {
      contratoInfo =
        `MEJOR CONTRATO DISPONIBLE\n`
        +`Ticker: ${contrato.ticker||'--'}\n`
        +`Strike: $${contrato.strike}\n`
        +`Vencimiento: ${contrato.expiration}\n`
        +`Precio contrato: ${contrato.lastPrice?'$'+contrato.lastPrice:'--'}\n`
        +`Bid/Ask: ${contrato.bid?'$'+contrato.bid:'--'} / ${contrato.ask?'$'+contrato.ask:'--'}\n`
        +`Costo 1 contrato: ${contrato.costPerContract?'$'+contrato.costPerContract:'verificar en broker'}\n`
        +`Volumen: ${contrato.volume||0} · OI: ${contrato.openInterest||0}\n`
        +(contrato.delta?`Delta: ${contrato.delta}\n`:'')
        +(contrato.iv?`IV: ${contrato.iv}%\n`:'');
    }
  }

  const msg =
    `${isCall?'🟢':'🔴'} ENTRADA ${tipo} — ${sig.sym}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Activo: ${sig.sym} — ${name}\n`
    +`Precio actual: $${sig.price}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`ANALISIS DE ENTRADA:\n`
    +`1H Ruptura MA20: ${isCall?'↑ ALCISTA':'↓ BAJISTA'}\n`
    +`1H Vela conf.: ${isCall?'🟢 Alcista':'🔴 Bajista'}\n`
    +`1H Volumen: ${sig.volRatio}x promedio\n`
    +`15M Tendencia: ${sig.trend15M==='UP'?'🟢 ALCISTA':'🔴 BAJISTA'}\n`
    +`MA20 ref: $${sig.ma20}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +contratoInfo
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`PLAN DE TRADING:\n`
    +`ENTRAR: ${isCall?`CALL strike $${contrato?.strike||sig.price}`:`PUT strike $${contrato?.strike||sig.price}`}\n`
    +`T1 subyacente: $${isCall?sig.callT1:sig.putT1} (${isCall?'+':'-'}2%)\n`
    +`T2 subyacente: $${isCall?sig.callT2:sig.putT2} (${isCall?'+':'-'}4%)\n`
    +`Stop subyacente: $${isCall?sig.callSL:sig.putSL}\n`
    +`Salida: si precio vuelve bajo MA20 $${sig.ma20}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Confirmar en TradingView antes de entrar\n`
    +`${hora} ET`;

  const ok = await sendTG(TG_GROUP, msg);
  if(ok) {
    sigCount++;
    openTrades[`${sig.sym}_${tipo}`] = {
      sym: sig.sym, tipo, entry: sig.price,
      ma20: sig.ma20,
      t1: isCall?sig.callT1:sig.putT1,
      t2: isCall?sig.callT2:sig.putT2,
      sl: isCall?sig.callSL:sig.putSL,
      hora, contrato,
    };
    tradeDiary.push({sym:sig.sym, tipo, price:sig.price, hora, result:'OPEN'});
    log(`✅ ENTRADA ${tipo} enviada: ${sig.sym} $${sig.price}`);
  }
  return ok;
}

// ── SEÑALES DE SALIDA ─────────────────────────
async function checkExits(sig) {
  const hora = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});

  // Verificar trade CALL abierto
  const tradeCall = openTrades[`${sig.sym}_CALL`];
  if(tradeCall) {
    const pnl = +(((sig.price-tradeCall.entry)/tradeCall.entry)*100).toFixed(2);

    // T1 alcanzado
    if(sig.price >= tradeCall.t1) {
      await sendTG(TG_GROUP,
        `✅ SALIDA PARCIAL CALL — ${sig.sym}\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`T1 ALCANZADO (+2% subyacente)\n`
        +`Entrada: $${tradeCall.entry}\n`
        +`Precio: $${sig.price}\n`
        +`Ganancia subyacente: +${pnl}%\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`ACCION: Vender 50% de la posicion\n`
        +`Dejar el resto hacia T2 $${tradeCall.t2}\n`
        +`Mover stop a precio de entrada\n`
        +`${hora} ET`
      );
      tradeCall.t1Hit = true;
      if(sig.price >= tradeCall.t2) {
        await sendTG(TG_GROUP,
          `🏆 SALIDA TOTAL CALL — ${sig.sym}\n`
          +`T2 ALCANZADO (+4% subyacente)\n`
          +`Ganancia: +${pnl}%\n`
          +`CERRAR POSICION COMPLETA`
        );
        tradeDiary.find(t=>t.sym===sig.sym&&t.tipo==='CALL'&&t.result==='OPEN').result='WIN';
        delete openTrades[`${sig.sym}_CALL`];
      }
    }
    // Stop loss
    else if(sig.price <= tradeCall.sl) {
      await sendTG(TG_GROUP,
        `🛑 STOP LOSS CALL — ${sig.sym}\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`Entrada: $${tradeCall.entry}\n`
        +`Precio: $${sig.price}\n`
        +`Resultado: ${pnl}%\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`CERRAR OPCION AHORA\n`
        +`${hora} ET`
      );
      tradeDiary.find(t=>t.sym===sig.sym&&t.tipo==='CALL'&&t.result==='OPEN').result='LOSS';
      delete openTrades[`${sig.sym}_CALL`];
    }
    // Precio volvió bajo MA20 — señal de salida técnica
    else if(sig.exitCall && tradeCall.t1Hit!==true) {
      await sendTG(TG_GROUP,
        `⚠️ ALERTA SALIDA CALL — ${sig.sym}\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`Precio bajo MA20 — tendencia cambia\n`
        +`Entrada: $${tradeCall.entry}\n`
        +`Precio: $${sig.price}\n`
        +`MA20: $${sig.ma20}\n`
        +`P&L actual: ${pnl>=0?'+':''}${pnl}%\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`Evalua cerrar la opcion\n`
        +`${hora} ET`
      );
    }
    else {
      log(`📊 CALL ${sig.sym}: $${sig.price} · P&L ${pnl>=0?'+':''}${pnl}% · MA20 $${sig.ma20}`);
    }
  }

  // Verificar trade PUT abierto
  const tradePut = openTrades[`${sig.sym}_PUT`];
  if(tradePut) {
    const pnl = +(((tradePut.entry-sig.price)/tradePut.entry)*100).toFixed(2);

    if(sig.price <= tradePut.t1) {
      await sendTG(TG_GROUP,
        `✅ SALIDA PARCIAL PUT — ${sig.sym}\n`
        +`T1 ALCANZADO (-2% subyacente)\n`
        +`Entrada: $${tradePut.entry}\n`
        +`Precio: $${sig.price}\n`
        +`Ganancia: +${pnl}%\n`
        +`ACCION: Vender 50% · Mover stop a entrada\n`
        +`${hora} ET`
      );
      tradePut.t1Hit = true;
      if(sig.price <= tradePut.t2) {
        await sendTG(TG_GROUP,
          `🏆 SALIDA TOTAL PUT — ${sig.sym}\n`
          +`T2 ALCANZADO (-4%)\nCERRAR POSICION COMPLETA`
        );
        delete openTrades[`${sig.sym}_PUT`];
      }
    }
    else if(sig.price >= tradePut.sl) {
      await sendTG(TG_GROUP,
        `🛑 STOP LOSS PUT — ${sig.sym}\n`
        +`Entrada: $${tradePut.entry} · Precio: $${sig.price}\n`
        +`CERRAR OPCION AHORA\n${hora} ET`
      );
      delete openTrades[`${sig.sym}_PUT`];
    }
    else if(sig.exitPut && !tradePut.t1Hit) {
      await sendTG(TG_GROUP,
        `⚠️ ALERTA SALIDA PUT — ${sig.sym}\n`
        +`Precio sobre MA20 — tendencia cambia\n`
        +`P&L: ${pnl>=0?'+':''}${pnl}% · MA20: $${sig.ma20}\n`
        +`Evalua cerrar la opcion\n${hora} ET`
      );
    }
    else {
      log(`📊 PUT ${sig.sym}: $${sig.price} · P&L ${pnl>=0?'+':''}${pnl}% · MA20 $${sig.ma20}`);
    }
  }
}

// ── HORA ET ──────────────────────────────────
function getET() { return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})); }
function isMarketOpen() {
  const et=getET(); const d=et.getDay(); const t=et.getHours()*60+et.getMinutes();
  return d>0&&d<6&&t>=570&&t<960;
}
function log(msg) {
  const et=getET();
  const time=et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  console.log(`[OPC2 ${et.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'})} ${time} ET] ${msg}`);
}

// ── SCAN ─────────────────────────────────────
async function runScan() {
  scanCount++;
  const open = isMarketOpen();
  log(`=== Scan #${scanCount} · ${open?'OPEN':'CLOSED'} · Trades: ${Object.keys(openTrades).length} ===`);

  if(!open) { log('Solo señales en mercado regular'); return; }

  for(const u of ASSETS) {
    try {
      const [bars1H, bars15M] = await Promise.all([
        fetchBars(u.sym,'hour',30),
        fetchBars(u.sym,'minute',5),
      ]);

      const sig = analyze(u.sym, bars1H, bars15M);
      if(!sig) continue;

      log(`${u.sym}: $${sig.price} MA20:$${sig.ma20} BreakUp:${sig.breakUp} BreakDn:${sig.breakDn} Vol:${sig.volRatio}x 15M:${sig.trend15M}`);

      // Verificar salidas de trades abiertos
      await checkExits(sig);

      const today = new Date().toISOString().split('T')[0];

      // Señal CALL
      if(sig.isCall && !openTrades[`${u.sym}_CALL`]) {
        const key = `CALL_${u.sym}_${today}`;
        if(!alerted[key]) {
          alerted[key] = true;
          setTimeout(()=>delete alerted[key], BLOCK_H*60*60*1000);
          const contrato = await findBestContract(u.sym, 'CALL', sig.price);
          await sendEntrySignal(sig, 'CALL', contrato);
        }
      }

      // Señal PUT
      if(sig.isPut && !openTrades[`${u.sym}_PUT`]) {
        const key = `PUT_${u.sym}_${today}`;
        if(!alerted[key]) {
          alerted[key] = true;
          setTimeout(()=>delete alerted[key], BLOCK_H*60*60*1000);
          const contrato = await findBestContract(u.sym, 'PUT', sig.price);
          await sendEntrySignal(sig, 'PUT', contrato);
        }
      }

    } catch(e) { log(`${u.sym} error: ${e.message}`); }
    await new Promise(r=>setTimeout(r,600));
  }
}

// ── RESUMEN ───────────────────────────────────
function scheduleSummary() {
  const et    = getET();
  const today = et.toISOString().split('T')[0];
  const hour  = et.getHours();
  const min   = et.getMinutes();
  if(hour===16&&min<=10&&summarySent!==today) {
    summarySent = today;
    const wins  = tradeDiary.filter(t=>t.result==='WIN').length;
    const loss  = tradeDiary.filter(t=>t.result==='LOSS').length;
    const calls = tradeDiary.filter(t=>t.tipo==='CALL').length;
    const puts  = tradeDiary.filter(t=>t.tipo==='PUT').length;
    sendTG(TG_GROUP,
      `RESUMEN OPCIONES DEL DIA\n`
      +`━━━━━━━━━━━━━━━━━━━━\n`
      +`Senales: ${sigCount} (${calls} CALL / ${puts} PUT)\n`
      +`Resultados: ${wins} WIN / ${loss} LOSS\n`
      +`Escaneos: ${scanCount}\n`
      +`━━━━━━━━━━━━━━━━━━━━\n`
      +`Hasta manana`
    );
    tradeDiary = [];
  }
}

// ── INICIO ────────────────────────────────────
async function main() {
  log('Agente Opciones PRO v2 iniciando...');
  log(`Activos: ${ASSETS.map(a=>a.sym).join(', ')}`);

  await sendTG(TG_GROUP,
    `AGENTE OPCIONES PRO INICIADO\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Estrategia: Ruptura MA20 1H + 15M\n`
    +`Activos: ${ASSETS.map(a=>a.sym).join(' ')}\n`
    +`Contratos reales via Polygon\n`
    +`Entrada + Salida + Mejor contrato\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Solo mercado regular 9:30am-4pm ET`
  );

  await runScan();
  setInterval(async()=>{ await runScan(); scheduleSummary(); }, INTERVAL*60*1000);
}

main().catch(e=>{ console.error('Error fatal:', e); process.exit(1); });
