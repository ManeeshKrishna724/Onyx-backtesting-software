import { createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType, createSeriesMarkers } from 'lightweight-charts';

// ========== CHART SETUP ==========
const chartContainer = document.getElementById('chart');
const chart = createChart(chartContainer, {
  layout: { background: { color: '#131722' }, textColor: '#d1d4dc', attributionLogo: false },
  grid: { vertLines: { color: '#2a2e39' }, horzLines: { color: '#2a2e39' } },
  crosshair: { mode: 0 },
  rightPriceScale: { borderColor: '#2a2e39' },
  handleScale: {
    mouseWheel: true, pinch: true,
    axisPressedMouseMove: { time: true, price: true },
    axisDoubleClickReset: { time: true, price: true }
  },
  handleScroll: {
    mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true
  },
  // Light kinetic scroll (not as floaty as full momentum)
  kineticScroll: { mouse: false, touch: true },
  localization: {
    timeFormatter: (time) => {
      if (typeof time === 'string') return time;
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      }).format(new Date(time * 1000));
    }
  },
  timeScale: {
    borderColor: '#2a2e39', timeVisible: true, secondsVisible: false,
    tickMarkFormatter: (time, tickMarkType) => {
      if (typeof time === 'string') return time;
      const d = new Date(time * 1000);
      const opts = { timeZone: 'America/New_York' };
      if (tickMarkType === 0) { opts.year = 'numeric'; } 
      else if (tickMarkType === 1) { opts.month = 'short'; } 
      else if (tickMarkType === 2) { opts.month = 'short'; opts.day = 'numeric'; } 
      else { opts.hour = 'numeric'; opts.minute = '2-digit'; opts.hour12 = true; }
      return new Intl.DateTimeFormat('en-US', opts).format(d);
    }
  },
});

new ResizeObserver(entries => {
  if (entries.length === 0 || !entries[0].contentRect) return;
  const { width, height } = entries[0].contentRect;
  chart.applyOptions({ width, height });
}).observe(chartContainer);

const candleSeries = chart.addSeries(CandlestickSeries, {
  upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});

// ========== CHART APPEARANCE (TradingView-style settings) ==========
const CHART_DEFAULTS = {
  // candles
  bodyOn: true, upColor: '#26a69a', upOp: 1, downColor: '#ef5350', downOp: 1,
  borderOn: false, borderUpColor: '#26a69a', borderUpOp: 1, borderDownColor: '#ef5350', borderDownOp: 1,
  wickOn: true, wickUpColor: '#26a69a', wickUpOp: 1, wickDownColor: '#ef5350', wickDownOp: 1,
  // canvas
  bgType: 'solid', bgColor: '#131722', bgOp: 1, bgColor2: '#1e222d', bgOp2: 1,
  gridMode: 'both', gridStyle: 0,
  vGridColor: '#2a2e39', vGridOp: 1, hGridColor: '#2a2e39', hGridOp: 1,
  textColor: '#d1d4dc', textOp: 1,
  scaleLineColor: '#2a2e39', scaleLineOp: 1,
  crossColor: '#758696', crossOp: 1
};
const CHART_LS_KEY = 'backtester.chartSettings.v1';
function loadChartSettings() {
  try { return { ...CHART_DEFAULTS, ...(JSON.parse(localStorage.getItem(CHART_LS_KEY)) || {}) }; }
  catch (e) { return { ...CHART_DEFAULTS }; }
}
function saveChartSettings() {
  try { localStorage.setItem(CHART_LS_KEY, JSON.stringify(chartCfg)); } catch (e) { /* storage unavailable */ }
}
let chartCfg = loadChartSettings();

function applyChartSettings(c) {
  const clear = 'rgba(0,0,0,0)';
  const vOn = c.gridMode === 'both' || c.gridMode === 'vert';
  const hOn = c.gridMode === 'both' || c.gridMode === 'horz';
  const cross = rgba(c.crossColor, c.crossOp);
  chart.applyOptions({
    layout: {
      background: c.bgType === 'gradient'
        ? { type: ColorType.VerticalGradient, topColor: rgba(c.bgColor, c.bgOp), bottomColor: rgba(c.bgColor2, c.bgOp2) }
        : { type: ColorType.Solid, color: rgba(c.bgColor, c.bgOp) },
      textColor: rgba(c.textColor, c.textOp)
    },
    grid: {
      vertLines: { visible: vOn, color: rgba(c.vGridColor, c.vGridOp), style: Number(c.gridStyle) },
      horzLines: { visible: hOn, color: rgba(c.hGridColor, c.hGridOp), style: Number(c.gridStyle) }
    },
    crosshair: { vertLine: { color: cross }, horzLine: { color: cross } },
    rightPriceScale: { borderColor: rgba(c.scaleLineColor, c.scaleLineOp) },
    timeScale: { borderColor: rgba(c.scaleLineColor, c.scaleLineOp) }
  });
  candleSeries.applyOptions({
    upColor: c.bodyOn ? rgba(c.upColor, c.upOp) : clear,
    downColor: c.bodyOn ? rgba(c.downColor, c.downOp) : clear,
    borderVisible: !!c.borderOn,
    borderUpColor: rgba(c.borderUpColor, c.borderUpOp),
    borderDownColor: rgba(c.borderDownColor, c.borderDownOp),
    wickVisible: !!c.wickOn,
    wickUpColor: rgba(c.wickUpColor, c.wickUpOp),
    wickDownColor: rgba(c.wickDownColor, c.wickDownOp)
  });
}
applyChartSettings(chartCfg);

// ========== STATE & CACHE ==========
let rawCandles = [];
let currentTimeframe = '1';
let currentSymbol = '';
const tfCache = new Map();
let currentDataCache = []; 
let replayTimestamp = null;
let replayRawIndex = -1; // O(1) replay cursor into rawCandles
let selectingBarMode = false;

// ========== INDEXEDDB STORAGE ==========
const DB_NAME = 'BacktesterDB';
const STORE_NAME = 'candlesStore';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveToDB(candles, tf) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(candles, 'rawCandles');
    store.put(tf, 'currentTf');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Changing the chart timeframe should not rewrite a potentially huge raw candle array.
async function saveCurrentTfToDB(tf) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(tf, 'currentTf');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const reqs = {
      candles: store.get('rawCandles'), tf: store.get('currentTf'), drawings: store.get('drawings'),
      toolStyles: store.get('toolStyles'), replayTs: store.get('replayTimestamp'), nextShapeId: store.get('nextShapeId'),
      posSize: store.get('posSize'), symbol: store.get('symbol'), timestampFixVersion: store.get('timestampFixVersion')
    };
    tx.oncomplete = () => resolve({
      candles: reqs.candles.result || [], tf: reqs.tf.result || '1', drawings: reqs.drawings.result,
      toolStyles: reqs.toolStyles.result, replayTs: reqs.replayTs.result, nextShapeId: reqs.nextShapeId.result,
      posSize: reqs.posSize.result, symbol: reqs.symbol.result, timestampFixVersion: reqs.timestampFixVersion.result || 0
    });
    tx.onerror = () => reject(tx.error);
  });
}

async function clearDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Drawings, tool styles and the replay position are auto-saved (debounced) whenever they change.
let persistReady = false, persistTimer = null, lastPersistSig = '';
function persistSignature() { return JSON.stringify([drawings, toolStyles, replayTimestamp, nextShapeId, posSize, currentSymbol]); }
function schedulePersist() {
  if (!persistReady) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 350);
}
async function persistNow() {
  persistTimer = null;
  if (!persistReady) return;
  lastPersistSig = persistSignature();
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const st = tx.objectStore(STORE_NAME);
      st.put(drawings, 'drawings');
      st.put(toolStyles, 'toolStyles');
      st.put(replayTimestamp, 'replayTimestamp');
      st.put(nextShapeId, 'nextShapeId');
      st.put(posSize, 'posSize');
      st.put(currentSymbol, 'symbol');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) { console.error('Failed to save state:', err); }
}
window.addEventListener('pagehide', () => { if (persistTimer) { clearTimeout(persistTimer); persistNow(); } });

// ========== FAST NY TIME HELPERS ==========
const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
});

// Cache NY wall-clock breakdowns. Intl.DateTimeFormat is the hot cost in
// session alignment, indicator day buckets, and marker mapping during skip.
const _nyDetailCache = new Map();
const NY_DETAIL_CACHE_MAX = 20000;
function getNYTimeDetails(timestampUTC) {
  const key = timestampUTC | 0;
  let ny = _nyDetailCache.get(key);
  if (ny) return ny;
  const d = new Date(timestampUTC * 1000);
  const parts = nyFormatter.formatToParts(d);
  ny = {};
  for (const p of parts) { if (p.type !== 'literal') ny[p.type] = parseInt(p.value, 10); }
  if (ny.hour === 24) ny.hour = 0;
  if (_nyDetailCache.size >= NY_DETAIL_CACHE_MAX) _nyDetailCache.clear();
  _nyDetailCache.set(key, ny);
  return ny;
}

const _sessKeyCache = new Map(); // `${tf}|${utc}` -> key
const SESS_KEY_CACHE_MAX = 30000;
function getSessionAlignedKey(utcSeconds, tf) {
  const ck = tf + '|' + (utcSeconds | 0);
  let hit = _sessKeyCache.get(ck);
  if (hit !== undefined) return hit;

  const ny = getNYTimeDetails(utcSeconds);
  const nyMathTime = Date.UTC(ny.year, ny.month - 1, ny.day, ny.hour, ny.minute, ny.second);
  const shiftedTime = nyMathTime + (6 * 3600 * 1000);
  const shiftedDate = new Date(shiftedTime);
  let key;

  if (tf === '1D') {
    key = `${shiftedDate.getUTCFullYear()}-${String(shiftedDate.getUTCMonth() + 1).padStart(2, '0')}-${String(shiftedDate.getUTCDate()).padStart(2, '0')}`;
  } else if (tf === '1W') {
    const dayOfWeek = shiftedDate.getUTCDay();
    const diff = shiftedDate.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    shiftedDate.setUTCDate(diff);
    key = `${shiftedDate.getUTCFullYear()}-${String(shiftedDate.getUTCMonth() + 1).padStart(2, '0')}-${String(shiftedDate.getUTCDate()).padStart(2, '0')}`;
  } else {
    const intervalSec = (parseInt(tf, 10) || 1) * 60;
    const shiftedSec = Math.floor(shiftedTime / 1000);
    const bucketShifted = Math.floor(shiftedSec / intervalSec) * intervalSec;
    const nyAsUtcSec = Math.floor(nyMathTime / 1000);
    const offset = nyAsUtcSec - utcSeconds;
    key = bucketShifted - offset - 6 * 3600;
  }
  if (_sessKeyCache.size >= SESS_KEY_CACHE_MAX) _sessKeyCache.clear();
  _sessKeyCache.set(ck, key);
  return key;
}

// ========== PARSER & MERGE ==========
// Accepts NinjaTrader exports ("yyyyMMdd HHmmss;O;H;L;C;V" or "yyyyMMdd;O;H;L;C;V") plus ISO-style dates,
// ; , or tab delimiters, header rows, CRLF files and decimal commas.
function parseTimeField(str) {
  const t = String(str).trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`; // daily bar
  m = /^(\d{4})(\d{2})(\d{2})[ T](\d{2})(\d{2})(\d{2})?/.exec(t);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000) - 60; // NinjaTrader intraday bars are close-stamped; store bar-open time
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) {
    if (m[4] === undefined) return `${m[1]}-${m[2]}-${m[3]}`;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000) - 60; // NinjaTrader intraday bars are close-stamped; store bar-open time
  }
  return null;
}
function parseNinjaTraderData(text) {
  const lines = text.split(/\r?\n/);
  let delim = ';';
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    delim = t.includes(';') ? ';' : t.includes('\t') ? '\t' : t.includes(',') ? ',' : ';';
    break;
  }
  const num = (v) => +String(v).trim().replace(delim === ';' ? ',' : '', delim === ';' ? '.' : '');
  const data = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(delim);
    if (parts.length < 5) continue;
    const time = parseTimeField(parts[0]);
    if (time === null) continue; // header or junk line
    const open = num(parts[1]), high = num(parts[2]), low = num(parts[3]), close = num(parts[4]);
    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;
    // repair rows whose high / low do not cover open and close
    const volume = parts.length > 5 ? (num(parts[5]) || 0) : 0;
    data.push({ time, open, high: Math.max(open, high, low, close), low: Math.min(open, high, low, close), close, volume });
  }
  return data;
}

// Merge is order-independent: everything is keyed and sorted by real time, so it does not matter
// in which order files are uploaded (or whether a file is oldest-first or newest-first).
// If two files contain the same timestamp, the most recently uploaded one wins.
function mergeCandles(existing, incoming) {
  const map = new Map();
  for (let i = 0; i < existing.length; i++) map.set(getComparableTime(existing[i].time), existing[i]);
  for (let i = 0; i < incoming.length; i++) map.set(getComparableTime(incoming[i].time), incoming[i]);
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(e => e[1]);
}
function isAscending(data) {
  let prev = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const t = getComparableTime(data[i].time);
    if (!(t > prev)) return false;
    prev = t;
  }
  return true;
}
function ensureAscending(data) { // the chart library throws on unsorted / duplicate times
  if (isAscending(data)) return data;
  return mergeCandles([], data);
}
// Most common gap between candles, in seconds (0 = unknown) - used to spot mixed bar sizes
function barStep(arr) {
  const n = Math.min(arr.length, 4000), counts = new Map();
  for (let i = 1; i < n; i++) {
    const d = getComparableTime(arr[i].time) - getComparableTime(arr[i - 1].time);
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 0, bc = 0;
  counts.forEach((c, d) => { if (c > bc) { bc = c; best = d; } });
  return best;
}
function fmtStep(sec) {
  if (sec % 86400 === 0) return `${sec / 86400}d`;
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}
const summaryDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const summaryDateUTC = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
function dataSummary() {
  if (!rawCandles.length) return '';
  const f = (t) => typeof t === 'string' ? summaryDateUTC.format(new Date(Date.parse(t))) : summaryDate.format(new Date(t * 1000));
  return `${rawCandles.length.toLocaleString()} candles \u00b7 ${f(rawCandles[0].time)} \u2013 ${f(rawCandles[rawCandles.length - 1].time)}`;
}

// ---- symbol (short name) taken from the file name, e.g. "NQ 12-24.Last.txt" -> NQ
const symbolChip = document.getElementById('symbolChip');
function symbolFromFileName(name) {
  const base = String(name).replace(/\.[^.]*$/, '');
  const tok = base.split(/[\s._\-]+/).filter(Boolean)[0] || '';
  const m = /^([A-Za-z]+)\d{2,}$/.exec(tok); // NQ1224 -> NQ
  const sym = (m ? m[1] : tok).toUpperCase();
  return /^\d+$/.test(sym) ? '' : sym.slice(0, 8);
}
function setSymbol(sym) {
  currentSymbol = sym || '';
  symbolChip.textContent = currentSymbol;
  symbolChip.hidden = !currentSymbol;
  document.title = currentSymbol ? `${currentSymbol} \u00b7 Onyx` : 'Onyx';
}

function resample(candles, tf, useCache = true) {
  if (!candles.length) return [];
  // Only cache the full raw history — replay partial series must not poison the cache
  if (useCache && candles === rawCandles && tfCache.has(tf)) return tfCache.get(tf);
  const result = [];
  let current = null; let currentKey = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const t = typeof c.time === 'string' ? Math.floor(Date.parse(c.time) / 1000) : c.time;
    const key = getSessionAlignedKey(t, tf);

    if (currentKey !== key) {
      if (current) result.push(current);
      currentKey = key;
      current = { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
    } else {
      if (c.high > current.high) current.high = c.high;
      if (c.low < current.low) current.low = c.low;
      current.close = c.close;
      current.volume += c.volume || 0;
    }
  }
  if (current) result.push(current);
  result.sort((a, b) => {
    const ta = typeof a.time === 'string' ? Date.parse(a.time) / 1000 : a.time;
    const tb = typeof b.time === 'string' ? Date.parse(b.time) / 1000 : b.time;
    return ta - tb;
  });
  const deduped = [];
  for (const c of result) {
    if (!deduped.length) { deduped.push(c); continue; }
    const prev = deduped[deduped.length - 1];
    const tp = typeof prev.time === 'string' ? Date.parse(prev.time) / 1000 : prev.time;
    const tc = typeof c.time === 'string' ? Date.parse(c.time) / 1000 : c.time;
    if (tc === tp) {
      if (c.high > prev.high) prev.high = c.high;
      if (c.low < prev.low) prev.low = c.low;
      prev.close = c.close;
      prev.volume = (prev.volume || 0) + (c.volume || 0);
    } else deduped.push(c);
  }
  if (useCache && candles === rawCandles) tfCache.set(tf, deduped);
  return deduped;
}

/** Last raw 1m index with time <= ts. */
function rawIndexAtOrBefore(ts) {
  if (!rawCandles.length || ts == null) return -1;
  let lo = 0, hi = rawCandles.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const t = getComparableTime(rawCandles[m].time);
    if (t <= ts) { ans = m; lo = m + 1; }
    else hi = m - 1;
  }
  return ans;
}

/**
 * Build the replay-visible series from the FULL timeframe cache.
 * Only the currently forming candle is aggregated from raw 1m bars; all
 * completed candles are reused from the cached timeframe series. This keeps
 * replay-timeframe switches from reprocessing the entire raw history.
 */
function buildSeriesForView(tf, fullSeries = null) {
  if (!rawCandles.length) return [];
  const cached = fullSeries || resample(rawCandles, tf, true);
  if (replayTimestamp == null) return cached;

  const end = rawIndexAtOrBefore(replayTimestamp);
  if (end < 0) return [];

  const endTime = getComparableTime(rawCandles[end].time);
  const bucketKey = getSessionAlignedKey(endTime, tf);
  const bucketTime = getComparableTime(bucketKey);

  // Find the first raw 1m candle belonging to the current timeframe bucket.
  let lo = 0, hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const midBucket = getComparableTime(getSessionAlignedKey(getComparableTime(rawCandles[mid].time), tf));
    if (midBucket < bucketTime) lo = mid + 1;
    else hi = mid;
  }
  const rawStart = lo;

  // Find the matching candle in the full timeframe cache. Everything before
  // it is already complete and can be reused without aggregation.
  lo = 0; hi = cached.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (getComparableTime(cached[mid].time) < bucketTime) lo = mid + 1;
    else hi = mid;
  }
  const cachedBucketIndex = lo;

  let partial = null;
  for (let i = rawStart; i <= end; i++) {
    const c = rawCandles[i];
    if (!partial) {
      partial = { time: bucketKey, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
    } else {
      if (c.high > partial.high) partial.high = c.high;
      if (c.low < partial.low) partial.low = c.low;
      partial.close = c.close;
      partial.volume += c.volume || 0;
    }
  }

  const visible = cached.slice(0, cachedBucketIndex);
  if (partial) visible.push(partial);
  return visible;
}

function getComparableTime(timeVal) {
  if (timeVal == null) return null;
  if (typeof timeVal === 'number' && isFinite(timeVal)) return timeVal;
  if (typeof timeVal === 'string') {
    const ms = Date.parse(timeVal);
    return isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  // Lightweight Charts business-day object { year, month, day }
  if (typeof timeVal === 'object' && timeVal.year) {
    return Math.floor(Date.UTC(timeVal.year, timeVal.month - 1, timeVal.day) / 1000);
  }
  return null;
}

let displayLen = 0; // number of candles currently on the chart
// Remember where the user is looking so a timeframe change can put the chart back in the same place.
function captureView() {
  const lr = chart.timeScale().getVisibleLogicalRange();
  if (!lr || !displayLen) return null;
  const bars = lr.to - lr.from, lastIdx = displayLen - 1;
  if (lr.to >= lastIdx - 0.5) return { mode: 'edge', bars, offset: lr.to - lastIdx }; // following the latest candle
  const ct = logicalToTime((lr.from + lr.to) / 2);
  return ct === null ? null : { mode: 'center', bars, centerTime: ct }; // looking at history
}
function restoreView(v, data) {
  if (!v || !data.length) return false;
  let to;
  if (v.mode === 'edge') to = data.length - 1 + v.offset;
  else { const cl = timeToLogical(v.centerTime); if (cl === null) return false; to = cl + v.bars / 2; }
  chart.timeScale().setVisibleLogicalRange({ from: to - v.bars, to });
  return true;
}

// Track manual price-scale zoom so TF changes don't force autoScale
let priceScaleManual = false;
let savedManualPriceRange = null;

function capturePriceScaleState() {
  if (!priceScaleManual) return;
  try {
    const r = chart.priceScale('right').getVisibleRange();
    if (r && isFinite(r.from) && isFinite(r.to) && r.to > r.from) savedManualPriceRange = { from: r.from, to: r.to };
  } catch (e) { /* ignore */ }
}
function markPriceScaleManual() {
  priceScaleManual = true;
  capturePriceScaleState();
  try { positionPriceResetBtn(); } catch (e) { /* not ready */ }
}
function resetPriceScale() {
  try { chart.priceScale('right').applyOptions({ autoScale: true }); } catch (e) { /* ignore */ }
  priceScaleManual = false;
  savedManualPriceRange = null;
  dirty = true;
  try { positionPriceResetBtn(); } catch (e) { /* not ready */ }
}

function binaryCutoffIndex(data, ts) {
  // first index with time > ts (same as findIndex but O(log n))
  let lo = 0, hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (getComparableTime(data[mid].time) > ts) hi = mid;
    else lo = mid + 1;
  }
  return lo < data.length ? lo : -1;
}

let pendingIndSync = 0;
let indSyncTimer = null;
let indSyncRaf = 0;
function scheduleIndicatorSync(delayMs = 0) {
  // Coalesce rapid replay steps / TF clicks into ONE indicator rebuild after idle
  const token = ++pendingIndSync;
  if (indSyncTimer) { clearTimeout(indSyncTimer); indSyncTimer = null; }
  if (indSyncRaf) { cancelAnimationFrame(indSyncRaf); indSyncRaf = 0; }
  const run = () => {
    indSyncTimer = null;
    indSyncRaf = requestAnimationFrame(() => {
      indSyncRaf = 0;
      if (token !== pendingIndSync) return;
      // Always sync when any instance exists — inactive ones must be removed
      // from the chart (series + box/VP overlays). Skipping here left MOR
      // markings visible on daily/hourly after a 1m–5m visibility range.
      if (indInst.length || indSeries.size) syncIndicators(false);
      else { indBoxCache.clear(); dirty = true; }
      updateGoToLatestBtn();
    });
  };
  if (delayMs > 0) indSyncTimer = setTimeout(run, delayMs);
  else run();
}

function applyTimeframe(tf, skipZoom = false, preserveView = false) {
  const prevView = preserveView && !skipZoom ? captureView() : null;
  capturePriceScaleState();
  const wasManual = priceScaleManual;
  const savedRange = savedManualPriceRange ? { ...savedManualPriceRange } : null;
  const tfChanged = tf !== currentTimeframe;

  currentTimeframe = tf;
  if (tfChanged) { trackerCache.clear(); indBoxCache.clear(); trMarkAlign.clear(); }
  dirty = true;
  document.querySelectorAll('.timeframes button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tf === tf);
  });

  // Build/reuse the full timeframe once, then derive the replay view from it.
  // During replay only the active partial candle is aggregated from raw 1m data.
  currentDataCache = resample(rawCandles, tf, true);
  const displayData = buildSeriesForView(tf, currentDataCache);
  replayRawIndex = replayTimestamp == null ? -1 : rawIndexAtOrBefore(replayTimestamp);

  candleSeries.setData(displayData);
  displayLen = displayData.length;
  shownData = displayData;
  window._dataStartIdx = 0;
  ctRef = null;

  if (!skipZoom) {
    if (wasManual && savedRange && isFinite(savedRange.from) && isFinite(savedRange.to)) {
      priceScaleManual = true;
      savedManualPriceRange = savedRange;
      try {
        chart.priceScale('right').applyOptions({ autoScale: false });
        chart.priceScale('right').setVisibleRange(savedRange);
      } catch (e) { /* ignore */ }
    } else {
      priceScaleManual = false;
      savedManualPriceRange = null;
      try { chart.priceScale('right').applyOptions({ autoScale: true }); } catch (e) { /* ignore */ }
    }
    if (!restoreView(prevView, displayData)) {
      if (displayData.length > 500) chart.timeScale().setVisibleLogicalRange({ from: displayData.length - 500, to: displayData.length });
      else chart.timeScale().fitContent();
    }
  }
  updateStatusBar(displayData);
  // Paint candles first; then rebuild indicators so visibility ranges
  // (e.g. 1m–5m only) remove series/boxes on hour/day/week charts.
  if (tfChanged) {
    // Invalidate the active-key so the next sync always rebuilds (hide inactive)
    indActiveKey = '';
  }
  scheduleIndicatorSync(tfChanged ? 30 : 0);
  scheduleGoToLatest();
  if (tfChanged) schedulePersist();
}

// ========== FOOTER / STATUS BAR ==========
const sbTf = document.getElementById('sbTf');
const sbReplay = document.getElementById('sbReplay');
const sbTime = document.getElementById('sbTime');
const sbIntraday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', day: '2-digit', month: 'short', year: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short'
});
const sbDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: '2-digit'
});
function formatStatusTime(t) {
  const p = {};
  if (typeof t === 'string') { // daily / weekly candles are keyed by date
    const [y, m, d] = t.split('-').map(Number);
    sbDate.formatToParts(new Date(Date.UTC(y, m - 1, d))).forEach(x => { p[x.type] = x.value; });
    return `${p.weekday} ${p.day} ${p.month} '${p.year}`;
  }
  sbIntraday.formatToParts(new Date(t * 1000)).forEach(x => { p[x.type] = x.value; });
  // timeZoneName is EST in winter and EDT during daylight-saving time
  return `${p.weekday} ${p.day} ${p.month} '${p.year}  ${p.hour}:${p.minute}:${p.second} ${String(p.dayPeriod).toUpperCase()} ${p.timeZoneName}`;
}
function updateStatusBar(data) {
  const btn = document.querySelector(`#timeframes button[data-tf="${currentTimeframe}"]`);
  sbTf.textContent = btn ? btn.textContent : currentTimeframe;
  sbReplay.hidden = replayTimestamp === null;
  // Replay clock is always the 1-minute cursor, not the higher-TF bar open
  if (replayTimestamp != null) {
    sbTime.textContent = formatStatusTime(replayTimestamp);
    return;
  }
  const last = data && data.length ? data[data.length - 1] : null;
  sbTime.textContent = last ? formatStatusTime(last.time) : '—';
}

// ========== REPLAY TOOLBAR ==========
const replayToolbar = document.querySelector('.replay-toolbar');
const dragHandle = document.querySelector('.drag-handle');
let isDraggingReplay = false;
let startX, startY, initialLeft, initialTop;

if (dragHandle && replayToolbar) {
  dragHandle.addEventListener('mousedown', (e) => {
    isDraggingReplay = true;
    startX = e.clientX; startY = e.clientY;
    const rect = replayToolbar.getBoundingClientRect();
    replayToolbar.style.left = `${rect.left}px`; replayToolbar.style.top = `${rect.top}px`;
    replayToolbar.style.bottom = 'auto'; replayToolbar.style.transform = 'none';
    initialLeft = rect.left; initialTop = rect.top;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDraggingReplay) return;
    replayToolbar.style.left = `${initialLeft + (e.clientX - startX)}px`;
    replayToolbar.style.top = `${initialTop + (e.clientY - startY)}px`;
  });
  document.addEventListener('mouseup', () => { isDraggingReplay = false; document.body.style.userSelect = ''; });
}

document.getElementById('btn-select-bar').addEventListener('click', function() {
  selectingBarMode = !selectingBarMode;
  this.classList.toggle('active', selectingBarMode);
  chartContainer.style.cursor = selectingBarMode ? 'crosshair' : 'default';
});

function stepReplay(steps) {
  if (replayTimestamp === null || !rawCandles.length || !steps) return;

  // Keep a raw-array cursor so normal forward replay never binary-searches or
  // rebuilds the complete historical prefix on every button press.
  // replayTimestamp is the CLOSE of the 1m bar (open + 59), not the open time.
  let cur = replayRawIndex;
  const curOpen = cur >= 0 && cur < rawCandles.length ? getComparableTime(rawCandles[cur].time) : null;
  if (cur < 0 || curOpen == null || curOpen + 59 !== replayTimestamp) {
    cur = rawIndexAtOrBefore(replayTimestamp);
  }
  if (cur < 0) return;

  // A replay click advances to the CLOSE of the next candle on the
  // selected timeframe. Raw data is 1-minute OHLC, so for higher timeframes
  // locate the final 1-minute bar in the target bucket.
  const isOneMinute = String(currentTimeframe) === '1';
  let targetIdx = cur;

  if (isOneMinute) {
    targetIdx = Math.min(Math.max(cur + steps, 0), rawCandles.length - 1);
  } else if (steps > 0) {
    // First click completes the candle currently being formed. Only a click
    // made while already at that candle's final raw bar advances to the next
    // timeframe candle. Additional steps then complete subsequent candles.
    let bucket = getSessionAlignedKey(getComparableTime(rawCandles[cur].time), currentTimeframe);
    let lastInBucket = cur;
    let i = cur + 1;

    // Find the final available 1m candle in the current timeframe bucket.
    while (i < rawCandles.length) {
      const nextBucket = getSessionAlignedKey(getComparableTime(rawCandles[i].time), currentTimeframe);
      if (nextBucket !== bucket) break;
      lastInBucket = i;
      i++;
    }

    let remaining = steps;
    if (lastInBucket > cur) {
      targetIdx = lastInBucket;
      remaining--;
    } else {
      // Cursor is already at the current timeframe candle's close; the next
      // click should complete the following timeframe candle.
      targetIdx = cur;
    }

    // Complete one subsequent timeframe candle for each remaining step.
    while (remaining > 0 && i < rawCandles.length) {
      bucket = getSessionAlignedKey(getComparableTime(rawCandles[i].time), currentTimeframe);
      targetIdx = i;
      i++;
      while (i < rawCandles.length) {
        const nextBucket = getSessionAlignedKey(getComparableTime(rawCandles[i].time), currentTimeframe);
        if (nextBucket !== bucket) break;
        targetIdx = i;
        i++;
      }
      remaining--;
    }
  } else {
    // Backward stepping lands on the close of the previous timeframe candle.
    let bucket = getSessionAlignedKey(getComparableTime(rawCandles[cur].time), currentTimeframe);
    let bucketsMoved = 0;
    for (let i = cur - 1; i >= 0; i--) {
      const previousBucket = getSessionAlignedKey(getComparableTime(rawCandles[i].time), currentTimeframe);
      if (previousBucket !== bucket) {
        bucketsMoved++;
        bucket = previousBucket;
        if (bucketsMoved > Math.abs(steps)) {
          targetIdx = i + 1; // final available 1m bar in the requested prior candle
          break;
        }
      }
      targetIdx = i;
    }
  }
  if (targetIdx === cur) return;

  // Keep ctArr in sync without rebuilding the whole array on every step
  const ensureCtAppend = (t) => {
    if (ctRef === shownData && Array.isArray(ctArr)) ctArr.push(getComparableTime(t));
    else ctRef = null; // force rebuild next time someone needs full ctimes
  };

  // Backward stepping rebuilds the visible aggregate safely.
  if (targetIdx < cur) {
    replayRawIndex = targetIdx;
    replayTimestamp = getComparableTime(rawCandles[targetIdx].time) + 59;
    const rebuilt = buildSeriesForView(currentTimeframe);
    candleSeries.setData(rebuilt);
    shownData = rebuilt;
    displayLen = rebuilt.length;
    ctRef = null;
  } else if (isOneMinute) {
    // Fast path: 1m only — push + single LWC update per new bar, no session keys
    for (let i = cur + 1; i <= targetIdx; i++) {
      const raw = rawCandles[i];
      const rawTime = getComparableTime(raw.time);
      const next = { time: rawTime, open: raw.open, high: raw.high, low: raw.low, close: raw.close, volume: raw.volume || 0 };
      shownData.push(next);
      ensureCtAppend(rawTime);
      candleSeries.update(next);
    }
    displayLen = shownData.length;
  } else {
    // Higher TF forward: aggregate into the forming bucket
    let next = null;
    for (let i = cur + 1; i <= targetIdx; i++) {
      const raw = rawCandles[i];
      const rawTime = getComparableTime(raw.time);
      const bucketTime = getSessionAlignedKey(rawTime, currentTimeframe);
      const last = shownData[shownData.length - 1];
      const lastTime = last ? getComparableTime(last.time) : null;
      if (last && lastTime === getComparableTime(bucketTime)) {
        last.high = Math.max(last.high, raw.high);
        last.low = Math.min(last.low, raw.low);
        last.close = raw.close;
        last.volume = (last.volume || 0) + (raw.volume || 0);
        next = last;
      } else {
        next = { time: bucketTime, open: raw.open, high: raw.high, low: raw.low, close: raw.close, volume: raw.volume || 0 };
        shownData.push(next);
        ensureCtAppend(bucketTime);
      }
    }
    if (next) candleSeries.update(next); // one LWC call for the whole step
    displayLen = shownData.length;
  }

  replayRawIndex = targetIdx;
  replayTimestamp = getComparableTime(rawCandles[targetIdx].time) + 59;
  // Status: write the clock directly (no querySelector work)
  sbReplay.hidden = false;
  sbTime.textContent = formatStatusTime(replayTimestamp);
  // Position tools only
  if (drawings.some(d => isPosTool(d.tool))) dirty = true;
  // Idle-only indicator sync: rapid scrubbing never pays for MOR/line rebuilds mid-burst
  scheduleIndicatorSync(replayTimestamp != null ? 400 : 0);
  // Defer go-to-latest visibility work
  if (typeof scheduleGoToLatest === 'function') scheduleGoToLatest();
  else updateGoToLatestBtn();
}


