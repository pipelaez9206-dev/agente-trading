// ════════════════════════════════════════════
//  AGENTE OPCIONES PRO — Node.js para Railway
//  Estrategia: Ruptura MA20 1H + confirmación 15M
//  Entrada + Salida + Mejor contrato real
//  Filtros: Earnings, IV, Horario óptimo, Volumen
// ════════════════════════════════════════════
const fetch = require('node-fetch');

const POLY     = 'uFofGpATkTeoMKxESD4EDlHU3reG_TzX';
const TG_TOKEN = '8576001297:AAH6dLApI099m7dUqe8zDaeMtK5pxbXc2t8';
const TG_GROUP = '-1003924134011'; // Grupo Trading Opciones
const INTERVAL = 5;
const BLOCK_H  = 3;

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
let openTrades = {};
let scanCount  = 0;
let sigCount   = 0;
let startTime  = Date.now();
let tradeDiary = [];
let summarySent= '';
let earningsCache = {}; // cache de fechas de earnings

// ── MATH ─────────────────────────────────────
const sma = (d,n) => { if(!d||d.length<n) return null; return d.slice(-n).reduce((a,b)=>a+b,0)/n; };
const ema = (d,n) => {
  if(!d||d.length<n) return null;
  const k=2/(n+1); let e=d.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for(let i=n;i<d.length;i++) e=d[i]*k+e*(1-k); return e;
};
const atr = (bars,n=14) => {
  if(!bars||bars.length<n+1) return null;
  const sl = bars.slice(-(n+1));
  let total = 0;
  for(let i=1;i<sl.length;i++){
    const h=sl[i].h||sl[i].c, l=sl[i].l||sl[i].c, pc=sl[i-1].c;
    total += Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc));
  }
  return +(total/n).toFixed(4);
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
  } catch(e) { log(`${sym} ${timespan}: ${e.message}`); }
  return null;
}

// ── VERIFICAR EARNINGS ────────────────────────
async function hasEarningsToday(sym) {
  try {
    const today = getET().toISOString().split('T')[0];
    if(earningsCache[sym]?.date===today) return earningsCache[sym].hasEarnings;

    const url = `https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=5&apiKey=${POLY}`;
    const r   = await fetchT(url, 5000);
    const d   = await r.json();

    // Verificar si hay reporte hoy
    const todayEarnings = d?.results?.some(f => f.filing_date===today || f.period_of_report_date===today);
    earningsCache[sym] = {date:today, hasEarnings:todayEarnings};
    return todayEarnings;
  } catch(e) { return false; }
}

// ── BUSCAR MEJOR CONTRATO ─────────────────────
async function findBestContract(sym, tipo, price) {
  try {
    const et         = getET();
    const today      = et.toISOString().split('T')[0];
    const tomorrow   = new Date(et.getTime()+864e5).toISOString().split('T')[0];
    const in2days    = new Date(et.getTime()+2*864e5).toISOString().split('T')[0];
    const contractType = tipo==='CALL'?'call':'put';

    // Strike ATM
    const step    = price<50?1:price<200?5:price<500?5:10;
    const strikeATM = Math.round(price/step)*step;

    const url = `https://api.polygon.io/v3/snapshot/options/${sym}?contract_type=${contractType}&expiration_date.lte=${in2days}&expiration_date.gte=${today}&strike_price.gte=${strikeATM-step*3}&strike_price.lte=${strikeATM+step*3}&limit=20&apiKey=${POLY}`;
    const r   = await fetchT(url, 7000);
    const d   = await r.json();

    if(d?.results?.length>0) {
      // Filtrar por volumen y OI mínimos
      const valid = d.results.filter(c=>(c.day?.volume||0)>=10||(c.open_interest||0)>=100);
      const sorted = (valid.length>0?valid:d.results)
        .sort((a,b)=>(b.day?.volume||0)+(b.open_interest||0) - ((a.day?.volume||0)+(a.open_interest||0)));

      const best    = sorted[0];
      const details = best.details||{};
      const greeks  = best.greeks||{};
      const day     = best.day||{};
      const quote   = best.last_quote||{};
      const mid     = quote.midpoint || ((quote.bid||0)+(quote.ask||0))/2 || day.last;

      return {
        ticker:      best.ticker||'--',
        strike:      details.strike_price||strikeATM,
        expiration:  details.expiration_date||today,
        lastPrice:   day.last||null,
        bid:         quote.bid||null,
        ask:         quote.ask||null,
        midpoint:    mid?+mid.toFixed(2):null,
        costPerContract: mid?+(mid*100).toFixed(0):null,
        volume:      day.volume||0,
        openInterest:best.open_interest||0,
        delta:       greeks.delta?+greeks.delta.toFixed(3):null,
        gamma:       greeks.gamma?+greeks.gamma.toFixed(4):null,
        theta:       greeks.theta?+greeks.theta.toFixed(3):null,
        iv:          best.implied_volatility?+(best.implied_volatility*100).toFixed(1):null,
        estimado:    false,
      };
    }

    // Estimado si no hay datos reales
    return {strike:strikeATM, expiration:today, estimado:true,
      nota:'Verificar precio y contrato en tu broker'};
  } catch(e) {
    log(`Contrato ${sym}: ${e.message}`);
    return null;
  }
}

