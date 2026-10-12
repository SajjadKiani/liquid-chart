# LiquidChart

A customizable financial chart engine built with TypeScript and Canvas 2D. Zero runtime dependencies. Candles, line charts, volume, MA, logarithmic scales, pan/zoom, 21 drawing tools, and OHLC magnet snapping. Framework-independent; no third-party chart renderer.

The engine is the npm package; the watchlist, toolbar, Binance connection, imports, and browser persistence live in the [workspace demo](https://github.com/SajjadKiani/liquid-chart/blob/main/demo/README.md). The package never starts a data connection or writes browser storage.

## Install

Version 0.1.0 is prepared for npm but has **not been published to the registry**. Build an installable tarball from this repository:

```sh
npm install
npm pack
# In your application's directory:
npm install /absolute/path/to/liquid-chart-0.1.0.tgz
```

The distribution contains ESM JavaScript, TypeScript declarations, source maps with embedded engine sources, and a small scoped stylesheet. Build tools such as Vite consume the ESM exports directly. No TypeScript compiler or Node.js runtime is needed in the browser.

## Create a chart

```ts
import { createChart, type Candle } from 'liquid-chart';
import 'liquid-chart/style.css';

const host = document.getElementById('chart')!;
host.style.height = '400px';
host.style.width = '100%';
const chart = createChart(host, {
  backgroundColor: '#141b1e', gridColor: '#20282b',
  upColor: '#5cc9af', downColor: '#dc7883', priceScale: 'log',
});
const candles: Candle[] = [
  { time: 1791676800000, open: 100, high: 105, low: 98, close: 103, volume: 1200 },
  { time: 1791680400000, open: 103, high: 108, low: 102, close: 106, volume: 1450 },
];
chart.setData(candles);
chart.setMagnet('weak');
const unsubscribe = chart.subscribe(state => {
  console.log(state.candle, state.following, state.firstVisibleIndex);
});
// When your component/page is removed: unsubscribe(); chart.destroy();
```

Give the host an explicit height and load `liquid-chart/style.css`. The engine adds a scoped host class, responds to ResizeObserver changes, and sizes backing buffers for devicePixelRatio. It does not change global page styles. JavaScript imports are safe during server rendering; instantiate the chart only after a DOM element mounts in the browser. React/Vue/Svelte integrations should call `destroy()` during cleanup. `new ChartEngine(host, options)` also works; `createChart` returns the same instance.

## API

| Method / property | Behavior |
| --- | --- |
| `setData(candles)` | Validate and replace history; reset viewport. Invalid batches preserve existing data. |
| `update(candle)` | Replace or insert by timestamp; preserve historical views. |
| `prependData(candles)` | Add strictly older bars without moving existing candles on screen; return the number added. |
| `configure(options)` | Change colors, price scale, candles/line style, volume, MA visibility, or MA period. |
| `subscribe(listener)` | Receive current state immediately and after redraws; return an unsubscribe function. |
| `setTool(tool)` | Activate drawing mode or `cursor`. |
| `setMagnet(mode)` | `off`, `weak` (12 CSS pixels), or `strong` (nearest candle's visible OHLC). Alt bypasses snapping. |
| `setDrawingStyle({ color, width })` | Set defaults and update the selected drawing. |
| `setDrawings(drawings)` | Restore validated drawings; reset undo history. |
| `onDrawingsChange` | Assign a callback to save committed drawing changes in your application. |
| `drawings` | Current time/price-anchored drawings; edit through methods rather than mutating objects. |
| `clearDrawings()`, `deleteSelectedDrawing()` | Remove all or selected drawings with undo support. |
| `undoDrawing()`, `redoDrawing()` | Undo/redo up to 50 drawing actions. |
| `fitPrices()`, `resetView()`, `followLatest()` | Fit prices, reset both axes, or resume following time. |
| `zoom(factor, x?)` | Zoom time around a CSS-pixel position. |
| `destroy()` | Disconnect observer, remove input listeners/canvases, cancel scheduled rendering, and release subscribers. |

Exported types include `Candle`, `Anchor`, `Drawing`, `Tool`, `PriceScale`, `MagnetMode`, `ChartOptions`, and `ChartState`. `TOOL_GROUPS`, `DRAWING_KINDS`, and `toolLabel` can drive your own toolbar. `restoreDrawings` validates persisted drawings. Pure data/scales utilities are available from `liquid-chart/model`.

### Provider-independent history

Feed candles from any provider. The engine accepts no vendor response formats or API credentials. The optional `liquid-chart/history` entry exposes `createHistoryPager`, `HistoryPageError`, and history types:

```ts
import { createHistoryPager } from 'liquid-chart/history';
const pager = createHistoryPager({
  oldestTime: () => chart.store.candles[0]?.time,
  fetchPage: (before, signal) => yourProvider.loadBefore(before, signal),
  prepend: candles => chart.prependData(candles),
  onStatus: status => console.log(status),
});
const stopWatching = chart.subscribe(state => {
  pager.consider(state.firstVisibleIndex, state.visible);
});
// On dataset changes/unmount: stopWatching(); pager.stop();
// On explicit retry: pager.retry();
```

`loadBefore` returns candles older than `before`, or an empty page at the beginning of history. One request runs at a time, with cancellation, timeout, explicit retry, and rate-limit cooldown support. The Binance example in `demo/binance.ts` is excluded from the npm package.

### Data and interactions

Timestamps are UTC Unix **milliseconds**. Candles are ordered and deduplicated by timestamp; the last repeated timestamp wins. OHLC values must be finite, with high/low containing open/close. Volume is finite and non-negative; omitted import volume defaults to zero. Non-positive prices remain valid data but force a linear scale. Anchors use timestamps and prices, so pagination and resizing preserve their meaning.

Drag to pan; scroll to zoom. Shift-scroll pans time and Alt-scroll pans price. Drag/scroll axes to zoom independently. The focused chart supports arrow-key panning, +/− zoom, Home following, A fitting, Escape cancellation, Delete, and Ctrl/Cmd+Z undo. Geometric tools snap during placement/resizing; freehand strokes and whole-shape movement stay free.

Drawings include lines/rays, Fibonacci retracement/time zones, brush/highlighter, arrows, rectangle/circle/ellipse, and price/date measurements. Your application supplies the toolbar and settings; the package implements their drawing behavior. View the demo for a complete example.

## Develop and verify

Use Node.js 22.18+; Node.js 24 is recommended for development.

```sh
npm install
npm run dev           # Workspace demo with live engine source edits
npm test              # Model, geometry, feed, history, and packed-package tests
npm run build         # Type-check, build library, build demo from package exports
npm run build:lib     # ESM/declarations/CSS into dist/
npm run build:demo    # Requires dist/; output into demo-dist/
npm run preview      # Preview the production demo
npm run test:package # Install a tarball in an isolated consumer and check exports/types
npm pack             # Rebuild library and create liquid-chart-0.1.0.tgz
```

Core source is in `src/`; the separate application is in `demo/`. Only `dist/`, this README, and package metadata are distributed. Development resolves the same public API from source; production demo builds resolve the built package. Packed-package tests install the actual archive in a temporary consumer and check runtime imports, declarations, and contents.

## Status and license

This is an early 0.1.0 API. There is no broker, order execution, backend, or automatic provider connection. Advanced indicators, multi-pane charts, channels/pitchforks/Gann, text, drawing locks, and touch pinch zoom are not implemented. MA currently recalculates across loaded history on updates. Drawings are capped at 1,000 per chart and freehand strokes at 2,000 points.

License: **UNLICENSED**. No open-source license has been granted. Publishing to npm is a separate release step; creating/installing a local tarball does not publish anything.
