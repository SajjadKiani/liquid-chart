import './style.css';
import { ChartEngine, formatPrice } from './engine.ts';
import type { ChartOptions } from './engine.ts';
import { generateCandles, instruments, intervals } from './demo.ts';
import { binanceSymbols, connectBinance, fetchBinanceOlder } from './binance.ts';
import { createHistoryPager } from './history.ts';
import type { Drawing, Tool } from './model.ts';

const icons: Record<string, string> = {
  cursor: '<path d="m5 3 13 9-7 1-3 7z"/>',
  trend: '<path d="m4 17 16-12"/><circle cx="4" cy="17" r="2"/><circle cx="20" cy="5" r="2"/>',
  horizontal: '<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  candles: '<path d="M6 3v4m0 10v4M18 3v8m0 6v4"/><rect x="3" y="7" width="6" height="10" rx="1"/><rect x="15" y="11" width="6" height="6" rx="1"/>',
  line: '<path d="m3 17 6-7 5 3 7-9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="LiquidChart home"><span class="brand-mark"><i></i><i></i><i></i></span>liquidchart<span class="brand-dot">.</span></a>
    <nav class="topnav" aria-label="Workspace"><span class="nav-active">Workspace</span><span class="workspace-label">Personal workspace</span></nav>
    <div class="top-right"><span class="demo-badge" id="data-badge"><i></i> SIMULATED DATA</span><button id="help" class="icon-button" aria-label="Chart controls and help">${icon('help')}</button><span class="avatar" aria-label="Local workspace">LC</span></div>
  </header>
  <div class="workspace">
    <aside class="sidebar">
      <div class="sidebar-heading"><div><span class="eyebrow">YOUR MARKETS</span><h2>Watchlist <span>04</span></h2></div><span class="list-mark">≡</span></div>
      <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="search" placeholder="Find a market" aria-label="Search watchlist"/><kbd>/</kbd></label>
      <div class="watch-labels"><span>ASSET</span><span>PRICE / CHANGE</span></div>
      <div id="watchlist">${instruments.map((s, i) => `<button class="market ${i === 0 ? 'selected' : ''}" data-symbol="${i}" aria-pressed="${i === 0}"><span class="coin" style="--coin:${s.color}">${s.tag.slice(0, 1)}</span><span class="market-name"><strong>${s.tag}</strong><small>${s.name}</small></span><span class="market-price"><strong data-price="${i}">${formatPrice(s.base)}</strong><small data-change="${i}">Demo feed</small></span></button>`).join('')}</div>
      <p id="no-results" hidden>No matching markets.</p>
      <div class="sidebar-note"><span class="eyebrow">MAKE IT YOURS</span><h3>Your market.<br/>Your perspective.</h3><p>Adjust your chart, mark a level, or bring your own candle data.</p><button id="sidebar-import" class="text-button">Import candle data <span>↗</span></button></div>
      <div class="sidebar-footer"><span class="status-dot"></span> Local workspace <span class="version">v0.1</span></div>
    </aside>
    <main class="main">
      <div class="source-controls"><label for="data-source">Data source</label><select id="data-source"><option value="binance">Binance spot</option><option value="demo">Demo</option><option value="imported" disabled hidden>Imported file</option></select><span id="source-status" role="status" aria-live="polite">Starting…</span><button id="retry-feed" class="text-button" hidden>Retry</button></div>
      <div id="history-info" class="history-controls" hidden><span id="history-status" role="status" aria-live="polite"></span><button id="retry-history" class="text-button" hidden>Retry history</button></div>
      <section class="market-header" aria-label="Selected market">
        <div class="market-title"><span class="eyebrow">MARKET OVERVIEW</span><div class="title-line"><h1 id="symbol-title">Bitcoin <span>BTC / USD</span></h1><span class="asset-tag" id="asset-tag">CRYPTO</span></div><p id="source-description">Synthetic prices · independent chart workspace</p></div>
        <div class="quote"><div id="latest-price">64,218.00 <span>USD</span></div><div id="latest-change" class="positive">+0.00% <span>last candle</span></div></div>
      </section>
      <section class="chart-panel" aria-label="Chart workspace">
        <div class="chart-toolbar">
          <div class="timeframes" aria-label="Chart timeframe">${intervals.map(t => `<button data-interval="${t.label}" class="${t.label === '1h' ? 'active' : ''}" aria-pressed="${t.label === '1h'}">${t.label}</button>`).join('')}</div>
          <span class="toolbar-divider"></span>
          <div class="chart-types" aria-label="Chart type"><button id="candles" class="icon-button active" aria-label="Candlestick chart" aria-pressed="true" title="Candlesticks">${icon('candles')}</button><button id="line" class="icon-button" aria-label="Line chart" aria-pressed="false" title="Line chart">${icon('line')}</button></div>
          <button id="ma-toggle" class="indicator-button active" aria-pressed="true"><span class="ma-dot"></span> MA 20</button>
          <div class="toolbar-spacer"></div>
          <button id="live-toggle" class="live-button" aria-pressed="true" title="Simulated updates; a new candle every 10 seconds"><span class="status-dot"></span> <span id="live-label">Live demo</span></button>
          <button id="settings-toggle" class="settings-button" aria-expanded="false" aria-controls="settings">${icon('settings')} <span>Style</span></button>
          <button id="export" class="icon-button" aria-label="Export candle data as JSON" title="Export JSON">${icon('download')}</button>
        </div>
        <div class="chart-body">
          <div class="drawing-toolbar" aria-label="Drawing tools">
            <button data-tool="cursor" class="tool-button active" aria-label="Cursor and pan tool" aria-pressed="true" title="Cursor / pan">${icon('cursor')}</button>
            <button data-tool="trend" class="tool-button" aria-label="Draw trendline using two clicks" aria-pressed="false" title="Trendline · click two points">${icon('trend')}</button>
            <button data-tool="horizontal" class="tool-button" aria-label="Draw horizontal price level" aria-pressed="false" title="Horizontal level">${icon('horizontal')}</button>
            <span class="tool-divider"></span>
            <button id="clear-drawings" class="tool-button" aria-label="Clear drawings for this chart" title="Clear drawings">${icon('trash')}</button>
            <div class="tool-spacer"></div>
            <button id="reset-view" class="tool-button" aria-label="Reset chart view" title="Reset view">${icon('reset')}</button>
          </div>
          <div class="chart-content">
            <div class="ohlc-row"><span id="chart-symbol">BTC/USD</span><span class="ohlc-divider">·</span><span id="chart-interval">1h</span><div class="ohlc-values" id="ohlc"></div></div>
            <div id="chart" class="chart-stage"></div>
            <div class="chart-watermark" aria-hidden="true">liquidchart<span>.</span></div>
            <div class="view-controls"><button id="zoom-out" aria-label="Zoom out">${icon('minus')}</button><button id="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button id="follow" title="Follow latest candle">Go to latest <span>→</span></button></div>
          </div>
          <div id="settings" class="settings-popover" hidden>
            <div class="popover-title"><strong>Chart style</strong><button id="settings-close" aria-label="Close style settings">×</button></div>
            <p>A workspace that feels like you.</p>
            <label class="scale-setting"><span>Price scale</span><select id="price-scale"><option value="linear">Linear</option><option value="log">Logarithmic</option></select></label>
            <p id="scale-note" class="scale-note" hidden>Log scale requires strictly positive prices. This dataset uses a linear scale.</p>
            <label class="color-setting">Chart background <input type="color" id="background-color" value="#141b1e" /></label>
            <label class="color-setting">Grid color <input type="color" id="grid-color" value="#20282b" /></label>
            <label class="color-setting">Up candle body <input type="color" id="up-color" value="#5cc9af" /></label>
            <label class="color-setting">Up candle border <input type="color" id="up-border-color" value="#5cc9af" /></label>
            <label class="color-setting">Down candle body <input type="color" id="down-color" value="#dc7883" /></label>
            <label class="color-setting">Down candle border <input type="color" id="down-border-color" value="#dc7883" /></label>
            <label class="check-setting"><span>Volume bars</span><input id="volume-toggle" type="checkbox" checked /></label>
            <label class="check-setting"><span>Moving average</span><input id="ma-setting" type="checkbox" checked /></label>
            <button id="restore-colors" class="secondary-button">Restore default colors</button>
          </div>
        </div>
        <footer class="chart-footer"><span id="interaction-hint">Drag plot to pan · Drag axes to zoom</span><span id="bar-count"></span><button id="auto-price" class="scale-toggle active" aria-label="Automatically fit price range" aria-pressed="true" title="Fit visible prices · A">Auto</button><button id="log-toggle" class="scale-toggle" aria-label="Logarithmic price scale" aria-pressed="false" title="Log scale: equal percentage changes have equal vertical spacing">Log</button><span>UTC</span></footer>
      </section>
      <section class="below-chart">
        <div class="range-card"><span class="eyebrow">RECENT 50 CANDLES</span><div class="range-stats"><div><small>High</small><strong id="range-high">—</strong></div><div><small>Low</small><strong id="range-low">—</strong></div><div><small>Volume</small><strong id="range-volume">—</strong></div><div><small>Drawings</small><strong id="drawing-count">0</strong></div></div></div>
        <div class="data-card"><span class="data-icon">${icon('upload')}</span><div><strong>Bring your own market</strong><p>Import OHLCV candles as JSON.</p></div><button id="import" class="secondary-button">Import data ↗</button><button id="demo-data" class="text-button" hidden>Return to demo</button></div>
      </section>
      <div class="workspace-footer"><span id="data-notice"><i class="status-dot"></i> All prices are simulated. No market connection.</span><span id="clock"></span></div>
    </main>
  </div>
  <input id="file-input" type="file" accept="application/json,.json" hidden />
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="help-dialog"><div class="dialog-heading"><span class="eyebrow">QUICK GUIDE</span><button id="help-close" aria-label="Close help">×</button></div><h2>Find your perspective.</h2><dl><dt>Pan & zoom</dt><dd>Drag the chart to move time and price together. Pan past the latest candle to reveal space on its right. Scroll to zoom; Shift-scroll moves time. Drag up/down or scroll on the right price axis to zoom vertically. Drag right/left or scroll on the bottom time axis to zoom horizontally. Alt-scroll on the plot moves prices. Double-click an axis to reset it. Auto fits visible prices again. Double-click resets both axes.</dd><dt>Price scale</dt><dd>Use Log in the chart footer or Style → Price scale. Equal percentage moves have equal vertical spacing. Log mode requires positive prices; zero or negative data uses the linear scale.</dd><dt>Drawing tools</dt><dd>Select a trendline and click two points. Select a price level and click once. Escape returns to the cursor. Drawings are saved for each market and timeframe in this browser.</dd><dt>Keyboard</dt><dd>Focus the chart: ← / → move time, ↑ / ↓ move prices, + / − zoom, Home follows the latest candle, and A fits prices.</dd><dt>Your data</dt><dd>Import a JSON array of candles with time (UTC milliseconds), open, high, low, close, and optional volume. Imports pause the simulation.</dd><dt>Market data</dt><dd>Select Binance spot for live USDT candles, or Demo for synthetic candles. Pause stops live updates; resume refreshes history. Pan left to load earlier Binance candles in pages. Only the selected market streams. Binance access depends on your network.</dd><dt>Live demo</dt><dd>Demo prices are synthetic. The accelerated simulator updates every second and opens a new candle every 10 seconds. This is not an exchange feed.</dd></dl></dialog>
`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const chart = new ChartEngine(el('chart'));
let selected = 0;
let interval = intervals[3];
let running = true;
let imported = false;
let source: 'demo' | 'binance' = 'demo';
let displayedSource: 'demo' | 'binance' | 'imported' = 'demo';
let displayedSelected = selected;
let displayedInterval = interval;
let feed: ReturnType<typeof connectBinance> | undefined;
let feedGeneration = 0;
let history: ReturnType<typeof createHistoryPager> | undefined;
let tick = 0;
let toastTimer: ReturnType<typeof setTimeout>;
const priceCache = instruments.map(s => s.base);

function toast(message: string): void {
  el('toast').textContent = message;
  el('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, 4200);
}

function readStorage(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function saveStorage(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Browser storage is unavailable. Changes will last for this session.'); }
}
// Retain the original storage namespace so existing preferences and drawings survive the rename.
const drawingKey = () => displayedSource === 'binance'
  ? `liquidchart.drawings.binance.${binanceSymbols[displayedSelected]}.${displayedInterval.label}`
  : `chartroom.drawings.${imported ? 'custom' : instruments[displayedSelected].symbol}.${displayedInterval.label}`;
function loadDrawings(): void {
  const value = readStorage(drawingKey());
  const anchorValid = (a: unknown): boolean => {
    if (!a || typeof a !== 'object') return false;
    const p = a as Record<string, unknown>;
    return typeof p.time === 'number' && Number.isFinite(p.time) && typeof p.price === 'number' && Number.isFinite(p.price);
  };
  const drawings = Array.isArray(value) ? value.filter(d => d && typeof d.id === 'string' && ['trend', 'horizontal'].includes(d.kind) && anchorValid(d.a) && anchorValid(d.b)).slice(0, 1000) as Drawing[] : [];
  chart.setDrawings(drawings);
}
chart.onDrawingsChange = drawings => { if (!imported) saveStorage(drawingKey(), drawings); };

function saveOptions(): void { saveStorage('chartroom.options', chart.options); }
function syncScale(): void {
  const log = chart.priceScale === 'log';
  const available = chart.store.supportsLogScale;
  const button = el<HTMLButtonElement>('log-toggle');
  button.classList.toggle('active', log);
  button.setAttribute('aria-pressed', String(log));
  button.disabled = !available;
  button.title = available ? 'Log scale: equal percentage changes have equal vertical spacing' : 'Log scale requires strictly positive prices';
  // Keep the preference selectable even while the active dataset forces linear.
  el<HTMLSelectElement>('price-scale').value = chart.options.priceScale;
  el<HTMLSelectElement>('price-scale').querySelector<HTMLOptionElement>('[value="log"]')!.disabled = !available;
  el('scale-note').hidden = available || chart.store.candles.length === 0;
}
function syncOptions(): void {
  syncScale();
  el<HTMLInputElement>('background-color').value = chart.options.backgroundColor;
  el<HTMLInputElement>('grid-color').value = chart.options.gridColor;
  el('chart').parentElement!.style.backgroundColor = chart.options.backgroundColor;
  el<HTMLInputElement>('up-color').value = chart.options.upColor;
  el<HTMLInputElement>('down-color').value = chart.options.downColor;
  el<HTMLInputElement>('up-border-color').value = chart.options.upBorderColor;
  el<HTMLInputElement>('down-border-color').value = chart.options.downBorderColor;
  el<HTMLInputElement>('volume-toggle').checked = chart.options.showVolume;
  el<HTMLInputElement>('ma-setting').checked = chart.options.showMA;
  el('ma-toggle').classList.toggle('active', chart.options.showMA);
  el('ma-toggle').setAttribute('aria-pressed', String(chart.options.showMA));
  for (const type of ['candles', 'line']) {
    el(type).classList.toggle('active', chart.options.style === type);
    el(type).setAttribute('aria-pressed', String(chart.options.style === type));
  }
}
const saved = readStorage('chartroom.options');
if (saved && typeof saved === 'object') {
  const s = saved as Partial<ChartOptions>;
  const options: Partial<ChartOptions> = {};
  for (const key of ['backgroundColor', 'gridColor'] as const) {
    const value = s[key];
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) options[key] = value;
  }
  if (typeof s.upColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.upColor)) options.upColor = s.upColor;
  if (typeof s.downColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.downColor)) options.downColor = s.downColor;
  // Older preferences have only body colors; retain their previous appearance.
  options.upBorderColor = typeof s.upBorderColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.upBorderColor) ? s.upBorderColor : options.upColor ?? chart.options.upBorderColor;
  options.downBorderColor = typeof s.downBorderColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.downBorderColor) ? s.downBorderColor : options.downColor ?? chart.options.downBorderColor;
  if (typeof s.showVolume === 'boolean') options.showVolume = s.showVolume;
  if (typeof s.showMA === 'boolean') options.showMA = s.showMA;
  if (s.style === 'line' || s.style === 'candles') options.style = s.style;
  if (s.priceScale === 'linear' || s.priceScale === 'log') options.priceScale = s.priceScale;
  chart.configure(options);
}
syncOptions();

function setRunning(value: boolean): void {
  running = value && !imported;
  el('live-label').textContent = imported ? 'Imported data' : running ? source === 'binance' ? 'Live Binance' : 'Live demo' : 'Paused';
  el('live-toggle').classList.toggle('paused', !running);
  el('live-toggle').setAttribute('aria-pressed', String(running));
  el<HTMLButtonElement>('live-toggle').disabled = imported;
}

function refreshQuote(): void {
  const candles = chart.store.candles;
  const last = candles[candles.length - 1];
  if (!last) return;
  const change = last.open === 0 ? 0 : (last.close - last.open) / Math.abs(last.open) * 100;
  el('latest-price').innerHTML = `${formatPrice(last.close)} <span>${displayedSource === 'imported' ? '' : displayedSource === 'binance' ? 'USDT' : 'USD'}</span>`;
  el('latest-change').innerHTML = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% <span>last candle</span>`;
  el('latest-change').className = change >= 0 ? 'positive' : 'negative';
  const recent = candles.slice(-50);
  let high = -Infinity, low = Infinity, volume = 0;
  for (const c of recent) { high = Math.max(high, c.high); low = Math.min(low, c.low); volume += c.volume; }
  el('range-high').textContent = formatPrice(high);
  el('range-low').textContent = formatPrice(low);
  el('range-volume').textContent = Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(volume);
  if (!imported) {
    priceCache[displayedSelected] = last.close;
    document.querySelector(`[data-price="${displayedSelected}"]`)!.textContent = formatPrice(last.close);
    const watchChange = document.querySelector(`[data-change="${displayedSelected}"]`)!;
    watchChange.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    watchChange.className = change >= 0 ? 'positive' : 'negative';
  }
}