// ── ANALYZE ───────────────────────────────────
function analyze(sym, bars1H, bars15M) {
  if(!bars1H||bars1H.length<25) return null;

  const cl1H  = bars1H.map(b=>b.c);
  const price  = cl1H[cl1H.length-1];
  const prevC  = cl1H[cl1H.length-2];
  const prev2C = cl1H[cl1H.length-3];
  const ma20   = sma(cl1H,20);
  const ma20p  = sma(cl1H.slice(0,-1),20);
  const ma9    = ema(cl1H,9);
  const ma50   = sma(cl1H,50);
  const atrV   = atr(bars1H);
  if(!ma20||!ma20p) return null;

  // Volumen 1H
  const vols   = bars1H.map(b=>b.v).filter(v=>v>0);
  const volCur = vols[vols.length-1]||0;
  const volAvg = vols.slice(-21,-1).reduce((a,b)=>a+b,0)/Math.max(1,vols.slice(-21,-1).length);
  const volRatio = volAvg>0?+(volCur/volAvg).toFixed(2):1;
  const highVol  = volRatio>=1.3;

  // Ruptura MA20 — precio cruza de abajo hacia arriba (CALL) o arriba hacia abajo (PUT)
  const breakUp = prevC<ma20p && price>ma20;
  const breakDn = prevC>ma20p && price<ma20;

  // Vela de confirmación
  const lastBar    = bars1H[bars1H.length-1];
  const bullCandle = lastBar.c>lastBar.o;
  const bearCandle = lastBar.c<lastBar.o;

  // Tamaño de la vela (cuerpo > 0.3% del precio)
  const bodySize   = Math.abs(lastBar.c-lastBar.o)/lastBar.o*100;
  const strongBody = bodySize>=0.3;

  // MA50 filtro de tendencia mayor
  const trendMA50Up = ma50?price>ma50:true;
  const trendMA50Dn = ma50?price<ma50:true;

  // 15M análisis detallado
  let trend15M='NEUTRAL', ma20_15M=null, ma9_15M=null, rsi15M=null, vol15MRatio=0;
  if(bars15M&&bars15M.length>=25) {
    const cl15   = bars15M.map(b=>b.c);
    const vl15   = bars15M.map(b=>b.v).filter(v=>v>0);
    ma20_15M     = sma(cl15,20);
    ma9_15M      = ema(cl15,9);
    const p15    = cl15[cl15.length-1];

    // RSI 15M
    if(cl15.length>=15){
      const sl=cl15.slice(-15); let g=0,l=0;
      for(let i=1;i<sl.length;i++){const c=sl[i]-sl[i-1];c>0?g+=c:l-=c;}
      g/=14;l/=14; rsi15M=l===0?100:+(100-100/(1+g/l)).toFixed(1);
    }

    // Volumen 15M
    const v15cur = vl15[vl15.length-1]||0;
    const v15avg = vl15.slice(-21,-1).reduce((a,b)=>a+b,0)/Math.max(1,vl15.slice(-21,-1).length);
    vol15MRatio  = v15avg>0?+(v15cur/v15avg).toFixed(2):1;

    if(ma20_15M&&ma9_15M){
      if(p15>ma20_15M&&ma9_15M>ma20_15M) trend15M='UP';
      else if(p15<ma20_15M&&ma9_15M<ma20_15M) trend15M='DOWN';
    }
  }

  // ── Condiciones CALL ──
  // 1. Ruptura MA20 alcista en 1H
  // 2. Vela alcista de confirmación con cuerpo fuerte
  // 3. Volumen alto en 1H
  // 4. 15M tendencia alcista confirmada
  // 5. RSI 15M no sobreextendido (<75)
  const isCall = breakUp && bullCandle && strongBody && highVol
    && trend15M==='UP'
    && (rsi15M===null||rsi15M<75)
    && (ma50?trendMA50Up:true);

  // ── Condiciones PUT ──
  const isPut = breakDn && bearCandle && strongBody && highVol
    && trend15M==='DOWN'
    && (rsi15M===null||rsi15M>25)
    && (ma50?trendMA50Dn:true);

  // Stop dinámico basado en ATR
  const stopCall = atrV ? +(price-atrV*1.5).toFixed(2) : +(price*0.985).toFixed(2);
  const stopPut  = atrV ? +(price+atrV*1.5).toFixed(2) : +(price*1.015).toFixed(2);

  return {
    sym, price:+price.toFixed(2),
    ma20:+ma20.toFixed(2), ma9:ma9?+ma9.toFixed(2):null,
    ma50:ma50?+ma50.toFixed(2):null,
    volRatio, highVol, atrV,
    breakUp, breakDn, bullCandle, bearCandle, strongBody,
    bodySize:+bodySize.toFixed(2),
    trend15M, ma20_15M:ma20_15M?+ma20_15M.toFixed(2):null,
    rsi15M, vol15MRatio,
    isCall, isPut,
    // Targets subyacente
    callT1: +(price*1.02).toFixed(2),
    callT2: +(price*1.04).toFixed(2),
    callSL: +Math.max(stopCall, price*0.97).toFixed(2),
    putT1:  +(price*0.98).toFixed(2),
    putT2:  +(price*0.96).toFixed(2),
    putSL:  +Math.min(stopPut, price*1.03).toFixed(2),
    // Señal de salida técnica
    exitCall: price<ma20,
    exitPut:  price>ma20,
  };
}

