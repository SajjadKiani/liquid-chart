# AGENTS.md — LiquidChart

## Purpose and scope

LiquidChart is an npm chart-engine package with a separate browser workspace demo. The package contains the independently implemented Canvas renderer, model, drawing tools, magnet snapping, and provider-independent history pager. The demo uses public Binance spot data, synthetic data, and local imports. It has no trading or account connection.

- Do not introduce TradingView code, libraries, widgets, APIs, or branding.
- Keep the core chart renderer owned by this project. Do not replace it with a third-party charting library.
- Preserve customization as a first-class concern: chart appearance, renderers, indicators, and drawing tools should be independently extensible.
- Keep changes within the requested scope. User instructions take precedence over this file, including explicit changes to these constraints.

## Stack and commands

The project uses TypeScript, native browser APIs, Canvas 2D, and Vite. The interface currently uses plain DOM code; no UI framework is installed. Tests use the Node.js test runner with native TypeScript stripping.

Use Node.js 22.18+; Node.js 24 is recommended. Run commands from the project root:

```sh
npm install         # Install when dependencies are absent or changed
npm run dev         # Local development; binds to 127.0.0.1
npm test            # Core/demo tests and isolated packed-package consumer tests
npm run build       # Type-check, package into dist/, demo into demo-dist/
npm run build:lib   # Build ESM, declarations, embedded-source maps, and scoped CSS
npm run build:demo  # Build demo against the already-built package exports
npm run test:package # Verify actual tarball installation, exports, types, and lifecycle
npm pack            # prepack rebuilds library and creates an installable .tgz
npm run preview     # Preview a completed production demo
```

Keep dependency changes minimal and update `package-lock.json` when they are necessary. Edit source files rather than generated files in `dist/` or `demo-dist/` or dependencies in `node_modules/`.

## Code discovery

This project uses codebase-memory-mcp. ALWAYS prefer MCP graph tools over grep, glob, or file search for code discovery.

Graph project: `home-saji-custom-chart-mvp`.

The local graph snapshot is ignored by Git; retain it locally. Fresh clones can create their own graph by indexing the repository.

Priority order:

1. `search_graph` — find functions, classes, methods, and variables.
2. `trace_path` — trace callers and dependencies.
3. `get_code_snippet` — read specific function or class implementations.
4. `query_graph` — inspect more complex relationships.
5. `get_architecture` — review the project's structure and boundaries.

Use file tools for string literals, error messages, configuration values, and non-code files. Fall back to `rg` for code discovery when graph tools are unavailable or return insufficient results. Refresh a stale graph with `index_repository`; index the project after substantial structural changes. Exclude generated output and dependencies from discovery. Preserve the existing `.codebase-memory/` artifacts.

## Architecture boundaries

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Public package exports and createChart factory. |
| `src/chart.css` | Scoped engine-only host/canvas CSS; never global workspace styles. |
| `src/model.ts` | Candle validation and storage, scales, coordinate math, time lookup, and moving averages. Keep it free of DOM and browser dependencies. |
| `src/drawings.ts` | Validated drawing storage, paths/labels, hit testing, move/resize geometry, and undo history. |
| `src/drawing-tools.ts` | Supported drawing catalogue and grouped toolbar metadata. |
| `src/magnet.ts` | Pure CSS-pixel OHLC anchor snapping for linear/log scales. |
| `src/engine.ts` | Canvas rendering, viewport management, input handling, redraw scheduling, drawing geometry, and chart subscriptions. |
| `demo/demo.ts` | Synthetic instruments, timeframes, and reproducible sample history. |
| `demo/binance.ts` | Public Binance REST/WebSocket adapter, validation, buffering, lifecycle, and reconnects. |
| `src/history.ts` | Provider-independent older-history pagination, cancellation, retry, and end-of-history state. |
| `demo/main.ts` | Workspace UI, browser storage, import/export, and simulated streaming. |
| `demo/style.css` | Responsive interface styling. |
| `tests/` | Meaningful model tests and valid/invalid import fixtures. |