function stopFeed(): void {
  feedGeneration++;
  feed?.stop(); feed = undefined;
}

function stopHistory(): void {
  history?.stop(); history = undefined;
  el('history-info').hidden = true;
}

function ensureHistory(): void {
  if (history || displayedSource !== 'binance') return;
  const symbol = binanceSymbols[displayedSelected];
  const label = displayedInterval.label;
  el('history-info').hidden = false;
  el('history-status').textContent = 'Scroll left to load earlier candles';
  el('retry-history').hidden = true;
  history = createHistoryPager({
    oldestTime: () => chart.store.candles[0]?.time,
    fetchPage: (before, signal) => fetchBinanceOlder(symbol, label, before, signal),
    prepend: candles => chart.prependData(candles),
    onStatus(status) {
      el('history-status').textContent = status.message;
      el('retry-history').hidden = status.state !== 'error';
      el<HTMLButtonElement>('retry-history').disabled = !status.canRetry;
    },
  });
}

function commitMarket(mode: 'demo' | 'binance'): void {
  const changedSource = displayedSource !== mode;
  displayedSource = mode;
  displayedSelected = selected;
  displayedInterval = interval;
  imported = false;
  const instrument = instruments[selected];
  chart.setTool('cursor');
  loadDrawings();
  const symbol = mode === 'binance' ? `${instrument.tag}/USDT` : instrument.symbol;
  el('symbol-title').innerHTML = `${instrument.name} <span>${symbol.replace('/', ' / ')}</span>`;
  el('chart-symbol').textContent = symbol;
  el('chart-interval').textContent = interval.label;
  el('source-description').textContent = mode === 'binance' ? 'Binance spot · USDT pairs · UTC candles' : 'Synthetic prices · independent chart workspace';
  el('data-badge').innerHTML = mode === 'binance' ? '<i></i> BINANCE SPOT' : '<i></i> SIMULATED DATA';
  el('data-notice').textContent = mode === 'binance' ? 'Binance spot data · Only the selected market streams.' : 'All prices are simulated. No market connection.';
  el('asset-tag').hidden = false;
  el('demo-data').hidden = true;
  document.querySelectorAll<HTMLButtonElement>('[data-symbol]').forEach(button => {
    const isSelected = Number(button.dataset.symbol) === selected;
    button.classList.toggle('selected', isSelected); button.setAttribute('aria-pressed', String(isSelected));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-interval]').forEach(button => {
    const isSelected = button.dataset.interval === interval.label;
    button.classList.toggle('active', isSelected); button.setAttribute('aria-pressed', String(isSelected));
  });
  for (const [i, s] of instruments.entries()) {
    if (changedSource) document.querySelector(`[data-price="${i}"]`)!.textContent = mode === 'binance' ? '—' : formatPrice(s.base);
    document.querySelector(`[data-change="${i}"]`)!.textContent = mode === 'binance' ? 'Not streaming' : 'Demo feed';
  }
  tick = 0;
  refreshQuote();
}