// ── TELEGRAM ─────────────────────────────────
async function sendTG(msg) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id:TG_GROUP, text:msg})
    });
    const d = await r.json();
    if(!d.ok) log(`TG error: ${d.description}`);
    return d.ok;
  } catch(e) { log(`TG error: ${e.message}`); return false; }
}

// ── ENVIAR SEÑAL ENTRADA ──────────────────────
async function sendEntry(sig, tipo, contrato) {
  const hora   = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  const isCall = tipo==='CALL';
  const name   = ASSETS.find(a=>a.sym===sig.sym)?.name||sig.sym;

  let contratoTxt = '';
  if(contrato) {
    if(contrato.estimado) {
      contratoTxt =
        `CONTRATO (estimado — verificar en broker)\n`
        +`Strike sugerido: $${contrato.strike}\n`
        +`Vencimiento: ${contrato.expiration}\n`;
    } else {
      contratoTxt =
        `MEJOR CONTRATO DISPONIBLE\n`
        +`Ticker: ${contrato.ticker}\n`
        +`Strike: $${contrato.strike}\n`
        +`Vencimiento: ${contrato.expiration}\n`
        +`Precio prima: ${contrato.midpoint?'$'+contrato.midpoint:'--'}\n`
        +`Costo 1 contrato (100 acc): ${contrato.costPerContract?'$'+contrato.costPerContract:'--'}\n`
        +`Bid: ${contrato.bid?'$'+contrato.bid:'--'} / Ask: ${contrato.ask?'$'+contrato.ask:'--'}\n`
        +`Volumen: ${contrato.volume.toLocaleString()} · OI: ${contrato.openInterest.toLocaleString()}\n`
        +(contrato.delta?`Delta: ${contrato.delta} · Gamma: ${contrato.gamma||'--'}\n`:'')
        +(contrato.theta?`Theta: ${contrato.theta}/dia\n`:'')
        +(contrato.iv?`IV: ${contrato.iv}%\n`:'');
    }
  }

  const msg =
    `${isCall?'🟢':'🔴'} ENTRADA ${tipo} — ${sig.sym}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`${sig.sym} — ${name}\n`
    +`Precio subyacente: $${sig.price}\n`
    +`${sig.horaOptima?'✅ Hora optima de entrada':'⚠️ Fuera de hora optima'}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`ANALISIS TECNICO:\n`
    +`1H Ruptura MA20: ${isCall?'↑ ALCISTA':'↓ BAJISTA'}\n`
    +`1H Vela: ${isCall?'🟢 Alcista':'🔴 Bajista'} (cuerpo ${sig.bodySize}%)\n`
    +`1H Volumen: ${sig.volRatio}x promedio\n`
    +`1H MA20: $${sig.ma20}${sig.ma50?' · MA50: $'+sig.ma50:''}\n`
    +`15M Tendencia: ${sig.trend15M==='UP'?'🟢 ALCISTA':'🔴 BAJISTA'}\n`
    +`15M RSI: ${sig.rsi15M||'--'} · Vol: ${sig.vol15MRatio}x\n`
    +(sig.atrV?`ATR: $${sig.atrV}\n`:'')
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +contratoTxt
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`PLAN DE TRADING:\n`
    +`Comprar: ${tipo} strike $${contrato?.strike||sig.price}\n`
    +`T1 subyacente: $${isCall?sig.callT1:sig.putT1} (${isCall?'+':'-'}2%)\n`
    +`T2 subyacente: $${isCall?sig.callT2:sig.putT2} (${isCall?'+':'-'}4%)\n`
    +`Stop subyacente: $${isCall?sig.callSL:sig.putSL}\n`
    +`Salida tecnica: si precio vuelve ${isCall?'bajo':'sobre'} MA20 $${sig.ma20}\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Confirmar en TradingView antes de entrar\n`
    +`${hora} ET`;

  const ok = await sendTG(msg);
  if(ok) {
    sigCount++;
    openTrades[`${sig.sym}_${tipo}`] = {
      sym:sig.sym, tipo, entry:sig.price, ma20:sig.ma20,
      t1:isCall?sig.callT1:sig.putT1,
      t2:isCall?sig.callT2:sig.putT2,
      sl:isCall?sig.callSL:sig.putSL,
      contrato, hora, t1Hit:false,
    };
    tradeDiary.push({sym:sig.sym, tipo, price:sig.price, hora, result:'OPEN', pnl:null});
    log(`✅ ENTRADA ${tipo}: ${sig.sym} $${sig.price}`);
  }
  return ok;
}