document.getElementById('btn-skip-1').addEventListener('click', () => stepReplay(1));
document.getElementById('btn-skip-5').addEventListener('click', () => stepReplay(5));
document.getElementById('btn-exit-replay').addEventListener('click', () => {
  pushUndo('exit replay');
  replayTimestamp = null; selectingBarMode = false;
  document.getElementById('btn-select-bar').classList.remove('active');
  chartContainer.style.cursor = 'default';
  applyTimeframe(currentTimeframe);
});

// ========== GO TO SESSION ==========
// Session open times in America/New_York local wall-clock.
const SESSION_TIMES = {
  asia:  { h: 20, m: 0,  label: 'Asia Session' },
  london:{ h: 2,  m: 0,  label: 'London Session' },
  nyam:  { h: 8,  m: 30, label: 'New York AM Session' },
  open:  { h: 9,  m: 30, label: '09:30 AM open' },
  nypm:  { h: 13, m: 30, label: 'New York PM Session' }
};

/** Return NY wall-clock {y,mo,d,h,mi,s} for a UTC-seconds timestamp. */
function nyParts(utcSec) {
  return getNYTimeDetails(utcSec);
}

/**
 * Find the next raw 1m candle whose NY time is >= target (h:m) on or after the
 * current cursor day. If none remains in the file, wrap to the first match.
 */
function findSessionIndex(sessionKey, fromTs) {
  const spec = SESSION_TIMES[sessionKey];
  if (!spec || !rawCandles.length) return -1;
  const startTs = fromTs != null ? fromTs : (rawCandles.length ? getComparableTime(rawCandles[0].time) : null);
  if (startTs == null) return -1;

  // Prefer the next occurrence strictly after the cursor so repeated clicks advance day-by-day
  const cursorIdx = rawIndexAtOrBefore(startTs);
  const searchFrom = Math.max(0, cursorIdx + 1);

  const matchAt = (i) => {
    const t = getComparableTime(rawCandles[i].time);
    if (t == null) return false;
    const ny = nyParts(t);
    return ny.hour === spec.h && ny.minute === spec.m;
  };

  for (let i = searchFrom; i < rawCandles.length; i++) {
    if (matchAt(i)) return i;
  }
  // Wrap: first occurrence from the start of the data
  for (let i = 0; i < rawCandles.length; i++) {
    if (matchAt(i)) return i;
  }
  return -1;
}

function goToSession(sessionKey) {
  if (!rawCandles.length) { trToast('Load some data first'); return; }
  const fromTs = replayTimestamp != null ? replayTimestamp : getComparableTime(rawCandles[rawCandles.length - 1].time);
  const idx = findSessionIndex(sessionKey, fromTs);
  if (idx < 0) {
    trToast('No ' + (SESSION_TIMES[sessionKey]?.label || sessionKey) + ' bar found in this data');
    return;
  }
  pushUndo('go to ' + (SESSION_TIMES[sessionKey]?.label || sessionKey));
  // Enter / move replay cursor to that bar's close
  const barT = getComparableTime(rawCandles[idx].time);
  replayRawIndex = idx;
  replayTimestamp = barT + 59;
  selectingBarMode = false;
  const selBtn = document.getElementById('btn-select-bar');
  if (selBtn) selBtn.classList.remove('active');
  chartContainer.style.cursor = 'default';
  const rebuilt = buildSeriesForView(currentTimeframe);
  candleSeries.setData(rebuilt);
  shownData = rebuilt;
  displayLen = rebuilt.length;
  ctRef = null;
  // Center the view near the jumped-to bar
  if (displayLen > 120) {
    chart.timeScale().setVisibleLogicalRange({ from: displayLen - 120, to: displayLen });
  } else {
    chart.timeScale().fitContent();
  }
  updateStatusBar(shownData);
  dirty = true;
  scheduleIndicatorSync(80);
  updateGoToLatestBtn();
  schedulePersist();
  trToast((SESSION_TIMES[sessionKey]?.label || sessionKey) + '  ·  ' + formatStatusTime(barT));
}

(function setupGotoMenu() {
  const btn = document.getElementById('gotoBtn');
  const menu = document.getElementById('gotoMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !menu.hidden;
    menu.hidden = open;
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-session]');
    if (!b) return;
    menu.hidden = true;
    goToSession(b.dataset.session);
  });
  document.addEventListener('mousedown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      menu.hidden = true;
    }
  }, true);
})();

// ========== ADVANCED SVG DRAWING ENGINE (TradingView style) ==========
const SVG_NS = 'http://www.w3.org/2000/svg';
const TICK_SIZE = 0.25; // only used for the "ticks" number on Long / Short labels
const UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const svgOverlay = document.createElementNS(SVG_NS, 'svg');
svgOverlay.id = 'svg-overlay';
chartContainer.appendChild(svgOverlay);

// Toolbars are plain <body> children (position: fixed) so they can float over everything
const drawToolbar = document.getElementById('drawToolbar');
const editToolbar = document.getElementById('editToolbar');
const ftButtons = document.getElementById('ftButtons');

let drawings = [];
let currentDrawTool = null;
let drawClicks = [];
let activePreview = null;
let selectedShapeId = null;
let isShiftDown = false;
let nextShapeId = 1;
let dirty = true;
let dragState = null;
let creating = null;
let posSize = null; // last-used long/short box size: { tp, sl (points), bars (width) }
let toolStyles = {}; // last-used style per tool, applied to the next drawing of that tool
const STYLE_SKIP = new Set(['id', 'tool', 'p1', 'p2', 'tpPrice', 'slPrice', 'locked', 'isPreview', 'vis', 'widthBars']);
function rememberStyle(s) {
  if (!s || !s.tool) return;
  const o = {};
  // Remember colours, sizes, alignment, etc. — but never the text content of the last drawing.
  // (Named templates can still store text via styleSnapshot.)
  for (const k in s) {
    if (STYLE_SKIP.has(k) || k === 'text') continue;
    o[k] = s[k];
  }
  toolStyles[s.tool] = clone(o);
}

// ---------- named drawing templates (style presets per tool) ----------
const TPL_KEY = 'onyx.drawTemplates.v1';
let drawTemplates = {}; // { tool: [{ name, style }, ...] }
function loadDrawTemplates() {
  try {
    const o = JSON.parse(localStorage.getItem(TPL_KEY));
    drawTemplates = (o && typeof o === 'object') ? o : {};
  } catch (e) { drawTemplates = {}; }
}
function saveDrawTemplates() {
  try { localStorage.setItem(TPL_KEY, JSON.stringify(drawTemplates)); } catch (e) { /* storage unavailable */ }
}
loadDrawTemplates();
function styleSnapshot(s) {
  if (!s) return {};
  const o = {};
  for (const k in s) if (!STYLE_SKIP.has(k)) o[k] = s[k];
  return clone(o);
}
function listTemplates(tool) { // alphabetical, not in the order they were created
  const arr = drawTemplates[tool];
  if (!Array.isArray(arr)) return [];
  return arr.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }));
}
function saveTemplate(tool, name, style) {
  const n = String(name || '').trim();
  if (!tool || !n) return false;
  if (!drawTemplates[tool]) drawTemplates[tool] = [];
  const list = drawTemplates[tool];
  const i = list.findIndex(t => t.name.toLowerCase() === n.toLowerCase());
  const entry = { name: n, style: clone(style) };
  if (i >= 0) list[i] = entry; else list.push(entry);
  saveDrawTemplates();
  return true;
}
function deleteTemplate(tool, name) {
  if (!drawTemplates[tool]) return;
  drawTemplates[tool] = drawTemplates[tool].filter(t => t.name !== name);
  if (!drawTemplates[tool].length) delete drawTemplates[tool];
  saveDrawTemplates();
}
function applyTemplate(s, name) {
  if (!s || !s.tool) return false;
  const t = listTemplates(s.tool).find(x => x.name === name);
  if (!t || !t.style) return false;
  const skip = STYLE_SKIP;
  for (const k of Object.keys(t.style)) {
    if (skip.has(k)) continue;
    s[k] = clone(t.style[k]);
  }
  rememberStyle(s);
  return true;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const findShape = (id) => drawings.find(d => d.id === id);
function ensureVis(d) {
  if (!d.vis || typeof d.vis !== 'object') d.vis = { min: true, hour: true, day: true, week: true };
  else {
    // Fill any missing keys with true (older saves / style-bleed bugs)
    for (const k of ['min', 'hour', 'day', 'week']) {
      if (d.vis[k] === undefined || d.vis[k] === null) d.vis[k] = true;
    }
  }
  // Backfill spanSec for older long/short drawings so tracking works on every TF
  if (isPosTool(d.tool) && !(d.spanSec > 0) && d.widthBars > 0) {
    d.spanSec = Math.max(60, d.widthBars * 60); // assume drawn on 1m if unknown
  }
  return d;
}
const isPosTool = (t) => t === 'long' || t === 'short';
function redrawDrawings() { dirty = true; }

// ---------- generic helpers ----------
function rgba(hex, a = 1) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const dashOf = (s) => (s === 'dashed' ? '7 5' : s === 'dotted' ? '2 4' : '');
const fmtP = (p) => p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.');
  const last = ks.pop();
  const t = ks.reduce((a, k) => a[k], o);
  t[last] = v;
}
function mk(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// ---------- time <-> x mapping (works in the future / past of the data too) ----------
function isDailyTf() { return currentTimeframe === '1D' || currentTimeframe === '1W'; }
function barSeconds() {
  if (currentTimeframe === '1D') return 86400;
  if (currentTimeframe === '1W') return 604800;
  return (parseInt(currentTimeframe, 10) || 1) * 60;
}
let ctRef = null, ctArr = [];
function ctimes() {
  // Must match whatever is currently on the chart series (shownData), not the full cache
  const src = (shownData && shownData.length) ? shownData : currentDataCache;
  if (ctRef !== src) {
    ctRef = src;
    ctArr = src.map(c => getComparableTime(c.time));
  }
  return ctArr;
}
function timeToLogical(t) {
  const a = ctimes(), n = a.length;
  if (!n) return null;
  t = getComparableTime(t);
  if (t == null || !isFinite(t)) return null;

  // Drawings are anchored to timestamps, while Lightweight Charts positions
  // candles by integer logical indexes. Always resolve the timestamp to the
  // timeframe candle that contains it. Do not return fractional indexes:
  // those place an anchor between candle centres and distort drawings after
  // changing timeframe (especially when bars are missing or sessions have gaps).
  const bucket = getComparableTime(getSessionAlignedKey(t, currentTimeframe));
  if (bucket == null || !isFinite(bucket)) return null;

  // Lower-bound search for the bucket timestamp in the exact series currently
  // displayed (including a replay-truncated series).
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < bucket) lo = mid + 1;
    else hi = mid;
  }

  // Exact candle match: the anchor belongs at the candle's centre.
  if (lo < n && a[lo] === bucket) return lo;

  // The timestamp falls in a timeframe bucket with no displayed candle
  // (for example, a data gap). Snap to the nearest existing candle rather
  // than interpolating across the gap and sending drawings far off-screen.
  if (lo > 0 && lo < n) {
    return (bucket - a[lo - 1] <= a[lo] - bucket) ? lo - 1 : lo;
  }

  // Only extrapolate outside the loaded series. Internal gaps are never
  // extrapolated because elapsed wall-clock time is not chart bar distance.
  const step = barSeconds();
  if (lo === 0) return (bucket - a[0]) / step;
  return n - 1 + (bucket - a[n - 1]) / step;
}
function logicalToTime(l) {
  const a = ctimes(), n = a.length;
  if (!n) return null;
  if (l <= 0) return a[0] + l * barSeconds();
  if (l >= n - 1) return a[n - 1] + (l - (n - 1)) * barSeconds();
  const i = Math.floor(l);
  return a[i] + (l - i) * (a[i + 1] - a[i]);
}
function timeToX(t) {
  const l = timeToLogical(t);
  if (l === null) return null;
  try {
    const x = chart.timeScale().logicalToCoordinate(l);
    if (x !== null && isFinite(x)) return x;
    // Outside the current visible window — still return a coordinate so drawings stay drawable
    const lr = chart.timeScale().getVisibleLogicalRange();
    if (!lr) return null;
    const clamped = Math.min(Math.max(l, lr.from - 50), lr.to + 50);
    return chart.timeScale().logicalToCoordinate(clamped);
  } catch (e) { return null; }
}
function xToTime(x) {
  const l = chart.timeScale().coordinateToLogical(x);
  if (l === null) return null;
  return logicalToTime(Math.round(l)); // snaps to bars like TradingView
}
function pxToData(x, y) {
  const t = xToTime(x);
  const p = candleSeries.coordinateToPrice(y);
  if (t === null || p === null) return null;
  return { time: t, price: p };
}
function dataToPx(pt) {
  if (!pt) return null;
  let x = timeToX(pt.time);
  let y = candleSeries.priceToCoordinate(pt.price);

  // If time is slightly outside the series, snap to nearest bar time
  if ((x === null || !isFinite(x)) && pt.time != null) {
    const a = ctimes();
    if (a.length) {
      const t = getComparableTime(pt.time);
      let lo = 0, hi = a.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (a[m] < t) lo = m + 1; else hi = m;
      }
      const i = Math.max(0, Math.min(a.length - 1, lo));
      const near = (i > 0 && Math.abs(a[i - 1] - t) < Math.abs(a[i] - t)) ? a[i - 1] : a[i];
      x = timeToX(near);
    }
  }

  // If price is outside the current scale, extrapolate from the visible range
  if ((y === null || !isFinite(y)) && pt.price != null && isFinite(pt.price)) {
    try {
      const r = chart.priceScale('right').getVisibleRange();
      const ph = paneSize().h;
      if (r && isFinite(r.from) && isFinite(r.to) && r.to !== r.from && ph > 0) {
        y = (1 - (pt.price - r.from) / (r.to - r.from)) * ph;
      }
    } catch (e) { /* ignore */ }
  }

  if (x === null || y === null || !isFinite(x) || !isFinite(y)) return null;
  return { x, y };
}
function paneSize() {
  try { const s = chart.paneSize(); if (s && s.width) return { w: s.width, h: s.height }; } catch (e) { /* fall through */ }
  return {
    w: chartContainer.clientWidth - chart.priceScale('right').width(),
    h: chartContainer.clientHeight - chart.timeScale().height()
  };
}
function tfCategory() {
  if (currentTimeframe === '1D') return 'day';
  if (currentTimeframe === '1W') return 'week';
  return (parseInt(currentTimeframe, 10) < 60) ? 'min' : 'hour';
}
function lastShownClose() {
  const a = ctimes();
  if (!a.length) return null;
  let idx = a.length - 1;
  if (replayTimestamp !== null) {
    let lo = 0, hi = a.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] <= replayTimestamp) { r = m; lo = m + 1; } else hi = m - 1; }
    if (r >= 0) idx = r;
  }
  return currentDataCache[idx].close;
}

// ---------- time formatting / parsing (New York time like the rest of the app) ----------
function fmtAxisTime(t) {
  const d = new Date(t * 1000);
  const o = isDailyTf()
    ? { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: '2-digit' }
    : { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true };
  return new Intl.DateTimeFormat('en-US', o).format(d).replace(/,/g, '');
}
const pad2 = (n) => String(n).padStart(2, '0');
function timeToInputStr(t) {
  if (isDailyTf()) {
    const d = new Date(t * 1000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  const n = getNYTimeDetails(Math.round(t));
  return `${n.year}-${pad2(n.month)}-${pad2(n.day)}T${pad2(n.hour)}:${pad2(n.minute)}`;
}
function inputStrToTime(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000;
  if (isDailyTf()) return guess;
  const n = getNYTimeDetails(guess);
  const nyAsUtc = Date.UTC(n.year, n.month - 1, n.day, n.hour, n.minute, n.second) / 1000;
  return guess - (nyAsUtc - guess);
}

// ---------- shape model & defaults ----------
const FIB_DEFAULTS = [
  [0, true, '#787b86'], [0.236, true, '#f23645'], [0.382, true, '#ff9800'], [0.5, true, '#4caf50'],
  [0.618, true, '#089981'], [0.786, true, '#00bcd4'], [1, true, '#787b86'],
  [1.618, false, '#2962ff'], [2.618, false, '#f23645'], [3.618, false, '#9c27b0'], [4.236, false, '#e91e63'],
  [1.272, false, '#ff9800'], [1.414, false, '#4caf50'], [2.272, false, '#089981'], [2.414, false, '#00bcd4'],
  [2, false, '#2962ff'], [3, false, '#f23645'], [3.272, false, '#ff9800'], [3.414, false, '#4caf50'],
  [4, false, '#089981'], [4.272, false, '#00bcd4'], [4.414, false, '#2962ff'], [4.618, false, '#f23645'],
  [4.764, false, '#9c27b0']
].map(([v, on, color]) => ({ v, on, color }));

function defaultStyle(tool) {
  const text = { text: '', textColor: '#2962ff', textOpacity: 1, textSize: 12, bold: false, italic: false, textV: 'top', textH: 'center' };
  if (tool === 'line') return { ...text, color: '#2962ff', opacity: 1, width: 2, lineStyle: 'solid', extendLeft: false, extendRight: false };
  if (tool === 'hline' || tool === 'hray') return { ...text, color: '#2962ff', opacity: 1, width: 2, lineStyle: 'solid' };
  if (tool === 'vline') return { ...text, color: '#2962ff', opacity: 1, width: 2, lineStyle: 'solid' };
  if (tool === 'rect') return {
    ...text, textV: 'middle',
    border: true, borderColor: '#2962ff', borderOpacity: 1, width: 2, lineStyle: 'solid',
    bg: true, bgColor: '#2962ff', bgOpacity: 0.2,
    middle: true, midColor: '#2962ff', midOpacity: 1, midStyle: 'dashed', extend: 'none'
  };
  if (tool === 'fib') return {
    width: 1, lineStyle: 'solid', trend: true, trendColor: '#787b86', trendStyle: 'dashed', extend: 'none',
    oneColor: false, oneColorValue: '#787b86', bg: true, bgOpacity: 0.2, levels: clone(FIB_DEFAULTS)
  };
  if (tool === 'note') return {
    text: 'Note',
    textColor: '#ffffff', textOpacity: 1, textSize: 13, bold: false, italic: false,
    textV: 'middle', textH: 'left',
    bgColor: '#1e222d', bgOpacity: 0.95,
    borderColor: '#363a45', borderOpacity: 1, width: 1,
    anchorColor: '#e91e8c', anchorOpacity: 1,
    lineColor: '#e91e8c', lineOpacity: 1, lineWidth: 1.2
  };
  return {
    profitColor: '#089981', profitOpacity: 0.2, stopColor: '#f23645', stopOpacity: 0.2,
    textColor: '#ffffff', textOpacity: 1, lineColor: '#787b86', qty: 1
  };
}
const isAxisTool = (t) => t === 'hline' || t === 'hray' || t === 'vline';
const isOneClickTool = (t) => isPosTool(t) || isAxisTool(t);
function makeShape(tool, p1, p2) {
  const base = defaultStyle(tool);
  const remembered = clone(toolStyles[tool] || {});
  delete remembered.text; // never inherit previous drawing's text content
  const s = { id: nextShapeId++, tool, p1, p2, locked: false, ...base, ...remembered, text: base.text || '' };
  // Always default to visible on every timeframe unless the user later customizes this shape
  s.vis = { min: true, hour: true, day: true, week: true };
  if (isPosTool(tool)) {
    const sz = currentPosSize(p1.price);
    s.tpPrice = tool === 'long' ? p1.price + sz.tp : p1.price - sz.tp;
    s.slPrice = tool === 'long' ? p1.price - sz.sl : p1.price + sz.sl;
    s.widthBars = sz.bars; // visual width in bars of the *current* timeframe
    // Absolute duration used for TP/SL tracking so results stay consistent across TFs
    s.spanSec = Math.max(60, sz.bars * barSeconds());
  }
  return s;
}
// Size for a new long / short: ALWAYS 1:1 RR (ignore last used TP/SL ratio).
// Only the width in bars is remembered from the previous position.
function currentPosSize() {
  let span = 0;
  try { const r = chart.priceScale('right').getVisibleRange(); if (r && r.to > r.from) span = r.to - r.from; } catch (e) { /* ignore */ }
  const q = (v) => Math.max(TICK_SIZE, Math.round(v / TICK_SIZE) * TICK_SIZE);
  const lr = chart.timeScale().getVisibleLogicalRange();
  const risk = q((span || 40) * 0.08); // equal distance for TP and SL
  const bars = (posSize && posSize.bars > 0)
    ? posSize.bars
    : (lr ? Math.max(5, Math.round((lr.to - lr.from) * 0.1)) : 12);
  return { sl: risk, tp: risk, bars }; // forced 1:1
}
function rememberPosSize(s) {
  const tp = Math.abs(s.tpPrice - s.p1.price), sl = Math.abs(s.p1.price - s.slPrice);
  if (tp > 0 && sl > 0 && s.widthBars > 0) posSize = { tp, sl, bars: s.widthBars };
}
// ---- price tracker: follows the REAL (1-minute) candles from the moment price first taps the entry
// until the target or the stop is hit - the same result on every timeframe, and replay-aware.
let rawVer = 0;
const trackerCache = new Map();
function rawLowerBound(t) { // first raw candle with time >= t
  let lo = 0, hi = rawCandles.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (getComparableTime(rawCandles[m].time) < t) lo = m + 1; else hi = m; }
  return lo;
}
function visibleRawEnd() { // raw candles at/after this index are hidden by replay
  if (replayTimestamp === null) return rawCandles.length;
  // Fast path: replayRawIndex is kept in lock-step with the cursor by stepReplay /
  // select-bar. Prefer O(1) over a binary search on every animation frame.
  if (replayRawIndex >= 0 && replayRawIndex < rawCandles.length) {
    const t = getComparableTime(rawCandles[replayRawIndex].time);
    // Cursor stores the close of that 1m bar (open + 59). The next open is > cursor.
    if (t != null && t <= replayTimestamp && (t + 59) >= replayTimestamp) {
      return replayRawIndex + 1;
    }
  }
  // Fallback binary search (cursor drifted or was restored from storage)
  let lo = 0, hi = rawCandles.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (getComparableTime(rawCandles[m].time) <= replayTimestamp) lo = m + 1;
    else hi = m;
  }
  return lo;
}
function positionBoxEndTime(s) {
  // Prefer absolute span (stable across TFs); fall back to visual right edge
  const t0 = getComparableTime(s.p1.time);
  if (t0 == null) return null;
  if (s.spanSec > 0) return t0 + s.spanSec;
  try {
    const p2 = posP2(s);
    if (p2 && p2.time != null) return getComparableTime(p2.time);
  } catch (e) { /* ignore */ }
  // Last resort: widthBars * current bar size
  return t0 + Math.max(60, (s.widthBars || 12) * barSeconds());
}
function getTracker(s) {
  if (!rawCandles.length) return null;
  const long = s.tool === 'long', entry = s.p1.price, tp = s.tpPrice, sl = s.slPrice;
  const t0 = getComparableTime(s.p1.time);
  if (t0 == null) return null;
  const boxEndT = positionBoxEndTime(s);
  if (boxEndT == null) return null;

  // Only raw candles inside the tool's time span (and not hidden by replay)
  let endIdx = visibleRawEnd();
  {
    let lo = 0, hi = rawCandles.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (getComparableTime(rawCandles[m].time) <= boxEndT) lo = m + 1;
      else hi = m;
    }
    endIdx = Math.min(endIdx, lo);
  }
  // Entry is filled at the tool's left edge (placement time) — do NOT wait for a later
  // touch of the entry price. Waiting caused the first TP/SL tap to be skipped.
  const entryIdx = Math.min(rawLowerBound(t0), Math.max(0, endIdx - 1));
  if (entryIdx < 0 || entryIdx >= endIdx) return null;

  const base = `${rawVer}|${t0}|${entry}|${tp}|${sl}|${boxEndT}|v2`;
  let st = trackerCache.get(s.id);
  if (!st || st.base !== base || endIdx < st.scanned) {
    st = { base, scanned: entryIdx, entryIdx, exitIdx: -1, outcome: null };
    trackerCache.set(s.id, st);
  }

  // Scan forward from entry for the FIRST candle that touches TP or SL
  if (!st.outcome) {
    let i = st.scanned;
    for (; i < endIdx; i++) {
      const c = rawCandles[i];
      const tpHit = long ? c.high >= tp : c.low <= tp;
      const slHit = long ? c.low <= sl : c.high >= sl;
      if (!tpHit && !slHit) continue;
      if (tpHit && slHit) {
        // Both in one bar: use candle direction as a simple intrabar order
        // (up-close → low first, down-close → high first)
        const lowFirst = c.close >= c.open;
        st.outcome = long ? (lowFirst ? 'sl' : 'tp') : (lowFirst ? 'tp' : 'sl');
      } else {
        st.outcome = tpHit ? 'tp' : 'sl';
      }
      st.exitIdx = i;
      i++;
      break;
    }
    st.scanned = i;
  }

  const lastIdx = st.outcome ? st.exitIdx : Math.min(endIdx, rawCandles.length) - 1;
  if (lastIdx < st.entryIdx) return null;
  const endCandle = rawCandles[lastIdx];
  let lastPrice = endCandle.close;
  // Pin path end exactly on TP/SL when closed so the line stops on the level
  if (st.outcome === 'tp') lastPrice = tp;
  else if (st.outcome === 'sl') lastPrice = sl;
  return {
    entryT: getComparableTime(rawCandles[st.entryIdx].time),
    endT: getComparableTime(endCandle.time),
    boxEndT,
    outcome: st.outcome,
    lastPrice
  };
}

// right edge of a long / short = entry + widthBars on the CURRENT timeframe
function posP2(s) {
  const l = timeToLogical(s.p1.time);
  return l === null ? s.p2 : { time: logicalToTime(l + s.widthBars), price: s.p1.price };
}

// ---------- icons ----------
const ic = (inner, extra = '') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
const ICON = {
  pencil: ic('<path d="M16.5 3.5l4 4L8 20l-5 1 1-5z"/><path d="M14 6l4 4"/>'),
  text: ic('<path d="M5 5h14M12 5v15M9 20h6"/>'),
  bucket: ic('<path d="M5 12l7-7 7 7-6.5 6.5a2 2 0 01-2.8 0z"/><path d="M19 15c0 0 2 2.4 2 3.8a2 2 0 01-4 0c0-1.4 2-3.8 2-3.8z"/>'),
  gear: ic('<path d="M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z"/><circle cx="12" cy="12" r="3"/>'),
  lock: ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  unlock: ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.6-1.7"/>'),
  trash: ic('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  more: ic('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  // TradingView-style templates: 2x2 tiles with + on the last cell
  template: ic('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 15.5v4M14.5 17.5h4" stroke-width="1.6"/>')
};

// ---------- popups (colour / thickness / style / more) ----------
const popup = document.createElement('div');
popup.className = 'dt-popup';
document.body.appendChild(popup);
let popupAnchor = null;
function closePopup() { popup.style.display = 'none'; popup.innerHTML = ''; popupAnchor = null; }
function openPopup(anchor, node) {
  popup.innerHTML = '';
  popup.appendChild(node);
  popup.style.display = 'block';
  popupAnchor = anchor;
  const r = anchor.getBoundingClientRect();
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}
document.addEventListener('mousedown', (e) => {
  if (popup.style.display === 'block' && !popup.contains(e.target) && !(popupAnchor && popupAnchor.contains(e.target))) closePopup();
}, true);

const PAL_GREYS = ['#ffffff', '#d1d4dc', '#b2b5bd', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#1e222d', '#000000'];
const PAL_BASE = ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63'];
function mixHex(hex, withHex, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(withHex.slice(1), 16);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
}
const PAL_ROWS = (() => {
  const rows = [PAL_GREYS, PAL_BASE];
  [0.85, 0.7, 0.5, 0.3].forEach(t => rows.push(PAL_BASE.map(c => mixHex(c, '#ffffff', t))));
  [0.2, 0.4, 0.6].forEach(t => rows.push(PAL_BASE.map(c => mixHex(c, '#000000', t))));
  return rows;
})();
const recentColors = [];

function openColorPicker(anchor, getVals, setVals, withOpacity = true) {
  if (popupAnchor === anchor && popup.style.display === 'block') { closePopup(); return; }
  const wrap = document.createElement('div');
  wrap.className = 'cp';
  let { color, opacity } = getVals();
  const grid = document.createElement('div');
  grid.className = 'cp-grid';
  const mkSw = (c, parent) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cp-sw'; b.dataset.c = c; b.style.background = c;
    b.addEventListener('click', () => { color = c; setVals(color, opacity); mark(); });
    parent.appendChild(b);
  };
  PAL_ROWS.forEach((row, i) => {
    row.forEach(c => mkSw(c, grid));
    if (i === 0 || i === 5) { const sp = document.createElement('div'); sp.className = 'cp-gap'; grid.appendChild(sp); }
  });
  wrap.appendChild(grid);
  const sep = document.createElement('div'); sep.className = 'cp-sep'; wrap.appendChild(sep);
  const custom = document.createElement('div'); custom.className = 'cp-grid cp-custom';
  const drawCustom = () => {
    custom.innerHTML = '';
    recentColors.slice(0, 9).forEach(c => mkSw(c, custom));
    const plus = document.createElement('button');
    plus.type = 'button'; plus.className = 'cp-plus'; plus.textContent = '+';
    const input = document.createElement('input');
    input.type = 'color'; input.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#2962ff'; input.className = 'cp-native';
    input.addEventListener('input', () => {
      color = input.value;
      if (!recentColors.includes(color)) recentColors.unshift(color);
      setVals(color, opacity); mark();
    });
    input.addEventListener('change', drawCustom);
    plus.addEventListener('click', () => input.click());
    custom.appendChild(plus); custom.appendChild(input);
    mark();
  };
  wrap.appendChild(custom);
  let label = null;
  if (withOpacity) {
    const t = document.createElement('div'); t.className = 'cp-title'; t.textContent = 'Opacity'; wrap.appendChild(t);
    const line = document.createElement('div'); line.className = 'cp-op';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = Math.round(opacity * 100);
    label = document.createElement('span'); label.textContent = `${Math.round(opacity * 100)}%`;
    const paint = () => slider.style.setProperty('--p', `${slider.value}%`);
    paint();
    slider.addEventListener('input', () => {
      opacity = slider.value / 100; label.textContent = `${slider.value}%`; paint(); setVals(color, opacity);
    });
    line.appendChild(slider); line.appendChild(label); wrap.appendChild(line);
  }
  function mark() {
    wrap.querySelectorAll('.cp-sw').forEach(b => b.classList.toggle('sel', (color || '').toLowerCase() === b.dataset.c.toLowerCase()));
  }
  drawCustom();
  openPopup(anchor, wrap);
}

function openChoiceMenu(anchor, items, current, onPick, cls = '') {
  if (popupAnchor === anchor && popup.style.display === 'block') { closePopup(); return; }
  const wrap = document.createElement('div');
  wrap.className = `menu ${cls}`;
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item' + (String(it.value) === String(current) ? ' sel' : '');
    b.innerHTML = it.html;
    b.addEventListener('click', () => { onPick(it.value); closePopup(); });
    wrap.appendChild(b);
  });
  openPopup(anchor, wrap);
}

