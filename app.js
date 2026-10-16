(() => {
'use strict';

const REST = 'https://fapi.binance.com';
const WS = 'wss://fstream.binance.com/stream';
const SYMBOLS = {
  BTCUSDT: { base: 'BTC', prec: 1 },
  ETHUSDT: { base: 'ETH', prec: 2 },
};
const COLORS = { up: '#0ECB81', down: '#F6465D', text: '#EAECEF', sub: '#848E9C', line: '#2B3139', bg: '#181A20',
  ma: ['#F0B90B', '#E91E8C', '#7B61FF'], boll: ['#F0B90B', '#E91E8C', '#7B61FF'] };
const TZ = -new Date().getTimezoneOffset() * 60; // Binance shows local time

const state = { symbol: 'BTCUSDT', interval: '15m', ind: { ma: true, ema: false, boll: false, vol: true },
  candles: [], gen: 0, ws: null, loadingMore: false, noMore: false, ticker: {} };

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const prec = () => SYMBOLS[state.symbol].prec;
const compact = (n) => n >= 1e9 ? fmt(n / 1e9) + 'B' : n >= 1e6 ? fmt(n / 1e6) + 'M' : fmt(n, 2);

// ---------- chart ----------
const chart = LightweightCharts.createChart($('chart'), {
  layout: { background: { color: COLORS.bg }, textColor: COLORS.sub, fontSize: 11 },
  grid: { vertLines: { color: '#1f2329' }, horzLines: { color: '#1f2329' } },
  rightPriceScale: { borderColor: COLORS.line, scaleMargins: { top: 0.08, bottom: 0.22 } },
  timeScale: { borderColor: COLORS.line, timeVisible: true, secondsVisible: false, rightOffset: 6 },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal,
    vertLine: { color: '#5E6673', labelBackgroundColor: '#2B3139' }, horzLine: { color: '#5E6673', labelBackgroundColor: '#2B3139' } },
  autoSize: true,
});
const candleSeries = chart.addCandlestickSeries({
  upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down,
});
const volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

const line = (color) => chart.addLineSeries({ color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
const maSeries = [7, 25, 99].map((_, i) => line(COLORS.ma[i]));
const emaSeries = [7, 25, 99].map((_, i) => line(COLORS.ma[i]));
const bollSeries = [line(COLORS.boll[1]), line(COLORS.boll[0]), line(COLORS.boll[1])]; // upper, mid, lower
const PERIODS = [7, 25, 99];

function applyPrecision() {
  const p = prec();
  candleSeries.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: 1 / 10 ** p } });
}

// ---------- indicators ----------
function sma(data, n) {
  const out = []; let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= n) sum -= data[i - n].close;
    if (i >= n - 1) out.push({ time: data[i].time, value: sum / n });
  }
  return out;
}
function ema(data, n) {
  const out = []; const k = 2 / (n + 1); let prev;
  for (let i = 0; i < data.length; i++) {
    prev = i === 0 ? data[i].close : data[i].close * k + prev * (1 - k);
    if (i >= n - 1) out.push({ time: data[i].time, value: prev });
  }
  return out;
}
function boll(data, n = 20, m = 2) {
  const up = [], mid = [], low = [];
  for (let i = n - 1; i < data.length; i++) {
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += data[j].close;
    const avg = s / n; let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (data[j].close - avg) ** 2;
    const sd = Math.sqrt(v / n), t = data[i].time;
    up.push({ time: t, value: avg + m * sd }); mid.push({ time: t, value: avg }); low.push({ time: t, value: avg - m * sd });
  }
  return [up, mid, low];
}