// ── SEÑALES DE SALIDA ─────────────────────────
async function checkExits(sig) {
  const hora = new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});

  // ── CALL abierto ──
  const tc = openTrades[`${sig.sym}_CALL`];
  if(tc) {
    const pnl = +(((sig.price-tc.entry)/tc.entry)*100).toFixed(2);
    log(`📊 CALL ${sig.sym}: $${sig.price} · P&L ${pnl>=0?'+':''}${pnl}% · MA20 $${sig.ma20}`);

    if(sig.price>=tc.t2) {
      // T2 +4% alcanzado
      await sendTG(
        `🏆 SALIDA TOTAL CALL — ${sig.sym}\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`T2 ALCANZADO (+4% subyacente)\n`
        +`Entrada: $${tc.entry} → Precio: $${sig.price}\n`
        +`Ganancia subyacente: +${pnl}%\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`ACCION: Cerrar TODA la posicion ahora\n`
        +`Excelente trade! 🎉\n${hora} ET`
      );
      const d = tradeDiary.find(t=>t.sym===sig.sym&&t.tipo==='CALL'&&t.result==='OPEN');
      if(d){d.result='WIN';d.pnl=pnl;}
      delete openTrades[`${sig.sym}_CALL`];
    }
    else if(sig.price>=tc.t1 && !tc.t1Hit) {
      // T1 +2% alcanzado
      await sendTG(
        `✅ SALIDA PARCIAL CALL — ${sig.sym}\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`T1 ALCANZADO (+2% subyacente)\n`
        +`Entrada: $${tc.entry} → Precio: $${sig.price}\n`
        +`Ganancia subyacente: +${pnl}%\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`ACCION:\n`
        +`1. Vender 50% de la opcion AHORA\n`
        +`2. Mover stop a precio de entrada $${tc.entry}\n`
        +`3. Dejar el resto hacia T2 $${tc.t2}\n`
        +`${hora} ET`
      );
      tc.t1Hit = true;
      tc.sl    = tc.entry; // stop a break-even
      const d = tradeDiary.find(t=>t.sym===sig.sym&&t.tipo==='CALL'&&t.result==='OPEN');
      if(d){d.result='WIN_PARCIAL';d.pnl=pnl;}
    }
    else if(sig.price<=tc.sl) {
      // Stop loss
      await sendTG(
        `🛑 STOP LOSS CALL — ${sig.sym}\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`Entrada: $${tc.entry} → Precio: $${sig.price}\n`
        +`Resultado: ${pnl}%\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`ACCION: Cerrar la opcion AHORA\n`
        +`El sistema te protegió\n${hora} ET`
      );
      const d = tradeDiary.find(t=>t.sym===sig.sym&&t.tipo==='CALL'&&t.result==='OPEN');
      if(d){d.result='LOSS';d.pnl=pnl;}
      delete openTrades[`${sig.sym}_CALL`];
    }
    else if(sig.exitCall && !tc.t1Hit) {
      // Salida técnica — precio bajo MA20
      await sendTG(
        `⚠️ ALERTA SALIDA CALL — ${sig.sym}\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`Precio volvio bajo MA20 $${sig.ma20}\n`
        +`Entrada: $${tc.entry} → Precio: $${sig.price}\n`
        +`P&L actual: ${pnl>=0?'+':''}${pnl}%\n`
        +`━━━━━━━━━━━━━━━━━━━━\n`
        +`Evalua cerrar la opcion\n`
        +`Tendencia 1H cambia de direccion\n${hora} ET`
      );
    }
  }

  // ── PUT abierto ──
  const tp = openTrades[`${sig.sym}_PUT`];
  if(tp) {
    const pnl = +(((tp.entry-sig.price)/tp.entry)*100).toFixed(2);
    log(`📊 PUT ${sig.sym}: $${sig.price} · P&L ${pnl>=0?'+':''}${pnl}% · MA20 $${sig.ma20}`);

    if(sig.price<=tp.t2) {
      await sendTG(
        `🏆 SALIDA TOTAL PUT — ${sig.sym}\n`
        +`T2 ALCANZADO (-4% subyacente)\n`
        +`Entrada: $${tp.entry} → Precio: $${sig.price}\n`
        +`Ganancia: +${pnl}%\n`
        +`ACCION: Cerrar TODA la posicion. Excelente trade! 🎉\n${hora} ET`
      );
      const d = tradeDiary.find(t=>t.sym===sig.sym&&t.tipo==='PUT'&&t.result==='OPEN');
      if(d){d.result='WIN';d.pnl=pnl;}
      delete openTrades[`${sig.sym}_PUT`];
    }
    else if(sig.price<=tp.t1 && !tp.t1Hit) {
      await sendTG(
        `✅ SALIDA PARCIAL PUT — ${sig.sym}\n`
        +`T1 ALCANZADO (-2% subyacente)\n`
        +`Entrada: $${tp.entry} → Precio: $${sig.price}\n`
        +`Ganancia: +${pnl}%\n`
        +`ACCION: Vender 50% · Mover stop a entrada $${tp.entry}\n${hora} ET`
      );
      tp.t1Hit=true; tp.sl=tp.entry;
    }
    else if(sig.price>=tp.sl) {
      await sendTG(
        `🛑 STOP LOSS PUT — ${sig.sym}\n`
        +`Entrada: $${tp.entry} → Precio: $${sig.price}\n`
        +`Resultado: ${pnl}%\n`
        +`ACCION: Cerrar la opcion AHORA\n${hora} ET`
      );
      const d = tradeDiary.find(t=>t.sym===sig.sym&&t.tipo==='PUT'&&t.result==='OPEN');
      if(d){d.result='LOSS';d.pnl=pnl;}
      delete openTrades[`${sig.sym}_PUT`];
    }
    else if(sig.exitPut && !tp.t1Hit) {
      await sendTG(
        `⚠️ ALERTA SALIDA PUT — ${sig.sym}\n`
        +`Precio volvio sobre MA20 $${sig.ma20}\n`
        +`P&L: ${pnl>=0?'+':''}${pnl}% · Evalua cerrar\n${hora} ET`
      );
    }
  }
}

// ── HORA ET ──────────────────────────────────
function getET() { return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})); }
function isMarketOpen() {
  const et=getET(); const d=et.getDay(); const t=et.getHours()*60+et.getMinutes();
  return d>0&&d<6&&t>=570&&t<960;
}
function isOptimalHour() {
  const et=getET(); const t=et.getHours()*60+et.getMinutes();
  // Horas óptimas: 9:30-11:00am y 2:30-3:45pm ET
  return (t>=570&&t<=660)||(t>=870&&t<=945);
}
function log(msg) {
  const et=getET();
  const time=et.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  console.log(`[OPC ${et.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'})} ${time} ET] ${msg}`);
}

// ── SCAN ─────────────────────────────────────
async function runScan() {
  scanCount++;
  const open = isMarketOpen();
  const opt  = isOptimalHour();
  log(`=== Scan #${scanCount} · ${open?'OPEN':'CLOSED'} · ${opt?'HORA OPTIMA':'hora normal'} · Trades: ${Object.keys(openTrades).length} ===`);

  if(!open) { log('Solo senales en mercado regular 9:30am-4pm ET'); return; }

  for(const u of ASSETS) {
    try {
      // Verificar earnings
      const earnings = await hasEarningsToday(u.sym);
      if(earnings) {
        log(`${u.sym}: ⚠️ Earnings hoy — saltando`);
        continue;
      }

      const [bars1H, bars15M] = await Promise.all([
        fetchBars(u.sym,'hour',30),
        fetchBars(u.sym,'minute',5),
      ]);

      const sig = analyze(u.sym, bars1H, bars15M);
      if(!sig) { log(`${u.sym}: datos insuficientes`); continue; }

      // Agregar hora óptima al sig
      sig.horaOptima = opt;

      log(`${u.sym}: $${sig.price} MA20:$${sig.ma20} BreakUp:${sig.breakUp} BreakDn:${sig.breakDn} Cuerpo:${sig.bodySize}% Vol:${sig.volRatio}x 15M:${sig.trend15M} RSI15:${sig.rsi15M} CALL:${sig.isCall} PUT:${sig.isPut}`);

      // Verificar salidas primero
      await checkExits(sig);

      const today = new Date().toISOString().split('T')[0];

      // Señal CALL
      if(sig.isCall && !openTrades[`${u.sym}_CALL`]) {
        const key = `CALL_${u.sym}_${today}`;
        if(!alerted[key]) {
          alerted[key] = true;
          setTimeout(()=>delete alerted[key], BLOCK_H*60*60*1000);
          const contrato = await findBestContract(u.sym,'CALL',sig.price);
          await sendEntry(sig,'CALL',contrato);
        }
      }

      // Señal PUT
      if(sig.isPut && !openTrades[`${u.sym}_PUT`]) {
        const key = `PUT_${u.sym}_${today}`;
        if(!alerted[key]) {
          alerted[key] = true;
          setTimeout(()=>delete alerted[key], BLOCK_H*60*60*1000);
          const contrato = await findBestContract(u.sym,'PUT',sig.price);
          await sendEntry(sig,'PUT',contrato);
        }
      }

    } catch(e) { log(`${u.sym} error: ${e.message}`); }
    await new Promise(r=>setTimeout(r,700));
  }
}

// ── RESUMEN DIARIO ────────────────────────────
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
    const pnlNet= tradeDiary.filter(t=>t.pnl!==null).reduce((a,t)=>a+(t.pnl||0),0);
    sendTG(
      `RESUMEN OPCIONES DEL DIA\n`
      +`━━━━━━━━━━━━━━━━━━━━\n`
      +`Senales: ${sigCount} total\n`
      +`CALL: ${calls} · PUT: ${puts}\n`
      +`WIN: ${wins} · LOSS: ${loss}\n`
      +`P&L neto subyacente: ${pnlNet>=0?'+':''}${pnlNet.toFixed(1)}%\n`
      +`━━━━━━━━━━━━━━━━━━━━\n`
      +`Hasta manana`
    );
    tradeDiary=[];
  }
}

// ── INICIO ────────────────────────────────────
async function main() {
  log('Agente Opciones PRO iniciando...');
  log(`Activos: ${ASSETS.map(a=>a.sym).join(', ')}`);
  log('Estrategia: Ruptura MA20 1H + 15M + Earnings filter + ATR stop');

  await sendTG(
    `AGENTE OPCIONES PRO INICIADO\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Estrategia: Ruptura MA20 1H + 15M\n`
    +`Activos: ${ASSETS.map(a=>a.sym).join(' ')}\n`
    +`Filtros: Earnings · Hora optima · ATR\n`
    +`Contratos reales via Polygon\n`
    +`Entrada + Salida automatica\n`
    +`━━━━━━━━━━━━━━━━━━━━\n`
    +`Solo mercado regular 9:30am-4pm ET\n`
    +`Horas optimas: 9:30-11am y 2:30-3:45pm`
  );

  await runScan();
  setInterval(async()=>{ await runScan(); scheduleSummary(); }, INTERVAL*60*1000);
}

main().catch(e=>{ console.error('Error fatal:', e); process.exit(1); });