// ---------- floating (selection) toolbar ----------
function ftBtn(act, icon, bar, title) {
  return `<button type="button" class="ft-btn" data-act="${act}" title="${title}">${icon}${bar ? `<i class="ft-bar" style="background:${bar}"></i>` : ''}</button>`;
}
function widthStyleBtns(s) {
  return `<button type="button" class="ft-btn ft-wide" data-act="width" title="Line thickness"><span class="ft-sample" style="border-top:${Math.min(s.width, 4)}px solid #d1d4dc"></span><span class="ft-txt">${s.width}px</span></button>` +
    `<button type="button" class="ft-btn" data-act="style" title="Line style"><span class="ft-sample" style="border-top:2px ${s.lineStyle || 'solid'} #d1d4dc"></span></button>`;
}
function refreshFloating() {
  const s = findShape(selectedShapeId);
  if (!s) { editToolbar.classList.remove('active'); return; }
  const grip = `<div class="ft-grip" id="ftGrip"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="7" cy="2" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="7" cy="7" r="1"/><circle cx="2" cy="12" r="1"/><circle cx="7" cy="12" r="1"/></svg></div>`;
  let h = grip + ftBtn('template', ICON.template, null, 'Templates');
  if (s.tool === 'line' || s.tool === 'hline' || s.tool === 'hray' || s.tool === 'vline') {
    h += ftBtn('stroke', ICON.pencil, s.color, 'Line colour') + ftBtn('text', ICON.text, s.textColor, 'Text') + widthStyleBtns(s);
  } else if (s.tool === 'rect') {
    h += ftBtn('stroke', ICON.pencil, s.borderColor, 'Border colour') + ftBtn('fill', ICON.bucket, s.bgColor, 'Background colour') +
      ftBtn('text', ICON.text, s.textColor, 'Text') + widthStyleBtns(s);
  } else if (s.tool === 'fib') {
    const first = s.levels.find(l => l.on);
    h += ftBtn('stroke', ICON.pencil, s.oneColor ? s.oneColorValue : (first ? first.color : '#787b86'), 'Line colour') +
      `<button type="button" class="ft-btn ft-wide" data-act="width" title="Line thickness"><span class="ft-sample" style="border-top:${Math.min(s.width, 4)}px solid #d1d4dc"></span><span class="ft-txt">${s.width}px</span></button>`;
  } else if (s.tool === 'note') {
    h += ftBtn('fill', ICON.bucket, s.bgColor, 'Background') + ftBtn('text', ICON.text, s.textColor, 'Text') +
      ftBtn('stroke', ICON.pencil, s.anchorColor, 'Anchor colour');
  } else {
    h += ftBtn('textcolor', ICON.text, s.textColor, 'Text colour') + ftBtn('profit', ICON.bucket, s.profitColor, 'Profit colour') +
      ftBtn('stop', ICON.bucket, s.stopColor, 'Stop colour');
  }
  h += ftBtn('settings', ICON.gear, null, 'Settings') + ftBtn('lock', s.locked ? ICON.lock : ICON.unlock, null, s.locked ? 'Unlock' : 'Lock') +
    ftBtn('delete', ICON.trash, null, 'Remove') + ftBtn('more', ICON.more, null, 'More');
  ftButtons.innerHTML = h;
  editToolbar.classList.add('active');
  attachDrag(editToolbar, document.getElementById('ftGrip'));
}
function cloneShape(s) {
  const c = clone(s);
  c.id = nextShapeId++;
  const dB = 3;
  ['p1', 'p2'].forEach(k => { const l = timeToLogical(c[k].time); if (l !== null) c[k].time = logicalToTime(l + dB); });
  drawings.push(c);
  selectShape(c.id);
}
function colourTarget(s, act) {
  if (s.tool === 'line' || s.tool === 'hline' || s.tool === 'hray' || s.tool === 'vline') return act === 'stroke' ? ['color', 'opacity'] : ['textColor', 'textOpacity'];
  if (s.tool === 'rect') return act === 'stroke' ? ['borderColor', 'borderOpacity'] : act === 'fill' ? ['bgColor', 'bgOpacity'] : ['textColor', 'textOpacity'];
  if (s.tool === 'note') return act === 'fill' ? ['bgColor', 'bgOpacity'] : act === 'stroke' ? ['anchorColor', 'anchorOpacity'] : ['textColor', 'textOpacity'];
  if (isPosTool(s.tool)) return act === 'profit' ? ['profitColor', 'profitOpacity'] : act === 'stop' ? ['stopColor', 'stopOpacity'] : ['textColor', 'textOpacity'];
  return null;
}
ftButtons.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const s = findShape(selectedShapeId);
  if (!btn || !s) return;
  const act = btn.dataset.act;
  if (act === 'settings') { closePopup(); openDialog(s, null); return; }
  if (act === 'text' && (s.tool === 'line' || s.tool === 'hline' || s.tool === 'hray' || s.tool === 'vline' || s.tool === 'rect' || s.tool === 'note')) { closePopup(); openDialog(s, 'text'); return; }
  if (act === 'delete') { pushUndo('delete drawing'); closePopup(); drawings = drawings.filter(d => d.id !== s.id); deselect(); return; }
  if (act === 'lock') { s.locked = !s.locked; refreshFloating(); dirty = true; return; }
  if (act === 'stroke' && s.tool === 'fib') {
    openColorPicker(btn, () => ({ color: s.oneColorValue, opacity: 1 }), (c) => {
      s.oneColor = true; s.oneColorValue = c; s.trendColor = c; s.levels.forEach(l => { l.color = c; });
      rememberStyle(s); refreshFloating(); dirty = true;
    }, false);
    return;
  }
  if (['stroke', 'fill', 'text', 'textcolor', 'profit', 'stop'].includes(act)) {
    const [ck, ok] = colourTarget(s, act);
    openColorPicker(btn, () => ({ color: s[ck], opacity: s[ok] }), (c, o) => {
      s[ck] = c; s[ok] = o; rememberStyle(s); refreshFloating(); syncDialog(); dirty = true;
    });
    return;
  }
  if (act === 'width') {
    openChoiceMenu(btn, [1, 2, 3, 4].map(w => ({ value: w, html: `<span class="ft-sample" style="border-top:${w}px solid #d1d4dc"></span><span>${w}px</span>` })), s.width, (v) => {
      s.width = v; rememberStyle(s); refreshFloating(); syncDialog(); dirty = true;
    });
    return;
  }
  if (act === 'style') {
    openChoiceMenu(btn, ['solid', 'dashed', 'dotted'].map(v => ({ value: v, html: `<span class="ft-sample long" style="border-top:2px ${v} #d1d4dc"></span>` })), s.lineStyle, (v) => {
      s.lineStyle = v; rememberStyle(s); refreshFloating(); syncDialog(); dirty = true;
    });
    return;
  }
  if (act === 'template') {
    openTemplateMenu(btn, s);
    return;
  }
  if (act === 'more') {
    openChoiceMenu(btn, [
      { value: 'clone', html: '<span>Clone</span>' },
      { value: 'front', html: '<span>Bring to front</span>' },
      { value: 'back', html: '<span>Send to back</span>' }
    ], null, (v) => {
      if (v === 'clone') cloneShape(s);
      if (v === 'front') { drawings = drawings.filter(d => d.id !== s.id); drawings.push(s); }
      if (v === 'back') { drawings = drawings.filter(d => d.id !== s.id); drawings.unshift(s); }
      dirty = true;
    }, 'menu-text');
  }
});

/** TradingView-style drawing template menu (Save / Apply default / named list). */
function openTemplateMenu(anchor, s) {
  if (!s || !s.tool) return;
  if (popupAnchor === anchor && popup.style.display === 'block') { closePopup(); return; }
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tpls = listTemplates(s.tool);
  const wrap = document.createElement('div');
  wrap.className = 'menu menu-text tpl-menu';

  const addItem = (label, value, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item' + (opts.sep ? ' tpl-sep-after' : '') + (opts.muted ? ' tpl-muted' : '');
    b.innerHTML = '<span>' + esc(label) + '</span>';
    if (opts.title) b.title = opts.title;
    b.addEventListener('click', () => {
      closePopup();
      if (value === 'save') {
        const name = prompt('Save drawing template as:', '');
        if (name && saveTemplate(s.tool, name, styleSnapshot(s))) {
          try { trToast('Template saved: ' + name.trim()); } catch (e) { /* optional */ }
        }
        return;
      }
      if (value === 'default') {
        // Reset style fields to factory defaults for this tool (keep geometry / text content)
        const base = defaultStyle(s.tool);
        const skip = STYLE_SKIP;
        for (const k of Object.keys(base)) {
          if (skip.has(k)) continue;
          s[k] = clone(base[k]);
        }
        // Clear last-used so next new drawing also uses factory defaults
        delete toolStyles[s.tool];
        rememberStyle(s);
        refreshFloating();
        syncDialog();
        dirty = true;
        return;
      }
      if (typeof value === 'string' && value.startsWith('apply:')) {
        if (applyTemplate(s, value.slice(6))) {
          refreshFloating();
          syncDialog();
          dirty = true;
        }
      }
      if (typeof value === 'string' && value.startsWith('del:')) {
        deleteTemplate(s.tool, value.slice(4));
      }
    });
    // Right-click a named template to delete it
    if (typeof value === 'string' && value.startsWith('apply:')) {
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const name = value.slice(6);
        if (confirm('Delete template "' + name + '"?')) {
          deleteTemplate(s.tool, name);
          closePopup();
          openTemplateMenu(anchor, s);
        }
      });
    }
    wrap.appendChild(b);
  };

  addItem('Save Drawing Template As...', 'save', { sep: true });
  addItem('Apply Default Drawing Template', 'default', { sep: true });
  if (!tpls.length) {
    const empty = document.createElement('div');
    empty.className = 'tpl-menu-empty';
    empty.textContent = 'No saved templates';
    wrap.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'tpl-menu-list';
    tpls.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.innerHTML = '<span>' + esc(t.name) + '</span>';
      b.addEventListener('click', () => {
        closePopup();
        if (applyTemplate(s, t.name)) {
          refreshFloating();
          syncDialog();
          dirty = true;
        }
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm('Delete template "' + t.name + '"?')) {
          deleteTemplate(s.tool, t.name);
          closePopup();
          openTemplateMenu(anchor, s);
        }
      });
      list.appendChild(b);
    });
    wrap.appendChild(list);
  }
  openPopup(anchor, wrap);
}

// Dragging a floating panel by its grip
function attachDrag(panel, grip) {
  if (!grip || grip._bound) return;
  grip._bound = true;
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = panel.getBoundingClientRect();
    // Pin size + clear opposing anchors so flex/transform don't stretch the bar while dragging
    panel.style.position = 'fixed';
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${r.width}px`;
    panel.style.height = `${r.height}px`;
    panel.style.transform = 'none';
    panel.style.margin = '0';
    const sx = e.clientX, sy = e.clientY, l0 = r.left, t0 = r.top;
    const mv = (ev) => {
      const maxL = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxT = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = `${Math.min(Math.max(0, l0 + ev.clientX - sx), maxL)}px`;
      panel.style.top = `${Math.min(Math.max(0, t0 + ev.clientY - sy), maxT)}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
      // Drop fixed width/height so orientation toggle can reflow naturally
      panel.style.width = '';
      panel.style.height = '';
    };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
}
attachDrag(drawToolbar, document.getElementById('dtGrip'));

// ---------- selection ----------
function selectShape(id) { selectedShapeId = id; refreshFloating(); dirty = true; }
function deselect() {
  selectedShapeId = null; closePopup(); editToolbar.classList.remove('active'); dirty = true;
}

