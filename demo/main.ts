import 'liquid-chart/style.css';
import './style.css';
import { ChartEngine, formatPrice } from 'liquid-chart';
import type { ChartOptions } from 'liquid-chart';
import { generateCandles, instruments, intervals } from './demo.ts';
import { binanceSymbols, connectBinance, fetchBinanceOlder } from './binance.ts';
import { createHistoryPager } from 'liquid-chart/history';
import { drawingStyle, restoreDrawings } from 'liquid-chart';
import { TOOL_GROUPS, toolLabel, freehand, singlePoint } from 'liquid-chart';
import type { MagnetMode } from 'liquid-chart';
import type { Drawing, Tool } from 'liquid-chart';
import { createAIWorkspace } from './ai-workspace.ts';
import { createWorkspaceSplit } from './workspace-split.ts';

const icons: Record<string, string> = {
  fib: '<path d="M3 4h18M3 9h14M3 14h18M3 20h14"/><circle cx="4" cy="4" r="1"/><circle cx="17" cy="20" r="1"/>',
  arrow: '<path d="m4 20 16-16M10 4h10v10"/>',
  measure: '<path d="M4 6h16M4 3v6m16-6v6M4 18h16M4 15v6m16-6v6M12 6v12m-3-3 3 3 3-3"/>',
  magnet: '<path d="M5 4v10a7 7 0 0 0 14 0V4h-5v10a2 2 0 0 1-4 0V4zM5 8h5m4 0h5"/>',
  ray: '<circle cx="4" cy="18" r="2"/><path d="m6 16 15-14"/>',
  extended: '<path d="m2 22 20-20"/><circle cx="8" cy="16" r="2"/><circle cx="16" cy="8" r="2"/>',
  info: '<path d="m3 17 17-12M3 21h17"/><circle cx="3" cy="17" r="1.5"/><circle cx="20" cy="5" r="1.5"/>',
  'horizontal-ray': '<circle cx="4" cy="12" r="2"/><path d="M6 12h16"/>',
  crossline: '<path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="2"/>',
  'fib-time': '<path d="M3 3v18M7 3v18M12 3v18M20 3v18"/>',
  highlighter: '<path d="m7 15 9-12 5 5-9 12zM3 21h12M7 15l5 5"/>',
  'arrow-up': '<path d="m12 3-8 9h5v9h6v-9h5z"/>',
  'arrow-down': '<path d="m12 21-8-9h5V3h6v9h5z"/>',
  circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="10" ry="6"/>',
  'price-range': '<path d="M7 3h10M7 21h10M12 3v18m-3-3 3 3 3-3m-6-12 3-3 3 3"/>',
  'date-range': '<path d="M3 7v10M21 7v10M3 12h18m-3-3 3 3-3 3M6 9l-3 3 3 3"/>',
  range: '<rect x="4" y="4" width="16" height="16"/><path d="m4 20 16-16M14 4h6v6"/>',

  cursor: '<path d="m5 3 13 9-7 1-3 7z"/>',
  trend: '<path d="m4 17 16-12"/><circle cx="4" cy="17" r="2"/><circle cx="20" cy="5" r="2"/>',
  horizontal: '<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>',
  vertical: '<path d="M12 3v18"/><circle cx="12" cy="12" r="2"/>',
  rectangle: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 5h2m12 14h2"/>',
  brush: '<path d="m14 4 6 6-9 9-5-5zM6 14c-4 1-2 5-4 6 4 1 8-1 9-3"/>',
  undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 6 6v3"/>',
  redo: '<path d="m15 5 5 5-5 5M20 10h-10a6 6 0 0 0-6 6v3"/>',
  remove: '<path d="M5 5h14v14H5zM9 9l6 6m0-6-6 6"/>',
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
  <div class="workspace">
    <aside id="ai-workspace-host" class="sidebar ai-sidebar" aria-label="AI indicator workspace"></aside>
    <div id="workspace-divider" class="workspace-divider" role="separator" tabindex="0" aria-label="Resize chat and chart" aria-orientation="vertical" aria-controls="ai-workspace-host chart-workspace" title="Drag to resize · Arrow keys adjust · Double-click resets"></div>
    <main id="chart-workspace" class="main">
      <section class="chart-panel" aria-label="Chart workspace">
        <div class="chart-body">
          <div class="drawing-toolbar" aria-label="Drawing tools">
            <button data-tool="cursor" class="tool-button active" aria-label="Cursor and pan tool" aria-pressed="true" title="Cursor / select / pan">${icon('cursor')}</button>
            ${TOOL_GROUPS.map(g => `<button data-group="${g.id}" class="tool-button category-button" aria-label="${g.label} drawing tools" aria-expanded="false" aria-controls="drawing-menu" aria-haspopup="menu" title="${g.label}">${icon(g.icon)}<span class="category-chevron">›</span></button>`).join('')}
            <span class="tool-divider"></span>
            <button id="magnet-toggle" data-group="magnet" class="tool-button category-button" aria-label="Magnet: off" aria-haspopup="menu" aria-expanded="false" aria-controls="drawing-menu" title="Magnet: off">${icon('magnet')}<span id="magnet-badge" class="magnet-badge"></span></button>
            <span class="tool-divider"></span>
            <button id="undo-drawing" class="tool-button" aria-label="Undo drawing change" title="Undo drawing · Ctrl/Cmd+Z" disabled>${icon('undo')}</button>
            <button id="redo-drawing" class="tool-button" aria-label="Redo drawing change" title="Redo drawing · Ctrl/Cmd+Shift+Z" disabled>${icon('redo')}</button>
            <button id="delete-drawing" class="tool-button" aria-label="Delete selected drawing" title="Delete selected drawing · Delete" disabled>${icon('remove')}</button>
            <button id="clear-drawings" class="tool-button" aria-label="Clear drawings for this chart" title="Clear drawings">${icon('trash')}</button>
            <div class="tool-spacer"></div>
            <button id="reset-view" class="tool-button" aria-label="Reset chart view" title="Reset view">${icon('reset')}</button>
          </div>
          <div id="drawing-menu" class="drawing-menu" role="menu" aria-label="Drawing tools" hidden>
            ${TOOL_GROUPS.map(g => `<section data-menu="${g.id}" hidden><div class="drawing-menu-heading">${g.label}</div>${g.tools.map(t => `<button class="drawing-menu-item" data-tool="${t.kind}" role="menuitemradio" aria-checked="false" tabindex="-1">${icon(icons[t.kind] ? t.kind : g.icon)}<span>${t.label}</span><span class="menu-check" aria-hidden="true">✓</span></button>`).join('')}<p class="drawing-menu-note">${g.id === 'brushes' ? 'Drag to draw freely' : 'Drag or click to place anchors'} · Esc cancels</p></section>`).join('')}
            <section data-menu="magnet" hidden><div class="drawing-menu-heading">Magnet snapping</div>${['off', 'weak', 'strong'].map(m => `<button class="drawing-menu-item" data-magnet="${m}" role="menuitemradio" aria-checked="false" tabindex="-1">${icon('magnet')}<span>${m[0].toUpperCase() + m.slice(1)}</span><span class="menu-check" aria-hidden="true">✓</span></button>`).join('')}<p class="drawing-menu-note">Weak: within 12 px. Strong: nearest candle OHLC.<br/>Hold Alt to bypass. Freehand stays free.</p></section>
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
            <p id="drawing-selection" class="drawing-section-label">New drawings</p>
            <label class="color-setting">Drawing color <input type="color" id="drawing-color" value="#9aaef5" /></label>
            <label class="scale-setting"><span>Drawing width</span><select id="drawing-width"><option value="1">1 px</option><option value="1.5">1.5 px</option><option value="2" selected>2 px</option><option value="3">3 px</option><option value="4">4 px</option><option value="6">6 px</option></select></label>
          </div>
        </div>
        <footer class="chart-footer"><span id="interaction-hint">Drag plot to pan · Drag axes to zoom</span><span id="displayed-source" aria-label="Displayed candle source">Demo · synthetic</span><span id="bar-count"></span><button id="settings-toggle" class="settings-button" aria-label="Chart style settings" aria-expanded="false" aria-controls="settings">${icon('settings')} <span>Style</span></button><button id="auto-price" class="scale-toggle active" aria-label="Automatically fit price range" aria-pressed="true" title="Fit visible prices · A">Auto</button><button id="log-toggle" class="scale-toggle" aria-label="Logarithmic price scale" aria-pressed="false" title="Log scale: equal percentage changes have equal vertical spacing">Log</button><span>UTC</span></footer>
      </section>
      <details class="compact-controls">
        <summary>Chart controls</summary>
        <div class="compact-control-content">
          <div class="compact-row"><label for="market-select">Market</label><select id="market-select"><option value="imported" disabled hidden>Imported dataset</option>${instruments.map((s, i) => `<option value="${i}">${s.tag} · ${s.name}</option>`).join('')}</select><div class="source-controls"><label for="data-source">Data</label><select id="data-source"><option value="binance">Binance spot</option><option value="demo">Demo</option><option value="imported" disabled hidden>Imported file</option></select><span id="source-status" role="status" aria-live="polite">Starting…</span><button id="retry-feed" class="text-button" hidden>Retry</button></div></div>
          <div id="history-info" class="history-controls" hidden><span id="history-status" role="status" aria-live="polite"></span><button id="retry-history" class="text-button" hidden>Retry history</button></div>
          <div class="chart-toolbar">
            <div class="timeframes" aria-label="Chart timeframe">${intervals.map(t => `<button data-interval="${t.label}" class="${t.label === '1h' ? 'active' : ''}" aria-pressed="${t.label === '1h'}">${t.label}</button>`).join('')}</div>
            <span class="toolbar-divider"></span>
            <div class="chart-types" aria-label="Chart type"><button id="candles" class="icon-button active" aria-label="Candlestick chart" aria-pressed="true" title="Candlesticks">${icon('candles')}</button><button id="line" class="icon-button" aria-label="Line chart" aria-pressed="false" title="Line chart">${icon('line')}</button></div>
            <button id="ma-toggle" class="indicator-button active" aria-pressed="true"><span class="ma-dot"></span> MA 20</button>
            <button id="live-toggle" class="live-button" aria-pressed="true" title="Simulated updates; a new candle every 10 seconds"><span class="status-dot"></span> <span id="live-label">Live demo</span></button>
            <button id="export" class="icon-button" aria-label="Export candle data as JSON" title="Export JSON">${icon('download')}</button>
            <button id="import" class="secondary-button">Import candles</button><button id="demo-data" class="text-button" hidden>Return to demo</button>
            <button id="help" class="text-button" aria-label="Chart controls and help">Help</button>
          </div>
        </div>
      </details>
    </main>
  </div>
  <input id="file-input" type="file" accept="application/json,.json" hidden />
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="help-dialog"><div class="dialog-heading"><span class="eyebrow">QUICK GUIDE</span><button id="help-close" aria-label="Close help">×</button></div><h2>Find your perspective.</h2><dl><dt>Pan & zoom</dt><dd>Drag the chart to move time and price together. Pan past the latest candle to reveal space on its right. Scroll to zoom; Shift-scroll moves time. Drag up/down or scroll on the right price axis to zoom vertically. Drag right/left or scroll on the bottom time axis to zoom horizontally. Alt-scroll on the plot moves prices. Double-click an axis to reset it. Auto fits visible prices again. Double-click resets both axes.</dd><dt>Price scale</dt><dd>Use Log in the chart footer or Style → Price scale. Equal percentage moves have equal vertical spacing. Log mode requires positive prices; zero or negative data uses the linear scale.</dd><dt>Drawing tools</dt><dd>Use the grouped menus for lines, Fibonacci retracements/time zones, brushes, arrows, shapes, and measurements. Two-anchor tools support dragging or two clicks; Circle uses a center and radius. Horizontal lines/rays, vertical lines, crosslines, and arrow marks need one click. Drag Brush or Highlighter freely. Magnet → Weak snaps within 12 CSS pixels; Strong snaps to the nearest visible OHLC price of the nearest candle. Hold Alt to bypass magnet. Snapping applies to placement and anchor resizing; moving whole shapes and freehand strokes remain free. Fibonacci retracement levels interpolate actual prices, including in log mode. Measurements show signed price change and elapsed time. The cursor selects drawings; drag to move or use handles to resize. Shift-drag pans through shapes. Delete removes a selected drawing; Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. Style controls drawing color and width. Escape cancels an unfinished edit. Drawings are saved per market/timeframe; imported drawings are session-only.</dd><dt>Keyboard</dt><dd>Focus the chart: ← / → move time, ↑ / ↓ move prices, + / − zoom, Home follows the latest candle, and A fits prices.</dd><dt>Your data</dt><dd>Import a JSON array of candles with time (UTC milliseconds), open, high, low, close, and optional volume. Imports pause the simulation.</dd><dt>Market data</dt><dd>Select Binance spot for live USDT candles, or Demo for synthetic candles. Pause stops live updates; resume refreshes history. Pan left to load earlier Binance candles in pages. Only the selected market streams. Binance access depends on your network.</dd><dt>Live demo</dt><dd>Demo prices are synthetic. The accelerated simulator updates every second and opens a new candle every 10 seconds. This is not an exchange feed.</dd></dl></dialog>
`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const destroyWorkspaceSplit = createWorkspaceSplit(app.querySelector<HTMLElement>('.workspace')!, el('workspace-divider'));
const chart = new ChartEngine(el('chart'));
let selected = 0;
let interval = intervals[3];
let running = true;
let imported = false;
let source: 'demo' | 'binance' = 'demo';
let displayedSource: 'demo' | 'binance' | 'imported' = 'demo';
let displayedSelected = selected;
let displayedInterval = interval;
let importedScope = '';
let feed: ReturnType<typeof connectBinance> | undefined;
let feedGeneration = 0;
let history: ReturnType<typeof createHistoryPager> | undefined;
let tick = 0;
let toastTimer: ReturnType<typeof setTimeout>;
const aiWorkspace = createAIWorkspace({
  chart,
  host: el('ai-workspace-host'),
  scope: () => displayedSource === 'imported'
    ? { key: `imported:${importedScope}`, persistent: false }
    : `${displayedSource}:${displayedSource === 'binance' ? binanceSymbols[displayedSelected] : instruments[displayedSelected].symbol}:${displayedInterval.label}`,
});

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
  chart.setDrawings(restoreDrawings(readStorage(drawingKey())));
}
chart.onDrawingsChange = drawings => { if (!imported) saveStorage(drawingKey(), drawings); };
const drawingPreferences = readStorage('liquidchart.drawingStyle');
if (drawingPreferences && typeof drawingPreferences === 'object') chart.setDrawingStyle(drawingPreferences as Partial<{ color: string; width: number }>);
const savedMagnet = readStorage('liquidchart.magnet');
if (savedMagnet === 'off' || savedMagnet === 'weak' || savedMagnet === 'strong') chart.setMagnet(savedMagnet);

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
    prepend: candles => { const added = chart.prependData(candles); aiWorkspace.datasetChanged(); return added; },
    onStatus(status) {
      el('history-status').textContent = status.message;
      el('retry-history').hidden = status.state !== 'error';
      el<HTMLButtonElement>('retry-history').disabled = !status.canRetry;
    },
  });
}

function commitMarket(mode: 'demo' | 'binance'): void {
  displayedSource = mode;
  displayedSelected = selected;
  displayedInterval = interval;
  imported = false;
  const instrument = instruments[selected];
  chart.setTool('cursor');
  loadDrawings();
  const symbol = mode === 'binance' ? `${instrument.tag}/USDT` : instrument.symbol;
  el('chart-symbol').textContent = symbol;
  el('chart-interval').textContent = interval.label;
  el<HTMLSelectElement>('market-select').value = String(selected);
  el<HTMLSelectElement>('market-select').options[0].hidden = true;
  el('source-status').textContent = mode === 'binance' ? `${instrument.tag}/USDT · Binance spot · UTC` : `${instrument.symbol} · Simulated demo data · UTC`;
  el('displayed-source').textContent = mode === 'binance' ? `Binance · ${instrument.tag}/USDT` : 'Demo · synthetic';
  el('demo-data').hidden = true;
  document.querySelectorAll<HTMLButtonElement>('[data-interval]').forEach(button => {
    const isSelected = button.dataset.interval === interval.label;
    button.classList.toggle('active', isSelected); button.setAttribute('aria-pressed', String(isSelected));
  });
  tick = 0;
}

function loadMarket(): void {
  stopFeed();
  if (source !== 'binance' || displayedSource !== 'binance' || displayedSelected !== selected || displayedInterval.label !== interval.label) stopHistory();
  el<HTMLSelectElement>('data-source').value = source;
  if (source === 'demo') {
    chart.setData(generateCandles(instruments[selected].base, interval.ms));
    commitMarket('demo'); setRunning(true);
    aiWorkspace.datasetChanged();
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
      aiWorkspace.datasetChanged();
      ensureHistory();
    },
    onCandle(candle) {
      if (generation !== feedGeneration || !initialized) return;
      chart.update(candle); aiWorkspace.datasetChanged();
    },
    onStatus(status, message) {
      if (generation !== feedGeneration) return;
      setRunning(status === 'live');
      el<HTMLButtonElement>('live-toggle').disabled = false;
      el('live-label').textContent = status === 'live' ? 'Live Binance' : status === 'error' ? 'Unavailable' : status === 'retrying' ? 'Reconnecting' : 'Connecting';
      el('retry-feed').hidden = status !== 'error' && status !== 'retrying';
      const retained = displayedSource === 'demo' ? 'Showing paused demo candles.' : displayedSource === 'imported' ? 'Showing imported candles.' : 'Showing last Binance snapshot.';
      el('source-status').textContent = `${pair} · ${message}${status === 'live' ? '' : ` ${retained}`}`;
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
  el<HTMLButtonElement>('delete-drawing').disabled = !state.selectedDrawing;
  el<HTMLButtonElement>('clear-drawings').disabled = state.drawings === 0;
  el<HTMLButtonElement>('undo-drawing').disabled = !state.canUndo;
  el<HTMLButtonElement>('redo-drawing').disabled = !state.canRedo;
  const style = state.selectedDrawing ? drawingStyle(state.selectedDrawing) : chart.drawingStyle;
  el<HTMLInputElement>('drawing-color').value = style.color;
  el<HTMLSelectElement>('drawing-width').value = String(style.width);
  el('drawing-selection').textContent = state.selectedDrawing ? `Selected ${toolLabel(state.selectedDrawing.kind)}` : 'New drawings';
  el('follow').classList.toggle('following', state.following);
  el('follow').setAttribute('aria-pressed', String(state.following));
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle('active', active);
    button.setAttribute(button.getAttribute('role') === 'menuitemradio' ? 'aria-checked' : 'aria-pressed', String(active));
  });
  for (const group of TOOL_GROUPS) document.querySelector(`[data-group="${group.id}"]`)?.classList.toggle('active', group.tools.some(t => t.kind === state.tool));
  const hint = state.tool !== 'cursor' ? `${toolLabel(state.tool)}: ${freehand(state.tool) ? 'drag freely' : singlePoint(state.tool) ? 'click once' : 'drag or click two anchors'} · Esc cancels`
    : state.selectedDrawing ? 'Drag to move · Handles resize · Delete removes · Shift-drag pans'
    : !state.autoPrice ? 'Manual price range · Auto fits visible prices'
    : state.following ? 'Drag plot to pan · Drag axes to zoom'
    : 'Browsing history · Go to latest to resume following';
  el('interaction-hint').textContent = hint;
});

el<HTMLSelectElement>('market-select').addEventListener('change', event => { selected = Number((event.target as HTMLSelectElement).value); loadMarket(); });
document.querySelectorAll<HTMLButtonElement>('[data-interval]').forEach(button => button.addEventListener('click', () => {
  interval = intervals.find(t => t.label === button.dataset.interval)!;
  if (imported) toast(`Switched to ${source === 'binance' ? 'Binance' : 'demo'} data. Imported candles are not resampled.`);
  loadMarket();
}));
let openDrawingMenu: string | null = null;
function drawingMenu(group: string | null, returnFocus = false): void {
  const previous = openDrawingMenu;
  openDrawingMenu = group;
  el('drawing-menu').hidden = group === null;
  document.querySelectorAll<HTMLElement>('[data-menu]').forEach(section => section.hidden = section.dataset.menu !== group);
  document.querySelectorAll<HTMLElement>('[data-group]').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.group === group)));
  if (group) {
    settings(false);
    el('drawing-menu').setAttribute('aria-label', group === 'magnet' ? 'Magnet snapping' : `${TOOL_GROUPS.find(g => g.id === group)!.label} drawing tools`);
    const active = el('drawing-menu').querySelector<HTMLElement>(`[data-menu="${group}"] [aria-checked="true"]`) ?? el('drawing-menu').querySelector<HTMLElement>(`[data-menu="${group}"] button`);
    active?.focus({ preventScroll: true });
  } else if (returnFocus && previous) document.querySelector<HTMLElement>(`[data-group="${previous}"]`)?.focus({ preventScroll: true });
}
function syncMagnet(): void {
  el('magnet-toggle').classList.toggle('active', chart.magnet !== 'off');
  el('magnet-toggle').setAttribute('aria-label', `Magnet: ${chart.magnet}`);
  el('magnet-toggle').title = `Magnet: ${chart.magnet} · snaps drawing anchors to candle OHLC`;
  el('magnet-badge').textContent = chart.magnet === 'off' ? '' : chart.magnet === 'weak' ? 'W' : 'S';
  document.querySelectorAll<HTMLElement>('[data-magnet]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.magnet === chart.magnet)));
}
syncMagnet();
document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(button => button.addEventListener('click', () => drawingMenu(openDrawingMenu === button.dataset.group ? null : button.dataset.group!)));
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.addEventListener('click', () => { drawingMenu(null); chart.setTool(button.dataset.tool as Tool); chart.overlay.focus({ preventScroll: true }); }));
document.querySelectorAll<HTMLButtonElement>('[data-magnet]').forEach(button => button.addEventListener('click', () => {
  chart.setMagnet(button.dataset.magnet as MagnetMode); saveStorage('liquidchart.magnet', chart.magnet); syncMagnet(); drawingMenu(null, true);
}));
el('drawing-menu').addEventListener('keydown', event => {
  const buttons = [...el('drawing-menu').querySelectorAll<HTMLButtonElement>(`[data-menu="${openDrawingMenu}"] button`)];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }
  if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); drawingMenu(null, true); }
});
document.addEventListener('pointerdown', event => {
  if (!el('drawing-menu').contains(event.target as Node) && !(event.target as Element).closest('[data-group]')) drawingMenu(null);
});
document.addEventListener('focusin', event => {
  if (openDrawingMenu && !el('drawing-menu').contains(event.target as Node) && !(event.target as Element).closest('[data-group]')) drawingMenu(null);
});
el('clear-drawings').addEventListener('click', () => { chart.clearDrawings(); toast('Drawings cleared for this chart.'); });
el('delete-drawing').addEventListener('click', () => chart.deleteSelectedDrawing());
el('undo-drawing').addEventListener('click', () => chart.undoDrawing());
el('redo-drawing').addEventListener('click', () => chart.redoDrawing());
for (const id of ['drawing-color', 'drawing-width']) el(id).addEventListener('input', () => {
  chart.setDrawingStyle({ color: el<HTMLInputElement>('drawing-color').value, width: Number(el<HTMLSelectElement>('drawing-width').value) });
  saveStorage('liquidchart.drawingStyle', chart.drawingStyle);
});
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
    if (displayedSource === 'binance') el('source-status').textContent = 'Binance spot data · Updates paused.';
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
function settings(open: boolean): void { if (open) drawingMenu(null); el('settings').hidden = !open; el('settings-toggle').setAttribute('aria-expanded', String(open)); }
el('settings-toggle').addEventListener('click', () => settings(el('settings').hidden !== false));
el('settings-close').addEventListener('click', () => settings(false));
document.addEventListener('pointerdown', event => { if (!el('settings').contains(event.target as Node) && !el('settings-toggle').contains(event.target as Node)) settings(false); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') settings(false);
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
el('import').addEventListener('click', () => el<HTMLInputElement>('file-input').click());
el('file-input').addEventListener('change', async () => {
  const input = el<HTMLInputElement>('file-input');
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 25 MB.');
    const value: unknown = JSON.parse(await file.text());
    if (!Array.isArray(value)) throw new Error('Expected a JSON array of candle objects.');
    chart.setData(value);
    importedScope = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    stopFeed(); stopHistory(); displayedSource = 'imported';
    el<HTMLSelectElement>('data-source').value = 'imported';
    imported = true; setRunning(false); chart.setTool('cursor'); aiWorkspace.datasetChanged();
    el('source-status').textContent = 'Imported local candles · Updates paused';
    el('retry-feed').hidden = true;
    // An imported dataset gets fresh anchors; no unrelated drawing is reused.
    chart.setDrawings([]);
    el('chart-symbol').textContent = 'CUSTOM';
    el('chart-interval').textContent = 'Imported';
    el('displayed-source').textContent = 'Imported · session only';
    const marketSelect = el<HTMLSelectElement>('market-select');
    marketSelect.options[0].hidden = false;
    marketSelect.value = 'imported';
    document.querySelectorAll<HTMLButtonElement>('[data-interval]').forEach(button => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    el('source-status').textContent = `Imported: ${file.name} · Session only`;
    el('demo-data').hidden = false;
    const scaleMessage = chart.options.priceScale === 'log' && !chart.store.supportsLogScale ? ' Using linear scale: log requires positive prices.' : '';
    toast(`Imported ${chart.store.candles.length.toLocaleString()} candles. Live updates paused.${scaleMessage}`);
  } catch (error) { toast(error instanceof Error ? error.message : 'Could not import this file.'); }
  input.value = '';
});

loadMarket();
source = 'binance';
loadMarket();
const timer = setInterval(() => {
  if (!running || imported || source !== 'demo' || displayedSource !== 'demo') return;
  const last = chart.store.candles[chart.store.candles.length - 1];
  const close = Math.max(0.000001, last.close * (1 + (Math.random() - 0.48) * 0.00055));
  tick++;
  const next = tick % 10 === 0
    ? { time: last.time + interval.ms, open: last.close, high: Math.max(last.close, close), low: Math.min(last.close, close), close, volume: 5 + Math.random() * 10 }
    : { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close), volume: last.volume + Math.random() * 4 };
  chart.update(next);
  aiWorkspace.datasetChanged();
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
  stopFeed(); stopHistory(); clearInterval(timer); clearTimeout(toastTimer); destroyWorkspaceSplit(); aiWorkspace.destroy(); chart.destroy();
  window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow);
});