function loadMarket(): void {
  stopFeed();
  if (source !== 'binance' || displayedSource !== 'binance' || displayedSelected !== selected || displayedInterval.label !== interval.label) stopHistory();
  el<HTMLSelectElement>('data-source').value = source;
  if (source === 'demo') {
    chart.setData(generateCandles(instruments[selected].base, interval.ms));
    commitMarket('demo'); setRunning(true);
    el('source-status').textContent = 'Simulated candles';
    el('retry-feed').hidden = true;
    el('live-toggle').title = 'Simulated updates; a new candle every 10 seconds';
    return;
  }
  setRunning(false);
  el<HTMLButtonElement>('live-toggle').disabled = false;
  el('live-toggle').title = 'Pause or resume Binance live candle updates';
  const generation = feedGeneration;
  let initialized = !imported && displayedSource === 'binance' && displayedSelected === selected && displayedInterval.label === interval.label;
  const pair = `${instruments[selected].tag}/USDT`;
  feed = connectBinance({
    symbol: binanceSymbols[selected], interval: interval.label,
    onHistory(candles) {
      if (generation !== feedGeneration) return;
      if (!initialized) { chart.setData(candles); commitMarket('binance'); initialized = true; }
      else for (const candle of candles) chart.update(candle);
      ensureHistory();
      refreshQuote();
    },
    onCandle(candle) {
      if (generation !== feedGeneration || !initialized) return;
      chart.update(candle); refreshQuote();
    },
    onStatus(status, message) {
      if (generation !== feedGeneration) return;
      setRunning(status === 'live');
      el<HTMLButtonElement>('live-toggle').disabled = false;
      el('live-label').textContent = status === 'live' ? 'Live Binance' : status === 'error' ? 'Unavailable' : status === 'retrying' ? 'Reconnecting' : 'Connecting';
      el('retry-feed').hidden = status !== 'error' && status !== 'retrying';
      const retained = displayedSource === 'demo' ? 'Showing paused demo candles.' : displayedSource === 'imported' ? 'Showing imported candles.' : 'Showing last Binance snapshot.';
      el('source-status').textContent = `${pair} · ${message}${status === 'live' ? '' : ` ${retained}`}`;
      if (displayedSource === 'binance') el('data-notice').textContent = status === 'live' ? 'Binance spot data · Only the selected market streams.' : 'Binance data is not live. Waiting for connection.';
    },
  });
}