// ---------- settings dialog ----------
const dialog = document.createElement('div');
dialog.className = 'dt-dialog';
document.body.appendChild(dialog);
let dlgShapeId = null, dlgSnapshot = null, dlgPrevStyles = null, dlgPrevPos = null, dlgTab = 'style';
const TOOL_TITLE = { line: 'Trend line', hline: 'Horizontal line', hray: 'Horizontal ray', vline: 'Vertical line', rect: 'Rectangle', fib: 'Fib retracement', long: 'Long position', short: 'Short position', note: 'Anchored note' };
const row = (label, inner) => `<div class="dlg-row"><div class="dlg-label">${label}</div><div class="dlg-ctrl">${inner}</div></div>`;
const chkRow = (path, label, inner = '') => `<div class="dlg-row"><label class="dlg-chk"><input type="checkbox" data-k="${path}"><span class="box"></span><span>${label}</span></label><div class="dlg-ctrl">${inner}</div></div>`;
const swBtn = (c, o) => `<button type="button" class="dlg-sw" data-sw="${c}" ${o ? `data-op="${o}"` : ''}><i></i></button>`;
const selBox = (path, opts, num) => `<select class="dlg-sel" data-k="${path}" ${num ? 'data-num="1"' : ''}>${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
const numBox = (path) => `<input type="number" class="dlg-num" step="any" data-k="${path}">`;
const timeBox = (path) => `<input type="datetime-local" class="dlg-time" data-type="time" data-k="${path}">`;
const WIDTHS = [[1, '1px'], [2, '2px'], [3, '3px'], [4, '4px']];
const STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
const EXTENDS = [['none', "Don't extend"], ['left', 'Extend left'], ['right', 'Extend right'], ['both', 'Extend both']];

function textTabHTML() {
  return `<div class="dlg-row dlg-textbar">${swBtn('textColor', 'textOpacity')}${selBox('textSize', [10, 11, 12, 14, 16, 20, 24].map(n => [n, n]), true)}
    <button type="button" class="dlg-tog" data-tog="bold"><b>B</b></button><button type="button" class="dlg-tog" data-tog="italic"><i>I</i></button></div>
    <textarea class="dlg-area" data-k="text" placeholder="Add text"></textarea>
    ${row('Vertical alignment', selBox('textV', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]))}
    ${row('Horizontal alignment', selBox('textH', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]))}`;
}
function coordsTabHTML(s) {
  if (isPosTool(s.tool)) return row('Bar 1', timeBox('p1.time'));
  return row('Price 1', numBox('p1.price')) + row('Bar 1', timeBox('p1.time')) + row('Price 2', numBox('p2.price')) + row('Bar 2', timeBox('p2.time'));
}
function visTabHTML() {
  return [['min', 'Minutes'], ['hour', 'Hours'], ['day', 'Days'], ['week', 'Weeks']].map(([k, t]) => chkRow(`vis.${k}`, t)).join('');
}
function styleTabHTML(s) {
  if (s.tool === 'line') {
    return chkRow('__line', 'Line', `${swBtn('color', 'opacity')}${selBox('width', WIDTHS, true)}${selBox('lineStyle', STYLES)}`).replace('<input type="checkbox" data-k="__line">', '<input type="checkbox" checked disabled>') +
      chkRow('extendLeft', 'Extend left') + chkRow('extendRight', 'Extend right');
  }
  if (s.tool === 'hline' || s.tool === 'hray' || s.tool === 'vline') {
    return chkRow('__line', 'Line', `${swBtn('color', 'opacity')}${selBox('width', WIDTHS, true)}${selBox('lineStyle', STYLES)}`).replace('<input type="checkbox" data-k="__line">', '<input type="checkbox" checked disabled>');
  }
  if (s.tool === 'rect') {
    return row('Extend', selBox('extend', EXTENDS)) +
      chkRow('border', 'Border', `${swBtn('borderColor', 'borderOpacity')}${selBox('width', WIDTHS, true)}${selBox('lineStyle', STYLES)}`) +
      chkRow('middle', 'Middle line', `${swBtn('midColor', 'midOpacity')}${selBox('midStyle', STYLES)}`) +
      chkRow('bg', 'Background', swBtn('bgColor', 'bgOpacity'));
  }
  if (s.tool === 'fib') {
    let lv = '<div class="dlg-levels">';
    s.levels.forEach((l, i) => {
      lv += `<label class="dlg-lv"><input type="checkbox" data-k="levels.${i}.on"><span class="box"></span><input type="number" class="dlg-num lv" step="any" data-k="levels.${i}.v">${swBtn(`levels.${i}.color`)}</label>`;
    });
    lv += '</div>';
    return chkRow('trend', 'Trend line', `${swBtn('trendColor')}${selBox('trendStyle', STYLES)}`) +
      row('Levels line', `${selBox('width', WIDTHS, true)}${selBox('lineStyle', STYLES)}`) +
      row('Extend', selBox('extend', EXTENDS)) + lv +
      chkRow('oneColor', 'Use one color', swBtn('oneColorValue')) +
      chkRow('bg', 'Background', `<input type="range" min="0" max="1" step="0.05" class="dlg-range" data-k="bgOpacity">`);
  }
  if (s.tool === 'note') {
    return row('Background', swBtn('bgColor', 'bgOpacity')) +
      row('Border', swBtn('borderColor', 'borderOpacity')) +
      row('Anchor', swBtn('anchorColor', 'anchorOpacity')) +
      row('Leader line', swBtn('lineColor', 'lineOpacity'));
  }
  return row('Profit', swBtn('profitColor', 'profitOpacity')) + row('Stop', swBtn('stopColor', 'stopOpacity')) + row('Text', swBtn('textColor', 'textOpacity'));
}
function inputsTabHTML() {
  return row('Qty', numBox('qty')) + row('Width (bars)', numBox('widthBars')) + row('Entry price', numBox('p1.price')) + row('Profit level (price)', numBox('tpPrice')) + row('Stop level (price)', numBox('slPrice'));
}
function templatesTabHTML(s) {
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = listTemplates(s.tool);
  const rows = list.length
    ? list.map(t => `<div class="tpl-row" data-tpl="${esc(t.name)}"><span class="tpl-name">${esc(t.name)}</span>
        <button type="button" class="dlg-btn tpl-apply" data-tpl-act="apply" data-name="${esc(t.name)}">Apply</button>
        <button type="button" class="dlg-btn tpl-del" data-tpl-act="del" data-name="${esc(t.name)}" title="Delete">✕</button></div>`).join('')
    : '<div class="ind-empty">No templates saved for this tool yet.</div>';
  return `<div class="tpl-hint">Save the current style (colour, size, text alignment, Fib levels, etc.) under a name, then re-apply it to any drawing of the same type.</div>
    <div class="tpl-save-row">
      <input type="text" class="dlg-num tpl-name-input" id="tplNameInput" placeholder="Template name" style="width:100%;text-align:left">
      <button type="button" class="dlg-btn primary" data-tpl-act="save">Save</button>
    </div>
    <div class="tpl-list">${rows}</div>`;
}
function dialogTabs(s) {
  if (s.tool === 'line' || s.tool === 'hline' || s.tool === 'hray' || s.tool === 'vline' || s.tool === 'rect') return [['style', 'Style'], ['text', 'Text'], ['coords', 'Coordinates'], ['vis', 'Visibility'], ['templates', 'Templates']];
  if (s.tool === 'note') return [['style', 'Style'], ['text', 'Text'], ['coords', 'Coordinates'], ['vis', 'Visibility'], ['templates', 'Templates']];
  if (s.tool === 'fib') return [['style', 'Style'], ['coords', 'Coordinates'], ['vis', 'Visibility'], ['templates', 'Templates']];
  return [['inputs', 'Inputs'], ['style', 'Style'], ['coords', 'Coordinates'], ['vis', 'Visibility'], ['templates', 'Templates']];
}
function openDialog(s, tab) {
  closePopup();
  dlgShapeId = s.id; dlgSnapshot = clone(s); dlgPrevStyles = clone(toolStyles); dlgPrevPos = posSize ? clone(posSize) : null;
  const tabs = dialogTabs(s);
  dlgTab = tab && tabs.some(t => t[0] === tab) ? tab : tabs[0][0];
  const panes = {
    style: styleTabHTML(s), text: (s.tool === 'line' || s.tool === 'hline' || s.tool === 'hray' || s.tool === 'vline' || s.tool === 'rect' || s.tool === 'note') ? textTabHTML() : '',
    coords: coordsTabHTML(s), vis: visTabHTML(), inputs: isPosTool(s.tool) ? inputsTabHTML() : '',
    templates: templatesTabHTML(s)
  };
  dialog.innerHTML = `
    <div class="dlg-head" id="dlgHead"><span>${TOOL_TITLE[s.tool]}</span><button type="button" class="dlg-x" data-dlg="cancel">✕</button></div>
    <div class="dlg-tabs">${tabs.map(([k, t]) => `<button type="button" class="dlg-tab" data-tab="${k}">${t}</button>`).join('')}</div>
    <div class="dlg-body">${tabs.map(([k]) => `<div class="dlg-pane" data-pane="${k}">${panes[k]}</div>`).join('')}</div>
    <div class="dlg-foot"><button type="button" class="dlg-btn" data-dlg="cancel">Cancel</button><button type="button" class="dlg-btn primary" data-dlg="ok">Ok</button></div>`;
  dialog.style.display = 'block';
  if (!dialog.style.left) { dialog.style.left = `${Math.max(16, window.innerWidth / 2 - 190)}px`; dialog.style.top = '110px'; }
  showDlgTab(dlgTab);
  syncDialog();
  attachDrag(dialog, document.getElementById('dlgHead'));
}
function showDlgTab(k) {
  dlgTab = k;
  dialog.querySelectorAll('.dlg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === k));
  dialog.querySelectorAll('.dlg-pane').forEach(p => { p.style.display = p.dataset.pane === k ? 'block' : 'none'; });
}
function closeDialog(cancel) {
  if (cancel && dlgSnapshot) {
    const i = drawings.findIndex(d => d.id === dlgShapeId);
    if (i >= 0) drawings[i] = dlgSnapshot;
    if (dlgPrevStyles) toolStyles = dlgPrevStyles;
    posSize = dlgPrevPos;
    refreshFloating();
  } else if (!cancel && dlgShapeId != null) {
    const s = findShape(dlgShapeId);
    if (s) rememberStyle(s);
  }
  dialog.style.display = 'none'; dialog.innerHTML = ''; dlgShapeId = null; dlgSnapshot = null; closePopup(); dirty = true;
}
function syncDialog() {
  if (dlgShapeId === null) return;
  const s = findShape(dlgShapeId);
  if (!s) return;
  dialog.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k;
    if (k === '__line') return;
    const v = getPath(s, k);
    if (v === undefined) return;
    if (document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.dataset.type === 'time') el.value = timeToInputStr(v);
    else el.value = v;
  });
  dialog.querySelectorAll('.dlg-sw').forEach(b => {
    const c = getPath(s, b.dataset.sw);
    const o = b.dataset.op ? getPath(s, b.dataset.op) : 1;
    b.firstElementChild.style.background = rgba(c, o);
  });
  dialog.querySelectorAll('.dlg-tog').forEach(b => b.classList.toggle('on', !!s[b.dataset.tog]));
}
dialog.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const s = findShape(dlgShapeId);
  if (t.dataset.dlg === 'ok') closeDialog(false);
  else if (t.dataset.dlg === 'cancel') closeDialog(true);
  else if (t.dataset.tab) showDlgTab(t.dataset.tab);
  else if (t.dataset.tplAct && s) {
    const act = t.dataset.tplAct;
    if (act === 'save') {
      const input = dialog.querySelector('#tplNameInput');
      const name = (input && input.value || '').trim();
      if (!name) { if (input) input.focus(); return; }
      saveTemplate(s.tool, name, styleSnapshot(s));
      const pane = dialog.querySelector('[data-pane="templates"]');
      if (pane) pane.innerHTML = templatesTabHTML(s);
    } else if (act === 'apply') {
      if (applyTemplate(s, t.dataset.name)) { refreshFloating(); syncDialog(); dirty = true; }
    } else if (act === 'del') {
      deleteTemplate(s.tool, t.dataset.name);
      const pane = dialog.querySelector('[data-pane="templates"]');
      if (pane) pane.innerHTML = templatesTabHTML(s);
    }
  }
  else if (t.dataset.tog && s) { s[t.dataset.tog] = !s[t.dataset.tog]; rememberStyle(s); syncDialog(); dirty = true; }
  else if (t.dataset.sw && s) {
    const ck = t.dataset.sw, ok = t.dataset.op;
    openColorPicker(t, () => ({ color: getPath(s, ck), opacity: ok ? getPath(s, ok) : 1 }), (c, o) => {
      setPath(s, ck, c); if (ok) setPath(s, ok, o);
      rememberStyle(s); refreshFloating(); syncDialog(); dirty = true;
    }, !!ok);
  }
});
function onDlgInput(e) {
  const t = e.target, k = t.dataset ? t.dataset.k : null;
  if (!k || k === '__line') return;
  const s = findShape(dlgShapeId);
  if (!s) return;
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (t.dataset.type === 'time') { v = inputStrToTime(t.value); if (v === null || !isFinite(v)) return; }
  else if (t.type === 'number' || t.type === 'range' || t.dataset.num) { v = parseFloat(t.value); if (!isFinite(v)) return; }
  else v = t.value;
  setPath(s, k, v);
  if (k === 'widthBars') {
    s.widthBars = Math.max(1, Math.round(v));
    s.spanSec = Math.max(60, s.widthBars * barSeconds());
  }
  if (isPosTool(s.tool)) rememberPosSize(s);
  rememberStyle(s); refreshFloating(); syncDialog(); dirty = true;
}
dialog.addEventListener('input', onDlgInput);
dialog.addEventListener('change', onDlgInput);

// ---------- top drawing toolbar ----------
function toggleDrawTool(tool) {
  drawClicks = []; activePreview = null; creating = null;
  document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
  if (currentDrawTool === tool) {
    currentDrawTool = null;
    chartContainer.style.cursor = 'default';
  } else {
    const btn = document.querySelector(`.draw-btn[data-tool="${tool}"]`);
    if (btn) btn.classList.add('active');
    currentDrawTool = tool;
    deselect();
    chartContainer.style.cursor = 'crosshair';
  }
  chartContainer.classList.toggle('drawing-mode', !!currentDrawTool);
  dirty = true;
}
document.querySelectorAll('.draw-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => toggleDrawTool(btn.dataset.tool));
});
document.getElementById('btn-clear-draw').addEventListener('click', () => {
  if (drawings.length) pushUndo('clear drawings');
  drawings = []; deselect(); if (dlgShapeId !== null) closeDialog(false); dirty = true;
});

// Vertical ↔ horizontal drawing toolbar
(function setupToolbarOrientation() {
  const bar = document.getElementById('drawToolbar');
  if (!bar) return;
  const KEY = 'onyx-toolbar-orient';
  function apply(orient) {
    bar.classList.toggle('horizontal', orient === 'horizontal');
    // Reset any drag-fixed geometry so CSS orientation rules take over cleanly
    bar.style.width = '';
    bar.style.height = '';
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    if (orient === 'horizontal') {
      bar.style.left = '50%';
      bar.style.top = 'auto';
      bar.style.bottom = '48px';
      bar.style.transform = 'translateX(-50%)';
    } else {
      bar.style.left = '14px';
      bar.style.top = '50%';
      bar.style.bottom = 'auto';
      bar.style.transform = 'translateY(-50%)';
    }
    try { localStorage.setItem(KEY, orient); } catch (e) { /* ignore */ }
    const btn = document.getElementById('btn-toolbar-orient');
    if (btn) btn.title = orient === 'horizontal' ? 'Switch to vertical toolbar' : 'Switch to horizontal toolbar';
  }
  let orient = 'vertical';
  try { orient = localStorage.getItem(KEY) === 'horizontal' ? 'horizontal' : 'vertical'; } catch (e) { /* ignore */ }
  apply(orient);
  const btn = document.getElementById('btn-toolbar-orient');
  if (btn) {
    btn.addEventListener('click', () => {
      orient = orient === 'horizontal' ? 'vertical' : 'horizontal';
      apply(orient);
    });
  }
})();

function stopTool() {
  currentDrawTool = null; drawClicks = []; activePreview = null; creating = null;
  document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
  chartContainer.style.cursor = 'default';
  chartContainer.classList.remove('drawing-mode');
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') { isShiftDown = true; dirty = true; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
  if (e.key === 'Escape') {
    if (ivOpen) closeInterval();
    else if (indEditor.style.display === 'block') closeIndEditor();
    else if (indDialog.style.display === 'block') closeIndDialog(true);
    else if (indPanel.style.display === 'block') closeIndPanel();
    else if (chartDialog.style.display === 'block') closeChartDialog(true);
    else if (dlgShapeId !== null) closeDialog(true);
    else if (popup.style.display === 'block') closePopup();
    else if (currentDrawTool) stopTool();
    else deselect();
    dirty = true;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selectedShapeId !== null) {
    const s = findShape(selectedShapeId);
    if (s && !s.locked) { pushUndo('delete drawing'); drawings = drawings.filter(d => d.id !== s.id); deselect(); dirty = true; }
  }
});
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') { isShiftDown = false; dirty = true; } });

// ---------- creating shapes ----------
function finishShape(s) {
  pushUndo('draw ' + (s.tool || 'shape'));
  if (isPosTool(s.tool)) rememberPosSize(s);
  rememberStyle(s); // carry colours / note text / sizes into the next drawing of this tool
  drawings.push(s);
  stopTool();
  selectShape(s.id);
}
function finishTwoPoint(pt) {
  const p1 = drawClicks[0];
  const p2pt = { time: pt.time, price: (isShiftDown && currentDrawTool === 'line') ? p1.price : pt.price };
  finishShape(makeShape(currentDrawTool, p1, p2pt));
}
chartContainer.addEventListener('mousedown', (e) => {
  if (!currentDrawTool || e.button !== 0) return;
  if (e.target.closest('.dt-toolbar, #editToolbar')) return;
  const r = chartContainer.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top, ps = paneSize();
  if (x < 0 || y < 0 || x > ps.w || y > ps.h) return;
  const pt = pxToData(x, y);
  if (!pt) return;
  e.stopPropagation(); e.preventDefault();
  if (isPosTool(currentDrawTool)) {
    const sh = makeShape(currentDrawTool, pt, { time: pt.time, price: pt.price });
    sh.p2 = posP2(sh);
    finishShape(sh);
    return;
  }
  if (isAxisTool(currentDrawTool)) {
    // One-click tools: hline / hray / vline
    const sh = makeShape(currentDrawTool, pt, { time: pt.time, price: pt.price });
    finishShape(sh);
    return;
  }
  if (drawClicks.length === 0) {
    drawClicks = [pt]; creating = { sx: e.clientX, sy: e.clientY }; activePreview = null; dirty = true;
  } else {
    finishTwoPoint(pt);
  }
}, true);

// ---------- selecting / dragging existing shapes ----------
svgOverlay.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || currentDrawTool) return;
  const t = e.target;
  const sid = parseInt(t.getAttribute('data-sid'), 10);
  if (!sid) return;
  const s = findShape(sid);
  if (!s) return;
  e.stopPropagation(); e.preventDefault();
  closePopup();
  if (selectedShapeId !== sid) selectShape(sid);
  if (s.locked) return;
  dragState = { sid, h: t.getAttribute('data-h') || null, sx: e.clientX, sy: e.clientY, orig: clone(s) };
});
svgOverlay.addEventListener('click', (e) => e.stopPropagation());
svgOverlay.addEventListener('dblclick', (e) => {
  const sid = parseInt(e.target.getAttribute('data-sid'), 10);
  const s = sid ? findShape(sid) : null;
  if (!s) return;
  if (s.tool === 'note') { startNoteInlineEdit(s); return; }
  openDialog(s, null);
});

// Click note body to edit text when already selected and the pointer did not drag
svgOverlay.addEventListener('click', (e) => {
  if (!e.target.getAttribute('data-note-edit')) return;
  const sid = parseInt(e.target.getAttribute('data-note-edit'), 10);
  const s = findShape(sid);
  if (!s || s.tool !== 'note' || selectedShapeId !== sid) return;
  // If a drag just finished, dragState was cleared on mouseup — use a short move threshold flag
  if (window._noteDidDrag) { window._noteDidDrag = false; return; }
  e.stopPropagation();
  startNoteInlineEdit(s);
});

let noteEditEl = null;
function endNoteInlineEdit(commit) {
  if (!noteEditEl) return;
  const sid = +noteEditEl.dataset.sid;
  const s = findShape(sid);
  if (commit && s) {
    s.text = noteEditEl.value;
    rememberStyle(s);
    dirty = true;
    refreshFloating();
  }
  noteEditEl.remove();
  noteEditEl = null;
}
function startNoteInlineEdit(s) {
  if (!s || s.tool !== 'note' || s.locked) return;
  endNoteInlineEdit(false);
  selectShape(s.id);
  const a = dataToPx(s.p1), b = dataToPx(s.p2);
  if (!b) return;
  const lines = String(s.text || '').split('\n');
  const size = s.textSize || 13;
  const padX = 10, padY = 8, lineH = size * 1.25;
  let maxW = 80;
  for (const ln of lines) maxW = Math.max(maxW, estimateTextWidth(ln || ' ', size));
  const boxW = Math.max(120, maxW + padX * 2 + 20);
  const boxH = Math.max(36, Math.max(lines.length, 2) * lineH + padY * 2);
  const left = b.x - boxW / 2;
  const top = b.y - boxH / 2;
  const ta = document.createElement('textarea');
  ta.className = 'note-inline-edit';
  ta.dataset.sid = s.id;
  ta.value = s.text || '';
  ta.style.left = Math.max(0, left) + 'px';
  ta.style.top = Math.max(0, top) + 'px';
  ta.style.width = boxW + 'px';
  ta.style.height = boxH + 'px';
  ta.style.fontSize = size + 'px';
  ta.style.color = s.textColor || '#fff';
  ta.style.background = rgba(s.bgColor || '#1e222d', s.bgOpacity != null ? s.bgOpacity : 0.95);
  ta.style.borderColor = rgba(s.borderColor || '#363a45', 1);
  chartContainer.appendChild(ta);
  noteEditEl = ta;
  ta.focus();
  ta.select();
  const commit = () => endNoteInlineEdit(true);
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); endNoteInlineEdit(false); dirty = true; }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commit(); }
    ev.stopPropagation();
  });
  ta.addEventListener('mousedown', (ev) => ev.stopPropagation());
  ta.addEventListener('click', (ev) => ev.stopPropagation());
}

function moveShape(s, orig, dx, dy) {
  const ts = chart.timeScale();
  const l0 = timeToLogical(orig.p1.time);
  const x0 = ts.logicalToCoordinate(l0);
  const y0 = candleSeries.priceToCoordinate(orig.p1.price);
  if (l0 === null || x0 === null || y0 === null) return;
  const l1 = ts.coordinateToLogical(x0 + dx);
  const pr = candleSeries.coordinateToPrice(y0 + dy);
  if (l1 === null || pr === null) return;
  const dB = Math.round(l1 - l0), dP = pr - orig.p1.price;
  if (s.tool === 'hline' || s.tool === 'hray') {
    // Horizontal tools: only move in price
    s.p1 = { time: orig.p1.time, price: orig.p1.price + dP };
    s.p2 = { time: orig.p2.time, price: orig.p2.price + dP };
  } else if (s.tool === 'vline') {
    // Vertical tool: only move in time
    s.p1 = { time: logicalToTime(timeToLogical(orig.p1.time) + dB), price: orig.p1.price };
    s.p2 = { time: logicalToTime(timeToLogical(orig.p2.time) + dB), price: orig.p2.price };
  } else {
    ['p1', 'p2'].forEach(k => { s[k] = { time: logicalToTime(timeToLogical(orig[k].time) + dB), price: orig[k].price + dP }; });
    if (isPosTool(s.tool)) { s.tpPrice = orig.tpPrice + dP; s.slPrice = orig.slPrice + dP; }
  }
}
function setHandle(s, h, time, price) {
  if (s.tool === 'hline' || s.tool === 'hray') {
    // Drag changes price only; keep time anchor for ray
    s.p1 = { time: s.p1.time, price };
    s.p2 = { time: s.p2.time, price };
  } else if (s.tool === 'vline') {
    s.p1 = { time, price: s.p1.price };
    s.p2 = { time, price: s.p2.price };
  } else if (s.tool === 'line' || s.tool === 'fib' || s.tool === 'note') {
    if (h === 'p1' || h === 'p2') {
      let pr = price;
      if (isShiftDown && s.tool === 'line') pr = (h === 'p2' ? s.p1.price : s.p2.price);
      s[h] = { time, price: pr };
    }
  } else if (s.tool === 'rect') {
    let L = Math.min(s.p1.time, s.p2.time), R = Math.max(s.p1.time, s.p2.time);
    let T = Math.max(s.p1.price, s.p2.price), B = Math.min(s.p1.price, s.p2.price);
    if (h.includes('l')) L = time;
    if (h.includes('r')) R = time;
    if (h[0] === 't') T = price;
    if (h[0] === 'b') B = price;
    s.p1 = { time: L, price: T }; s.p2 = { time: R, price: B };
  } else if (isPosTool(s.tool)) {
    if (h === 'tp') s.tpPrice = price;
    else if (h === 'sl') s.slPrice = price;
    else if (h === 'right') {
      const l1 = timeToLogical(s.p1.time), l2 = timeToLogical(time);
      if (l1 !== null && l2 !== null) {
        s.widthBars = Math.max(1, Math.round(l2 - l1));
        s.spanSec = Math.max(60, s.widthBars * barSeconds());
      }
    }
    else if (h === 'entry') {
      const dP = price - s.p1.price, dT = time - s.p1.time;
      s.p1 = { time: s.p1.time + dT, price }; s.p2 = { time: s.p2.time + dT, price: s.p2.price + dP };
      s.tpPrice += dP; s.slPrice += dP;
    }
  }
}
document.addEventListener('mousemove', (e) => {
  const r = chartContainer.getBoundingClientRect();
  if (dragState) {
    const s = findShape(dragState.sid);
    if (!s) return;
    if (Math.abs(e.clientX - dragState.sx) > 3 || Math.abs(e.clientY - dragState.sy) > 3) {
      dragState.moved = true;
      if (s.tool === 'note') window._noteDidDrag = true;
    }
    if (dragState.h) {
      const pt = pxToData(e.clientX - r.left, e.clientY - r.top);
      if (pt) setHandle(s, dragState.h, pt.time, pt.price);
    } else {
      moveShape(s, dragState.orig, e.clientX - dragState.sx, e.clientY - dragState.sy);
    }
    syncDialog(); dirty = true;
    return;
  }
  if (currentDrawTool && drawClicks.length === 1) {
    const pt = pxToData(e.clientX - r.left, e.clientY - r.top);
    if (pt) {
      if (isShiftDown && currentDrawTool === 'line') pt.price = drawClicks[0].price;
      activePreview = pt; dirty = true;
    }
  }
});
document.addEventListener('mouseup', (e) => {
  if (dragState) { const ds = findShape(dragState.sid); if (ds && isPosTool(ds.tool)) rememberPosSize(ds); }
  dragState = null;
  if (creating) {
    const moved = Math.hypot(e.clientX - creating.sx, e.clientY - creating.sy);
    creating = null;
    if (moved > 6 && drawClicks.length === 1) { // click-drag-release also works
      const r = chartContainer.getBoundingClientRect();
      const pt = pxToData(e.clientX - r.left, e.clientY - r.top);
      if (pt) finishTwoPoint(pt);
    }
  }
});
// click on empty chart space deselects (ignoring pans)
let downPos = null;
chartContainer.addEventListener('mousedown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
chartContainer.addEventListener('click', (e) => {
  if (currentDrawTool || e.target.closest('.dt-toolbar, #editToolbar')) return;
  if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) return;
  if (selectedShapeId !== null) deselect();
});

// ========== RENDERING ==========
function addText(parent, lines, x, y, anchor, s, rotate) {
  const t = mk('text', {
    x, y, 'text-anchor': anchor, 'font-size': s.textSize, 'font-family': UI_FONT,
    'font-weight': s.bold ? '700' : '400', 'font-style': s.italic ? 'italic' : 'normal',
    fill: rgba(s.textColor, s.textOpacity), transform: rotate || null
  }, parent);
  t.style.pointerEvents = 'none';
  lines.forEach((ln, i) => {
    const sp = mk('tspan', { x, dy: i === 0 ? 0 : s.textSize * 1.2 }, t);
    sp.textContent = ln;
  });
  return t;
}
function pill(parent, cx, cy, lines, fill, color = '#fff') {
  const w = Math.max(...lines.map(l => l.length)) * 6.1 + 14;
  const h = lines.length * 14 + 6;
  const r = mk('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 3, fill }, parent);
  r.style.pointerEvents = 'none';
  lines.forEach((ln, i) => {
    const t = mk('text', { x: cx, y: cy - h / 2 + 14 + i * 14 - 1, 'text-anchor': 'middle', 'font-size': 11, 'font-family': UI_FONT, fill: color }, parent);
    t.textContent = ln; t.style.pointerEvents = 'none';
  });
}
function hit(el, s, strokeOnly) {
  el.setAttribute('data-sid', s.id);
  el.setAttribute('class', 'hit' + (strokeOnly ? ' hit-stroke' : ''));
  return el;
}

function estimateTextWidth(str, size) {
  const lines = String(str || '').split('\n');
  let max = 0;
  for (const ln of lines) max = Math.max(max, ln.length);
  return max * (size || 12) * 0.62;
}
function strokeLineAttrs(s) {
  return {
    stroke: rgba(s.color, s.opacity), 'stroke-width': s.width,
    'stroke-dasharray': dashOf(s.lineStyle) || null,
    'stroke-linecap': s.lineStyle === 'dotted' ? 'round' : 'butt'
  };
}
function renderLine(s, g, c, pw) {
  const dx = c.x2 - c.x1, dy = c.y2 - c.y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  let ax1 = c.x1, ay1 = c.y1, ax2 = c.x2, ay2 = c.y2;
  if (s.extendLeft) { ax1 = c.x1 - ux * 1e5; ay1 = c.y1 - uy * 1e5; }
  if (s.extendRight) { ax2 = c.x2 + ux * 1e5; ay2 = c.y2 + uy * 1e5; }
  const [lx, ly, rx, ry] = c.x1 <= c.x2 ? [c.x1, c.y1, c.x2, c.y2] : [c.x2, c.y2, c.x1, c.y1];
  const ang = Math.atan2(ry - ly, rx - lx) * 180 / Math.PI;
  const px = s.textH === 'left' ? lx : s.textH === 'right' ? rx : (lx + rx) / 2;
  const py = s.textH === 'left' ? ly : s.textH === 'right' ? ry : (ly + ry) / 2;
  const hasText = !!(s.text && String(s.text).trim());
  // Vertical middle: open a gap under the label so the stroke never strikes through the text
  const middleV = hasText && s.textV === 'middle';
  const sa = strokeLineAttrs(s);
  if (middleV) {
    const tw = estimateTextWidth(s.text, s.textSize) + 12;
    let gapBefore, gapAfter;
    if (s.textH === 'left') { gapBefore = 4; gapAfter = tw + 4; }
    else if (s.textH === 'right') { gapBefore = tw + 4; gapAfter = 4; }
    else { gapBefore = tw / 2; gapAfter = tw / 2; }
    // Distance of text anchor from the drawn start, projected onto the unit direction
    const fullLen = Math.hypot(ax2 - ax1, ay2 - ay1) || 1;
    const tDist = (px - ax1) * ux + (py - ay1) * uy;
    const g0 = Math.max(0, Math.min(fullLen, tDist - gapBefore));
    const g1 = Math.max(0, Math.min(fullLen, tDist + gapAfter));
    // First segment: start → gap (skip if too short so we never draw a stub past the end)
    if (g0 > 0.5) {
      mk('line', { x1: ax1, y1: ay1, x2: ax1 + ux * g0, y2: ay1 + uy * g0, ...sa }, g);
    }
    // Second segment: gap end → end
    if (g1 < fullLen - 0.5) {
      mk('line', { x1: ax1 + ux * g1, y1: ay1 + uy * g1, x2: ax2, y2: ay2, ...sa }, g);
    }
  } else {
    mk('line', { x1: ax1, y1: ay1, x2: ax2, y2: ay2, ...sa }, g);
  }
  if (!s.isPreview) hit(mk('line', { x1: ax1, y1: ay1, x2: ax2, y2: ay2, stroke: 'transparent', 'stroke-width': 12 }, g), s);
  if (hasText) {
    const off = s.textV === 'top' ? -8 : s.textV === 'bottom' ? (s.textSize || 12) + 4 : (s.textSize || 12) * 0.35;
    addText(g, String(s.text).split('\n'), px, py + off, s.textH === 'left' ? 'start' : s.textH === 'right' ? 'end' : 'middle', s, `rotate(${ang} ${px} ${py})`);
  }
}

function renderHLine(s, g, c, pw) {
  const y = c.y1;
  let x1 = -5, x2 = pw + 5;
  if (s.tool === 'hray') {
    // Horizontal ray: from the anchor point to the right edge
    x1 = c.x1;
    x2 = pw + 5;
  }
  const hasText = !!(s.text && String(s.text).trim());
  const sa = strokeLineAttrs(s);
  // Horizontal position of the label
  let px;
  if (s.tool === 'hray') px = x1 + 8;
  else if (s.textH === 'left') px = Math.max(8, x1 + 8);
  else if (s.textH === 'right') px = Math.min(pw - 8, x2 - 8);
  else px = (Math.max(0, x1) + Math.min(pw, x2)) / 2;
  // Gap under label whenever vertical alignment is middle
  const middleV = hasText && s.textV === 'middle';
  if (middleV) {
    const tw = estimateTextWidth(s.text, s.textSize) + 12;
    let gapBefore, gapAfter;
    if (s.tool === 'hray' || s.textH === 'left') { gapBefore = 4; gapAfter = tw + 4; }
    else if (s.textH === 'right') { gapBefore = tw + 4; gapAfter = 4; }
    else { gapBefore = tw / 2; gapAfter = tw / 2; }
    const leftEnd = Math.min(x1, x2), rightEnd = Math.max(x1, x2);
    const g0 = Math.max(leftEnd, px - gapBefore);
    const g1 = Math.min(rightEnd, px + gapAfter);
    if (g0 > leftEnd + 0.5) mk('line', { x1: leftEnd, y1: y, x2: g0, y2: y, ...sa }, g);
    if (g1 < rightEnd - 0.5) mk('line', { x1: g1, y1: y, x2: rightEnd, y2: y, ...sa }, g);
  } else {
    mk('line', { x1, y1: y, x2, y2: y, ...sa }, g);
  }
  if (!s.isPreview) hit(mk('line', { x1, y1: y, x2, y2: y, stroke: 'transparent', 'stroke-width': 12 }, g), s);
  if (hasText) {
    const off = s.textV === 'top' ? -8 : s.textV === 'bottom' ? (s.textSize || 12) + 4 : (s.textSize || 12) * 0.35;
    const anchor = s.tool === 'hray' ? 'start' : (s.textH === 'left' ? 'start' : s.textH === 'right' ? 'end' : 'middle');
    addText(g, String(s.text).split('\n'), px, y + off, anchor, s);
  }
}
function renderVLine(s, g, c, pw, ph) {
  const x = c.x1;
  const y1 = -5, y2 = (ph || 1000) + 5;
  mk('line', { x1: x, y1, x2: x, y2, stroke: rgba(s.color, s.opacity), 'stroke-width': s.width, 'stroke-dasharray': dashOf(s.lineStyle) || null, 'stroke-linecap': s.lineStyle === 'dotted' ? 'round' : 'butt' }, g);
  if (!s.isPreview) hit(mk('line', { x1: x, y1, x2: x, y2, stroke: 'transparent', 'stroke-width': 12 }, g), s);
  if (s.text) {
    const py = s.textV === 'top' ? 12 : s.textV === 'bottom' ? (ph || 0) - 8 : (ph || 0) / 2;
    addText(g, s.text.split('\n'), x + 6, py, 'start', s);
  }
}
function renderRect(s, g, c, pw) {
  let L = Math.min(c.x1, c.x2), R = Math.max(c.x1, c.x2);
  const T = Math.min(c.y1, c.y2), B = Math.max(c.y1, c.y2);
  if (s.extend === 'left' || s.extend === 'both') L = -5;
  if (s.extend === 'right' || s.extend === 'both') R = pw + 5;
  const rect = mk('rect', {
    x: L, y: T, width: R - L, height: B - T,
    fill: s.bg ? rgba(s.bgColor, s.bgOpacity) : 'transparent',
    stroke: s.border ? rgba(s.borderColor, s.borderOpacity) : 'none',
    'stroke-width': s.width, 'stroke-dasharray': dashOf(s.lineStyle) || null
  }, g);
  if (!s.isPreview) hit(rect, s, !s.bg);
  if (s.middle) {
    const my = (T + B) / 2;
    const ml = mk('line', {
      x1: L, y1: my, x2: R, y2: my,
      stroke: rgba(s.midColor, s.midOpacity),
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
      'stroke-dasharray': dashOf(s.midStyle) || null
    }, g);
    ml.style.pointerEvents = 'none';
  }
  if (s.text) {
    const lines = s.text.split('\n'), lh = s.textSize * 1.2;
    const anchor = s.textH === 'left' ? 'start' : s.textH === 'right' ? 'end' : 'middle';
    const tx0 = s.textH === 'left' ? L + 8 : s.textH === 'right' ? R - 8 : (L + R) / 2;
    const ty0 = s.textV === 'top' ? T + s.textSize + 6 : s.textV === 'bottom' ? B - 8 - (lines.length - 1) * lh : (T + B) / 2 + s.textSize * 0.35 - (lines.length - 1) * lh / 2;
    addText(g, lines, tx0, ty0, anchor, s, null);
  }
}
function renderFib(s, g, c, pw) {
  let L = Math.min(c.x1, c.x2), R = Math.max(c.x1, c.x2);
  if (s.extend === 'left' || s.extend === 'both') L = -5;
  if (s.extend === 'right' || s.extend === 'both') R = pw + 5;
  const lv = s.levels.filter(l => l.on).map(l => ({
    v: l.v, color: s.oneColor ? s.oneColorValue : l.color,
    price: s.p2.price + (s.p1.price - s.p2.price) * l.v
  }));
  lv.forEach(l => { l.y = candleSeries.priceToCoordinate(l.price); });
  const valid = lv.filter(l => l.y !== null).sort((a, b) => a.v - b.v);
  if (s.bg) {
    for (let i = 1; i < valid.length; i++) {
      const a = valid[i - 1], b = valid[i];
      const bgr = mk('rect', { x: L, y: Math.min(a.y, b.y), width: R - L, height: Math.abs(b.y - a.y), fill: rgba(b.color, s.bgOpacity) }, g);
      bgr.style.pointerEvents = 'none';
    }
  }
  if (s.trend) {
    mk('line', { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, stroke: s.oneColor ? s.oneColorValue : s.trendColor, 'stroke-width': 1, 'stroke-dasharray': dashOf(s.trendStyle) || null }, g).style.pointerEvents = 'none';
  }
  valid.forEach(l => {
    mk('line', { x1: L, y1: l.y, x2: R, y2: l.y, stroke: l.color, 'stroke-width': s.width, 'stroke-dasharray': dashOf(s.lineStyle) || null }, g);
    if (!s.isPreview) hit(mk('line', { x1: L, y1: l.y, x2: R, y2: l.y, stroke: 'transparent', 'stroke-width': 10 }, g), s);
    const t = mk('text', { x: L - 6, y: l.y + 4, 'text-anchor': 'end', 'font-size': 11, 'font-family': UI_FONT, fill: l.color }, g);
    t.textContent = `${l.v} (${fmtP(l.price)})`; t.style.pointerEvents = 'none';
  });
  if (!s.isPreview && s.trend) hit(mk('line', { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, stroke: 'transparent', 'stroke-width': 10 }, g), s);
}
function renderPosition(s, g, c, selected) {
  const long = s.tool === 'long';
  const entryY = c.y1;
  const tpY = candleSeries.priceToCoordinate(s.tpPrice), slY = candleSeries.priceToCoordinate(s.slPrice);
  if (tpY === null || slY === null) return null;
  const x1 = Math.min(c.x1, c.x2), x2 = Math.max(c.x1, c.x2), w = Math.max(2, x2 - x1), mx = x1 + w / 2;
  const entry = s.p1.price;
  const tpD = Math.abs(s.tpPrice - entry), slD = Math.abs(entry - s.slPrice);
  const trk = getTracker(s);
  const closed = !!(trk && trk.outcome);

  // Base TP / SL boxes — constant opacity (no path boost on whole zones)
  const baseOp = s.profitOpacity != null ? s.profitOpacity : 0.2;
  const baseStop = s.stopOpacity != null ? s.stopOpacity : 0.2;
  hit(mk('rect', { x: x1, y: Math.min(entryY, tpY), width: w, height: Math.abs(tpY - entryY), fill: rgba(s.profitColor, baseOp) }, g), s);
  hit(mk('rect', { x: x1, y: Math.min(entryY, slY), width: w, height: Math.abs(slY - entryY), fill: rgba(s.stopColor, baseStop) }, g), s);

  // Path opacity: band from entry → last price inside the tool, mapped by TIME RATIO
  // so it works the same on every timeframe (no dependency on 1m bar X coords)
  if (trk) {
    const priceY = candleSeries.priceToCoordinate(trk.lastPrice);
    if (priceY !== null && isFinite(priceY)) {
      const tStart = getComparableTime(s.p1.time);
      const tBoxEnd = trk.boxEndT != null ? trk.boxEndT : positionBoxEndTime(s);
      const tEnd = trk.endT;
      let ratio = 1;
      if (tStart != null && tBoxEnd != null && tBoxEnd > tStart && tEnd != null) {
        ratio = Math.max(0, Math.min(1, (tEnd - tStart) / (tBoxEnd - tStart)));
      }
      const hx1 = x1;
      const hx2 = x1 + Math.max(2, (x2 - x1) * ratio);
      const top = Math.min(entryY, priceY);
      const bot = Math.max(entryY, priceY);
      const pathH = Math.max(1, bot - top);
      const inProfit = long ? (trk.lastPrice >= entry) : (trk.lastPrice <= entry);
      const pathColor = inProfit ? s.profitColor : s.stopColor;
      const pathOp = closed ? 0.32 : 0.30;
      mk('rect', {
        x: hx1, y: top, width: Math.max(2, hx2 - hx1), height: pathH,
        fill: rgba(pathColor, pathOp)
      }, g).style.pointerEvents = 'none';

      // Dashed tracker: entry → first TP/SL touch (or latest price if still open)
      mk('line', {
        x1: hx1, y1: entryY,
        x2: hx2, y2: priceY,
        stroke: s.lineColor || '#787b86',
        'stroke-width': 1.25,
        'stroke-dasharray': '6 4',
        'stroke-linecap': 'round'
      }, g).style.pointerEvents = 'none';
    }
  }

  // Entry midline — always 1px
  mk('line', {
    x1, y1: entryY, x2, y2: entryY,
    stroke: s.lineColor || '#787b86',
    'stroke-width': 1,
    'vector-effect': 'non-scaling-stroke'
  }, g).style.pointerEvents = 'none';

  // Labels only while the position is selected
  if (selected) {
    const pct = (d) => (entry ? (d / entry * 100) : 0).toFixed(3);
    const ticks = (d) => Math.round(d / TICK_SIZE).toLocaleString('en-US');
    const last = trk && trk.lastPrice != null ? trk.lastPrice : lastShownClose();
    let pnl = 0;
    if (trk) {
      if (trk.outcome === 'tp') pnl = tpD * s.qty;
      else if (trk.outcome === 'sl') pnl = -slD * s.qty;
      else if (last != null) pnl = (long ? last - entry : entry - last) * s.qty;
    }
    const rr = slD > 0 ? (tpD / slD).toFixed(2) : '0.00';
    const tpPillY = tpY <= entryY ? tpY - 14 : tpY + 14;
    const slPillY = slY >= entryY ? slY + 14 : slY - 14;
    pill(g, mx, tpPillY, [
      `Target: ${tpD.toFixed(2)} (${pct(tpD)}%) ${ticks(tpD)}, Amount: ${(tpD * s.qty).toFixed(2)}`
    ], s.profitColor, s.textColor);
    pill(g, mx, slPillY, [
      `Stop: ${slD.toFixed(2)} (${pct(slD)}%) ${ticks(slD)}, Amount: ${(slD * s.qty).toFixed(2)}`
    ], s.stopColor, s.textColor);
    let statusLines;
    if (!trk) statusLines = [`Waiting for entry`, `Qty: ${s.qty}`, `Risk/reward ratio: ${rr}`];
    else if (closed) statusLines = [`Closed Pnl: ${pnl.toFixed(2)}, Qty: ${s.qty}`, `Risk/reward ratio: ${rr}`];
    else statusLines = [`Open Pnl: ${pnl.toFixed(2)}, Qty: ${s.qty}`, `Risk/reward ratio: ${rr}`];
    const statusFill = closed
      ? (trk.outcome === 'tp' ? rgba(s.profitColor, 0.92) : rgba(s.stopColor, 0.92))
      : 'rgba(120,123,134,0.92)';
    pill(g, mx, entryY, statusLines, statusFill, s.textColor);
  }
  return { x1, x2, entryY, tpY, slY };
}

function getHandles(s, c, pos) {
  if (s.tool === 'hline' || s.tool === 'hray') return [{ id: 'p1', x: s.tool === 'hray' ? c.x1 : (c.x1 + c.x2) / 2, y: c.y1, cur: 'ns-resize' }];
  if (s.tool === 'vline') return [{ id: 'p1', x: c.x1, y: (c.y1 + c.y2) / 2, cur: 'ew-resize' }];
  if (s.tool === 'line' || s.tool === 'fib' || s.tool === 'note') return [{ id: 'p1', x: c.x1, y: c.y1, cur: 'pointer' }, { id: 'p2', x: c.x2, y: c.y2, cur: 'pointer' }];
  if (s.tool === 'rect') {
    const L = Math.min(c.x1, c.x2), R = Math.max(c.x1, c.x2), T = Math.min(c.y1, c.y2), B = Math.max(c.y1, c.y2), mx = (L + R) / 2, my = (T + B) / 2;
    return [
      { id: 'tl', x: L, y: T, cur: 'nwse-resize' }, { id: 'tm', x: mx, y: T, cur: 'ns-resize' }, { id: 'tr', x: R, y: T, cur: 'nesw-resize' },
      { id: 'ml', x: L, y: my, cur: 'ew-resize' }, { id: 'mr', x: R, y: my, cur: 'ew-resize' },
      { id: 'bl', x: L, y: B, cur: 'nesw-resize' }, { id: 'bm', x: mx, y: B, cur: 'ns-resize' }, { id: 'br', x: R, y: B, cur: 'nwse-resize' }
    ];
  }
  if (!pos) return [];
  return [
    { id: 'tp', x: pos.x1, y: pos.tpY, cur: 'ns-resize' }, { id: 'entry', x: pos.x1, y: pos.entryY, cur: 'move' },
    { id: 'sl', x: pos.x1, y: pos.slY, cur: 'ns-resize' }, { id: 'right', x: pos.x2, y: pos.entryY, cur: 'ew-resize' }
  ];
}
function priceMarks(s) {
  if (isPosTool(s.tool)) return [
    { price: s.tpPrice, color: s.profitColor }, { price: s.p1.price, color: '#787b86' }, { price: s.slPrice, color: s.stopColor }
  ];
  return [{ price: s.p1.price, color: '#2962ff' }, { price: s.p2.price, color: '#2962ff' }];
}
function renderAxisHighlight(s, c, pw, ph, W, H) {
  const tsH = chart.timeScale().height() || (H - ph), ty = H - tsH;
  const marks = priceMarks(s).map(m => ({ ...m, y: candleSeries.priceToCoordinate(m.price) })).filter(m => m.y !== null);
  if (marks.length) {
    const ys = marks.map(m => m.y), top = Math.min(...ys), bot = Math.max(...ys);
    mk('rect', { x: pw, y: top, width: W - pw, height: bot - top, fill: 'rgba(41,98,255,0.28)' }, svgOverlay).style.pointerEvents = 'none';
    marks.forEach(m => {
      mk('rect', { x: pw + 1, y: m.y - 9, width: W - pw - 2, height: 18, fill: m.color }, svgOverlay).style.pointerEvents = 'none';
      const t = mk('text', { x: pw + (W - pw) / 2, y: m.y + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-family': UI_FONT, fill: '#fff' }, svgOverlay);
      t.textContent = fmtP(m.price); t.style.pointerEvents = 'none';
    });
  }
  const xs = [{ x: c.x1, t: s.p1.time }, { x: c.x2, t: s.p2.time }];
  const xl = Math.min(c.x1, c.x2), xr = Math.max(c.x1, c.x2);
  mk('rect', { x: xl, y: ty, width: xr - xl, height: tsH, fill: 'rgba(41,98,255,0.28)' }, svgOverlay).style.pointerEvents = 'none';
  xs.forEach(m => {
    const label = fmtAxisTime(m.t), w = label.length * 6.3 + 14;
    mk('rect', { x: m.x - w / 2, y: ty + 1, width: w, height: tsH - 2, fill: '#2962ff' }, svgOverlay).style.pointerEvents = 'none';
    const t = mk('text', { x: m.x, y: ty + tsH / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-family': UI_FONT, fill: '#fff' }, svgOverlay);
    t.textContent = label; t.style.pointerEvents = 'none';
  });
}

function renderNote(s, g, c) {
  const ax = c.x1, ay = c.y1, bx = c.x2, by = c.y2;
  const lines = String(s.text || 'Note').split('\n');
  const size = s.textSize || 13;
  const padX = 10, padY = 8, lineH = size * 1.25;
  let maxW = 40;
  for (const ln of lines) maxW = Math.max(maxW, estimateTextWidth(ln, size));
  const boxW = Math.max(48, maxW + padX * 2);
  const boxH = Math.max(28, lines.length * lineH + padY * 2);
  // Box is centered on p2
  const left = bx - boxW / 2;
  const top = by - boxH / 2;
  const cx = left + boxW / 2, cy = top + boxH / 2;
  // Leader attaches to the CENTER of the side that faces the anchor
  let tx, ty;
  const dx = ax - cx, dy = ay - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Left or right side — horizontal center of that edge is (edge, cy)
    tx = dx < 0 ? left : left + boxW;
    ty = cy;
  } else {
    // Top or bottom side — vertical center of that edge is (cx, edge)
    tx = cx;
    ty = dy < 0 ? top : top + boxH;
  }
  mk('line', {
    x1: ax, y1: ay, x2: tx, y2: ty,
    stroke: rgba(s.lineColor || s.anchorColor || '#e91e8c', s.lineOpacity != null ? s.lineOpacity : 1),
    'stroke-width': s.lineWidth || 1.2
  }, g);
  mk('circle', {
    cx: ax, cy: ay, r: 4.5,
    fill: rgba(s.anchorColor || '#e91e8c', s.anchorOpacity != null ? s.anchorOpacity : 1),
    stroke: '#fff', 'stroke-width': 1.2
  }, g);
  const bg = rgba(s.bgColor || '#1e222d', s.bgOpacity != null ? s.bgOpacity : 0.95);
  const border = rgba(s.borderColor || '#363a45', s.borderOpacity != null ? s.borderOpacity : 1);
  const rect = mk('rect', {
    x: left, y: top, width: boxW, height: boxH, rx: 6, ry: 6,
    fill: bg, stroke: border, 'stroke-width': s.width || 1
  }, g);
  if (!s.isPreview) {
    hit(mk('circle', { cx: ax, cy: ay, r: 12, fill: 'transparent' }, g), s);
    const hitR = mk('rect', { x: left, y: top, width: boxW, height: boxH, fill: 'transparent', class: 'note-body-hit' }, g);
    hit(hitR, s);
    hitR.setAttribute('data-note-edit', s.id);
  }
  const tAnchor = 'middle';
  const tx0 = left + boxW / 2;
  const ty0 = top + padY + size * 0.85;
  addText(g, lines, tx0, ty0, tAnchor, s);
}

function render() {
  svgOverlay.innerHTML = '';
  if (selectedShapeId !== null && !findShape(selectedShapeId)) deselect();
  if (!currentDataCache.length) return;
  const { w: pw, h: ph } = paneSize();
  const W = chartContainer.clientWidth, H = chartContainer.clientHeight;
  const defs = mk('defs', {}, svgOverlay);
  const cp = mk('clipPath', { id: 'paneClip' }, defs);
  mk('rect', { x: 0, y: 0, width: pw, height: ph }, cp);
  const layer = mk('g', { 'clip-path': 'url(#paneClip)' }, svgOverlay);
  const cat = tfCategory();
  const all = drawings.filter(d => ensureVis(d).vis[cat] !== false);
  if (selectedShapeId !== null && !all.some(d => d.id === selectedShapeId)) deselect();
  if (currentDrawTool && !isPosTool(currentDrawTool) && drawClicks.length === 1 && activePreview) {
    const pv = makeShape(currentDrawTool, drawClicks[0], activePreview);
    pv.id = 'preview'; pv.isPreview = true; nextShapeId--;
    all.push(pv);
  }
  let selInfo = null;
  all.forEach(s => {
    if (isPosTool(s.tool)) {
      if (!(s.widthBars > 0)) { // older saved drawing: derive the width in bars once
        const l1 = timeToLogical(s.p1.time), l2 = timeToLogical(s.p2.time);
        s.widthBars = l1 !== null && l2 !== null ? Math.max(1, Math.round(l2 - l1)) : 12;
      }
      s.p2 = posP2(s);
    }
    let a = dataToPx(s.p1), b = dataToPx(s.p2);
    // Horizontal / near-horizontal lines: if one end fails, copy the working end's Y
    if (a && !b && isFinite(s.p2 && s.p2.price)) {
      const x = timeToX(s.p2.time);
      if (x != null && isFinite(x)) b = { x, y: a.y };
    } else if (b && !a && isFinite(s.p1 && s.p1.price)) {
      const x = timeToX(s.p1.time);
      if (x != null && isFinite(x)) a = { x, y: b.y };
    }
    if (!a || !b) return;
    const c = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    const g = mk('g', {}, layer);
    let pos = null;
    if (s.tool === 'line') renderLine(s, g, c, pw);
    else if (s.tool === 'hline' || s.tool === 'hray') renderHLine(s, g, c, pw);
    else if (s.tool === 'vline') renderVLine(s, g, c, pw, ph);
    else if (s.tool === 'rect') renderRect(s, g, c, pw);
    else if (s.tool === 'fib') renderFib(s, g, c, pw);
    else if (s.tool === 'note') renderNote(s, g, c);
    else if (isPosTool(s.tool)) pos = renderPosition(s, g, c, s.id === selectedShapeId);
    if (isPosTool(s.tool) && !pos) return;
    if (s.id === selectedShapeId) selInfo = { s, c, pos };
  });
  if (selInfo) {
    const { s, c, pos } = selInfo;
    const cc = pos ? { x1: pos.x1, x2: pos.x2 } : c;
    renderAxisHighlight(s, { x1: cc.x1, x2: cc.x2 }, pw, ph, W, H);
    if (!s.locked) {
      const hg = mk('g', {}, svgOverlay);
      getHandles(s, c, pos).forEach(h => {
        if (h.x < -6 || h.x > pw + 6 || h.y < -6 || h.y > ph + 6) return;
        const el = mk('circle', { cx: h.x, cy: h.y, r: 5.5, class: 'dt-handle', 'data-sid': s.id, 'data-h': h.id }, hg);
        el.style.cursor = h.cur;
      });
    }
  }

  // Indicator boxes (any plot with type: 'box')
  renderIndicatorBoxes(layer, pw);
  // Volume profile (horizontal volume-at-price bars)
  renderVolumeProfiles(layer, pw);
}

function renderIndicatorBoxes(layer, pw) {
  if (!indSeries.size) return;
  const rightEdge = Math.max(1, pw);
  const times = ctimes();
  indSeries.forEach((rt) => {
    if (!rt.boxes) return;
    for (const key of Object.keys(rt.boxes)) {
      const box = rt.boxes[key];
      const st = box.style || {};
      if (st.on === false) continue;
      const fillCol = st.fillColor || st.color || '#2962ff';
      const borderCol = st.borderColor || st.color || '#2962ff';
      const fill = rgba(fillCol, st.fillOpacity !== undefined ? st.fillOpacity : 0.12);
      const stroke = rgba(borderCol, st.borderOpacity !== undefined ? st.borderOpacity : 0.85);
      const bw = st.borderWidth || 1;
      const showLabel = st.showLabel !== false;
      const extendDefault = st.extendRight !== false;
      for (const b of box.pts || []) {
        if (!b || !isFinite(b.high) || !isFinite(b.low)) continue;
        const t0 = getComparableTime(b.time);
        if (t0 == null) continue;
        // Map midnight time onto the chart: exact match, else nearest bar
        let x1 = timeToX(t0);
        if ((x1 === null || !isFinite(x1)) && times.length) {
          let lo = 0, hi = times.length - 1;
          while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (times[m] < t0) lo = m + 1; else hi = m;
          }
          const i = Math.max(0, Math.min(times.length - 1, lo));
          const cand = (i > 0 && Math.abs(times[i - 1] - t0) < Math.abs(times[i] - t0)) ? times[i - 1] : times[i];
          x1 = timeToX(cand);
        }
        if (x1 === null || !isFinite(x1)) continue;
        const yHigh = candleSeries.priceToCoordinate(b.high);
        const yLow = candleSeries.priceToCoordinate(b.low);
        if (yHigh === null || yLow === null || !isFinite(yHigh) || !isFinite(yLow)) continue;
        const extend = b.extendRight !== undefined ? b.extendRight : extendDefault;
        const x2 = extend ? rightEdge : (x1 + 40);
        const left = Math.min(x1, x2);
        const width = Math.max(2, Math.abs(x2 - x1));
        const top = Math.min(yHigh, yLow);
        const h = Math.max(1, Math.abs(yLow - yHigh));
        const g = mk('g', {}, layer);
        mk('rect', { x: left, y: top, width, height: h, fill, stroke, 'stroke-width': bw }, g).style.pointerEvents = 'none';
        mk('line', { x1: left, y1: yHigh, x2: left + width, y2: yHigh, stroke, 'stroke-width': bw }, g).style.pointerEvents = 'none';
        mk('line', { x1: left, y1: yLow, x2: left + width, y2: yLow, stroke, 'stroke-width': bw }, g).style.pointerEvents = 'none';
        if (showLabel && b.label) {
          const labelY = top - 4;
          if (labelY > 2) {
            const t = mk('text', {
              x: left + 4, y: labelY,
              'font-size': 10, 'font-family': UI_FONT,
              fill: stroke, 'font-weight': 600
            }, g);
            t.textContent = b.label;
            t.style.pointerEvents = 'none';
          }
        }
      }
    }
  });
}

function renderVolumeProfiles(layer, pw) {
  if (!indSeries.size) return;
  const rightEdge = Math.max(1, pw);
  indSeries.forEach((rt) => {
    if (!rt.vp) return;
    for (const key of Object.keys(rt.vp)) {
      const vp = rt.vp[key];
      const data = vp.data;
      const st = vp.style || {};
      if (st.on === false || !data || !Array.isArray(data.rows) || !data.rows.length) continue;
      const maxVol = data.maxVol || 0;
      if (!(maxVol > 0)) continue;
      const side = st.side === 'left' ? 'left' : 'right';
      const widthPct = Math.min(60, Math.max(5, st.widthPct || 30)) / 100;
      const maxBarW = Math.max(8, rightEdge * widthPct);
      const baseX = side === 'right' ? rightEdge : 0;
      const showPoc = st.showPoc !== false;
      const showVa = st.showVa !== false;
      const fillOp = st.fillOpacity !== undefined ? st.fillOpacity : 0.55;
      const upColor = st.color || '#2962ff';
      const vaColor = st.vaColor || '#089981';
      const pocColor = st.pocColor || '#f7a600';
      const g = mk('g', { class: 'vp-layer' }, layer);
      g.style.pointerEvents = 'none';
      const vaHigh = data.vaHigh, vaLow = data.vaLow, poc = data.poc;
      for (const row of data.rows) {
        if (!row || !(row.vol > 0)) continue;
        const yTop = candleSeries.priceToCoordinate(row.high);
        const yBot = candleSeries.priceToCoordinate(row.low);
        if (yTop === null || yBot === null || !isFinite(yTop) || !isFinite(yBot)) continue;
        const top = Math.min(yTop, yBot);
        const h = Math.max(1, Math.abs(yBot - yTop));
        const w = Math.max(1, (row.vol / maxVol) * maxBarW);
        const x = side === 'right' ? baseX - w : baseX;
        const inVa = showVa && isFinite(vaHigh) && isFinite(vaLow) && row.mid <= vaHigh && row.mid >= vaLow;
        const isPoc = showPoc && isFinite(poc) && Math.abs(row.mid - poc) < (row.high - row.low) * 0.51;
        const col = isPoc ? pocColor : (inVa ? vaColor : upColor);
        mk('rect', {
          x, y: top, width: w, height: h,
          fill: rgba(col, fillOp),
          stroke: 'none'
        }, g);
      }
      if (showPoc && isFinite(poc)) {
        const y = candleSeries.priceToCoordinate(poc);
        if (y !== null && isFinite(y)) {
          mk('line', {
            x1: side === 'right' ? rightEdge - maxBarW : 0,
            y1: y, x2: side === 'right' ? rightEdge : maxBarW, y2: y,
            stroke: pocColor, 'stroke-width': 1.5, 'stroke-dasharray': '4 3'
          }, g);
        }
      }
      if (showVa && isFinite(vaHigh) && isFinite(vaLow)) {
        for (const pr of [vaHigh, vaLow]) {
          const y = candleSeries.priceToCoordinate(pr);
          if (y === null || !isFinite(y)) continue;
          mk('line', {
            x1: side === 'right' ? rightEdge - maxBarW : 0,
            y1: y, x2: side === 'right' ? rightEdge : maxBarW, y2: y,
            stroke: vaColor, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.85
          }, g);
        }
      }
    }
  });
}

// Re-render whenever the chart view changes (pan / zoom / price-scale drag / resize)
let lastSig = '';
function viewSignature() {
  const ts = chart.timeScale();
  const lr = ts.getVisibleLogicalRange();
  return [lr ? lr.from : '', lr ? lr.to : '', candleSeries.priceToCoordinate(0), candleSeries.priceToCoordinate(1000),
    chartContainer.clientWidth, chartContainer.clientHeight, currentDataCache.length].join('|');
}
function drawLoop() {
  const sig = viewSignature();
  if (dirty || sig !== lastSig) {
    const changed = dirty;
    lastSig = sig; dirty = false; render();
    if (changed && persistReady && persistSignature() !== lastPersistSig) schedulePersist();
  }
  requestAnimationFrame(drawLoop);
}
requestAnimationFrame(drawLoop);

// Replay "Select bar" click (unchanged behaviour)
chart.subscribeClick((param) => {
  if (selectingBarMode && param.time) {
    const barT = getComparableTime(param.time);
    if (String(currentTimeframe) === '1') {
      replayTimestamp = barT;
    } else if (barT != null && rawCandles.length) {
      // Last 1m candle that still belongs to the clicked higher-TF bar
      const interval = barSeconds();
      let best = rawIndexAtOrBefore(barT + interval - 1);
      if (best < 0) best = rawIndexAtOrBefore(barT);
      while (best > 0) {
        const rt = getComparableTime(rawCandles[best].time);
        const key = getSessionAlignedKey(rt, currentTimeframe);
        if (key === param.time || getComparableTime(key) === barT) break;
        if (rt < barT) break;
        best--;
      }
      replayTimestamp = best >= 0 ? getComparableTime(rawCandles[best].time) : barT;
    } else {
      replayTimestamp = barT;
    }
    selectingBarMode = false;
    document.getElementById('btn-select-bar').classList.remove('active');
    chartContainer.style.cursor = 'default';
    applyTimeframe(currentTimeframe, true);
  }
});

// ========== RIGHT PRICE SCALE: MOUSE WHEEL ==========
// Wheel over the price axis zooms the price scale (TradingView behaviour).
// Shift + wheel scrolls the price scale up / down. Double-click the axis to reset to auto.
chartContainer.addEventListener('wheel', (e) => {
  const r = chartContainer.getBoundingClientRect();
  const { w: pw, h: ph } = paneSize();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (x <= pw || x > r.width || y < 0 || y > ph) return; // not over the right price scale
  e.preventDefault(); e.stopPropagation();
  const scale = chart.priceScale('right');
  const range = scale.getVisibleRange();
  if (!range || !isFinite(range.from) || !isFinite(range.to) || range.to === range.from) return;
  let dy = e.deltaY || e.deltaX;
  if (e.deltaMode === 1) dy *= 33; else if (e.deltaMode === 2) dy *= 400;
  const span = range.to - range.from;
  let from, to;
  if (e.shiftKey) { // scroll
    const shift = (dy / Math.max(ph, 1)) * span;
    from = range.from + shift; to = range.to + shift;
  } else { // zoom around the centre of the visible range
    const factor = Math.min(Math.max(Math.exp(dy * 0.0015), 0.5), 2);
    const mid = (range.from + range.to) / 2, half = (span / 2) * factor;
    from = mid - half; to = mid + half;
  }
  scale.applyOptions({ autoScale: false });
  scale.setVisibleRange({ from, to });
  markPriceScaleManual();
  dirty = true;
}, { passive: false, capture: true });

// Dragging the right price axis → manual mode
chartContainer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const r = chartContainer.getBoundingClientRect();
  const { w: pw, h: ph } = paneSize();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (x <= pw || x > r.width || y < 0 || y > ph) return;
  const onUp = () => {
    window.removeEventListener('mouseup', onUp);
    markPriceScaleManual();
    dirty = true;
  };
  window.addEventListener('mouseup', onUp);
}, true);

// "R" button at the bottom of the right price scale
const priceResetBtn = document.createElement('button');
priceResetBtn.id = 'priceResetBtn';
priceResetBtn.type = 'button';
priceResetBtn.title = 'Reset price scale (auto)';
priceResetBtn.textContent = 'R';
priceResetBtn.addEventListener('click', (e) => { e.stopPropagation(); resetPriceScale(); });
chartContainer.appendChild(priceResetBtn);
function positionPriceResetBtn() {
  try {
    const sw = chart.priceScale('right').width() || 56;
    const th = chart.timeScale().height() || 26;
    // Park the R button in the empty corner where the time scale and price scale meet
    priceResetBtn.style.right = Math.max(2, Math.round((sw - 22) / 2)) + 'px';
    priceResetBtn.style.bottom = Math.max(2, Math.round((th - 22) / 2)) + 'px';
  } catch (e) {
    priceResetBtn.style.right = '18px';
    priceResetBtn.style.bottom = '8px';
  }
  // Dark filled look only while the scale is in auto mode; outline when user-zoomed
  priceResetBtn.classList.toggle('is-auto', !priceScaleManual);
  priceResetBtn.classList.toggle('is-manual', !!priceScaleManual);
}
new ResizeObserver(() => positionPriceResetBtn()).observe(chartContainer);
positionPriceResetBtn();
chartContainer.addEventListener('dblclick', (e) => {
  const r = chartContainer.getBoundingClientRect();
  const { w: pw, h: ph } = paneSize();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (x > pw && x <= r.width && y >= 0 && y <= ph) resetPriceScale();
});

// "→" jump-to-current-candle when the latest bar is off-screen to the right
const goToLatestBtn = document.createElement('button');
goToLatestBtn.id = 'goToLatestBtn';
goToLatestBtn.type = 'button';
goToLatestBtn.title = 'Jump to current candle';
goToLatestBtn.innerHTML = '&#9654;'; // ▶
goToLatestBtn.hidden = true;
goToLatestBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  scrollToLatestCandle();
});
chartContainer.appendChild(goToLatestBtn);

function positionGoToLatestBtn() {
  try {
    const sw = chart.priceScale('right').width() || 56;
    goToLatestBtn.style.right = Math.max(4, Math.round((sw - 26) / 2)) + 'px';
    goToLatestBtn.style.top = '10px';
  } catch (e) {
    goToLatestBtn.style.right = '16px';
    goToLatestBtn.style.top = '10px';
  }
}
function scrollToLatestCandle() {
  if (!displayLen) return;
  const lr = chart.timeScale().getVisibleLogicalRange();
  const bars = lr && isFinite(lr.to - lr.from) ? Math.max(20, lr.to - lr.from) : Math.min(500, displayLen);
  // Center the latest candle in the viewport (not pinned to the right edge)
  const center = displayLen - 1;
  const half = bars / 2;
  chart.timeScale().setVisibleLogicalRange({ from: center - half, to: center + half });
  dirty = true;
  updateGoToLatestBtn();
}
let _goLatestTimer = null;
function scheduleGoToLatest() {
  if (_goLatestTimer) return;
  _goLatestTimer = setTimeout(() => { _goLatestTimer = null; updateGoToLatestBtn(); }, 120);
}
function updateGoToLatestBtn() {
  if (!displayLen) {
    goToLatestBtn.hidden = true;
    return;
  }
  const lr = chart.timeScale().getVisibleLogicalRange();
  if (!lr || !isFinite(lr.to)) {
    goToLatestBtn.hidden = true;
    return;
  }
  // Show when the latest candle is well off the right edge of the view
  const gap = displayLen - 1 - lr.to;
  goToLatestBtn.hidden = gap < 3;
  if (!goToLatestBtn.hidden) positionGoToLatestBtn();
}
new ResizeObserver(() => { positionPriceResetBtn(); positionGoToLatestBtn(); }).observe(chartContainer);
chart.timeScale().subscribeVisibleLogicalRangeChange(() => { updateGoToLatestBtn(); });
positionGoToLatestBtn();
updateGoToLatestBtn();

// ========== CHART SETTINGS DIALOG (TradingView-style) ==========
const chartDialog = document.createElement('div');
chartDialog.className = 'dt-dialog';
document.body.appendChild(chartDialog);
let csSnapshot = null;

function chartDialogCandlesHTML() {
  return `<div class="cs-title">Candles</div>
    ${chkRow('bodyOn', 'Body', swBtn('upColor', 'upOp') + swBtn('downColor', 'downOp'))}
    ${chkRow('borderOn', 'Borders', swBtn('borderUpColor', 'borderUpOp') + swBtn('borderDownColor', 'borderDownOp'))}
    ${chkRow('wickOn', 'Wick', swBtn('wickUpColor', 'wickUpOp') + swBtn('wickDownColor', 'wickDownOp'))}
    <div class="cs-hint">First swatch = up candle, second swatch = down candle.</div>`;
}
function chartDialogCanvasHTML() {
  return `<div class="cs-title">Background</div>
    ${row('Type', selBox('bgType', [['solid', 'Solid'], ['gradient', 'Gradient']]))}
    ${row('Color', swBtn('bgColor', 'bgOp') + swBtn('bgColor2', 'bgOp2'))}
    <div class="cs-title">Grid lines</div>
    ${row('Show', selBox('gridMode', [['both', 'Vert and horz'], ['vert', 'Vert only'], ['horz', 'Horz only'], ['none', 'Hidden']]))}
    ${row('Vert color', swBtn('vGridColor', 'vGridOp'))}
    ${row('Horz color', swBtn('hGridColor', 'hGridOp'))}
    ${row('Style', selBox('gridStyle', [[0, 'Solid'], [2, 'Dashed'], [1, 'Dotted']], true))}
    <div class="cs-title">Scales and crosshair</div>
    ${row('Text color', swBtn('textColor', 'textOp'))}
    ${row('Scale lines', swBtn('scaleLineColor', 'scaleLineOp'))}
    ${row('Crosshair', swBtn('crossColor', 'crossOp'))}`;
}
function openChartDialog() {
  closePopup();
  if (dialog.style.display === 'block') closeDialog(false);
  csSnapshot = { ...chartCfg };
  chartDialog.innerHTML = `
    <div class="dlg-head" id="csHead"><span>Chart settings</span><button type="button" class="dlg-x" data-cs="cancel">\u2715</button></div>
    <div class="dlg-tabs">
      <button type="button" class="dlg-tab" data-cstab="candles">Candles</button>
      <button type="button" class="dlg-tab" data-cstab="canvas">Canvas</button>
    </div>
    <div class="dlg-body">
      <div class="dlg-pane" data-pane="candles">${chartDialogCandlesHTML()}</div>
      <div class="dlg-pane" data-pane="canvas">${chartDialogCanvasHTML()}</div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="dlg-btn cs-reset" data-cs="reset">Reset</button>
      <button type="button" class="dlg-btn" data-cs="cancel">Cancel</button>
      <button type="button" class="dlg-btn primary" data-cs="ok">Ok</button>
    </div>`;
  chartDialog.style.display = 'block';
  if (!chartDialog.style.left) { chartDialog.style.left = `${Math.max(16, window.innerWidth / 2 - 190)}px`; chartDialog.style.top = '90px'; }
  showChartTab('candles');
  syncChartDialog();
  attachDrag(chartDialog, document.getElementById('csHead'));
}
function showChartTab(k) {
  chartDialog.querySelectorAll('.dlg-tab').forEach(b => b.classList.toggle('active', b.dataset.cstab === k));
  chartDialog.querySelectorAll('.dlg-pane').forEach(p => { p.style.display = p.dataset.pane === k ? 'block' : 'none'; });
}
function closeChartDialog(cancel) {
  if (cancel && csSnapshot) { chartCfg = { ...csSnapshot }; applyChartSettings(chartCfg); }
  else saveChartSettings();
  chartDialog.style.display = 'none'; chartDialog.innerHTML = ''; csSnapshot = null; closePopup();
}
function syncChartDialog() {
  if (chartDialog.style.display !== 'block') return;
  chartDialog.querySelectorAll('[data-k]').forEach(el => {
    const v = chartCfg[el.dataset.k];
    if (v === undefined) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = v;
  });
  chartDialog.querySelectorAll('.dlg-sw').forEach(b => {
    const o = b.dataset.op ? chartCfg[b.dataset.op] : 1;
    b.firstElementChild.style.background = rgba(chartCfg[b.dataset.sw], o);
  });
  const g2 = chartDialog.querySelector('[data-sw="bgColor2"]');
  if (g2) g2.style.display = chartCfg.bgType === 'gradient' ? '' : 'none';
}
function commitChartCfg() { applyChartSettings(chartCfg); syncChartDialog(); dirty = true; }

chartDialog.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.cs === 'ok') closeChartDialog(false);
  else if (t.dataset.cs === 'cancel') closeChartDialog(true);
  else if (t.dataset.cs === 'reset') { chartCfg = { ...CHART_DEFAULTS }; commitChartCfg(); }
  else if (t.dataset.cstab) showChartTab(t.dataset.cstab);
  else if (t.dataset.sw) {
    const ck = t.dataset.sw, ok = t.dataset.op;
    openColorPicker(t, () => ({ color: chartCfg[ck], opacity: ok ? chartCfg[ok] : 1 }), (c, o) => {
      chartCfg[ck] = c; if (ok) chartCfg[ok] = o; commitChartCfg();
    }, !!ok);
  }
});
function onChartDlgInput(e) {
  const t = e.target, k = t.dataset ? t.dataset.k : null;
  if (!k) return;
  if (t.type === 'checkbox') chartCfg[k] = t.checked;
  else if (t.dataset.num) { const v = parseFloat(t.value); if (!isFinite(v)) return; chartCfg[k] = v; }
  else chartCfg[k] = t.value;
  commitChartCfg();
}
chartDialog.addEventListener('input', onChartDlgInput);
chartDialog.addEventListener('change', onChartDlgInput);
document.getElementById('chartSettingsBtn').addEventListener('click', () => {
  if (chartDialog.style.display === 'block') closeChartDialog(false); else openChartDialog();
});

// ========== KEYBOARD INTERVAL SWITCHING ==========
// Type 1 + Enter -> 1m, 15 + Enter -> 15m, 1h / 4h + Enter -> hours, 1d -> daily, 1w -> weekly.
const ivBox = document.createElement('div');
ivBox.className = 'iv-box';
ivBox.innerHTML = `<div class="iv-title">Change interval</div>
  <input class="iv-input" type="text" maxlength="5" autocomplete="off" spellcheck="false" />
  <div class="iv-hint"></div>
  <div class="iv-keys">5 = 5m &nbsp;\u00b7&nbsp; 1h = 1 hour &nbsp;\u00b7&nbsp; 1d = daily &nbsp;\u00b7&nbsp; 1w = weekly</div>`;
document.body.appendChild(ivBox);
const ivInput = ivBox.querySelector('.iv-input');
const ivHint = ivBox.querySelector('.iv-hint');
let ivOpen = false;

function parseInterval(str) {
  const m = /^(\d*)\s*([a-z]?)$/i.exec((str || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  const n = m[1] === '' ? 1 : parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (!n) return null;
  let tf;
  if (unit === 'd') { if (n !== 1) return null; tf = '1D'; }
  else if (unit === 'w') { if (n !== 1) return null; tf = '1W'; }
  else if (unit === 'h') tf = String(n * 60);
  else tf = String(n); // plain number or "m" = minutes
  return document.querySelector(`#timeframes button[data-tf="${tf}"]`) ? tf : null;
}
function updateIvHint() {
  const v = ivInput.value, tf = parseInterval(v);
  ivBox.classList.remove('bad');
  if (!v) { ivHint.textContent = ''; ivHint.className = 'iv-hint'; return; }
  if (tf) {
    ivHint.textContent = `\u2192 ${document.querySelector(`#timeframes button[data-tf="${tf}"]`).textContent}  (press Enter)`;
    ivHint.className = 'iv-hint ok';
  } else { ivHint.textContent = 'Interval not available'; ivHint.className = 'iv-hint err'; }
}
function openInterval(first) {
  ivOpen = true; ivBox.classList.add('open');
  ivInput.value = first; updateIvHint();
  ivInput.focus(); ivInput.setSelectionRange(first.length, first.length);
}
function closeInterval() { ivOpen = false; ivBox.classList.remove('open', 'bad'); ivInput.blur(); }
ivInput.addEventListener('input', () => { ivInput.value = ivInput.value.replace(/[^0-9dhwmDHWM]/g, ''); updateIvHint(); });
ivInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const tf = parseInterval(ivInput.value);
  if (tf) { closeInterval(); setTimeframe(tf); }
  else { ivBox.classList.remove('bad'); void ivBox.offsetWidth; ivBox.classList.add('bad'); }
});
ivInput.addEventListener('blur', () => { if (ivOpen) closeInterval(); });
document.addEventListener('keydown', (e) => {
  if (ivOpen || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
  if (anyDialogOpen()) return;
  if (!/^[0-9dDwW]$/.test(e.key)) return;
  e.preventDefault(); // keep the typed character out of the freshly focused input
  openInterval(e.key.toLowerCase());
});

// ========== INDICATORS ==========
// Indicators are written in plain JavaScript (runs natively in the browser, no extra tooling).
// Built-ins and your own code use exactly the same format: indicator({ name, overlay, inputs, plots, calculate }).
const IND_KEY = 'onyx.indicators.v1';
function indMaxBars() {
  // Line/histogram indicators: keep math cheap on dense charts
  const n = parseInt(currentTimeframe, 10);
  if (currentTimeframe === '1' || currentTimeframe === '2' || currentTimeframe === '3') return 4000;
  if (currentTimeframe === '5' || currentTimeframe === '10') return 6000;
  if (n && n < 60) return 8000;
  return 12000;
}
/** Bars needed so box indicators (e.g. MOR past-days) still see every midnight in range. */
function historyBarsForBoxes() {
  let maxPast = 5;
  for (const inst of indInst) {
    if (!indicatorActive(inst)) continue;
    const v = +(inst.inputs && inst.inputs.pastDays);
    if (isFinite(v) && v > maxPast) maxPast = v;
  }
  // Calendar span: pastDays + current + 1 buffer day, as minutes
  const spanMin = (maxPast + 2) * 24 * 60;
  let barMin = parseInt(currentTimeframe, 10);
  if (currentTimeframe === '1D') barMin = 1440;
  else if (currentTimeframe === '1W') barMin = 10080;
  else if (!barMin || !isFinite(barMin)) barMin = 1;
  return Math.min(shownData.length, Math.max(3000, Math.ceil(spanMin / barMin) + 100));
}

// ---- technical-analysis helpers handed to every indicator as `ta`
const nanArr = (n) => new Array(n).fill(NaN);
const taAt = (x, i) => (Array.isArray(x) ? x[i] : x);
function taZip(a, b, f) {
  const n = Array.isArray(a) ? a.length : b.length, out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = f(taAt(a, i), taAt(b, i));
  return out;
}
function taRecursive(src, len, k) { // EMA / RMA, seeded with an SMA like TradingView
  len = Math.max(1, Math.floor(len));
  const n = src.length, out = nanArr(n);
  let prev = NaN, cnt = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (v !== v) { prev = NaN; cnt = 0; sum = 0; continue; }
    if (prev !== prev) { sum += v; cnt++; if (cnt === len) { prev = sum / len; out[i] = prev; } }
    else { prev = v * k + prev * (1 - k); out[i] = prev; }
  }
  return out;
}
const TA = {
  add: (a, b) => taZip(a, b, (x, y) => x + y),
  sub: (a, b) => taZip(a, b, (x, y) => x - y),
  mul: (a, b) => taZip(a, b, (x, y) => x * y),
  div: (a, b) => taZip(a, b, (x, y) => x / y),
  sma(src, len) {
    len = Math.max(1, Math.floor(len));
    const n = src.length, out = nanArr(n);
    let sum = 0, bad = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i]; if (v !== v) bad++; else sum += v;
      if (i >= len) { const o = src[i - len]; if (o !== o) bad--; else sum -= o; }
      if (i >= len - 1 && bad === 0) out[i] = sum / len;
    }
    return out;
  },
  ema: (src, len) => taRecursive(src, len, 2 / (Math.max(1, len) + 1)),
  rma: (src, len) => taRecursive(src, len, 1 / Math.max(1, len)),
  wma(src, len) {
    len = Math.max(1, Math.floor(len));
    const n = src.length, out = nanArr(n), den = len * (len + 1) / 2;
    for (let i = len - 1; i < n; i++) {
      let s = 0, ok = true;
      for (let j = 0; j < len; j++) { const v = src[i - j]; if (v !== v) { ok = false; break; } s += v * (len - j); }
      if (ok) out[i] = s / den;
    }
    return out;
  },
  stdev(src, len) {
    len = Math.max(1, Math.floor(len));
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) {
      let s = 0, ok = true;
      for (let j = 0; j < len; j++) { const v = src[i - j]; if (v !== v) { ok = false; break; } s += v; }
      if (!ok) continue;
      const m = s / len; let q = 0;
      for (let j = 0; j < len; j++) { const x = src[i - j] - m; q += x * x; }
      out[i] = Math.sqrt(q / len);
    }
    return out;
  },
  highest(src, len) {
    len = Math.max(1, Math.floor(len));
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) { let m = -Infinity; for (let j = 0; j < len; j++) if (src[i - j] > m) m = src[i - j]; out[i] = m; }
    return out;
  },
  lowest(src, len) {
    len = Math.max(1, Math.floor(len));
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) { let m = Infinity; for (let j = 0; j < len; j++) if (src[i - j] < m) m = src[i - j]; out[i] = m; }
    return out;
  },
  change(src, len = 1) { const out = nanArr(src.length); for (let i = len; i < src.length; i++) out[i] = src[i] - src[i - len]; return out; },
  tr(d) {
    const n = d.length, out = nanArr(n);
    for (let i = 0; i < n; i++) out[i] = i === 0 ? d.high[i] - d.low[i] : Math.max(d.high[i] - d.low[i], Math.abs(d.high[i] - d.close[i - 1]), Math.abs(d.low[i] - d.close[i - 1]));
    return out;
  },
  atr(d, len) { return TA.rma(TA.tr(d), len); },
  rsi(src, len) {
    const n = src.length, up = nanArr(n), dn = nanArr(n);
    for (let i = 1; i < n; i++) { const ch = src[i] - src[i - 1]; up[i] = ch > 0 ? ch : (ch === ch ? 0 : NaN); dn[i] = ch < 0 ? -ch : (ch === ch ? 0 : NaN); }
    const ru = TA.rma(up, len), rd = TA.rma(dn, len);
    return ru.map((u, i) => (rd[i] === 0 ? 100 : 100 - 100 / (1 + u / rd[i])));
  },
  crossover(a, b) { const n = Array.isArray(a) ? a.length : b.length, out = new Array(n).fill(0); for (let i = 1; i < n; i++) out[i] = taAt(a, i) > taAt(b, i) && taAt(a, i - 1) <= taAt(b, i - 1) ? 1 : 0; return out; },
  crossunder(a, b) { const n = Array.isArray(a) ? a.length : b.length, out = new Array(n).fill(0); for (let i = 1; i < n; i++) out[i] = taAt(a, i) < taAt(b, i) && taAt(a, i - 1) >= taAt(b, i - 1) ? 1 : 0; return out; }
};

