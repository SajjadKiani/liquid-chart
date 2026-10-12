# LiquidChart workspace demo

This demo consumes the LiquidChart package. Run the commands below from the repository root. For embedding the engine in your own application, see the [package README](../README.md).

A charting MVP with an independently implemented TypeScript + Canvas 2D engine and Binance public spot market data. No TradingView code or third-party charting libraries are used.

## Start

Requires Node.js 22.18+ (Node.js 24 recommended).

```sh
gh repo clone SajjadKiani/liquid-chart
cd liquid-chart
npm install
npm run dev
```

Open the Local URL printed by Vite. The workspace and local AI API bind to loopback. Charting and artifact import work without AI credentials.

```sh
npm test       # Data validation, updates, scales, zoom anchors, time anchors, MA
npm run build # Type-check; package dist/ and demo-dist/
npm run preview
```

## AI indicator studio

The studio places chat on the left and the chart on the right. Requests follow optional research → generated code → isolated smoke checks → at most two repairs → saved artifact. There is no RSI/EMA catalogue or indicator-name dispatch in this workflow. Existing MA 20 remains an ordinary demo control.

On desktop, drag the divider between chat and chart left or right to resize the panels. The chat width is saved in this browser; both panels retain a minimum usable width. Focus the divider and use Left/Right arrows (Shift for larger steps), Home/End for the limits, or double-click to reset. Escape cancels an active resize. Narrow screens retain the stacked layout.

The **Web search** checkbox beside Generate controls each request and remembers its setting in this browser. Checked (the initial default) requests research; unavailable search can fall back to model knowledge with empty sources and an explicit assumption. Unchecked skips the research stage entirely and makes no search call, even when search credentials are configured. The artifact records that research was disabled by the user. The checkbox is locked while a request is active and becomes available again after completion or cancellation. Authentication, quota, and invalid-model errors remain visible.

For OpenRouter, copy `.env.example` to ignored `.env` and configure:

```dotenv
AI_PROVIDER=openrouter
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=your-key
OPENAI_MODEL=poolside/laguna-s-2.1:free
```