chart.subscribe(state => {
  if (displayedSource === 'binance' && source === 'binance' && displayedSelected === selected && displayedInterval.label === interval.label && !state.following) history?.consider(state.firstVisibleIndex, state.visible);
  syncScale();
  el('auto-price').classList.toggle('active', state.autoPrice);
  el('auto-price').setAttribute('aria-pressed', String(state.autoPrice));
  if (state.candle) {
    const c = state.candle;
    el('ohlc').innerHTML = ['open', 'high', 'low', 'close'].map((key, i) => `<span><small>${['O', 'H', 'L', 'C'][i]}</small><b class="${c.close >= c.open ? 'positive' : 'negative'}">${formatPrice(c[key as keyof typeof c])}</b></span>`).join('');
  } else el('ohlc').textContent = '';
  el('bar-count').textContent = `${chart.store.candles.length.toLocaleString()} bars`;
  el('drawing-count').textContent = String(state.drawings);
  el('follow').classList.toggle('following', state.following);
  el('follow').setAttribute('aria-pressed', String(state.following));
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const hint = state.tool === 'trend' ? 'Trendline: click a start point, then an end point · Esc to finish'
    : state.tool === 'horizontal' ? 'Price level: click anywhere on the price chart · Esc to finish'
    : !state.autoPrice ? 'Manual price range · Auto fits visible prices'
    : state.following ? 'Drag plot to pan · Drag axes to zoom'
    : 'Browsing history · Go to latest to resume following';
  el('interaction-hint').textContent = hint;
});