// ---- built-in library (same format as user code, so each one doubles as a template)
const IND_SOURCES = "['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4']";
const BUILTIN_INDICATORS = [
  { id: 'b-sma', builtin: true, name: 'Simple Moving Average', code: `indicator({
  name: 'Simple Moving Average',
  overlay: true,
  inputs: {
    length: { type: 'number', value: 20, min: 1, max: 1000, label: 'Length' },
    source: { type: 'select', value: 'close', options: ${IND_SOURCES}, label: 'Source' }
  },
  plots: { sma: { title: 'SMA', color: '#2962ff', width: 2 } },
  calculate(d, inputs, ta) {
    return { sma: ta.sma(d[inputs.source], inputs.length) };
  }
});` },
  { id: 'b-ema', builtin: true, name: 'Exponential Moving Average', code: `indicator({
  name: 'Exponential Moving Average',
  overlay: true,
  inputs: {
    length: { type: 'number', value: 21, min: 1, max: 1000, label: 'Length' },
    source: { type: 'select', value: 'close', options: ${IND_SOURCES}, label: 'Source' }
  },
  plots: { ema: { title: 'EMA', color: '#ff9800', width: 2 } },
  calculate(d, inputs, ta) {
    return { ema: ta.ema(d[inputs.source], inputs.length) };
  }
});` },
  { id: 'b-bb', builtin: true, name: 'Bollinger Bands', code: `indicator({
  name: 'Bollinger Bands',
  overlay: true,
  inputs: {
    length: { type: 'number', value: 20, min: 1, max: 500, label: 'Length' },
    mult: { type: 'number', value: 2, min: 0.1, step: 0.1, label: 'StdDev multiplier' },
    source: { type: 'select', value: 'close', options: ${IND_SOURCES}, label: 'Source' }
  },
  plots: {
    upper: { title: 'Upper', color: '#f23645', width: 1 },
    basis: { title: 'Basis', color: '#2962ff', width: 1 },
    lower: { title: 'Lower', color: '#089981', width: 1 }
  },
  calculate(d, inputs, ta) {
    const src = d[inputs.source];
    const basis = ta.sma(src, inputs.length);
    const dev = ta.stdev(src, inputs.length).map(v => v * inputs.mult);
    return { upper: ta.add(basis, dev), basis, lower: ta.sub(basis, dev) };
  }
});` },
  { id: 'b-vwap', builtin: true, name: 'VWAP (session)', code: `indicator({
  name: 'VWAP (session)',
  overlay: true,
  inputs: { source: { type: 'select', value: 'hlc3', options: ${IND_SOURCES}, label: 'Source' } },
  plots: { vwap: { title: 'VWAP', color: '#f7a600', width: 2 } },
  calculate(d, inputs) {
    const src = d[inputs.source], out = [];
    const hasVolume = d.volume.some(v => v > 0); // files without a volume column fall back to equal weights
    let pv = 0, vol = 0, prevDay = null;
    for (let i = 0; i < d.length; i++) {
      if (d.day[i] !== prevDay) { pv = 0; vol = 0; prevDay = d.day[i]; } // new session (6 PM New York)
      const v = hasVolume ? d.volume[i] : 1;
      pv += src[i] * v; vol += v;
      out.push(vol ? pv / vol : NaN);
    }
    return { vwap: out };
  }
});` },
  { id: 'b-rsi', builtin: true, name: 'Relative Strength Index', code: `indicator({
  name: 'Relative Strength Index',
  overlay: false,          // false = drawn in its own pane under the chart
  levels: [30, 70],        // horizontal guide lines
  inputs: {
    length: { type: 'number', value: 14, min: 1, max: 500, label: 'Length' },
    source: { type: 'select', value: 'close', options: ${IND_SOURCES}, label: 'Source' }
  },
  plots: { rsi: { title: 'RSI', color: '#7e57c2', width: 2 } },
  calculate(d, inputs, ta) {
    return { rsi: ta.rsi(d[inputs.source], inputs.length) };
  }
});` },
  { id: 'b-macd', builtin: true, name: 'MACD', code: `indicator({
  name: 'MACD',
  overlay: false,
  levels: [0],
  inputs: {
    fast: { type: 'number', value: 12, min: 1, label: 'Fast length' },
    slow: { type: 'number', value: 26, min: 1, label: 'Slow length' },
    signal: { type: 'number', value: 9, min: 1, label: 'Signal length' },
    source: { type: 'select', value: 'close', options: ${IND_SOURCES}, label: 'Source' }
  },
  plots: {
    hist: { title: 'Histogram', type: 'histogram', color: '#26a69a', colorNeg: '#ef5350' },
    macd: { title: 'MACD', color: '#2962ff', width: 2 },
    signal: { title: 'Signal', color: '#ff6d00', width: 2 }
  },
  calculate(d, inputs, ta) {
    const src = d[inputs.source];
    const macd = ta.sub(ta.ema(src, inputs.fast), ta.ema(src, inputs.slow));
    const signal = ta.ema(macd, inputs.signal);
    return { hist: ta.sub(macd, signal), macd, signal };
  }
});` },
  { id: 'b-vp', builtin: true, name: 'Volume Profile', code: `indicator({
  name: 'Volume Profile',
  overlay: true,
  inputs: {
    bars: { type: 'number', value: 120, min: 10, max: 5000, label: 'Lookback bars' },
    rows: { type: 'number', value: 40, min: 8, max: 200, label: 'Row count' },
    valueArea: { type: 'number', value: 70, min: 10, max: 100, step: 1, label: 'Value area %' },
    side: { type: 'select', value: 'right', options: ['right', 'left'], label: 'Side' },
    widthPct: { type: 'number', value: 28, min: 5, max: 60, label: 'Width % of pane' },
    showPoc: { type: 'bool', value: true, label: 'Show POC' },
    showVa: { type: 'bool', value: true, label: 'Show value area' }
  },
  plots: {
    profile: {
      type: 'vp',
      title: 'Volume Profile',
      color: '#2962ff',
      vaColor: '#089981',
      pocColor: '#f7a600'
    }
  },
  calculate(d, inputs) {
    const n = d.length;
    if (!n) return { profile: { rows: [], maxVol: 0, poc: NaN, vaHigh: NaN, vaLow: NaN } };
    const look = Math.max(10, Math.min(n, Math.floor(inputs.bars || 120)));
    const start = n - look;
    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < n; i++) {
      if (d.low[i] < lo) lo = d.low[i];
      if (d.high[i] > hi) hi = d.high[i];
    }
    if (!(hi > lo) || !isFinite(lo) || !isFinite(hi)) {
      return { profile: { rows: [], maxVol: 0, poc: NaN, vaHigh: NaN, vaLow: NaN } };
    }
    const rowCount = Math.max(8, Math.min(200, Math.floor(inputs.rows || 40)));
    const step = (hi - lo) / rowCount;
    const vols = new Array(rowCount).fill(0);
    const hasVol = d.volume.some(v => v > 0);
    for (let i = start; i < n; i++) {
      const h = d.high[i], l = d.low[i];
      const v = hasVol ? (d.volume[i] || 0) : 1;
      if (!(v > 0) || !(h >= l)) continue;
      const r0 = Math.max(0, Math.min(rowCount - 1, Math.floor((l - lo) / step)));
      const r1 = Math.max(0, Math.min(rowCount - 1, Math.floor((Math.min(h, hi) - lo) / step - 1e-12)));
      const span = Math.max(1, r1 - r0 + 1);
      const share = v / span;
      for (let r = r0; r <= r1; r++) vols[r] += share;
    }
    let maxVol = 0, pocIdx = 0;
    for (let r = 0; r < rowCount; r++) {
      if (vols[r] > maxVol) { maxVol = vols[r]; pocIdx = r; }
    }
    const total = vols.reduce((a, b) => a + b, 0);
    const target = total * Math.min(100, Math.max(10, inputs.valueArea || 70)) / 100;
    let vaLo = pocIdx, vaHi = pocIdx, acc = vols[pocIdx];
    while (acc < target && (vaLo > 0 || vaHi < rowCount - 1)) {
      const up = vaHi < rowCount - 1 ? vols[vaHi + 1] : -1;
      const dn = vaLo > 0 ? vols[vaLo - 1] : -1;
      if (up >= dn && up >= 0) { vaHi++; acc += up; }
      else if (dn >= 0) { vaLo--; acc += dn; }
      else break;
    }
    const rows = [];
    for (let r = 0; r < rowCount; r++) {
      const low = lo + r * step;
      const high = lo + (r + 1) * step;
      rows.push({ low, high, mid: (low + high) / 2, vol: vols[r] });
    }
    return {
      profile: {
        rows,
        maxVol,
        poc: rows[pocIdx].mid,
        vaHigh: rows[vaHi].high,
        vaLow: rows[vaLo].low
      }
    };
  }
});` },

];
const BLANK_INDICATOR = `// Onyx indicator - plain JavaScript.
indicator({
  name: 'My indicator',
  overlay: true,   // true = on the price chart, false = own pane below the chart
  inputs: {        // these become editable fields in the indicator settings
    length: { type: 'number', value: 14, min: 1, label: 'Length' },
    source: { type: 'select', value: 'close', options: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'], label: 'Source' }
  },
  plots: {         // one entry per line / histogram you return
    avg: { title: 'Average', color: '#f7a600', width: 2 }
  },
  // d = { time, open, high, low, close, volume, hl2, hlc3, ohlc4, length }  (one array entry per candle)
  // Return one array per plot (same length as d, use NaN where there is no value).
  calculate(d, inputs, ta) {
    return { avg: ta.sma(d[inputs.source], inputs.length) };
  }
});`;
const IND_HELP = `indicator({ name, overlay, levels, inputs, plots, calculate })

name       Text shown in the list.
overlay    true  = drawn on the price chart
           false = drawn in its own pane under the chart
levels     (optional) horizontal guide lines for pane indicators, e.g. [30, 70]
inputs     Editable settings. Each one is { type, value, label, min, max, step, options }
             type: 'number' | 'select' | 'bool' | 'text'
           Shorthand also works:  length: 20
plots      Lines / histograms / boxes / volume profiles to draw.
             type: 'line' (default) | 'histogram' | 'box' | 'vp'
             line/histogram: { title, color, width, lineStyle, colorNeg }
             box: { title, fillColor, fillOpacity, borderColor, borderOpacity, borderWidth, extendRight, showLabel }
             vp:   { title, color, vaColor, pocColor }  (horizontal volume-at-price bars)
           For box plots, calculate() must return an array of
             { time, high, low, label?, extendRight? } objects (not a number per bar).
           For vp plots, return { rows:[{low,high,mid,vol}], maxVol, poc, vaHigh, vaLow }.
           Shorthand also works:  avg: '#f7a600'
calculate(d, inputs, ta)   returns { plotKey: [numbers...] } or for boxes { plotKey: [{time,high,low}] } or vp object

d       arrays with one value per candle:
        d.time (seconds) d.open d.high d.low d.close d.volume d.hl2 d.hlc3 d.ohlc4 d.length
        d.day  = trading-day key (changes at 6 PM New York) - handy for session resets
inputs  current values of your inputs, e.g. inputs.length
ta      sma(src,len) ema(src,len) rma(src,len) wma(src,len) stdev(src,len)
        highest(src,len) lowest(src,len) change(src,len) rsi(src,len)
        tr(d) atr(d,len) crossover(a,b) crossunder(a,b)
        add(a,b) sub(a,b) mul(a,b) div(a,b)   (a or b may be a number)

Visible time-frame range (e.g. 1m - 5m) and the style of every plot are
edited from the indicator's settings (gear icon) after you add it.`;