An existing `OPENAI_API_KEY` also works when OpenRouter is selected; `OPENROUTER_API_KEY` takes precedence. `AI_MODEL` overrides `OPENAI_MODEL`. Do not prefix secrets with `VITE_`. Restart `npm run dev` after changing environment settings. The selected model is preserved; the adapter asks for JSON and applies strict validation without requiring Structured Outputs support. Research uses [OpenRouter's web search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search), with bounded Exa searches and returned citations. Search access, credits, model availability, and rate limits depend on your provider account, including for free models.

OpenRouter generation defaults to `AI_MAX_OUTPUT_TOKENS=16000` and `AI_REASONING_EFFORT=low`. A response stopped by the token limit is discarded and retried once from scratch with twice the budget (maximum 32000), within the existing total deadline. Set `AI_REASONING_EFFORT=none` to omit the effort parameter for a model that does not support it. Token limits include provider reasoning overhead; this retry does not bypass authentication, quota, schema, or runtime checks. Restart the API after changing these settings.

For NaraRouter, use `AI_PROVIDER=nararouter`, `OPENAI_BASE_URL=https://router.bynara.id/v1`, `OPENAI_API_KEY` for your Nara key, and `OPENAI_MODEL` for your model alias. Its generation adapter uses Chat Completions. `EXA_API_KEY` optionally enables actual Exa web research. Without available search, generation uses model knowledge and explicitly records **Web research skipped**, with no invented citation links. Search-key authentication and credit errors remain visible.

For OpenAI directly, use `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.openai.com/v1`, `OPENAI_API_KEY`, and a model supporting Responses web search and Structured Outputs. No LangChain is required.

`npm run dev` starts both Vite and the API. `npm run dev:demo` and `npm run dev:api` run them separately. The default API port is 8787 (`API_PORT` changes both API and Vite proxy). For production-build local QA, run the API alongside `npm run preview`. The API checks local origins and bounds body size, concurrency, execution, and total request time. It is not a hosted production service; authentication, quotas, durable storage, and tenant isolation remain future work.

Each artifact records its code hash, numeric parameters, sources, and assumptions. Inspect code, edit numeric parameters, remove/undo, or import/export artifacts. Parameter edits and incoming candle updates execute the saved code locally. Source/market/timeframe changes reject stale jobs and restore the relevant library. Demo/Binance libraries persist in browser storage; imported candle datasets and their libraries remain session-only. Corrupt storage and execution failures preserve usable chart data.

Generated code receives only candles and numeric parameters. It has no application DOM, network, filesystem, or environment bridge. Each run uses a fresh bounded QuickJS context in a browser Worker; server smoke checks use a Node Worker watchdog. Infinite loops or allocation failures stop and the worker can recover. Code is never executed with host `eval` or `new Function`. The MVP accepts up to 100,000 candles per calculation; output-size limits may reject large multi-series histories. Calculations currently run over loaded history rather than incrementally.

The chart supports overlays and up to four independent panes, line/histogram/band series, bar offsets, reference levels, and explicit null warmup gaps. Execution/schema checks **do not prove mathematical correctness**. Research sources and assumptions remain visible; independently verify formulas before relying on them. Missing keys, unavailable models, credit limits, malformed code, or failed checks produce errors, without simulated AI output.

## Minimal workspace layout

The demo opens as a flush chat/chart split with square corners. The chart starts at the top edge; there is no global header, watchlist, market overview, or promotional card. On narrow screens, chat and chart stack. Open **Chart controls** at the bottom for market/data selection, timeframes, chart type, live/pause, candle import/export, and Help. Drawing tools remain beside the chart. **Style** stays visible in the footer beside Auto/Log and opens background, grid, candle body/border, drawing, volume, MA, and price-scale settings. The chart readout and source label identify the displayed dataset.

## Included

- Custom candle and line rendering, price/time axes, volume, and MA 20.
- Linear and logarithmic price scales, with a footer toggle and Style selector.
- Visible-range rendering and automatic price scaling; high-DPI canvas buffers.
- Two-axis pointer panning, cursor-anchored wheel zoom, price/time axis drag and wheel zoom, crosshair and OHLC readout.
- Market selection, timeframe switching, and live/pause controls inside Chart controls.
- 21 drawing tools in grouped flyout menus: lines, Fibonacci, brushes, arrows, shapes, and measurements, anchored to time/price.
- Off/Weak/Strong magnet snapping to candle OHLC, with a snap marker, temporary Alt bypass, and a saved mode preference.
- Drawing selection, moving, resize handles, deletion, color/width controls, and undo/redo.
- Per-demo-market/timeframe drawings and chart colors/options saved in localStorage.
- Separate up/down candle body and border colors in Style, with saved preferences and a default-color reset.
- Custom chart background and grid colors in Style, applied immediately and saved with preferences.
- JSON import and export; imported datasets pause the simulator.
- Binance spot history and live candles, source switching, pause/resume, and automatic reconnect with history resynchronization.
- Earlier Binance history loads automatically in pages as you pan left, without moving existing candles on screen.
- Responsive layout, keyboard controls, style settings, and help dialog.

Drag the chart to pan time and price together; drag up/down on the right price axis to zoom prices in/out. Drag right/left on the bottom time axis to zoom time in/out. Pan past the latest candle to reveal space on its right, up to almost a full screen while retaining the last candle. Shift-wheel (or horizontal trackpad scrolling) moves time. Wheel over the price axis zooms prices vertically; wheel over the time axis zooms time horizontally. Scroll up zooms in; scroll down zooms out. Both gestures preserve the price/time under the initial pointer unless a viewport/numeric limit applies. Alt-wheel over the plot moves prices. Ordinary wheel over the plot zooms around the pointer.

Focus the chart: Left/Right move time, Up/Down move prices, + / - zoom, Home follows the last candle, A fits prices, and Escape cancels drawing mode. **Auto** in the footer restores automatic price fitting without moving the time viewport. Vertical scrolling keeps a manual price range during horizontal navigation and live updates; switching scales or datasets restores automatic fitting. Double-click the price axis to fit prices, or the time axis to reset candle spacing and follow latest without changing a manual price range. Double-click the plot or Reset view resets both axes. Go to latest resumes time following while retaining a manual price range. Clearing drawings removes only the current chart's drawings.

### Drawing tools

Open a category in the left toolbar:

- **Lines**: trendline, ray, extended line, info line, horizontal line/ray, vertical line, and crossline.
- **Fibonacci**: retracement (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1) and time zones (0, 1, 2, 3, 5, 8, 13, 21).
- **Brushes**: freehand brush and translucent highlighter. Drag to draw.
- **Arrows**: two-anchor arrow and one-click up/down markers.
- **Shapes**: rectangle, ellipse, and circle. Circle anchors define its center and radius.
- **Measures**: price range, elapsed date range, and combined date/price range. Price measurements show signed change and percentage; a zero starting price displays an undefined percentage.

Horizontal lines/rays, vertical lines, crosslines, and up/down arrow marks need one click. Other geometric tools support dragging or two clicks. Menu Up/Down/Home/End moves focus; Enter selects, and Escape closes the menu. All listed tools support the existing selection, editing, styling, persistence, and undo workflow. Fibonacci retracement levels interpolate actual prices and then project to the active scale. Time zones use elapsed UTC time, so missing sessions may result in uneven bar spacing.

**Magnet** opens Off/Weak/Strong choices. Weak snaps within 12 CSS pixels of the nearest candle's open, high, low, or close. Strong always chooses the nearest visible OHLC price of the nearest candle. A gold circle and OHLC label preview the snap. Hold Alt while placing/resizing an anchor to bypass snapping. Freehand strokes and whole-shape movement stay free; snapping does not distort an existing shape during translation. Candle-free past/future slots remain available for unsnapped drawings. The mode persists separately from drawings and works with linear/log scales and paginated history.

Completing a drawing returns to the cursor and selects the new shape. With the cursor tool, click a stroke or a filled shape's interior to select it, then drag to move it. Drag the visible handles to resize lines and rectangles or stretch a brush's bounding box. Horizontal levels move only vertically; vertical lines move only horizontally. Shift-drag pans through drawings. Click blank chart space to deselect. Escape cancels an unfinished stroke/edit, removes selection, and returns to the cursor.

**Delete selected** or Delete/Backspace removes one drawing. The trash button clears the current chart's drawings. Undo/redo buttons, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y restore drawing changes. Each completed stroke or drag is one undo step. The latest 50 drawing actions are retained for the current dataset session; switching datasets or reloading resets undo history. These shortcuts apply while the chart is focused.

Under **Style → Drawing color / Drawing width**, choose defaults for new drawings, or edit the selected drawing. Stroke widths range from 1 to 6 CSS pixels. Chart/candle color reset is separate from drawing style. Demo and Binance drawings persist by source, market, and timeframe; imported-dataset drawings are session-only. Old saved trendlines and horizontal levels remain compatible.

Drawing geometry uses time/price anchors, including interpolated times and space past the latest candle. Shapes reproject on pan, zoom, resizing, scale changes, and history pagination. Log mode hides shapes with non-positive price anchors while retaining them for linear mode; vertical lines depend only on time. During a drawing/edit gesture, automatic price fitting and live-follow scrolling are held steady. Limit: 1,000 drawings per chart. Long brush strokes are resampled to at most 2,000 points. Drawing JSON is validated on restore; malformed shapes are skipped. Candle JSON exports contain candles only.

With a single imported candle and no measurable interval, drawing times outside that candle use a one-hour interval.

### Logarithmic price scale

Click **Log** in the chart footer or select **Logarithmic** under **Style → Price scale**. Equal percentage changes occupy equal vertical distances (for example, 10 → 20 and 20 → 40). Axis labels and crosshair values remain prices; candles, line series, moving averages, drawing anchors, and latest-price lines share the same scale. Volume remains linear. The scale preference is saved with other chart options and does not reset when switching markets/timeframes or resetting the view.

Log mode requires every candle's low to be strictly positive. Datasets containing zero or negative prices remain supported on the linear scale; the Log toggle is disabled and the chart falls back to linear without discarding the saved log preference. Returning to positive data restores log mode. Drawings at non-positive prices are hidden in log mode and reappear in linear mode; their stored anchors are retained.

### Candle colors

Open **Style** to choose **Up candle body**, **Up candle border**, **Down candle body**, and **Down candle border** independently. Border colors apply to both the candle outline and its high/low wick; volume retains the body colors. Choices persist across reloads and markets. Existing saved preferences without border colors use their body colors for borders. Border options apply to candles in both linear and log modes; the line series continues to use the up body color.

For engine customization, call `configure({ upBorderColor: '#ffffff', downBorderColor: '#e8b05f' })` independently of `upColor` and `downColor`.

### Background and grid colors

Choose **Style → Chart background** and **Grid color** to change the chart immediately. The background covers the price plot, volume panel, axes, and OHLC header. Grid color applies to horizontal price lines and vertical time lines in candle and line modes, on linear and logarithmic scales. Both choices persist across reloads and markets. Older saved preferences use the default background and grid colors. **Restore default colors** resets all six chart and candle colors.

For engine customization, call `configure({ backgroundColor: '#101827', gridColor: '#334155' })`.

### Binance market data

The app starts connecting to **Binance spot**. Choose **Chart controls → Data → Demo** for synthetic candles. Binance uses BTC/USDT, ETH/USDT, SOL/USDT, and AVAX/USDT on the existing six timeframes. USDT is the quote asset; these are not USD pairs. The `1D` button maps to Binance's case-sensitive `1d` interval. The quote change is the current candle's change, not a 24-hour change. Only the selected market streams; market selection lists the supported pairs.

The adapter fetches the latest 1,000 UTC candles from `https://data-api.binance.vision/api/v3/klines` and subscribes to `wss://data-stream.binance.vision/ws/<symbol>@kline_<interval>`. These [official public market-data endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md) need no API key or account. There is no trading or account connection. Requests run directly from the browser.

Incoming updates replace the open candle by timestamp and append new candles. Stream events are buffered during history requests. Disconnects and silent streams retry with delays up to 30 seconds; HTTP 429 respects `Retry-After` with a minimum one-minute wait. Reconnect and resume refresh the latest 1,000 candles without resetting a matching chart's viewport. Disconnects at Binance's connection lifetime are handled the same way. No extra client ping messages are needed because browsers handle WebSocket ping/pong frames.

**Pause** closes the connection and keeps the displayed snapshot. Resume refreshes history and reconnects. Switching market, timeframe, source, or successfully importing candles cancels the old connection and ignores late responses. Failed imports preserve the active feed and candles. Binance drawings are saved separately from demo drawings. Style preferences apply to both.

Connection status identifies loading, live, paused, unavailable, and retrying states. Until a new request succeeds, the previous chart stays visible with its original source labels; synthetic data is never labeled as Binance data. HTTP 403/418/451 stops automatic retry and offers **Retry** or **Demo**. Network or regional restrictions can prevent access. There is no proxy or alternate host to bypass them. Outages longer than the reconnect snapshot can leave internal gaps; older-history pagination does not automatically repair those gaps.

### Scrolling into earlier history

Binance initially loads the latest 1,000 candles. When the left edge of the visible window approaches the oldest loaded candle, another page of up to 1,000 candles is requested with `endTime = oldestOpenTime - 1`. Continue panning left to load additional pages back to the beginning of available exchange history. Zooming out or keyboard navigation also triggers the same loading behavior. Demo and imported datasets keep their fixed local histories.

Each page is validated, sorted, and deduplicated before prepending. Existing candles, including the current live candle, cannot be overwritten by an older page. The viewport and active drag anchor shift by the number of prepended bars so the same candle stays at the same pixel. Candle spacing, manual price range, time/price drawing anchors, and live-following behavior are preserved. Indicators are recalculated once for the entire batch.

Only one older-history request runs at a time. Pagination stops when a page contains no earlier candles. **Loading earlier candles**, **Beginning of available history**, and **Retry history** provide feedback. Failed pages leave existing data and the live connection intact; retry repeats the same cursor. Rate-limited retries remain disabled until Binance's cooldown expires. Switching markets, timeframes, sources, or importing successfully aborts pending pages and ignores late responses. Pausing the live feed still allows earlier-history loading.

Loaded pages are retained in session memory and included in JSON exports; reloading starts again with the latest 1,000 candles. The 100,000-candle limit applies to imports, not a total history window. Large histories use more memory and increase the cost of the current full-history MA calculation. Pagination loads older history; it does not automatically repair an internal gap caused by an outage longer than the 1,000-candle reconnect snapshot.

## Data contract

Import a JSON array:

```json
[
  { "time": 1791676800000, "open": 100, "high": 105, "low": 98, "close": 103, "volume": 1200 },
  { "time": 1791680400000, "open": 103, "high": 108, "low": 102, "close": 106, "volume": 1450 }
]
```

`time` is a UTC timestamp in **milliseconds**. OHLC fields are finite numbers. High and low must contain open and close. Volume is optional (defaults to zero), finite, and non-negative. Imports are sorted; duplicate timestamps use the last record. Invalid imports leave current data intact. Limit: 100,000 candles / 25 MB. Import data remains in session memory, not localStorage. Switching a demo market/timeframe replaces the imported dataset; it does not resample it. Import drawings last for the current import session; demo drawings restore across reloads.

## Extend

- `src/model.ts`: pure data store, validation, scales, moving average, time lookup.
- `src/drawings.ts`: drawing validation, paths/labels, hit testing, move/resize geometry, and undo history.
- `src/drawing-tools.ts`: supported tool catalogue and grouped menu metadata.
- `src/magnet.ts`: pure OHLC snapping in CSS-pixel coordinates.
- `src/engine.ts`: rendering, viewport, interaction, redraw scheduling, drawing anchors.
- `demo/demo.ts`: sample symbols and deterministic synthetic history.
- `demo/binance.ts`: public REST/WebSocket adapter, validation, buffering, cancellation, and reconnects.
- `src/history.ts`: provider-independent historical pagination, single-request control, cancellation, retry, and end-of-history state.
- `demo/main.ts`: workspace UI, file actions, persistence, accelerated live simulator.
- `demo/style.css`: interface styling.
- `src/indicators.ts`: generic output validation and pane layout.
- `runtime/`: versioned artifact validation, bounded QuickJS execution, browser/Node workers.
- `server/`: provider adapters and local research/generation/check/repair API.
- `demo/ai-workspace.ts`, `demo/ai-controller.ts`: indicator chat, artifacts, and async lifecycle.

Import `ChartEngine` and `liquid-chart/style.css` from the package. Instantiate `ChartEngine` with a sized host element. Call `setData(candles)` to replace history, `update(candle)` for timestamp-based insertion/replacement, and `configure(options)` for styling. Subscribe for crosshair/viewport changes. Use `destroy()` when removing the engine.

Use `fitPrices()` to restore automatic price fitting, `resetView()` to reset both axes, and `followLatest()` to follow time while retaining a manual price range.

Use `prependData(candles)` to append earlier history to the left without resetting the viewport. It returns the number of newly prepended bars. Subscription state includes `firstVisibleIndex` for provider-independent history loading.

Use `configure({ priceScale: 'log' })` or `configure({ priceScale: 'linear' })` to request a scale. `chart.priceScale` and subscription state expose the effective scale; `chart.options.priceScale` retains the preference. `chart.store.supportsLogScale` reports whether the full dataset permits logarithmic scaling.

Use `setMagnet('off' | 'weak' | 'strong')` to configure anchor snapping.

The engine is independent of any UI framework. Add custom renderers beside the candle renderer, share the time/price scale functions, and keep user drawings anchored to market coordinates. A provider adapter should translate vendor data into the Candle contract; do not embed provider secrets in browser code.

## MVP boundaries

Demo prices are synthetic. Demo simulation updates every second and advances one timeframe every 10 seconds, so timestamps can move into the future. Only the selected market streams in either source. Binance supplies real spot candles in USDT; there is no broker, account, or order execution. The AI API is a separate local service. Demo timeframes generate separate sample histories; Binance timeframes request exchange candles. Drawings support creation, selection, moving/resizing, styling, deletion, and session undo/redo; Specialist tools such as channels, pitchforks, Gann tools, forecasting/positions, volume profiles, and advanced Fibonacci tools are not implemented. Text annotations and drawing locks are not implemented. Touch supports drag and one-pointer drawing; pinch zoom is not implemented. Browser storage is local to each browser profile. The optional Google Fonts stylesheet falls back to system fonts when unavailable.

Useful next steps: additional drawing families, shared demo resampling, additional indicator primitives, touch pinch zoom, internal gap recovery, and independent formula verification. Profile the renderer before introducing WebGL. The current MA recalculates across loaded history on an update; incremental indicator calculation is a future optimization for large streams.