document.querySelectorAll<HTMLButtonElement>('[data-symbol]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.symbol); loadMarket(); }));
document.querySelectorAll<HTMLButtonElement>('[data-interval]').forEach(button => button.addEventListener('click', () => {
  interval = intervals.find(t => t.label === button.dataset.interval)!;
  if (imported) toast(`Switched to ${source === 'binance' ? 'Binance' : 'demo'} data. Imported candles are not resampled.`);
  loadMarket();
}));
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.addEventListener('click', () => chart.setTool(button.dataset.tool as Tool)));
el('clear-drawings').addEventListener('click', () => { chart.clearDrawings(); toast('Drawings cleared for this chart.'); });
el('reset-view').addEventListener('click', () => chart.resetView());
el('auto-price').addEventListener('click', () => chart.fitPrices());
el('follow').addEventListener('click', () => chart.followLatest());
el('zoom-in').addEventListener('click', () => chart.zoom(1.2));
el('zoom-out').addEventListener('click', () => chart.zoom(1 / 1.2));
el('live-toggle').addEventListener('click', () => {
  if (source === 'demo') { setRunning(!running); return; }
  if (feed) {
    stopFeed(); setRunning(false);
    el('source-status').textContent = 'Binance updates paused. Resume to refresh history and reconnect.';
    el('retry-feed').hidden = true;
    if (displayedSource === 'binance') el('data-notice').textContent = 'Binance data · Updates paused.';
  } else loadMarket();
});
el('data-source').addEventListener('change', () => {
  source = el<HTMLSelectElement>('data-source').value === 'binance' ? 'binance' : 'demo';
  loadMarket();
});
el('retry-feed').addEventListener('click', () => loadMarket());
el('retry-history').addEventListener('click', () => history?.retry());
el('demo-data').addEventListener('click', () => { source = 'demo'; el<HTMLSelectElement>('data-source').value = 'demo'; loadMarket(); });
for (const type of ['candles', 'line'] as const) el(type).addEventListener('click', () => { chart.configure({ style: type }); syncOptions(); saveOptions(); });
el('ma-toggle').addEventListener('click', () => { chart.configure({ showMA: !chart.options.showMA }); syncOptions(); saveOptions(); });
el('log-toggle').addEventListener('click', () => {
  chart.configure({ priceScale: chart.priceScale === 'log' ? 'linear' : 'log' });
  syncOptions(); saveOptions();
});
el('price-scale').addEventListener('change', () => {
  const value = el<HTMLSelectElement>('price-scale').value;
  if (value === 'linear' || value === 'log') chart.configure({ priceScale: value });
  syncOptions(); saveOptions();
});
for (const [id, key] of [['up-color', 'upColor'], ['down-color', 'downColor'], ['up-border-color', 'upBorderColor'], ['down-border-color', 'downBorderColor'], ['background-color', 'backgroundColor'], ['grid-color', 'gridColor']] as const) {
  el(id).addEventListener('input', () => { chart.configure({ [key]: el<HTMLInputElement>(id).value }); syncOptions(); saveOptions(); });
}
el('volume-toggle').addEventListener('change', () => { chart.configure({ showVolume: el<HTMLInputElement>('volume-toggle').checked }); saveOptions(); });
el('ma-setting').addEventListener('change', () => { chart.configure({ showMA: el<HTMLInputElement>('ma-setting').checked }); syncOptions(); saveOptions(); });
el('restore-colors').addEventListener('click', () => { chart.configure({ upColor: '#5cc9af', downColor: '#dc7883', upBorderColor: '#5cc9af', downBorderColor: '#dc7883', backgroundColor: '#141b1e', gridColor: '#20282b' }); syncOptions(); saveOptions(); });
function settings(open: boolean): void { el('settings').hidden = !open; el('settings-toggle').setAttribute('aria-expanded', String(open)); }
el('settings-toggle').addEventListener('click', () => settings(el('settings').hidden !== false));
el('settings-close').addEventListener('click', () => settings(false));
document.addEventListener('pointerdown', event => { if (!el('settings').contains(event.target as Node) && !el('settings-toggle').contains(event.target as Node)) settings(false); });
el<HTMLInputElement>('search').addEventListener('input', event => {
  const query = (event.target as HTMLInputElement).value.trim().toLowerCase();
  let matches = 0;
  document.querySelectorAll<HTMLButtonElement>('[data-symbol]').forEach(button => {
    const s = instruments[Number(button.dataset.symbol)];
    button.hidden = !`${s.symbol} ${s.name}`.toLowerCase().includes(query);
    if (!button.hidden) matches++;
  });
  el('no-results').hidden = matches !== 0;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') settings(false);
  if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !el<HTMLDialogElement>('help-dialog').open) { event.preventDefault(); el('search').focus(); }
});
el('help').addEventListener('click', () => el<HTMLDialogElement>('help-dialog').showModal());
el('help-close').addEventListener('click', () => el<HTMLDialogElement>('help-dialog').close());