The dependency direction is demo UI → package public API → engine → model. Keep the package at zero runtime dependencies. Package exports are ESM JavaScript, declarations, model/history subpaths, and CSS. Only dist/, README.md, and package metadata belong in the tarball. No demo UI, provider adapters, storage, tests, or secrets belong in the distribution. Use development aliases for live source edits; production demo builds must resolve built exports. The license is UNLICENSED until the user explicitly chooses another license; do not publish an npm release without a user request.

The engine host receives a scoped liquid-chart-host class; preserve existing classes and remove engine listeners/observers/canvases during destroy(). Importing the JS must remain safe without a DOM; browser APIs are used only when creating a chart.

The dependency direction remains UI → engine → model. Demo data belongs outside the engine. Keep file pickers, localStorage, timers for simulation, provider-specific logic, and workspace controls out of the core model.

Preserve the engine's public entry points: `setData`, `update`, `configure`, `subscribe`, and `destroy`. If a change requires a different contract, update callers and document the change. Share coordinate math across renderers and tools instead of duplicating it.

## Market-data contract

- Use UTC Unix timestamps in **milliseconds** at the data boundary. Label displayed times clearly; do not silently mix seconds, milliseconds, or local time.
- Store candles in ascending timestamp order with one candle per timestamp. Repeated timestamps replace the existing candle, rather than appending duplicates.
- OHLC values must be finite numbers; high and low must contain open and close. Do not impose positivity unless the target instrument requires it.
- Volume is finite and non-negative; omitted import volume defaults to zero.
- Validate a complete imported batch before replacing existing data. Failed imports must preserve the current chart.
- Preserve the existing import limits of 100,000 candles and 25 MB unless deliberately changed and documented.
- Treat inputs from files, providers, and browser storage as untrusted. Validate restored data and show useful errors without losing the active dataset.

When adding a market-data provider, create a separate adapter that produces the project's candle contract. Keep API secrets on a backend. Chart rendering must not depend directly on a vendor's response format.

## Rendering and interaction invariants

- Use Canvas 2D initially. Introduce workers, WebGL, or other rendering infrastructure only when requirements or profiling justify it.
- Draw the visible range instead of processing all loaded candles during each paint.
- Coalesce redraws through `requestAnimationFrame`. Keep crosshair and drawing overlays separate from base chart redraws where practical.
- Keep calculations in CSS pixels and size canvas backing buffers using `devicePixelRatio`. Check resize and high-DPI behavior after rendering changes.
- Keep price↔pixel transformations consistent and invertible. Handle empty or flat price ranges and very short histories without invalid coordinates.
- Preserve the candle beneath the pointer when zooming, except where viewport bounds require clamping.
- Prepending history must preserve candle pixel positions and active drag anchors. Validate a page atomically and keep overlaps from overwriting live candles. Use `firstVisibleIndex` subscription state for earlier-history loading; allow one request per pager and cancel it on dataset changes.
- Keep historical views stable when inserting older data. Incoming live bars must not force a user browsing history back to the latest candle.
- Store drawing anchors as timestamps and prices, never screen pixels or unstable array indexes.
- Keep committed drawing objects immutable so undo snapshots can share unchanged shapes. Treat a completed stroke or edit drag as one action; cancelled edits restore the original. Preserve legacy trendline/horizontal storage and validate brush points/styles on restore.
- Preserve keyboard navigation and pointer capture behavior. Cancel gestures cleanly and avoid hijacking shortcuts while users are typing.
- Clean up observers, subscriptions, animation frames, event listeners, and timers when destroying or replacing chart/UI instances.

Indicator calculations must handle warmup periods and missing data explicitly. If adding aggregation or downsampling, preserve open-first, high-maximum, low-minimum, close-last, and summed-volume semantics. Do not apply ordinary line-series sampling to OHLC data.

## Generated indicator boundaries