// ---- compiling user code
function normalizeIndicatorDef(def) {
  if (!def || typeof def !== 'object') throw new Error('Call indicator({ ... }) with an object.');
  if (typeof def.calculate !== 'function') throw new Error('Missing calculate(d, inputs, ta) function.');
  const out = { name: String(def.name || 'Untitled indicator'), overlay: def.overlay !== false, levels: Array.isArray(def.levels) ? def.levels.filter(Number.isFinite) : [], inputs: {}, plots: {}, calculate: def.calculate };
  for (const [k, v] of Object.entries(def.inputs || {})) {
    const i = v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : { value: v };
    if (!i.type) i.type = typeof i.value === 'boolean' ? 'bool' : typeof i.value === 'number' ? 'number' : (Array.isArray(i.options) ? 'select' : 'text');
    if (i.value === undefined) i.value = i.type === 'bool' ? false : i.type === 'select' && i.options ? i.options[0] : i.type === 'number' ? 0 : '';
    if (!['number', 'select', 'bool', 'text'].includes(i.type)) i.type = 'text';
    i.label = i.label || k;
    out.inputs[k] = i;
  }
  for (const [k, v] of Object.entries(def.plots || {})) {
    const p = typeof v === 'string' ? { color: v } : { ...(v || {}) };
    const type = p.type === 'histogram' ? 'histogram' : p.type === 'box' ? 'box' : p.type === 'vp' ? 'vp' : 'line';
    out.plots[k] = {
      title: p.title || k,
      type,
      color: p.color || '#2962ff',
      colorNeg: p.colorNeg || '#ef5350',
      vaColor: p.vaColor || '#089981',
      pocColor: p.pocColor || '#f7a600',
      width: p.width || 2,
      lineStyle: p.lineStyle || 0,
      fillColor: p.fillColor || p.color || '#2962ff',
      fillOpacity: p.fillOpacity !== undefined ? p.fillOpacity : 0.12,
      borderColor: p.borderColor || p.color || '#2962ff',
      borderOpacity: p.borderOpacity !== undefined ? p.borderOpacity : 0.85,
      borderWidth: p.borderWidth || 1,
      extendRight: p.extendRight !== false,
      showLabel: p.showLabel !== false
    };
  }
  if (!Object.keys(out.plots).length) throw new Error('Define at least one plot, e.g. plots: { line: { color: "#2962ff" } }.');
  return out;
}
function compileIndicatorCode(code) {
  let captured;
  new Function('indicator', '"use strict";\n' + code)((d) => { captured = d; });
  return normalizeIndicatorDef(captured);
}
function buildIndicatorSource(slice) {
  const n = slice.length;
  const d = { length: n, time: new Array(n), open: new Array(n), high: new Array(n), low: new Array(n), close: new Array(n), volume: new Array(n), hl2: new Array(n), hlc3: new Array(n), ohlc4: new Array(n) };
  for (let i = 0; i < n; i++) {
    const c = slice[i];
    d.time[i] = getComparableTime(c.time); d.open[i] = c.open; d.high[i] = c.high; d.low[i] = c.low; d.close[i] = c.close; d.volume[i] = c.volume || 0;
    d.hl2[i] = (c.high + c.low) / 2; d.hlc3[i] = (c.high + c.low + c.close) / 3; d.ohlc4[i] = (c.open + c.high + c.low + c.close) / 4;
  }
  let dayCache = null;
  Object.defineProperty(d, 'day', { enumerable: true, get() { return dayCache || (dayCache = d.time.map(t => getSessionAlignedKey(t, '1D'))); } });
  return d;
}
function testRunIndicator(def) { // catches mistakes when the code is saved
  const n = 120, slice = [];
  let p = 100;
  for (let i = 0; i < n; i++) { const o = p, c = p + Math.sin(i / 5) * 2 + (i % 3 - 1); slice.push({ time: 1700000000 + i * 60, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 100 + i }); p = c; }
  try {
    const out = def.calculate(buildIndicatorSource(slice), defaultInputs(def), TA);
    if (!out || typeof out !== 'object') return 'calculate() must return an object like { plotKey: [numbers] }.';
    for (const k of Object.keys(def.plots)) {
      if (def.plots[k].type === 'vp') {
        if (!out[k] || typeof out[k] !== 'object') return `calculate() must return a volume-profile object for plot "${k}".`;
        continue;
      }
      if (!Array.isArray(out[k])) return `calculate() did not return an array for the plot "${k}".`;
      if (def.plots[k].type === 'box') continue; // boxes return [{time,high,low}] of any length
      if (out[k].length !== n) return `The array for plot "${k}" has ${out[k].length} values but there are ${n} candles - return one value per candle (use NaN for "no value").`;
    }
  } catch (e) { return `Runtime error: ${e.message}`; }
  return null;
}
function defaultInputs(def) { const o = {}; for (const [k, i] of Object.entries(def.inputs)) o[k] = i.value; return o; }

// ---- library / instances / persistence
let customIndicators = []; // [{ id, name, code }]
let indInst = [];          // on-chart instances
const indDefs = new Map(); // libId -> { def, error, runtimeError }
const indSeries = new Map(); // uid -> { series: { plotKey: seriesApi }, first }
let indActiveKey = '', shownData = [];
const allIndicatorLib = () => [...BUILTIN_INDICATORS, ...customIndicators];
function compileLib(entry) {
  if (!entry || !entry.id || typeof entry.code !== 'string') return;
  try {
    const def = compileIndicatorCode(entry.code);
    entry.name = def.name;
    indDefs.set(entry.id, { def, error: null, runtimeError: null });
  } catch (e) { indDefs.set(entry.id, { def: null, error: e.message || String(e), runtimeError: null }); }
}
const tfList = () => Array.from(document.querySelectorAll('#timeframes button[data-tf]')).map(b => ({ tf: b.dataset.tf, label: b.textContent }));
function reconcileInstance(inst, def) { // keep saved values, fill in anything new, drop anything removed
  const old = inst.inputs || {}, oldPlots = inst.plots || {}, list = tfList();
  inst.inputs = {};
  for (const [k, i] of Object.entries(def.inputs)) inst.inputs[k] = old[k] !== undefined && typeof old[k] === typeof i.value ? old[k] : i.value;
  inst.plots = {};
  for (const [k, p] of Object.entries(def.plots)) {
    const o = oldPlots[k] || {};
    inst.plots[k] = {
      on: o.on !== false,
      color: o.color || p.color,
      colorNeg: o.colorNeg || p.colorNeg,
      vaColor: o.vaColor || p.vaColor,
      pocColor: o.pocColor || p.pocColor,
      width: o.width || p.width,
      lineStyle: o.lineStyle !== undefined ? o.lineStyle : p.lineStyle,
      fillColor: o.fillColor || p.fillColor || p.color,
      fillOpacity: o.fillOpacity !== undefined ? o.fillOpacity : (p.fillOpacity !== undefined ? p.fillOpacity : 0.12),
      borderColor: o.borderColor || p.borderColor || p.color,
      borderOpacity: o.borderOpacity !== undefined ? o.borderOpacity : (p.borderOpacity !== undefined ? p.borderOpacity : 0.85),
      borderWidth: o.borderWidth || p.borderWidth || 1,
      extendRight: o.extendRight !== undefined ? o.extendRight : p.extendRight !== false,
      showLabel: o.showLabel !== undefined ? o.showLabel : p.showLabel !== false
    };
  }
  if (!list.some(x => x.tf === inst.from)) inst.from = list[0].tf;
  if (!list.some(x => x.tf === inst.to)) inst.to = list[list.length - 1].tf;
  if (inst.visible === undefined) inst.visible = true;
}
function loadIndicators() {
  try {
    const o = JSON.parse(localStorage.getItem(IND_KEY)) || {};
    customIndicators = Array.isArray(o.lib) ? o.lib.filter(x => x && x.id && typeof x.code === 'string') : [];
    indInst = Array.isArray(o.inst) ? o.inst : [];
  } catch (e) { customIndicators = []; indInst = []; }
  allIndicatorLib().forEach(compileLib);
  indInst = indInst.filter(i => i && i.uid && indDefs.has(i.libId));
  indInst.forEach(i => { const r = indDefs.get(i.libId); if (r.def) reconcileInstance(i, r.def); });
}
function saveIndicators() {
  try { localStorage.setItem(IND_KEY, JSON.stringify({ lib: customIndicators.map(({ id, name, code }) => ({ id, name, code })), inst: indInst })); } catch (e) { /* storage unavailable */ }
}
loadIndicators();

// ---- showing indicators on the chart
function indicatorActive(inst) {
  const rec = indDefs.get(inst.libId);
  if (!inst.visible || !rec || !rec.def) return false;
  const list = tfList(), cur = list.findIndex(x => x.tf === currentTimeframe);
  let a = list.findIndex(x => x.tf === inst.from), b = list.findIndex(x => x.tf === inst.to);
  if (a < 0) a = 0; if (b < 0) b = list.length - 1;
  if (a > b) [a, b] = [b, a];
  return cur >= a && cur <= b; // e.g. from 1m to 5m = 1m, 2m, 3m and 5m charts
}
function clearIndicatorSeries() {
  indSeries.forEach(rt => Object.values(rt.series).forEach(s => { try { chart.removeSeries(s); } catch (e) { /* already gone */ } }));
  indSeries.clear();
  try { while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1); } catch (e) { /* older API */ }
}
function rebuildIndicators() {
  clearIndicatorSeries();
  indBoxCache.clear();
  let pane = 0;
  for (const inst of indInst) {
    if (!indicatorActive(inst)) continue;
    const def = indDefs.get(inst.libId).def;
    const paneIdx = def.overlay ? 0 : ++pane;
    const rt = { series: {}, first: null, boxes: {}, vp: {} };
    for (const [key, p] of Object.entries(def.plots)) {
      const st = inst.plots[key] || {};
      if (st.on === false) continue;
      if (p.type === 'box') {
        // Merge style defaults from def so fill/border always exist
        rt.boxes[key] = {
          pts: [],
          style: {
            on: true,
            fillColor: st.fillColor || p.fillColor || p.color || '#2962ff',
            fillOpacity: st.fillOpacity !== undefined ? st.fillOpacity : (p.fillOpacity !== undefined ? p.fillOpacity : 0.12),
            borderColor: st.borderColor || p.borderColor || p.color || '#2962ff',
            borderOpacity: st.borderOpacity !== undefined ? st.borderOpacity : (p.borderOpacity !== undefined ? p.borderOpacity : 0.85),
            borderWidth: st.borderWidth || p.borderWidth || 1,
            extendRight: st.extendRight !== false,
            showLabel: st.showLabel !== false,
            color: st.color || p.color || '#2962ff'
          },
          def: p
        };
        continue;
      }
      if (p.type === 'vp') {
        rt.vp[key] = {
          data: null,
          style: {
            on: true,
            color: st.color || p.color || '#2962ff',
            vaColor: st.vaColor || p.vaColor || '#089981',
            pocColor: st.pocColor || p.pocColor || '#f7a600',
            fillOpacity: st.fillOpacity !== undefined ? st.fillOpacity : 0.55
          },
          def: p
        };
        continue;
      }
      const hist = p.type === 'histogram';
      const opts = hist
        ? { color: st.color, priceLineVisible: false, lastValueVisible: false }
        : { color: st.color, lineWidth: st.width, lineStyle: Number(st.lineStyle) || 0, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false };
      const s = chart.addSeries(hist ? HistogramSeries : LineSeries, opts, paneIdx);
      rt.series[key] = s;
      if (!rt.first) rt.first = s;
    }
    if (rt.first && !def.overlay) def.levels.forEach(v => rt.first.createPriceLine({ price: v, color: '#4a4e5b', lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
    if (rt.first || Object.keys(rt.boxes).length || Object.keys(rt.vp).length) indSeries.set(inst.uid, rt);
  }
  try { // give the extra panes a sensible height
    const panes = chart.panes(), h = Math.max(90, Math.round(chartContainer.clientHeight * 0.2));
    for (let i = 1; i < panes.length; i++) panes[i].setHeight(h);
  } catch (e) { /* older API */ }
}
// Cache box / VP indicator outputs across rapid replay steps. Midnight ranges
// only change when a new NY calendar day enters the visible history — not on
// every 1m skip — so recomputing them each click is pure waste.
const indBoxCache = new Map(); // uid -> { sig, out }
function updateIndicatorData() {
  // Ensure box-only indicators are still registered even if series map was empty
  if (!indSeries.size && indInst.some(i => indicatorActive(i))) {
    rebuildIndicators();
  }
  if (!indSeries.size) return;

  const hasBoxes = [...indSeries.values()].some(rt => (rt.boxes && Object.keys(rt.boxes).length) || (rt.vp && Object.keys(rt.vp).length));

  // Line/histogram: short visible window. Boxes: enough calendar history for past days.
  const lineMax = indMaxBars();
  const boxMax = hasBoxes ? Math.max(lineMax, historyBarsForBoxes()) : lineMax;

  let lineOff = Math.max(0, shownData.length - lineMax);
  try {
    const lr = chart.timeScale().getVisibleLogicalRange();
    if (lr && isFinite(lr.from) && isFinite(lr.to)) {
      const visFrom = Math.max(0, Math.floor(lr.from) - 200);
      const visTo = Math.min(shownData.length, Math.ceil(lr.to) + 2);
      if (visTo - visFrom < lineMax) lineOff = visFrom;
      else lineOff = Math.max(lineOff, visTo - lineMax);
    }
  } catch (e) { /* ignore */ }
  const boxOff = Math.max(0, shownData.length - boxMax);

  const lineSlice = lineOff ? shownData.slice(lineOff) : shownData;
  const boxSlice = hasBoxes ? (boxOff ? shownData.slice(boxOff) : shownData) : lineSlice;
  let dLine = null, dBox = null;
  let errorsChanged = false;

  // Signature for "has a new midnight entered the box slice?"
  const lastBar = shownData.length ? shownData[shownData.length - 1] : null;
  const lastT = lastBar ? getComparableTime(lastBar.time) : null;
  let lastNyDay = '';
  if (lastT != null) {
    const ny = getNYTimeDetails(lastT);
    lastNyDay = ny.year + '-' + ny.month + '-' + ny.day;
  }
  const boxHistSig = `${currentTimeframe}|${boxSlice.length}|${boxOff}|${lastNyDay}|${rawVer}`;

  indSeries.forEach((rt, uid) => {
    const inst = indInst.find(i => i.uid === uid), rec = inst && indDefs.get(inst.libId);
    if (!rec || !rec.def) return;
    const needsBox = !!(rt.boxes && Object.keys(rt.boxes).length) || !!(rt.vp && Object.keys(rt.vp).length);
    const needsLine = !!(rt.series && Object.keys(rt.series).length);
    let out = null, err = null;
    const inputs = {};
    for (const [k, i] of Object.entries(rec.def.inputs)) {
      let v = inst.inputs[k];
      if (i.type === 'number') { v = +v; if (!isFinite(v)) v = i.value; if (i.min !== undefined) v = Math.max(i.min, v); if (i.max !== undefined) v = Math.min(i.max, v); }
      if (i.type === 'bool') v = v !== false && v !== 0 && v !== 'false';
      inputs[k] = v;
    }
    const inputSig = JSON.stringify(inputs);

    try {
      if (needsBox && !needsLine) {
        // Pure box/VP indicator: reuse previous output until the NY day set changes
        const cacheKey = uid;
        const sig = boxHistSig + '|' + inputSig;
        const cached = indBoxCache.get(cacheKey);
        if (cached && cached.sig === sig) {
          out = cached.out;
        } else if (boxSlice.length) {
          if (!dBox) dBox = buildIndicatorSource(boxSlice);
          out = rec.def.calculate(dBox, inputs, TA);
          indBoxCache.set(cacheKey, { sig, out });
        }
      } else {
        // Line or mixed: recompute on the short visible window (and box slice if needed)
        const slice = needsBox ? boxSlice : lineSlice;
        if (slice.length) {
          if (needsBox) {
            if (!dBox) dBox = buildIndicatorSource(boxSlice);
            out = rec.def.calculate(dBox, inputs, TA);
          } else {
            if (!dLine) dLine = buildIndicatorSource(lineSlice);
            out = rec.def.calculate(dLine, inputs, TA);
          }
        }
      }
    } catch (e) { err = `Runtime error: ${e.message}`; console.error('Indicator error', inst.libId, e); }
    if ((rec.runtimeError || null) !== err) { rec.runtimeError = err; errorsChanged = true; }

    const lineSliceRef = needsBox ? boxSlice : lineSlice;
    for (const [key, s] of Object.entries(rt.series || {})) {
      const arr = out && out[key], hist = rec.def.plots[key].type === 'histogram', st = inst.plots[key], pts = [];
      if (Array.isArray(arr) && arr.length === lineSliceRef.length) {
        for (let i = 0; i < lineSliceRef.length; i++) {
          const v = arr[i];
          if (typeof v === 'number' && isFinite(v)) pts.push(hist ? { time: lineSliceRef[i].time, value: v, color: v >= 0 ? st.color : st.colorNeg } : { time: lineSliceRef[i].time, value: v });
          else pts.push({ time: lineSliceRef[i].time });
        }
      }
      try { s.setData(pts); } catch (e) { /* ignore */ }
    }
    if (rt.boxes) {
      for (const [key, box] of Object.entries(rt.boxes)) {
        const raw = out && out[key];
        const st = Object.assign({}, box.style || {}, inst.plots[key] || {});
        if (inputs.extendRight !== undefined) st.extendRight = !!inputs.extendRight;
        if (inputs.showLabels !== undefined) st.showLabel = !!inputs.showLabels;
        const boxes = [];
        if (Array.isArray(raw)) {
          for (const b of raw) {
            if (!b || !isFinite(b.high) || !isFinite(b.low)) continue;
            boxes.push({
              time: b.time, high: b.high, low: b.low,
              label: b.label || '',
              extendRight: b.extendRight !== undefined ? b.extendRight : (st.extendRight !== false)
            });
          }
        }
        box.pts = boxes;
        box.style = st;
      }
    }
    if (rt.vp) {
      for (const [key, vp] of Object.entries(rt.vp)) {
        const raw = out && out[key];
        const st = Object.assign({}, vp.style || {}, inst.plots[key] || {});
        st.side = inputs.side === 'left' ? 'left' : 'right';
        st.widthPct = isFinite(+inputs.widthPct) ? +inputs.widthPct : 30;
        st.showPoc = inputs.showPoc !== false;
        st.showVa = inputs.showVa !== false;
        st.showLabels = inputs.showLabels === true;
        vp.data = (raw && typeof raw === 'object' && Array.isArray(raw.rows)) ? raw : null;
        vp.style = st;
        vp.inputs = inputs;
      }
    }
  });
  dirty = true;
  if (errorsChanged) renderIndPanel();
}
function syncIndicators(force) {
  const key = currentTimeframe + '|' + indInst.map(i => {
    const on = indicatorActive(i) ? 1 : 0;
    const plotOn = i.plots ? Object.keys(i.plots).map(k => (i.plots[k] && i.plots[k].on === false ? '0' : '1')).join('') : '';
    return i.uid + on + plotOn;
  }).join(',');
  if (force || key !== indActiveKey) {
    indActiveKey = key;
    rebuildIndicators(); // drops series/boxes for indicators outside the TF visibility range
  }
  // Only compute data when something is actually on the chart
  if (indSeries.size) updateIndicatorData();
  else dirty = true; // clear any leftover SVG box/VP drawings
}

// ---- UI helpers
const escHtml = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const anyDialogOpen = () => !!document.querySelector('.dt-dialog[style*="display: block"]');
const IC = {
  eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>'
};
function centerDialog(el, w) { if (!el.style.left) { el.style.left = `${Math.max(12, window.innerWidth / 2 - w / 2)}px`; el.style.top = '80px'; } }

// ---- indicators list ("Indicators" button)
const indPanel = document.createElement('div');
indPanel.className = 'dt-dialog ind-dialog';
document.body.appendChild(indPanel);
function openIndPanel() { indPanel.style.display = 'block'; centerDialog(indPanel, 440); renderIndPanel(); }
function closeIndPanel() { indPanel.style.display = 'none'; indPanel.innerHTML = ''; }
function renderIndPanel() {
  if (indPanel.style.display !== 'block') return;
  const onChart = indInst.map(inst => {
    const rec = indDefs.get(inst.libId) || {}, def = rec.def;
    const lib = allIndicatorLib().find(l => l.id === inst.libId);
    const name = def ? def.name : (lib ? lib.name : 'Indicator');
    const sum = def ? Object.entries(def.inputs).filter(([, v]) => v.type !== 'bool').map(([k]) => inst.inputs[k]).join(', ') : '';
    const err = rec.error || rec.runtimeError;
    const hiddenNote = def && inst.visible && !indicatorActive(inst) ? '<div class="ind-sub">Not shown on this time frame</div>' : '';
    return `<div class="ind-row" data-uid="${inst.uid}">
      <button type="button" class="ind-ico ${inst.visible ? '' : 'off'}" data-act="toggle" title="Show / hide">${IC.eye}</button>
      <div class="ind-main"><div class="ind-name">${escHtml(name)}${sum ? ` <span class="ind-sum">(${escHtml(sum)})</span>` : ''}</div>${hiddenNote}${err ? `<div class="ind-err">${escHtml(err)}</div>` : ''}</div>
      <button type="button" class="ind-ico" data-act="settings" title="Settings">${IC.gear}</button>
      <button type="button" class="ind-ico" data-act="remove" title="Remove from chart">${IC.trash}</button>
    </div>`;
  }).join('') || '<div class="ind-empty">No indicators on the chart yet. Add one from the library below.</div>';
  const lib = allIndicatorLib().map(l => {
    const rec = indDefs.get(l.id) || {};
    return `<div class="ind-row" data-lib="${l.id}">
      <div class="ind-main"><div class="ind-name">${escHtml(l.name)}</div><div class="ind-sub">${l.builtin ? 'Built-in' : 'Custom'}</div>${rec.error ? `<div class="ind-err">${escHtml(rec.error)}</div>` : ''}</div>
      ${rec.def ? '<button type="button" class="dlg-btn" data-act="add">Add</button>' : ''}
      <button type="button" class="ind-ico" data-act="edit" title="${l.builtin ? 'View code / make a copy' : 'Edit code'}">${l.builtin ? IC.code : IC.edit}</button>
      ${l.builtin ? '' : `<button type="button" class="ind-ico" data-act="del" title="Delete indicator">${IC.trash}</button>`}
    </div>`;
  }).join('');
  indPanel.innerHTML = `
    <div class="dlg-head" id="indHead"><span>Indicators</span><button type="button" class="dlg-x" data-act="close">\u2715</button></div>
    <div class="dlg-body">
      <div class="ind-sec">On chart</div>${onChart}
      <div class="ind-sec" style="margin-top:14px">Library</div>${lib}
    </div>
    <div class="dlg-foot"><button type="button" class="dlg-btn cs-reset" data-act="new">+ New indicator</button><button type="button" class="dlg-btn primary" data-act="close">Done</button></div>`;
  attachDrag(indPanel, document.getElementById('indHead'));
}
function addIndicator(libId) {
  const rec = indDefs.get(libId);
  if (!rec || !rec.def) return null;
  const list = tfList();
  const inst = { uid: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), libId, visible: true, from: list[0].tf, to: list[list.length - 1].tf };
  reconcileInstance(inst, rec.def);
  indInst.push(inst);
  saveIndicators(); syncIndicators(true); renderIndPanel();
  return inst;
}
indPanel.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !b.dataset.act) return;
  const act = b.dataset.act, rowEl = b.closest('[data-uid],[data-lib]');
  const uid = rowEl && rowEl.dataset.uid, libId = rowEl && rowEl.dataset.lib;
  if (act === 'close') closeIndPanel();
  else if (act === 'new') openIndEditor(null, null);
  else if (act === 'add') addIndicator(libId);
  else if (act === 'edit') { const l = allIndicatorLib().find(x => x.id === libId); openIndEditor(l.builtin ? null : l.id, l.builtin ? l : null); }
  else if (act === 'del') {
    const l = allIndicatorLib().find(x => x.id === libId);
    if (!confirm(`Delete "${l.name}" and remove it from the chart?`)) return;
    customIndicators = customIndicators.filter(x => x.id !== libId); indDefs.delete(libId);
    indInst = indInst.filter(i => i.libId !== libId);
    saveIndicators(); syncIndicators(true); renderIndPanel();
  } else if (act === 'toggle') {
    const inst = indInst.find(i => i.uid === uid); inst.visible = !inst.visible;
    saveIndicators(); syncIndicators(true); renderIndPanel();
  } else if (act === 'remove') {
    indInst = indInst.filter(i => i.uid !== uid);
    if (indWork && indWork.uid === uid) closeIndDialog(false);
    saveIndicators(); syncIndicators(true); renderIndPanel();
  } else if (act === 'settings') openIndDialog(uid);
});
document.getElementById('indicatorsBtn').addEventListener('click', () => {
  if (indPanel.style.display === 'block') closeIndPanel(); else openIndPanel();
});