el('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(chart.store.candles, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `liquid-chart-${imported ? 'custom' : instruments[displayedSelected].tag}-${displayedSource}-${displayedInterval.label}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Candle data exported.');
});
for (const id of ['import', 'sidebar-import']) el(id).addEventListener('click', () => el<HTMLInputElement>('file-input').click());
el('file-input').addEventListener('change', async () => {
  const input = el<HTMLInputElement>('file-input');
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 25 MB.');
    const value: unknown = JSON.parse(await file.text());
    if (!Array.isArray(value)) throw new Error('Expected a JSON array of candle objects.');
    chart.setData(value);
    stopFeed(); stopHistory(); displayedSource = 'imported';
    el<HTMLSelectElement>('data-source').value = 'imported';
    imported = true; setRunning(false); chart.setTool('cursor');
    el('source-status').textContent = 'Imported local candles · Updates paused';
    el('retry-feed').hidden = true;
    // An imported dataset gets fresh anchors; no unrelated drawing is reused.
    chart.setDrawings([]);
    el('symbol-title').textContent = 'Custom dataset';
    el('chart-symbol').textContent = 'CUSTOM';
    el('chart-interval').textContent = 'Imported';
    el('source-description').textContent = file.name;
    el('data-badge').innerHTML = '<i></i> IMPORTED DATA';
    el('data-notice').innerHTML = '<i class="status-dot"></i> Your local candle data. No market connection.';
    el('asset-tag').hidden = true;
    el('demo-data').hidden = false;
    document.querySelectorAll('[data-symbol], [data-interval]').forEach(button => { button.classList.remove('selected', 'active'); button.setAttribute('aria-pressed', 'false'); });
    refreshQuote();
    const scaleMessage = chart.options.priceScale === 'log' && !chart.store.supportsLogScale ? ' Using linear scale: log requires positive prices.' : '';
    toast(`Imported ${chart.store.candles.length.toLocaleString()} candles. Live updates paused.${scaleMessage}`);
  } catch (error) { toast(error instanceof Error ? error.message : 'Could not import this file.'); }
  input.value = '';
});