let indVals = {}; // last computed series for legend lookups
function renderIndicators() {
  const d = state.candles;
  indVals = { ma: PERIODS.map((n) => sma(d, n)), ema: PERIODS.map((n) => ema(d, n)), boll: boll(d) };
  maSeries.forEach((s, i) => s.setData(state.ind.ma ? indVals.ma[i] : []));
  emaSeries.forEach((s, i) => s.setData(state.ind.ema ? indVals.ema[i] : []));
  bollSeries.forEach((s, i) => s.setData(state.ind.boll ? indVals.boll[i] : []));
  volSeries.applyOptions({ visible: state.ind.vol });
  renderLegend();
}

// ---------- legend ----------
let hoverTime = null;
function valAt(arr, time) { // arr sorted by time
  if (!arr || !arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].time < time) lo = m + 1; else hi = m; }
  return arr[lo].time === time ? arr[lo].value : null;
}
function renderLegend() {
  const d = state.candles; if (!d.length) return;
  const c = hoverTime ? d.find((x) => x.time === hoverTime) || d[d.length - 1] : d[d.length - 1];
  const p = prec(), cls = c.close >= c.open ? 'up' : 'down';
  const chgPct = ((c.close - c.open) / c.open) * 100;
  let html = `<div class="ohlc ${cls}"><span><label>시</label>${fmt(c.open, p)}</span><span><label>고</label>${fmt(c.high, p)}</span>` +
    `<span><label>저</label>${fmt(c.low, p)}</span><span><label>종</label>${fmt(c.close, p)}</span>` +
    `<span>${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%</span><span><label>거래량</label>${fmt(c.volume, 3)}</span></div>`;
  const row = (name, series, colors, lbls) => {
    const parts = series.map((s, i) => {
      const v = valAt(s, c.time);
      return v == null ? '' : `<span style="color:${colors[i]}">${lbls[i]}: ${fmt(v, p)}</span>`;
    }).join(' ');
    return parts ? `<div class="ohlc">${parts}</div>` : '';
  };
  if (state.ind.ma) html += row('MA', indVals.ma, COLORS.ma, PERIODS.map((n) => `MA(${n})`));
  if (state.ind.ema) html += row('EMA', indVals.ema, COLORS.ma, PERIODS.map((n) => `EMA(${n})`));
  if (state.ind.boll) html += row('BOLL', [indVals.boll[1], indVals.boll[0], indVals.boll[2]], [COLORS.boll[0], COLORS.boll[1], COLORS.boll[2]], ['MID', 'UP', 'LOW']);
  $('legend').innerHTML = html;
}
chart.subscribeCrosshairMove((param) => { hoverTime = param.time || null; renderLegend(); });