// ---- code editor ("+ New indicator")
const indEditor = document.createElement('div');
indEditor.className = 'dt-dialog ind-editor';
document.body.appendChild(indEditor);
let indEditId = null;
function openIndEditor(libId, templateEntry) {
  indEditId = libId;
  const existing = libId ? customIndicators.find(c => c.id === libId) : null;
  const code = existing ? existing.code : templateEntry ? templateEntry.code : BLANK_INDICATOR;
  const title = existing ? 'Edit indicator' : templateEntry ? `New indicator (copy of ${templateEntry.name})` : 'New indicator';
  indEditor.innerHTML = `
    <div class="dlg-head" id="indEdHead"><span>${escHtml(title)}</span><button type="button" class="dlg-x" data-ed="close">\u2715</button></div>
    <div class="dlg-body">
      <div class="ind-note">Paste or write your indicator in <b>JavaScript</b> (it runs directly in the browser). Open <i>API help</i> to see everything you can use.</div>
      <textarea class="ind-code" id="indCode" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
      <div class="ind-err" id="indEdErr" hidden></div>
      <details class="ind-help"><summary>API help</summary><pre>${escHtml(IND_HELP)}</pre></details>
    </div>
    <div class="dlg-foot">
      <select class="dlg-sel cs-reset" id="indTemplate"><option value="">Start from template\u2026</option><option value="__blank">Blank</option>${BUILTIN_INDICATORS.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('')}</select>
      <button type="button" class="dlg-btn" data-ed="close">Cancel</button>
      <button type="button" class="dlg-btn" data-ed="save">Save</button>
      <button type="button" class="dlg-btn primary" data-ed="saveadd">Save &amp; add to chart</button>
    </div>`;
  document.getElementById('indCode').value = code;
  indEditor.style.display = 'block';
  centerDialog(indEditor, 700);
  attachDrag(indEditor, document.getElementById('indEdHead'));
}
function closeIndEditor() { indEditor.style.display = 'none'; indEditor.innerHTML = ''; }
function saveIndEditor(addAfter) {
  const ta = document.getElementById('indCode'), errBox = document.getElementById('indEdErr');
  const fail = (m) => { errBox.hidden = false; errBox.textContent = m; };
  let def;
  try { def = compileIndicatorCode(ta.value); } catch (e) { return fail(`${e.name || 'Error'}: ${e.message}`); }
  const testErr = testRunIndicator(def);
  if (testErr) return fail(testErr);
  let entry = indEditId ? customIndicators.find(c => c.id === indEditId) : null;
  if (entry) { entry.code = ta.value; }
  else { entry = { id: 'c-' + Date.now().toString(36), name: def.name, code: ta.value }; customIndicators.push(entry); }
  compileLib(entry);
  indInst.filter(i => i.libId === entry.id).forEach(i => reconcileInstance(i, indDefs.get(entry.id).def));
  saveIndicators();
  closeIndEditor();
  if (addAfter) addIndicator(entry.id); else { syncIndicators(true); renderIndPanel(); }
}
indEditor.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !b.dataset.ed) return;
  if (b.dataset.ed === 'close') closeIndEditor();
  else saveIndEditor(b.dataset.ed === 'saveadd');
});
indEditor.addEventListener('change', (e) => {
  if (e.target.id !== 'indTemplate' || !e.target.value) return;
  const t = e.target.value === '__blank' ? BLANK_INDICATOR : BUILTIN_INDICATORS.find(b => b.id === e.target.value).code;
  document.getElementById('indCode').value = t;
  e.target.value = '';
});
indEditor.addEventListener('keydown', (e) => { // Tab inserts two spaces inside the code box
  if (e.target.id !== 'indCode' || e.key !== 'Tab') return;
  e.preventDefault();
  const t = e.target, s = t.selectionStart;
  t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
  t.selectionStart = t.selectionEnd = s + 2;
});

// ---- per-indicator settings (inputs / style / visible time frames)
const indDialog = document.createElement('div');
indDialog.className = 'dt-dialog ind-settings';
document.body.appendChild(indDialog);
let indWork = null, indSnap = null, indTab = 'inputs';
function openIndDialog(uid) {
  const inst = indInst.find(i => i.uid === uid), rec = inst && indDefs.get(inst.libId);
  if (!rec || !rec.def) return;
  if (indWork) closeIndDialog(true);
  indWork = inst; indSnap = JSON.parse(JSON.stringify(inst)); indTab = 'inputs';
  renderIndDialog();
  indDialog.style.display = 'block';
  centerDialog(indDialog, 400);
}
function renderIndDialog() {
  const def = indDefs.get(indWork.libId).def, tfs = tfList().map(x => [x.tf, x.label]);
  const inputsHtml = Object.entries(def.inputs).map(([k, i]) => {
    const path = `inputs.${k}`;
    if (i.type === 'bool') return chkRow(path, escHtml(i.label));
    if (i.type === 'select') return row(escHtml(i.label), selBox(path, (i.options || []).map(o => [o, o]), typeof i.value === 'number'));
    if (i.type === 'text') return row(escHtml(i.label), `<input type="text" class="dlg-num" data-k="${path}">`);
    return row(escHtml(i.label), `<input type="number" class="dlg-num" data-k="${path}" step="${i.step !== undefined ? i.step : 'any'}" ${i.min !== undefined ? `min="${i.min}"` : ''} ${i.max !== undefined ? `max="${i.max}"` : ''}>`);
  }).join('') || '<div class="ind-empty">This indicator has no inputs.</div>';
  const styleHtml = Object.entries(def.plots).map(([k, p]) => {
    const pick = (path) => `<button type="button" class="dlg-sw" data-ipick="${path}"><i></i></button>`;
    let ctrl;
    if (p.type === 'histogram') {
      ctrl = pick(`plots.${k}.color`) + pick(`plots.${k}.colorNeg`);
    } else if (p.type === 'box') {
      ctrl = pick(`plots.${k}.fillColor`) + pick(`plots.${k}.borderColor`) +
        `<input type="number" class="dlg-num" data-k="plots.${k}.fillOpacity" min="0" max="1" step="0.01" title="Fill opacity" style="width:58px">` +
        `<input type="number" class="dlg-num" data-k="plots.${k}.borderOpacity" min="0" max="1" step="0.01" title="Border opacity" style="width:58px">`;
    } else if (p.type === 'vp') {
      ctrl = pick(`plots.${k}.color`) + pick(`plots.${k}.vaColor`) + pick(`plots.${k}.pocColor`) +
        `<input type="number" class="dlg-num" data-k="plots.${k}.fillOpacity" min="0" max="1" step="0.05" title="Bar opacity" style="width:58px">`;
    } else {
      ctrl = pick(`plots.${k}.color`) + selBox(`plots.${k}.width`, [[1, '1px'], [2, '2px'], [3, '3px'], [4, '4px']], true) + selBox(`plots.${k}.lineStyle`, [[0, 'Solid'], [2, 'Dashed'], [1, 'Dotted']], true);
    }
    return chkRow(`plots.${k}.on`, escHtml(p.title), ctrl);
  }).join('');
  indDialog.innerHTML = `
    <div class="dlg-head" id="indSetHead"><span>${escHtml(def.name)}</span><button type="button" class="dlg-x" data-is="cancel">\u2715</button></div>
    <div class="dlg-tabs">
      <button type="button" class="dlg-tab" data-istab="inputs">Inputs</button>
      <button type="button" class="dlg-tab" data-istab="style">Style</button>
      <button type="button" class="dlg-tab" data-istab="vis">Visibility</button>
    </div>
    <div class="dlg-body">
      <div class="dlg-pane" data-pane="inputs">${inputsHtml}</div>
      <div class="dlg-pane" data-pane="style">${styleHtml}</div>
      <div class="dlg-pane" data-pane="vis">
        ${chkRow('visible', 'Show on chart')}
        <div class="ind-note">Show this indicator only between these time frames.</div>
        ${row('From', selBox('from', tfs))}
        ${row('To', selBox('to', tfs))}
        <div class="ind-note" id="indVisNote"></div>
      </div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="dlg-btn cs-reset" data-is="defaults">Defaults</button>
      <button type="button" class="dlg-btn" data-is="cancel">Cancel</button>
      <button type="button" class="dlg-btn primary" data-is="ok">Ok</button>
    </div>`;
  showIndTab(indTab);
  syncIndDialog();
  attachDrag(indDialog, document.getElementById('indSetHead'));
}
function showIndTab(k) {
  indTab = k;
  indDialog.querySelectorAll('.dlg-tab').forEach(b => b.classList.toggle('active', b.dataset.istab === k));
  indDialog.querySelectorAll('.dlg-pane').forEach(p => { p.style.display = p.dataset.pane === k ? 'block' : 'none'; });
}
function syncIndDialog() {
  if (!indWork || indDialog.style.display === 'none' && !indDialog.innerHTML) return;
  indDialog.querySelectorAll('[data-k]').forEach(el => {
    const v = getPath(indWork, el.dataset.k);
    if (v === undefined) return;
    if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v;
  });
  indDialog.querySelectorAll('[data-ipick]').forEach(b => { b.firstElementChild.style.background = getPath(indWork, b.dataset.ipick) || '#2962ff'; });
  const list = tfList(), note = document.getElementById('indVisNote');
  if (note) {
    let a = list.findIndex(x => x.tf === indWork.from), b = list.findIndex(x => x.tf === indWork.to);
    if (a > b) [a, b] = [b, a];
    note.textContent = `Shown on: ${list.slice(a, b + 1).map(x => x.label).join(', ')}`;
  }
}
function onIndChanged(path) {
  syncIndDialog();
  if (path.startsWith('inputs.')) updateIndicatorData(); else syncIndicators(true);
}
function closeIndDialog(cancel) {
  if (indWork && cancel && indSnap) { indWork.inputs = indSnap.inputs; indWork.plots = indSnap.plots; indWork.from = indSnap.from; indWork.to = indSnap.to; indWork.visible = indSnap.visible; syncIndicators(true); }
  indWork = null; indSnap = null;
  indDialog.style.display = 'none'; indDialog.innerHTML = ''; closePopup();
  saveIndicators(); renderIndPanel();
}
indDialog.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !indWork) return;
  if (b.dataset.is === 'ok') closeIndDialog(false);
  else if (b.dataset.is === 'cancel') closeIndDialog(true);
  else if (b.dataset.is === 'defaults') {
    const list = tfList();
    indWork.inputs = {}; indWork.plots = {}; indWork.from = list[0].tf; indWork.to = list[list.length - 1].tf;
    reconcileInstance(indWork, indDefs.get(indWork.libId).def);
    syncIndicators(true); renderIndDialog();
  } else if (b.dataset.istab) showIndTab(b.dataset.istab);
  else if (b.dataset.ipick) {
    const path = b.dataset.ipick;
    openColorPicker(b, () => ({ color: getPath(indWork, path) || '#2962ff', opacity: 1 }), (c) => { setPath(indWork, path, c); onIndChanged(path); }, false);
  }
});
function onIndInput(e) {
  const t = e.target, k = t.dataset ? t.dataset.k : null;
  if (!k || !indWork) return;
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (t.type === 'number' || t.dataset.num) { v = parseFloat(t.value); if (!isFinite(v)) return; }
  else v = t.value;
  setPath(indWork, k, v);
  onIndChanged(k);
}
indDialog.addEventListener('input', onIndInput);
indDialog.addEventListener('change', onIndInput);


// ========== KEYBOARD SHORTCUTS ==========
// Alt+T trend | Alt+H hline | Alt+J hray | Alt+V vline | Alt+Shift+S rect | Alt+S short | Alt+D long | Alt+F fib | Alt+R reset
// Ctrl+Z undo | Right-arrow skip 1 candle in replay
function resetChartView() {
  resetPriceScale();
  if (displayLen > 500) chart.timeScale().setVisibleLogicalRange({ from: displayLen - 500, to: displayLen });
  else chart.timeScale().fitContent();
}

// ---- Undo stack (drawings + replay cursor + timeframe) ----
const UNDO_MAX = 40;
let undoStack = [];
function pushUndo(label) {
  try {
    const snap = {
      label: label || 'action',
      drawings: JSON.parse(JSON.stringify(drawings)),
      nextShapeId,
      selectedShapeId,
      currentTimeframe,
      replayTimestamp,
      replayRawIndex
    };
    undoStack.push(snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  } catch (err) { /* ignore */ }
}
function performUndo() {
  if (!undoStack.length) { trToast('Nothing to undo'); return; }
  const snap = undoStack.pop();
  drawings = Array.isArray(snap.drawings) ? snap.drawings : [];
  nextShapeId = snap.nextShapeId || nextShapeId;
  selectedShapeId = snap.selectedShapeId || null;
  dirty = true;
  deselect();
  // Restore timeframe if it changed
  if (snap.currentTimeframe && snap.currentTimeframe !== currentTimeframe) {
    applyTimeframe(snap.currentTimeframe, false, true);
  }
  // Restore replay cursor if it changed
  if (snap.replayTimestamp !== replayTimestamp) {
    replayTimestamp = snap.replayTimestamp;
    replayRawIndex = snap.replayRawIndex != null ? snap.replayRawIndex : -1;
    if (replayTimestamp == null) {
      applyTimeframe(currentTimeframe);
    } else {
      const rebuilt = buildSeriesForView(currentTimeframe);
      candleSeries.setData(rebuilt);
      shownData = rebuilt;
      displayLen = rebuilt.length;
      ctRef = null;
      updateStatusBar(shownData);
      dirty = true;
      scheduleIndicatorSync(80);
      updateGoToLatestBtn();
    }
  }
  schedulePersist();
  trToast('Undo: ' + (snap.label || 'last action'));
}

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
  // Ctrl/Cmd+Z undo
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyZ' && !e.shiftKey) {
    if (typing || ivOpen || anyDialogOpen()) return;
    e.preventDefault();
    performUndo();
    return;
  }
  // Right arrow: skip 1 candle in replay
  if (!typing && !e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'ArrowRight' && replayTimestamp != null) {
    if (ivOpen || anyDialogOpen()) return;
    e.preventDefault();
    pushUndo('replay skip');
    stepReplay(1);
    return;
  }
  if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
  if (typing) return;
  if (ivOpen || anyDialogOpen()) return;
  // e.code is used so the shortcuts also work on keyboard layouts where Alt changes the character
  if (e.code === 'KeyR' && !e.shiftKey) { e.preventDefault(); resetChartView(); return; }
  let tool = null;
  if (e.code === 'KeyS') tool = e.shiftKey ? 'rect' : 'short';
  else if (!e.shiftKey && e.code === 'KeyT') tool = 'line';
  else if (!e.shiftKey && e.code === 'KeyD') tool = 'long';
  else if (!e.shiftKey && e.code === 'KeyF') tool = 'fib';
  else if (!e.shiftKey && e.code === 'KeyH') tool = 'hline';
  else if (!e.shiftKey && e.code === 'KeyJ') tool = 'hray';
  else if (!e.shiftKey && e.code === 'KeyV') tool = 'vline';
  else if (!e.shiftKey && e.code === 'KeyN') tool = 'note';
  if (!tool) return;
  e.preventDefault();
  toggleDrawTool(tool);
});

// ========== FILE UPLOAD ==========
const fileInput = document.getElementById('fileInput');
const fileNameSpan = document.getElementById('fileName');

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const restoreLabel = () => { fileNameSpan.textContent = dataSummary(); fileInput.value = ''; };
  fileNameSpan.textContent = `Parsing ${files.length} file(s)...`;
  await new Promise(r => setTimeout(r, 20));

  const hadData = rawCandles.length > 0;
  const parsed = [];
  for (const file of files) {
    parsed.push({ name: file.name, symbol: symbolFromFileName(file.name), candles: parseNinjaTraderData(await file.text()) });
  }
  const valid = parsed.filter(p => p.candles.length);
  if (!valid.length) { alert('No valid candles found.'); restoreLabel(); return; }

  // daily and intraday data cannot share one cache
  const isDaily = (arr) => typeof arr[0].time === 'string';
  const kinds = new Set(valid.map(p => isDaily(p.candles)));
  if (hadData) kinds.add(isDaily(rawCandles));
  if (kinds.size > 1) {
    alert('Daily data and intraday data cannot be mixed. Press "Clear cache" first, then upload one kind.');
    restoreLabel(); return;
  }

  // sanity checks that would otherwise produce wrong candles
  const warnings = [];
  const syms = [...new Set(valid.map(p => p.symbol).filter(Boolean))];
  const known = hadData && currentSymbol ? currentSymbol : syms[0];
  if (known && syms.some(x => x !== known)) {
    warnings.push(`These files look like different instruments (${[...new Set([known, ...syms])].join(', ')}). Mixing instruments gives wrong candles.`);
  }
  const refStep = hadData ? barStep(rawCandles) : barStep(valid[0].candles);
  const oddSize = valid.filter(p => { const st = barStep(p.candles); return refStep && st && st !== refStep; });
  if (oddSize.length) {
    warnings.push(`Bar size differs from the ${fmtStep(refStep)} data: ${oddSize.map(p => p.name).join(', ')}. Mixing bar sizes gives wrong candles.`);
  }
  if (warnings.length && !confirm(`${warnings.join('\n\n')}\n\nAdd the data anyway?`)) { restoreLabel(); return; }

  let incoming = [];
  for (const p of valid) incoming = mergeCandles(incoming, p.candles); // upload order does not matter
  rawCandles = mergeCandles(rawCandles, incoming);
  if (!currentSymbol && syms[0]) setSymbol(syms[0]);
  tfCache.clear(); rawVer++; trackerCache.clear(); indBoxCache.clear();
  await saveToDB(rawCandles, currentTimeframe);
  applyTimeframe(currentTimeframe);
  schedulePersist();
  restoreLabel();
});

async function clearAllData() {
  if (!rawCandles.length && !drawings.length) return alert('Cache is already empty.');
  if (!confirm('Clear all cached candles, drawings, tool styles and the saved replay position?')) return;

  persistReady = false; clearTimeout(persistTimer);
  if (dlgShapeId !== null) closeDialog(false);
  await clearDB();
  rawCandles = []; tfCache.clear(); currentDataCache = []; displayLen = 0;
  replayTimestamp = null; replayRawIndex = -1; selectingBarMode = false; drawings = []; toolStyles = {}; posSize = null; nextShapeId = 1; setSymbol('');
  deselect();
  document.getElementById('btn-select-bar').classList.remove('active');
  chartContainer.style.cursor = 'default';
  
  candleSeries.setData([]);
  shownData = []; rawVer++; trackerCache.clear(); indBoxCache.clear();
  updateStatusBar([]);
  syncIndicators(false);
  fileNameSpan.textContent = '';
  redrawDrawings();
  lastPersistSig = persistSignature(); persistReady = true;
}

// Candles only: removes the uploaded price data (and the replay position that belongs to it) but keeps
// drawings, tool styles, templates, indicators and the demo account.
async function deleteCandlesFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const st = tx.objectStore(STORE_NAME);
    st.delete('rawCandles'); st.delete('replayTimestamp'); st.delete('symbol');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function clearCandleData() {
  if (!rawCandles.length) return alert('There is no candle data to clear.');
  if (!confirm('Clear all candle data and the replay position?\n\nYour drawings, tool styles, templates and indicators are kept.')) return;
  persistReady = false; clearTimeout(persistTimer);
  if (dlgShapeId !== null) closeDialog(false);
  await deleteCandlesFromDB();
  rawCandles = []; tfCache.clear(); currentDataCache = []; displayLen = 0;
  replayTimestamp = null; replayRawIndex = -1; selectingBarMode = false; setSymbol('');
  deselect();
  document.getElementById('btn-select-bar').classList.remove('active');
  chartContainer.style.cursor = 'default';
  candleSeries.setData([]);
  shownData = []; rawVer++; trackerCache.clear(); indBoxCache.clear();
  updateStatusBar([]);
  syncIndicators(false);
  fileNameSpan.textContent = '';
  redrawDrawings();
  lastPersistSig = persistSignature(); persistReady = true;
  schedulePersist();
  try { trToast('Candle data cleared - drawings kept'); } catch (e) { /* optional */ }
}
(function setupClearMenu() {
  const btn = document.getElementById('clearCacheBtn'), menu = document.getElementById('clearMenu');
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear]');
    if (!b) return;
    menu.hidden = true;
    if (b.dataset.clear === 'candles') clearCandleData(); else clearAllData();
  });
  document.addEventListener('mousedown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) menu.hidden = true;
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) menu.hidden = true; });
})();

async function setTimeframe(tf) {
  if (tf === currentTimeframe) return; // ignore no-op clicks
  pushUndo('timeframe ' + tf);
  applyTimeframe(tf, false, true);
  await saveCurrentTfToDB(tf);
}
document.getElementById('timeframes').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tf]');
  if (btn) setTimeframe(btn.dataset.tf);
});

// ========== DEMO TRADING (paper account: market + limit orders, draggable TP / SL, live P&L, trade arrows) ==========
const TR_STORE = 'onyx.demo.v1';
const TR_START_BALANCE = 100000;
// [dollars per point, tick size] - standard (mini) contract specs
const TR_SPECS = {
  ES: [50, 0.25], NQ: [20, 0.25], YM: [5, 1], RTY: [50, 0.1], MES: [5, 0.25], MNQ: [2, 0.25], MYM: [0.5, 1], M2K: [5, 0.1],
  CL: [1000, 0.01], GC: [100, 0.1], SI: [5000, 0.005], NG: [10000, 0.001], HG: [25000, 0.0005],
  ZB: [1000, 1 / 32], ZN: [1000, 1 / 64], ZF: [1000, 1 / 128], '6E': [125000, 0.00005], '6B': [62500, 0.0001], '6A': [100000, 0.0001], '6C': [100000, 0.00005]
};
const trFresh = () => ({ balance: TR_START_BALANCE, realized: 0, trades: [], orders: [], execs: [], closed: [], actions: [], nextId: 1, showMarkers: true });
function trExecKey(ex) {
  return `${ex.t}|${ex.side}|${ex.qty}|${ex.kind}|${ex.price}`;
}
function trDedupeExecs(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const seen = new Set();
  const out = [];
  for (const ex of list) {
    if (!ex) continue;
    const k = trExecKey(ex);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ex);
  }
  return out;
}
let tr = (() => {
  const d = { ...trFresh(), pv: null, tick: null, qty: 1 };
  try {
    const s = JSON.parse(localStorage.getItem(TR_STORE));
    if (s && typeof s === 'object') {
      const merged = { ...d, ...s };
      if (!Array.isArray(merged.actions)) merged.actions = [];
      if (!Array.isArray(merged.execs)) merged.execs = [];
      if (!Array.isArray(merged.trades)) merged.trades = [];
      if (!Array.isArray(merged.orders)) merged.orders = [];
      if (!Array.isArray(merged.closed)) merged.closed = [];
      if (typeof merged.showMarkers !== 'boolean') merged.showMarkers = true;
      // Older sessions may have duplicated fills after refresh — collapse them once
      merged.execs = trDedupeExecs(merged.execs);
      return merged;
    }
  } catch (e) { /* ignore */ }
  return d;
})();
let trVer = 1, trSaveTimer = null;
function trTouch() { trVer++; clearTimeout(trSaveTimer); trSaveTimer = setTimeout(() => { try { localStorage.setItem(TR_STORE, JSON.stringify(tr)); } catch (e) { /* ignore */ } }, 250); }