loadMarket();
source = 'binance';
loadMarket();
const timer = setInterval(() => {
  el('clock').textContent = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
  if (!running || imported || source !== 'demo' || displayedSource !== 'demo') return;
  const last = chart.store.candles[chart.store.candles.length - 1];
  const close = Math.max(0.000001, last.close * (1 + (Math.random() - 0.48) * 0.00055));
  tick++;
  const next = tick % 10 === 0
    ? { time: last.time + interval.ms, open: last.close, high: Math.max(last.close, close), low: Math.min(last.close, close), close, volume: 5 + Math.random() * 10 }
    : { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close), volume: last.volume + Math.random() * 4 };
  chart.update(next);
  refreshQuote();
}, 1000);

let resumeOnPageShow = false;
const pageHide = () => { resumeOnPageShow = !!feed; stopFeed(); stopHistory(); };
const pageShow = (event: PageTransitionEvent) => {
  if (!event.persisted) return;
  if (source === 'binance' && !imported && resumeOnPageShow) loadMarket();
  else if (displayedSource === 'binance') ensureHistory();
};
window.addEventListener('pagehide', pageHide);
window.addEventListener('pageshow', pageShow);
if (import.meta.hot) import.meta.hot.dispose(() => {
  stopFeed(); stopHistory(); clearInterval(timer); clearTimeout(toastTimer); chart.destroy();
  window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow);
});