// ---------- data ----------
const toCandle = (k) => ({ time: Math.floor(k[0] / 1000) + TZ, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
const volPoint = (c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(14,203,129,.45)' : 'rgba(246,70,93,.45)' });

async function fetchKlines(endTime) {
  const q = new URLSearchParams({ symbol: state.symbol, interval: state.interval, limit: 1000 });
  if (endTime) q.set('endTime', endTime);
  const r = await fetch(`${REST}/fapi/v1/klines?${q}`);
  if (!r.ok) throw new Error('klines ' + r.status);
  return (await r.json()).map(toCandle);
}

async function loadChart() {
  const gen = state.gen;
  state.candles = []; state.noMore = false;
  candleSeries.setData([]); volSeries.setData([]);
  try {
    const data = await fetchKlines();
    if (gen !== state.gen) return;
    state.candles = data;
    candleSeries.setData(data);
    volSeries.setData(data.map(volPoint));
    renderIndicators();
    chart.timeScale().setVisibleLogicalRange({ from: data.length - 120, to: data.length + 6 });
  } catch (e) { setConn('bad', '데이터 로드 실패'); console.error(e); }
}

chart.timeScale().subscribeVisibleLogicalRangeChange(async (range) => {
  if (!range || range.from > 30 || state.loadingMore || state.noMore || !state.candles.length) return;
  state.loadingMore = true;
  const gen = state.gen;
  try {
    const first = state.candles[0].time - TZ;
    const older = await fetchKlines(first * 1000 - 1);
    if (gen !== state.gen) return;
    if (!older.length) { state.noMore = true; return; }
    state.candles = older.concat(state.candles);
    candleSeries.setData(state.candles);
    volSeries.setData(state.candles.map(volPoint));
    renderIndicators();
  } catch (e) { console.error(e); } finally { state.loadingMore = false; }
});

// ---------- websocket ----------
function setConn(cls, text) { const el = $('conn'); el.className = 'conn ' + cls; el.querySelector('span').textContent = text; }

function connect() {
  const gen = state.gen, s = state.symbol.toLowerCase();
  const streams = [`${s}@kline_${state.interval}`, `${s}@ticker`, `${s}@markPrice@1s`, `${s}@depth20@500ms`, `${s}@aggTrade`];
  const ws = new WebSocket(`${WS}?streams=${streams.join('/')}`);
  state.ws = ws;
  ws.onopen = () => setConn('ok', '실시간');
  ws.onmessage = (ev) => {
    if (gen !== state.gen) return;
    const { stream, data } = JSON.parse(ev.data);
    if (stream.includes('@kline')) onKline(data.k);
    else if (stream.endsWith('@ticker')) onTicker(data);
    else if (stream.includes('@markPrice')) onMark(data);
    else if (stream.includes('@depth')) onDepth(data);
    else if (stream.endsWith('@aggTrade')) onTrade(data);
  };
  ws.onclose = () => { if (gen === state.gen) { setConn('bad', '재연결 중'); setTimeout(() => gen === state.gen && connect(), 2000); } };
  ws.onerror = () => ws.close();
}

function restart() {
  state.gen++;
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }
  setConn('', '연결 중');
  applyPrecision();
  resetPanels();
  loadSnapshots();
  loadChart().then(connect);
}

function onKline(k) {
  const c = toCandle([k.t, k.o, k.h, k.l, k.c, k.v]);
  const arr = state.candles; if (!arr.length) return;
  const last = arr[arr.length - 1];
  if (c.time === last.time) arr[arr.length - 1] = c; else if (c.time > last.time) arr.push(c); else return;
  candleSeries.update(c); volSeries.update(volPoint(c));
  renderIndicators();
}

// ---------- ticker bar ----------
let lastPx = null;
function setPrice(px) {
  const p = prec(), el = $('lastPrice');
  if (lastPx != null && px !== lastPx) el.className = 'last-price ' + (px > lastPx ? 'up' : 'down');
  lastPx = px;
  el.textContent = fmt(px, p); $('lastUsd').textContent = '$' + fmt(px, p);
  const mid = $('midPrice'); mid.firstChild.textContent = fmt(px, p); mid.firstChild.className = el.className.replace('last-price ', '');
}
function onTicker(t) {
  const p = prec(), chg = +t.P;
  setPrice(+t.c);
  $('chg').innerHTML = `<span class="${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : ''}${fmt(t.p, p)} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>`;
  $('high').textContent = fmt(t.h, p); $('low').textContent = fmt(t.l, p);
  $('volBase').textContent = fmt(t.v, 3); $('volQuote').textContent = fmt(t.q, 2);
  $('midPrice').lastChild.textContent = '';
  document.title = `${fmt(t.c, p)} | ${state.symbol} Futures`;
}
let nextFunding = 0;
function onMark(m) {
  const p = prec();
  $('mark').textContent = fmt(m.p, p); $('index').textContent = fmt(m.i, p);
  $('funding').textContent = (m.r * 100).toFixed(4) + '%';
  nextFunding = m.T;
  $('midPrice').lastChild.textContent = fmt(m.p, p);
}
setInterval(() => {
  if (!nextFunding) return;
  const s = Math.max(0, Math.floor((nextFunding - Date.now()) / 1000));
  const z = (n) => String(n).padStart(2, '0');
  $('countdown').textContent = `${z(Math.floor(s / 3600))}:${z(Math.floor(s % 3600 / 60))}:${z(s % 60)}`;
}, 1000);

// ---------- order book / trades ----------
const ROWS = 14;
function onDepth(d) {
  const p = prec();
  const asks = d.a.slice(0, ROWS).map(([px, q]) => [+px, +q]).sort((a, b) => b[0] - a[0]); // far → near
  const bids = d.b.slice(0, ROWS).map(([px, q]) => [+px, +q]);
  const max = Math.max(...asks.map((x) => x[1]), ...bids.map((x) => x[1]), 1e-9);
  const render = (list, el, cumFromEnd) => {
    const totals = []; let c = 0;
    const order = cumFromEnd ? [...list].reverse() : list;
    order.forEach(([, q]) => { c += q; totals.push(c); });
    if (cumFromEnd) totals.reverse();
    el.innerHTML = list.map(([px, q], i) =>
      `<div class="row"><i class="bar" style="width:${(q / max * 100).toFixed(1)}%"></i>` +
      `<span class="${el.id === 'asks' ? 'down' : 'up'}">${fmt(px, p)}</span><span>${fmt(q, 3)}</span><span>${fmt(totals[i], 3)}</span></div>`).join('');
  };
  render(asks, $('asks'), true);
  render(bids, $('bids'), false);
}
const trades = [];
function onTrade(t) {
  const p = prec();
  trades.unshift({ px: +t.p, q: +t.q, sell: t.m, t: t.T });
  if (trades.length > 40) trades.pop();
  if ($('tradesView').classList.contains('hidden')) return;
  const time = (ms) => new Date(ms).toLocaleTimeString('en-GB');
  $('tradeRows').innerHTML = trades.map((x) =>
    `<div class="row"><span class="${x.sell ? 'down' : 'up'}">${fmt(x.px, p)}</span><span>${fmt(x.q, 3)}</span><span>${time(x.t)}</span></div>`).join('');
}
function resetPanels() {
  trades.length = 0; lastPx = null; nextFunding = 0;
  ['asks', 'bids', 'tradeRows'].forEach((id) => { $(id).innerHTML = ''; });
  ['lastPrice', 'chg', 'mark', 'index', 'funding', 'countdown', 'high', 'low', 'volBase', 'volQuote'].forEach((id) => { $(id).textContent = '--'; });
  $('lastPrice').className = 'last-price';
  $('volBaseLabel').textContent = `24시간 거래량(${SYMBOLS[state.symbol].base})`;
}
// instant first paint before the socket delivers
async function loadSnapshots() {
  const gen = state.gen;
  try {
    const r = await fetch(`${REST}/fapi/v1/ticker/24hr?symbol=${state.symbol}`);
    const t = await r.json();
    if (gen === state.gen && t.lastPrice) onTicker({ c: t.lastPrice, P: t.priceChangePercent, p: t.priceChange, h: t.highPrice, l: t.lowPrice, v: t.volume, q: t.quoteVolume });
  } catch (e) { /* ws will fill in */ }
}

// ---------- UI wiring ----------
function bindGroup(id, attr, onPick, multi) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (multi) b.classList.toggle('active');
    else { [...$(id).children].forEach((x) => x.classList.remove('active')); b.classList.add('active'); }
    onPick(b.dataset[attr], b.classList.contains('active'));
  });
}
bindGroup('symSwitch', 'sym', (s) => { if (s !== state.symbol) { state.symbol = s; restart(); } });
bindGroup('tf', 'i', (i) => { if (i !== state.interval) { state.interval = i; restart(); } });
bindGroup('ind', 'ind', (k, on) => {
  state.ind[k] = on;
  renderIndicators();
}, true);
bindGroup('sideTabs', 'tab', (t) => {
  $('bookView').classList.toggle('hidden', t !== 'book');
  $('tradesView').classList.toggle('hidden', t !== 'trades');
});

restart();
})();