- Core `src/` renders generic validated outputs; no formula catalogue or AI provider logic belongs in the package.
- `runtime/` validates versioned/hash-checked artifacts and runs generated code in bounded QuickJS contexts inside terminable browser/Node workers. Never use host eval/new Function or give generated code DOM/network/filesystem/environment access.
- `server/` selects OpenRouter/OpenAI/NaraRouter or a generic Chat Completions endpoint, preserves actual sources when web research is used, bounds generation/repair/deadlines, and keeps secrets server-side. Preserve user-selected models and provider base URLs. Never invent a production AI result when credentials or provider calls fail.
- `demo/ai-workspace.ts` owns artifacts, scope persistence, numeric parameters, and explicit recalculation on data changes; subscriptions/redraws must not trigger calculation loops. Discard stale scope/data jobs and commit chart/state changes atomically.
- Generic outputs support overlays and four independent panes, lines/histograms/bands/levels, finite or null warmup samples and generic bar offsets. Package imports stay DOM-safe and runtime dependencies stay zero. AI/runtime/demo files must remain outside the engine tarball.
- NaraRouter and generic Chat Completions can generate from model knowledge when search is unavailable, as explicitly authorized by the user. Record Web research skipped, keep sources empty, and never label model recall as web research or invent citations. Do not hide authentication/model/quota errors behind a fallback.
- Band outputs contain paired values (both null for gaps); offsets are integer candle positions from -500 to 500. Keep timestamps candle-linked. Draw clouds behind candles and split fills at crossings. No indicator formula belongs in the renderer.
- Smoke/schema checks do not establish formula correctness. Keep sources, assumptions, and limitations visible. The local AI service lacks production authentication/tenant isolation.

## Interface and persistence

- Keep simulated data clearly labeled. Imported data must be labeled as imported rather than simulated or exchange-connected.
- Label Binance spot data in USDT. Keep displayed source/pair labels tied to loaded candles while new requests are pending; never silently relabel demo data as live data. Preserve provider cancellation and reconnect history refresh. No API keys are needed for public market data.
- Demo drawings are scoped by market and timeframe. Style options persist in localStorage. Imported candles and drawings currently remain session-only.
- Handle unavailable or corrupt browser storage gracefully; the chart should remain usable without persistence.
- Use safe DOM updates for filenames, symbols, or provider text. Do not interpolate untrusted strings into `innerHTML`.
- Keep controls functional, keyboard accessible, and labeled. Verify the layout on a narrow screen when changing workspace structure.
- Keep the interface focused on charting. Avoid adding unrelated product features or nonfunctional placeholder controls.

## Current MVP limitations

The simulator updates every second and creates a candle every 10 seconds, advancing by the selected timeframe. Timestamps can move into the future. Only the selected demo market streams; demo timeframes generate separate histories rather than resampling a shared feed.

Binance public spot candles are connected, with the latest 1,000 bars loaded and refreshed on reconnect. Panning left fetches older pages until available history ends. Loaded pages remain in session memory and are not capped by the import limit. Pagination does not automatically recover internal gaps from outages longer than the reconnect snapshot. There is a local AI development backend; no broker, account system, or order execution. Drawing tools support 21 tools in grouped menus, selection, moving/resizing, styling, deletion, and undo/redo. Off/Weak/Strong magnet modes snap geometric anchors to OHLC; Alt bypasses snapping. Freehand strokes and whole-shape movement remain free. Channels, pitchforks, Gann, forecasting/positions, volume profiles, advanced Fibonacci tools, text, and drawing locks are not implemented. Undo history is session-only and resets on dataset changes; drawings are limited to 1,000 per chart with at most 2,000 points per brush stroke. Touch supports dragging and single-pointer drawing, but not pinch zoom. The moving average currently recalculates over loaded history on each update.

Treat these as documented limitations, not completed capabilities. Update `README.md` and relevant UI guidance when implementing or changing them.

## Verification and handoff

- For model, engine, or data-flow changes, run `npm test` and `npm run build`. Package/build/export changes must pass packed-consumer tests with strict NodeNext and Bundler type resolution and a standalone browser rendering check.
- For UI or styling changes, run `npm run build` and verify affected browser interactions. Run model tests if shared behavior also changed.
- Add focused tests for new math, data invariants, or reproduced bugs. Avoid tests that only restate implementation details.
- Documentation-only edits do not require application tests.
- For affected chart behavior, check pan/zoom, follow mode, crosshair readout, resizing, and short histories. For affected data controls, check valid import, invalid import preserving data, export, and demo/import mode transitions.
- Use the existing valid/invalid JSON fixtures for import checks. Do not overwrite user datasets or clear unrelated browser storage while testing.
- Report what changed, what was actually verified, and any remaining limitation. Keep setup instructions and architecture notes in `README.md` current.