// ---------- instrument spec / formatting ----------
function trSpec() {
  const full = String(currentSymbol || '').toUpperCase();
  const sp = TR_SPECS[full] || TR_SPECS[full.replace(/\d+$/, '')];
  return { pv: tr.pv > 0 ? tr.pv : (sp ? sp[0] : 50), tick: tr.tick > 0 ? tr.tick : (sp ? sp[1] : 0.25), known: !!sp };
}
function trDecimals(tick) { let d = 0; while (d < 8 && Math.abs(Math.round(tick * 10 ** d) / 10 ** d - tick) > 1e-10) d++; return d; }
function trSnap(p) { const { tick } = trSpec(); return +(Math.round(p / tick) * tick).toFixed(trDecimals(tick)); }
function trPx(p) { const d = Math.max(2, trDecimals(trSpec().tick)); return Number(p).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function trMoney(v, signed) {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : signed ? '+' : ''}$${s}`;
}
const trCents = (v) => Math.round(v * 100) / 100;

// ---------- market state (replay aware: always the last candle the user can currently see) ----------
function trLastBar() {
  const end = visibleRawEnd();
  if (end <= 0) return null;
  const c = rawCandles[end - 1], t = getComparableTime(c.time);
  return t == null ? null : { t, o: c.open, h: c.high, l: c.low, c: c.close };
}
const trUnrealized = (last) => {
  if (last == null || !tr.trades.length) return 0;
  return tr.trades.reduce((s, t) => s + (last - t.entry) * (t.side === 'long' ? 1 : -1) * t.qty * (t.pv || trSpec().pv), 0);
};

// ---------- account engine ----------
function trExec(t, price, side, qty, kind) { tr.execs.push({ id: tr.nextId++, t, price, side, qty, kind }); }
function trRealize(trade, q, price, t, kind) { // close q contracts of a trade at price
  const pv = trade.pv || trSpec().pv;
  const pnl = (trade.side === 'long' ? price - trade.entry : trade.entry - price) * q * pv;
  tr.balance = trCents(tr.balance + pnl); tr.realized = trCents(tr.realized + pnl);
  trade.qty -= q;
  trExec(t, price, trade.side === 'long' ? 'sell' : 'buy', q, kind);
  // Record fully-closed legs for stats
  if (trade.qty <= 0) {
    if (!Array.isArray(tr.closed)) tr.closed = [];
    const riskPts = (trade.sl != null) ? Math.abs(trade.entry - trade.sl) : null;
    const rewardPts = (trade.tp != null) ? Math.abs(trade.tp - trade.entry) : null;
    tr.closed.push({
      side: trade.side, qty: q, entry: trade.entry, exit: price, pnl,
      kind: kind || 'close', tEntry: trade.t, tExit: t,
      riskPts, rewardPts, pv
    });
  }
  return pnl;
}
function trFill(side, qty, price, t, kind, tp, sl) { // market / limit fill: nets against opposite trades first (oldest first)
  const dir = side === 'buy' ? 'long' : 'short', opp = dir === 'long' ? 'short' : 'long';
  let rem = qty;
  for (const tdr of tr.trades.filter(x => x.side === opp).sort((a, b) => a.id - b.id)) {
    if (rem <= 0) break;
    const q = Math.min(rem, tdr.qty);
    trRealize(tdr, q, price, t, 'close');
    rem -= q;
  }
  tr.trades = tr.trades.filter(x => x.qty > 0);
  if (rem > 0) {
    tr.trades.push({ id: tr.nextId++, side: dir, qty: rem, entry: price, tp: tp == null ? null : tp, sl: sl == null ? null : sl, t, pv: trSpec().pv });
    trExec(t, price, side, rem, kind);
  }
}
function trToast(msg) {
  let el = document.getElementById('trToast');
  if (!el) { el = document.createElement('div'); el.id = 'trToast'; el.className = 'tr-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
function trQty() { const q = Math.floor(+document.getElementById('qtyInput').value); return q >= 1 ? Math.min(q, 10000) : 1; }
function trLog(action) {
  if (!Array.isArray(tr.actions)) tr.actions = [];
  tr.actions.push(action);
}
function trMarket(side) {
  const b = trLastBar();
  if (!b) { trToast('Load some data first'); return; }
  const qty = trQty();
  trLog({ type: 'market', t: b.t, side, qty });
  trFill(side, qty, b.c, b.t, 'market');
  trCursorSync(); trTouch();
}
function trPlaceLimit(side, price) {
  const b = trLastBar();
  if (!b) { trToast('Load some data first'); return; }
  if (side === 'buy' && price >= b.c) { trToast('A buy limit must be below the current price'); return; }
  if (side === 'sell' && price <= b.c) { trToast('A sell limit must be above the current price'); return; }
  const qty = trQty();
  const order = { id: tr.nextId++, side, qty, price, tp: null, sl: null, pv: trSpec().pv, t: b.t };
  tr.orders.push(order);
  trLog({ type: 'limit', t: b.t, side, qty, price, orderId: order.id });
  trTouch();
}
function trCloseTrade(id) {
  const t = tr.trades.find(x => x.id === id), b = trLastBar();
  if (!t || !b) return;
  const side = t.side, q = t.qty, entry = t.entry;
  const pnl = trRealize(t, t.qty, b.c, b.t, 'close');
  tr.trades = tr.trades.filter(x => x.qty > 0); // the trade's TP and SL are part of it, so both are cancelled too
  trLog({ type: 'close', t: b.t, side, entry, qty: q });
  trToast(`Closed ${side.toUpperCase()} ${q} @ ${trPx(b.c)}   ${trMoney(pnl, true)}`);
  trTouch();
}

let trNotes = []; // results of TP / SL fills, shown as one toast after a replay step
// Candle-by-candle matching of TP / SL / limit orders while the replay moves forward.
// If TP and SL are both touched inside one candle the SL is assumed to hit first (conservative).
// Newly opened trades (entry time >= this candle's time) are NOT checked until the NEXT candle,
// matching live behaviour so a market fill at the close cannot instantly exit on the same bar.
function trProcessCandle(c) {
  const t = getComparableTime(c.time);
  if (t == null) return;
  const o = c.open, h = c.high, l = c.low;
  for (const tdr of tr.trades.slice()) {
    // Skip trades opened on this bar (or later). They become eligible starting next bar.
    if (tdr.t != null && getComparableTime(tdr.t) >= t) continue;
    const long = tdr.side === 'long';
    let px = null, kind = null;
    if (tdr.sl != null) {
      if (long ? o <= tdr.sl : o >= tdr.sl) { px = o; kind = 'sl'; }
      else if (long ? l <= tdr.sl : h >= tdr.sl) { px = tdr.sl; kind = 'sl'; }
    }
    if (px === null && tdr.tp != null) {
      if (long ? o >= tdr.tp : o <= tdr.tp) { px = o; kind = 'tp'; }
      else if (long ? h >= tdr.tp : l <= tdr.tp) { px = tdr.tp; kind = 'tp'; }
    }
    if (px !== null) {
      const side = tdr.side, q = tdr.qty;
      const pnl = trRealize(tdr, tdr.qty, px, t, kind); // trade closes completely: its other bracket order (SL or TP) disappears with it
      trNotes.push(`${kind === 'tp' ? 'Take profit' : 'Stop loss'} hit: ${side.toUpperCase()} ${q} closed @ ${trPx(px)}  ${trMoney(pnl, true)}`);
    }
  }
  tr.trades = tr.trades.filter(x => x.qty > 0);
  for (const od of tr.orders.slice()) {
    let px = null;
    if (od.side === 'buy') { if (o <= od.price) px = o; else if (l <= od.price) px = od.price; }
    else { if (o >= od.price) px = o; else if (h >= od.price) px = od.price; }
    if (px !== null) {
      tr.orders = tr.orders.filter(x => x.id !== od.id);
      trFill(od.side, od.qty, px, t, 'limit', od.tp, od.sl); // new trades are first checked on the NEXT candle
    }
  }
}

/** Apply a single user action during rebuild (no extra logging). */
function trApplyLoggedAction(a) {
  if (!a || a.t == null) return;
  if (a.type === 'market') {
    // Fill at the close of the 1m bar at action time (same as live market click)
    const idx = rawIndexAtOrBefore(a.t);
    if (idx < 0) return;
    const c = rawCandles[idx];
    trFill(a.side, a.qty, c.close, a.t, 'market', a.tp, a.sl);
  } else if (a.type === 'limit') {
    tr.orders.push({
      id: tr.nextId++, side: a.side, qty: a.qty, price: a.price,
      tp: a.tp == null ? null : a.tp, sl: a.sl == null ? null : a.sl,
      pv: trSpec().pv, t: a.t
    });
  } else if (a.type === 'close') {
    // Close matching open trade (side + entry) oldest first
    const tdr = tr.trades.find(x => x.side === a.side && x.entry === a.entry && x.qty > 0);
    if (!tdr) return;
    const idx = rawIndexAtOrBefore(a.t);
    if (idx < 0) return;
    const px = rawCandles[idx].close;
    trRealize(tdr, Math.min(a.qty || tdr.qty, tdr.qty), px, a.t, 'close');
    tr.trades = tr.trades.filter(x => x.qty > 0);
  } else if (a.type === 'cancel') {
    if (a.orderId != null) tr.orders = tr.orders.filter(x => x.id !== a.orderId);
    else if (a.side != null && a.price != null) {
      const i = tr.orders.findIndex(x => x.side === a.side && x.price === a.price);
      if (i >= 0) tr.orders.splice(i, 1);
    }
  } else if (a.type === 'brackets') {
    // Restore TP / SL on the matching open trade or pending order
    if (a.owner === 'order' || (a.side === 'buy' || a.side === 'sell')) {
      const od = tr.orders.find(x =>
        (a.orderId != null && x.id === a.orderId) ||
        (x.side === a.side && x.price === a.price)
      );
      if (od) {
        if (a.tp !== undefined) od.tp = a.tp;
        if (a.sl !== undefined) od.sl = a.sl;
        return;
      }
    }
    const tdr = tr.trades.find(x => x.side === a.side && x.entry === a.entry && x.qty > 0);
    if (!tdr) return;
    if (a.tp !== undefined) tdr.tp = a.tp;
    if (a.sl !== undefined) tdr.sl = a.sl;
  }
}

/**
 * Rebuild paper account from scratch up to raw index `end` (exclusive end of visible raw).
 * Actions AFTER the cursor are permanently dropped from the journal — once you rewind
 * past a trade, that trade is gone for good and will not reappear when you skip forward.
 */
function trRebuildTo(end) {
  const allActions = Array.isArray(tr.actions) ? tr.actions.slice() : [];
  const keepPv = tr.pv, keepTick = tr.tick, keepQty = tr.qty, keepShow = tr.showMarkers;
  tr.balance = TR_START_BALANCE;
  tr.realized = 0;
  tr.trades = [];
  tr.orders = [];
  tr.execs = [];
  tr.closed = [];
  tr.nextId = 1;
  trNotes = [];

  const cursorT = end > 0 && rawCandles.length
    ? getComparableTime(rawCandles[Math.min(end, rawCandles.length) - 1].time)
    : null;

  // Keep only actions at or before the cursor; discard anything later
  const applicable = cursorT == null ? [] : allActions.filter(a => a && a.t != null && a.t <= cursorT);
  let ai = 0;
  for (let i = 0; i < end && i < rawCandles.length; i++) {
    const c = rawCandles[i];
    const t = getComparableTime(c.time);
    // Apply all actions whose timestamp falls on or before this bar, then process
    // the bar. Newly opened trades are skipped inside trProcessCandle until the
    // next bar, so a market fill at this bar's close cannot instantly exit here.
    while (ai < applicable.length && applicable[ai].t <= t) {
      trApplyLoggedAction(applicable[ai]);
      ai++;
    }
    trProcessCandle(c);
  }
  while (ai < applicable.length) {
    trApplyLoggedAction(applicable[ai]);
    ai++;
  }

  tr.actions = applicable; // future trades erased from the journal
  tr.pv = keepPv;
  tr.tick = keepTick;
  tr.qty = keepQty;
  tr.showMarkers = keepShow;
  trLastEnd = end;
  trVer++;
  trTouch();
  trMarkSig = ''; // force marker refresh
}

let trLastEnd = -1;
function trCursorSync() { trLastEnd = visibleRawEnd(); }
function trAdvance() {
  const end = visibleRawEnd();
  // Going backward in replay: erase trades / orders / history after the cursor and rebuild
  if (trLastEnd >= 0 && end < trLastEnd) {
    trRebuildTo(end);
    return;
  }
  // First tick after load (or before data exists): lock cursor only.
  // Do NOT replay the action journal here — that would duplicate every fill on each refresh.
  if (trLastEnd < 0) { trLastEnd = end; return; }
  if (end === trLastEnd) return;

  // Going forward: only match TP / SL / resting limits on newly revealed bars.
  // User actions (market / limit / close) are applied at click time and on rebuild after rewind —
  // never again while scrubbing forward (otherwise refresh multiplies arrows).
  const open0 = tr.trades.length + tr.orders.length;
  for (let i = trLastEnd; i < end; i++) {
    if (tr.trades.length || tr.orders.length) trProcessCandle(rawCandles[i]);
  }
  const open1 = tr.trades.length + tr.orders.length;
  if (trNotes.length) { trToast(trNotes.slice(-2).join('   |   ')); trNotes = []; }
  trLastEnd = end;
  // Always touch when size changed (fill/close) so overlay + account panel refresh without a page reload
  if (open1 !== open0 || tr.trades.length || tr.orders.length || tr.execs.length) trTouch();
}

// ---------- trade arrows on the candles ----------
const trMarkers = createSeriesMarkers(candleSeries, []);
let trMarkSig = '';
// Per-timeframe cache of exec.t -> session-aligned key (avoids Intl on every frame)
let trMarkAlignTf = '';
const trMarkAlign = new Map();
function trUpdateMarkers() {
  const data = shownData;
  const show = tr.showMarkers !== false;
  const sig = `${currentTimeframe}|${data ? data.length : 0}|${data && data.length ? data[data.length - 1].time : ''}|${tr.execs.length}|${rawVer}|${show}`;
  if (sig === trMarkSig) return;
  trMarkSig = sig;
  if (!show || !data || !data.length || !tr.execs.length) { trMarkers.setMarkers([]); return; }
  if (trMarkAlignTf !== currentTimeframe) { trMarkAlign.clear(); trMarkAlignTf = currentTimeframe; }
  const first = getComparableTime(data[0].time), last = getComparableTime(data[data.length - 1].time);
  const map = new Map();
  for (const ex of tr.execs) {
    let key = trMarkAlign.get(ex.t);
    if (key === undefined) {
      key = getSessionAlignedKey(ex.t, currentTimeframe);
      trMarkAlign.set(ex.t, key);
    }
    const kc = getComparableTime(key);
    if (kc == null || kc < first || kc > last) continue;
    const kind = (ex.kind === 'tp' || ex.kind === 'sl' || ex.kind === 'close') ? ex.kind : 'fill';
    const id = `${kc}|${ex.side}|${kind}`;
    const prev = map.get(id);
    if (prev) { prev.qty += ex.qty || 0; continue; }
    map.set(id, { time: key, kc, side: ex.side, kind, qty: ex.qty || 0 });
  }
  const out = [...map.values()].sort((a, b) => a.kc - b.kc).map(m => {
    const buy = m.side === 'buy';
    const isExit = m.kind === 'tp' || m.kind === 'sl' || m.kind === 'close';
    const entryBuy = buy;
    return {
      time: m.time,
      position: (isExit ? !entryBuy : entryBuy) ? 'belowBar' : 'aboveBar',
      color: m.kind === 'tp' ? '#089981' : m.kind === 'sl' ? '#f23645' : (entryBuy ? '#2962ff' : '#f23645'),
      shape: (isExit ? !entryBuy : entryBuy) ? 'arrowUp' : 'arrowDown',
      text: m.kind === 'tp' ? 'TP' : m.kind === 'sl' ? 'SL' : m.kind === 'close' ? 'X' : String(m.qty),
      size: 0.8
    };
  });
  trMarkers.setMarkers(out);
}

// ---------- on-chart overlay (order / position lines, chips, price-axis tags) ----------
const tradeSvg = document.createElementNS(SVG_NS, 'svg');
tradeSvg.id = 'trade-overlay';
chartContainer.appendChild(tradeSvg);
const trChipW = (segs) => segs.reduce((w, s) => w + Math.max(18, s.text.length * 5.6 + 10) + 1, 0);
function trChip(parent, x, y, segs, id, owner) {
  let cx = x;
  const g = mk('g', {}, parent);
  segs.forEach((sg) => {
    const w = Math.max(18, sg.text.length * 5.6 + 10);
    const seg = mk('g', sg.kind ? { class: 'tr-hit', 'data-k': sg.kind, 'data-id': id, 'data-o': owner } : {}, g);
    if (sg.tip) mk('title', {}, seg).textContent = sg.tip;
    mk('rect', { x: cx, y: y - 8, width: w, height: 16, rx: 3, fill: sg.bg, stroke: sg.stroke || 'none', 'stroke-dasharray': sg.dash || null }, seg);
    const t = mk('text', { x: cx + w / 2, y: y + 3, 'text-anchor': 'middle', 'font-size': 10, 'font-family': UI_FONT, 'font-weight': 600, fill: sg.fg || '#fff' }, seg);
    t.textContent = sg.text;
    cx += w + 1;
  });
}
function trRender() {
  if (!tr.trades.length && !tr.orders.length) { if (tradeSvg.firstChild) tradeSvg.replaceChildren(); return; }
  const ps = paneSize(), W = chartContainer.clientWidth;
  if (!ps || !(ps.w > 0)) return;
  const last = trLastBar();
  const frag = document.createDocumentFragment();
  const clip = mk('clipPath', { id: 'trClip' }, mk('defs', {}, frag));
  mk('rect', { x: 0, y: 0, width: ps.w, height: ps.h }, clip);
  const lines = mk('g', { 'clip-path': 'url(#trClip)' }, frag), chips = mk('g', {}, frag), tags = mk('g', {}, frag);
  const Y = (p) => candleSeries.priceToCoordinate(p);
  const tag = (y, text, color) => {
    if (y < -8 || y > ps.h + 8) return;
    mk('rect', { x: ps.w + 1, y: y - 8, width: W - ps.w - 2, height: 16, fill: color }, tags);
    const t = mk('text', { x: ps.w + (W - ps.w) / 2, y: y + 3.5, 'text-anchor': 'middle', 'font-size': 10, 'font-family': UI_FONT, fill: '#fff' }, tags);
    t.textContent = text;
  };
  const line = (y, x0, color, dashed, k, id, owner) => {
    mk('line', { x1: x0, y1: y, x2: ps.w, y2: y, stroke: color, 'stroke-width': 1, 'stroke-dasharray': dashed ? '6 4' : null }, lines);
    if (k) mk('line', { x1: x0, y1: y, x2: ps.w, y2: y, stroke: 'transparent', 'stroke-width': 10, class: 'tr-hit', 'data-k': k, 'data-id': id, 'data-o': owner }, lines);
  };
  const zone = (y1, y2, x0, color) => mk('rect', { x: x0, y: Math.min(y1, y2), width: Math.max(0, ps.w - x0), height: Math.abs(y2 - y1), fill: color }, lines);
  const clampX = (x, w) => Math.min(Math.max(x, 8), Math.max(8, ps.w - w - 8));

  // draws one entry (open trade or pending order) with its TP / SL
  const item = (o, owner) => {
    const isTrade = owner === 'trade', long = isTrade ? o.side === 'long' : o.side === 'buy';
    const entry = isTrade ? o.entry : o.price, y = Y(entry);
    if (y === null) return;
    let x0 = 0;
    if (isTrade) { const ex = timeToX(o.t); x0 = Math.min(Math.max(ex == null || !isFinite(ex) ? 0 : ex, 0), ps.w); }
    const dir = long ? 1 : -1, money = (p) => (p - entry) * dir * o.qty * o.pv;
    const col = isTrade ? '#2962ff' : (long ? '#2962ff' : '#f23645');
    const yt = o.tp != null ? Y(o.tp) : null, ys = o.sl != null ? Y(o.sl) : null;
    if (yt !== null) zone(y, yt, x0, 'rgba(8,153,129,0.09)');
    if (ys !== null) zone(y, ys, x0, 'rgba(242,54,69,0.09)');
    line(y, x0, col, !isTrade, isTrade ? null : 'order', o.id, owner);
    if (isTrade) line(y, x0, col, false, 'bracket', o.id, owner); // grab the entry line and drag up / down to place TP / SL
    const cx = isTrade ? x0 + 10 : Math.round(ps.w * 0.12);
    // main chip
    const pnl = isTrade && last ? (last.c - o.entry) * dir * o.qty * o.pv : 0;
    const segs = isTrade
      ? [{ text: `${long ? 'LONG' : 'SHORT'} ${o.qty}`, bg: '#1e222d', fg: '#d1d4dc', kind: 'bracket', tip: 'Drag up / down to place TP / SL' },
         { text: trMoney(pnl, true), bg: pnl >= 0 ? '#089981' : '#f23645', kind: 'bracket', tip: 'Drag up / down to place TP / SL' },
         { text: '\u2715', bg: '#1e222d', fg: '#9aa3b2', kind: 'close', tip: 'Close position at market (also cancels its TP / SL)' }]
      : [{ text: `${long ? 'BUY' : 'SELL'} LMT ${o.qty} @ ${trPx(o.price)}`, bg: col, kind: 'order' }, { text: '\u2715', bg: '#1e222d', fg: '#9aa3b2', kind: 'cancel' }];
    const w = trChipW(segs), x = clampX(cx, w);
    trChip(chips, x, y, segs, o.id, owner);
    const add = [];
    if (o.tp == null) add.push({ text: '+TP', bg: 'rgba(8,153,129,0.15)', fg: '#2bd4b4', stroke: '#089981', dash: '3 2', kind: 'addtp', tip: 'Click for a default take profit, or drag it to a price' });
    if (o.sl == null) add.push({ text: '+SL', bg: 'rgba(242,54,69,0.15)', fg: '#ff7b86', stroke: '#f23645', dash: '3 2', kind: 'addsl', tip: 'Click for a default stop loss, or drag it to a price' });
    if (add.length) trChip(chips, Math.min(x + w + 8, Math.max(8, ps.w - trChipW(add) - 8)), y, add, o.id, owner);
    tag(y, trPx(entry), col);
    [['tp', '#089981', '#0a5c4f', 'TP'], ['sl', '#f23645', '#7a1d27', 'SL']].forEach(([f, c1, c2, lbl]) => {
      if (o[f] == null) return;
      const yy = Y(o[f]);
      if (yy === null) return;
      line(yy, x0, c1, true, f, o.id, owner);
      const s2 = [{ text: `${lbl} ${trPx(o[f])}`, bg: c1, kind: f }, { text: trMoney(money(o[f]), true), bg: c2, kind: f }, { text: '\u2715', bg: '#1e222d', fg: '#9aa3b2', kind: f === 'tp' ? 'rmtp' : 'rmsl' }];
      trChip(chips, clampX(cx, trChipW(s2)), yy, s2, o.id, owner);
      tag(yy, trPx(o[f]), c1);
    });
  };
  tr.orders.forEach(o => item(o, 'order'));
  tr.trades.forEach(t => item(t, 'trade'));
  tradeSvg.replaceChildren(frag);
}

// ---------- dragging TP / SL / limit price ----------
//  * drag a TP / SL chip or line to move it
//  * drag "+TP" / "+SL" to create one at a price (a plain click drops it at a default distance)
//  * drag the position chip or its entry line: up = TP side, down = SL side (a level created by this drag is removed again if you cross over)
// A TP / SL always stays on the correct side of the market: a long's TP above the price, its SL below it (and the reverse for a short).
let trDrag = null;
tradeSvg.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('[data-k]');
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  const k = el.dataset.k, id = +el.dataset.id, o = el.dataset.o;
  const obj = (o === 'trade' ? tr.trades : tr.orders).find(x => x.id === id);
  if (!obj) return;
  if (k === 'close') { trCloseTrade(id); return; }
  if (k === 'cancel') {
    const od = tr.orders.find(x => x.id === id);
    if (od) {
      const b = trLastBar();
      trLog({ type: 'cancel', t: b ? b.t : od.t, orderId: id, side: od.side, price: od.price });
    }
    tr.orders = tr.orders.filter(x => x.id !== id); trTouch(); return;
  }
  if (k === 'rmtp') {
    obj.tp = null;
    trLogBrackets(obj, o);
    trTouch();
    return;
  }
  if (k === 'rmsl') {
    obj.sl = null;
    trLogBrackets(obj, o);
    trTouch();
    return;
  }
  trDrag = { k: k === 'addtp' ? 'tp' : k === 'addsl' ? 'sl' : k, obj, owner: o, creating: k === 'addtp' || k === 'addsl', sy: e.clientY, moved: false, made: { tp: false, sl: false } };
});
// Persist TP / SL so rebuilds (rewinding) restore the brackets and can re-hit them.
function trLogBrackets(obj, owner) {
  if (!obj) return;
  const b = trLastBar();
  const t = b ? b.t : (obj.t || null);
  if (t == null) return;
  if (owner === 'order') {
    trLog({
      type: 'brackets', t, owner: 'order', side: obj.side, price: obj.price,
      orderId: obj.id, tp: obj.tp == null ? null : obj.tp, sl: obj.sl == null ? null : obj.sl
    });
  } else {
    trLog({
      type: 'brackets', t, owner: 'trade', side: obj.side, entry: obj.entry,
      tp: obj.tp == null ? null : obj.tp, sl: obj.sl == null ? null : obj.sl
    });
  }
}
// the price a TP / SL may take: strictly beyond the current market (for an open trade) or the entry (for a pending order)
function trClamp(o, owner, f, price) {
  const tick = trSpec().tick, isTrade = owner === 'trade';
  const long = isTrade ? o.side === 'long' : o.side === 'buy', entry = isTrade ? o.entry : o.price;
  const lb = isTrade ? trLastBar() : null, ref = lb ? lb.c : entry;
  const above = (v) => trSnap((Math.floor(v / tick + 1e-9) + 1) * tick), below = (v) => trSnap((Math.ceil(v / tick - 1e-9) - 1) * tick);
  const up = (f === 'tp') === long; // a long's TP and a short's SL sit above the market
  return up ? Math.max(trSnap(price), above(ref)) : Math.min(trSnap(price), below(ref));
}
function trSetLevel(d, price) {
  const o = d.obj;
  if (d.k === 'order') { // moving a pending order keeps its TP / SL at the same distance
    const delta = price - o.price;
    o.price = price;
    if (o.tp != null) o.tp = trSnap(o.tp + delta);
    if (o.sl != null) o.sl = trSnap(o.sl + delta);
    return;
  }
  if (d.k === 'bracket') { // dragging out of the position itself
    const long = o.side === 'long', f = (price - o.entry) * (long ? 1 : -1) >= 0 ? 'tp' : 'sl', other = f === 'tp' ? 'sl' : 'tp';
    if (d.made[other]) { o[other] = null; d.made[other] = false; }
    if (o[f] == null) d.made[f] = true;
    o[f] = trClamp(o, d.owner, f, price);
    return;
  }
  o[d.k] = trClamp(o, d.owner, d.k, price);
}
document.addEventListener('mousemove', (e) => {
  if (!trDrag) return;
  if (!(trDrag.owner === 'trade' ? tr.trades : tr.orders).includes(trDrag.obj)) { trDrag = null; return; } // closed / filled meanwhile
  if (!trDrag.moved && Math.abs(e.clientY - trDrag.sy) < 3) return;
  trDrag.moved = true;
  const p = candleSeries.coordinateToPrice(e.clientY - chartContainer.getBoundingClientRect().top);
  if (p === null) return;
  trSetLevel(trDrag, trSnap(p));
  trVer++;
});
document.addEventListener('mouseup', () => {
  if (!trDrag) return;
  const d = trDrag; trDrag = null;
  if (d.creating && !d.moved) { // plain click on +TP / +SL: drop it at a sensible default distance
    const o = d.obj, isTrade = d.owner === 'trade', long = isTrade ? o.side === 'long' : o.side === 'buy', entry = isTrade ? o.entry : o.price;
    const lb = isTrade ? trLastBar() : null, ref = lb ? lb.c : entry;
    const dist = Math.max(trSpec().tick * 8, trSnap(entry * 0.003));
    o[d.k] = trClamp(o, d.owner, d.k, ref + (d.k === 'tp' ? 1 : -1) * (long ? 1 : -1) * dist);
  }
  // Always persist the final TP / SL state so a later rebuild can restore them
  // and correctly re-hit exits when replaying forward past this point.
  if (d.moved || d.creating) trLogBrackets(d.obj, d.owner);
  trTouch();
});

// ---------- "+" button on the right edge of the chart: place a limit order at the crosshair price ----------
const trPlus = document.createElement('button');
trPlus.type = 'button'; trPlus.id = 'trPlus'; trPlus.className = 'tr-plus'; trPlus.title = 'Place a limit order at this price'; trPlus.textContent = '+';
chartContainer.appendChild(trPlus);
const trMenu = document.createElement('div');
trMenu.className = 'tr-menu';
chartContainer.appendChild(trMenu);
let trPlusY = null;
function trCloseMenu() { trMenu.style.display = 'none'; }
chartContainer.addEventListener('mousemove', (e) => {
  const r = chartContainer.getBoundingClientRect(), ps = paneSize();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (x >= 0 && x <= ps.w && y >= 0 && y <= ps.h && !currentDrawTool && !e.target.closest('.dt-toolbar, #editToolbar, .tr-menu')) {
    trPlusY = y;
    trPlus.style.display = 'flex'; trPlus.style.left = `${ps.w - 24}px`; trPlus.style.top = `${Math.min(Math.max(y - 10, 0), ps.h - 20)}px`;
  } else if (!trPlus.matches(':hover') && trMenu.style.display !== 'block') trPlus.style.display = 'none';
});
chartContainer.addEventListener('mouseleave', () => { if (!trPlus.matches(':hover') && trMenu.style.display !== 'block') trPlus.style.display = 'none'; });
trPlus.addEventListener('mousedown', (e) => e.stopPropagation());
// Keep the chart crosshair alive while the pointer is over the + button
trPlus.addEventListener('mousemove', (e) => {
  try {
    const r = chartContainer.getBoundingClientRect();
    const y = e.clientY - r.top;
    const x = e.clientX - r.left;
    const price = candleSeries.coordinateToPrice(y);
    const time = xToTime(x);
    if (price != null && time != null && isFinite(price)) {
      chart.setCrosshairPosition(price, time, candleSeries);
    }
  } catch (err) { /* older lightweight-charts builds */ }
});
trPlus.addEventListener('mouseleave', () => {
  try { chart.clearCrosshairPosition(); } catch (err) { /* ignore */ }
});
trPlus.addEventListener('click', (e) => {
  e.stopPropagation();
  if (trMenu.style.display === 'block') { trCloseMenu(); return; }
  const raw = candleSeries.coordinateToPrice(trPlusY == null ? 0 : trPlusY);
  if (raw === null) return;
  const price = trSnap(raw), q = trQty(), ps = paneSize();
  trMenu.innerHTML = `<div class="tr-menu-h">Limit order @ ${trPx(price)}</div>
    <button type="button" class="tr-menu-i buy" data-s="buy">Buy limit &nbsp;${q} @ ${trPx(price)}</button>
    <button type="button" class="tr-menu-i sell" data-s="sell">Sell limit &nbsp;${q} @ ${trPx(price)}</button>`;
  trMenu.dataset.price = price;
  trMenu.style.display = 'block';
  trMenu.style.left = `${Math.max(8, ps.w - 24 - trMenu.offsetWidth - 8)}px`;
  trMenu.style.top = `${Math.min(Math.max(trPlusY - 10, 0), Math.max(0, ps.h - trMenu.offsetHeight))}px`;
});
trMenu.addEventListener('mousedown', (e) => e.stopPropagation());
trMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]');
  if (!b) return;
  trPlaceLimit(b.dataset.s, +trMenu.dataset.price);
  trCloseMenu();
});
document.addEventListener('mousedown', (e) => { if (trMenu.style.display === 'block' && !trMenu.contains(e.target) && e.target !== trPlus) trCloseMenu(); }, true);

// ---------- top bar: Buy / Sell + contracts ----------
const qtyInput = document.getElementById('qtyInput'), sellPx = document.getElementById('sellPx'), buyPx = document.getElementById('buyPx');
qtyInput.value = tr.qty || 1;
qtyInput.addEventListener('change', () => { tr.qty = trQty(); qtyInput.value = tr.qty; trTouch(); });
document.getElementById('buyBtn').addEventListener('click', () => trMarket('buy'));
document.getElementById('sellBtn').addEventListener('click', () => trMarket('sell'));

// ---------- account drop-down ----------
const acctBtn = document.getElementById('acctBtn'), acctBal = document.getElementById('acctBal');
const acctPanel = document.createElement('div');
acctPanel.className = 'tr-panel';
acctPanel.innerHTML = `
  <div class="tr-title">Demo account</div>
  <div class="tr-row"><span>Account balance</span><b id="trpBal"></b></div>
  <div class="tr-row"><span>P&amp;L (open)</span><b id="trpOpen"></b></div>
  <div class="tr-row"><span>Realized P&amp;L</span><b id="trpReal"></b></div>
  <div class="tr-row"><span>Equity</span><b id="trpEq"></b></div>
  <div class="tr-sep"></div>
  <div class="tr-row"><span>Trades</span><b id="trpTrades"></b></div>
  <div class="tr-row"><span>Win rate</span><b id="trpWin"></b></div>
  <div class="tr-row"><span>Avg R:R</span><b id="trpRR"></b></div>
  <div class="tr-sep"></div>
  <div class="tr-row"><span>Point value ($ / point)</span><input id="trpPv" type="number" step="any" min="0"></div>
  <div class="tr-row"><span>Tick size</span><input id="trpTick" type="number" step="any" min="0"></div>
  <div class="tr-row tr-toggle-row"><span>Trade history labels</span><label class="tr-toggle"><input type="checkbox" id="trpMarkers" checked><span class="tr-toggle-ui"></span></label></div>
  <div class="tr-hint" id="trpHint"></div>
  <button type="button" id="trpReset" class="tr-reset">Reset account</button>`;
document.body.appendChild(acctPanel);
const $p = (id) => document.getElementById(id);
function trPanelOpen() { return acctPanel.style.display === 'block'; }
function trToggleAccount() {
  if (trPanelOpen()) { acctPanel.style.display = 'none'; return; }
  const r = acctBtn.getBoundingClientRect();
  acctPanel.style.display = 'block';
  acctPanel.style.top = `${r.bottom + 8}px`;
  acctPanel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - acctPanel.offsetWidth - 8))}px`;
  trUpdateUI(true);
}
acctBtn.addEventListener('click', (e) => { e.stopPropagation(); trToggleAccount(); });
document.addEventListener('mousedown', (e) => { if (trPanelOpen() && !acctPanel.contains(e.target) && !acctBtn.contains(e.target)) acctPanel.style.display = 'none'; }, true);
const trNumInput = (el, key) => el.addEventListener('change', () => { const v = parseFloat(el.value); tr[key] = v > 0 ? v : null; trTouch(); trUpdateUI(true); });
trNumInput($p('trpPv'), 'pv'); trNumInput($p('trpTick'), 'tick');
$p('trpMarkers').addEventListener('change', () => {
  tr.showMarkers = !!$p('trpMarkers').checked;
  trMarkSig = ''; // force refresh
  trTouch();
  trUpdateMarkers();
});
let trResetArm = 0;
$p('trpReset').addEventListener('click', () => {
  const btn = $p('trpReset');
  if (performance.now() - trResetArm > 3000) { trResetArm = performance.now(); btn.textContent = 'Click again to confirm'; btn.classList.add('armed'); setTimeout(() => { btn.textContent = 'Reset account'; btn.classList.remove('armed'); }, 3000); return; }
  trResetArm = 0; btn.textContent = 'Reset account'; btn.classList.remove('armed');
  const keepShow = tr.showMarkers;
  tr = { ...tr, ...trFresh(), pv: tr.pv, tick: tr.tick, qty: tr.qty, showMarkers: keepShow }; // balance/trades/history cleared; keep contract prefs + marker pref
  trCursorSync(); trTouch(); trUpdateUI(true);
  trToast('Account reset to $100,000.00');
});
function trStats() {
  const closed = Array.isArray(tr.closed) ? tr.closed : [];
  const wins = closed.filter(c => c.pnl > 0);
  const losses = closed.filter(c => c.pnl < 0);
  const n = closed.length;                         // every closed trade (shown as "Trades")
  const decided = wins.length + losses.length;     // win rate ignores break-even trades
  if (!decided) return { n, decided: 0, winRate: null, avgRR: null, wins: 0, losses: 0 };
  const winRate = (wins.length / decided) * 100;
  // Average realized R:R = avg win $ / avg loss $ (absolute). Falls back to null if no losses.
  let avgRR = null;
  if (wins.length && losses.length) {
    const avgW = wins.reduce((s, c) => s + c.pnl, 0) / wins.length;
    const avgL = Math.abs(losses.reduce((s, c) => s + c.pnl, 0) / losses.length);
    if (avgL > 0) avgRR = avgW / avgL;
  } else if (wins.length && !losses.length) {
    avgRR = Infinity; // all winners
  }
  return { n, decided, winRate, avgRR, wins: wins.length, losses: losses.length };
}
function trUpdateUI(force) {
  const last = trLastBar();
  // Guard: never report unrealized when the engine has no open trades
  const open = (tr.trades && tr.trades.length) ? trUnrealized(last ? last.c : null) : 0;
  const sp = trSpec();
  acctBal.textContent = trMoney(tr.balance);
  sellPx.textContent = buyPx.textContent = last ? trPx(last.c) : '\u2014';
  if (!trPanelOpen() && !force) return;
  const set = (id, v, cls) => { const el = $p(id); if (!el) return; el.textContent = v; el.className = cls || ''; };
  set('trpBal', trMoney(tr.balance)); set('trpEq', trMoney(tr.balance + open));
  set('trpOpen', trMoney(open, true), open > 0 ? 'pos' : open < 0 ? 'neg' : '');
  set('trpReal', trMoney(tr.realized, true), tr.realized > 0 ? 'pos' : tr.realized < 0 ? 'neg' : '');
  const st = trStats();
  set('trpTrades', st.n ? String(st.n) : '0');
  set('trpWin', st.winRate == null ? '\u2014' : `${st.winRate.toFixed(1)}%` + (st.decided ? ` (${st.wins}W/${st.losses}L)` : ''), st.winRate != null && st.winRate >= 50 ? 'pos' : st.winRate != null ? 'neg' : '');
  set('trpRR', st.avgRR == null ? '\u2014' : !isFinite(st.avgRR) ? '\u221e' : `1 : ${st.avgRR.toFixed(2)}`, st.avgRR != null && st.avgRR >= 1 ? 'pos' : st.avgRR != null ? 'neg' : '');
  if (document.activeElement !== $p('trpPv')) $p('trpPv').value = sp.pv;
  if (document.activeElement !== $p('trpTick')) $p('trpTick').value = sp.tick;
  const mkEl = $p('trpMarkers');
  if (mkEl && document.activeElement !== mkEl) mkEl.checked = tr.showMarkers !== false;
  $p('trpHint').textContent = sp.known ? `Contract specs for ${String(currentSymbol).toUpperCase()} detected.` : 'Unknown symbol - set the point value and tick size of your contract.';
}

// ---------- main loop: matching, overlay, arrows, numbers ----------
let trSig = '', trUiAt = 0;
function trLoop(now) {
  try {
    const openBefore = tr.trades.length + tr.orders.length;
    // Always run advance: early-returns when the cursor has not moved.
    // Skipping it previously left TP/SL unprocessed and the overlay stuck after a close.
    trAdvance();
    const openAfter = tr.trades.length + tr.orders.length;
    // Redraw when something is open, OR when a trade/order just closed (must clear chips)
    if (openAfter || openBefore || trVer) {
      const lr = chart.timeScale().getVisibleLogicalRange();
      const lb = trLastBar();
      const sig = [lr ? lr.from : '', lr ? lr.to : '', trVer, lb ? lb.c : '', currentTimeframe,
        chartContainer.clientWidth, openAfter].join('|');
      if (sig !== trSig) { trSig = sig; trRender(); }
    }
    if (tr.execs.length && tr.showMarkers !== false) trUpdateMarkers();
    // Force account UI refresh immediately after a fill/close
    if (openAfter !== openBefore || trNotes.length) {
      trUpdateUI(true);
      trUiAt = now;
    } else if (now - trUiAt > 200) {
      trUiAt = now;
      trUpdateUI(false);
    }
  } catch (e) { /* never let the trading layer break the chart */ }
  requestAnimationFrame(trLoop);
}
requestAnimationFrame(trLoop);


// ========== ONE-TIME INTRADAY TIMESTAMP MIGRATION ==========
// Older builds persisted NinjaTrader close-stamped minute bars without converting
// them to bar-open timestamps. Shift stored candles and their time-anchored state
// back by one minute exactly once; new uploads are normalized in parseTimeField().
async function migrateCloseStampedTimestamps(st) {
  if ((st.timestampFixVersion || 0) >= 1) return st;
  const candles = Array.isArray(st.candles) ? st.candles.map(c =>
    c && typeof c.time === 'number' ? { ...c, time: c.time - 60 } : c
  ) : [];
  const drawings = Array.isArray(st.drawings) ? st.drawings.map(d => {
    if (!d || typeof d !== 'object') return d;
    const out = { ...d };
    for (const k of ['p1', 'p2']) {
      if (out[k] && typeof out[k].time === 'number') out[k] = { ...out[k], time: out[k].time - 60 };
    }
    return out;
  }) : st.drawings;
  const replayTs = typeof st.replayTs === 'number' ? st.replayTs - 60 : st.replayTs;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(candles, 'rawCandles');
    if (drawings !== undefined) store.put(drawings, 'drawings');
    if (replayTs !== undefined) store.put(replayTs, 'replayTimestamp');
    store.put(1, 'timestampFixVersion');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return { ...st, candles, drawings, replayTs, timestampFixVersion: 1 };
}

// ========== INITIALIZE ==========
async function init() {
  try {
    let st = await loadFromDB();
    st = await migrateCloseStampedTimestamps(st);
    rawCandles = ensureAscending(st.candles); currentTimeframe = st.tf;
    setSymbol(st.symbol);
    if (st.posSize && st.posSize.tp > 0 && st.posSize.sl > 0 && st.posSize.bars > 0) posSize = st.posSize;
    if (Array.isArray(st.drawings)) drawings = st.drawings.filter(d => d && d.tool && d.p1 && d.p2).map(ensureVis);
    if (st.toolStyles && typeof st.toolStyles === 'object') toolStyles = st.toolStyles;
    nextShapeId = Math.max(drawings.reduce((m, d) => Math.max(m, d.id || 0), 0) + 1, st.nextShapeId || 1);
    if (rawCandles.length && typeof st.replayTs === 'number') replayTimestamp = st.replayTs; // resume replay where it was
    document.querySelectorAll('.timeframes button').forEach(btn => btn.classList.toggle('active', btn.dataset.tf === currentTimeframe));
    if (rawCandles.length) {
      applyTimeframe(currentTimeframe);
      fileNameSpan.textContent = dataSummary();
      // Lock the trading engine to the current visible end so refresh does not
      // re-play the whole action journal and multiply fill markers.
      try { trCursorSync(); } catch (e) { /* trading may init after */ }
    }
  } catch (err) { console.error('Failed to load DB:', err); }
  updateStatusBar(currentDataCache);
  try { trCursorSync(); } catch (e) { /* ignore */ }
  // Force indicators to build after data is ready
  if (indInst.length) {
    try { syncIndicators(true); } catch (e) { console.error('Indicator sync failed', e); }
  }
  dirty = true;
  lastPersistSig = persistSignature();
  persistReady = true;
}
init();