# Generated indicators implementation plan

## Objective

Deliver an AI chart workspace: chat on the left, LiquidChart on the right. The backend researches a requested indicator, generates a JavaScript program, checks it in an isolated runtime, and returns a versioned artifact. The browser executes the saved program against current candles and renders generic series/panes. There is no indicator-name dispatch table or built-in RSI/EMA generation fallback.

The primary agent acts as judge and integrator. Three GPT-6 Luna agents implement separate lanes; all changes require review, meaningful tests, a production build, packed-library checks, and browser verification before acceptance.

## Boundaries

- `src/`: zero-runtime-dependency chart package. Generic indicator rendering and output validation only.
- `runtime/`: companion QuickJS/WASM interpreter, bounded execution, browser Worker client, program artifact validation. This is excluded from the core npm tarball.
- `server/`: local Node/TypeScript AI service, selectable OpenRouter/OpenAI adapters, research → specification → generation → test → bounded repair workflow. Secrets remain here. This is excluded from the npm tarball.
- `demo/`: chat/workspace UI, dataset lifetime, parameter editing, persistence, undo/remove, progress and error feedback.
- Root agent owns dependency/configuration changes, documentation, integration, adversarial review, and final handoff.

## Agreed contracts

Core exports:

```ts
type IndicatorPoint = { time: number; value: number | null };
type IndicatorPane = { id: string; title: string; range?: [number, number]; levels?: { value: number; color?: string; label?: string }[] };
type IndicatorSeriesBase = { id: string; name: string; paneId: string; color: string; offset?: number };
type IndicatorSeries = IndicatorSeriesBase & (
  { type: 'line' | 'histogram'; points: IndicatorPoint[]; baseline?: number } |
  { type: 'band'; points: { time: number; value: number | null; value2: number | null }[]; negativeColor?: string }
);
type IndicatorOutput = { panes: IndicatorPane[]; series: IndicatorSeries[] };
// paneId 'price' denotes the candle overlay; other ids identify independent panes.
chart.setIndicator(id: string, output: IndicatorOutput): void;
chart.removeIndicator(id: string): void;
chart.clearIndicators(): void;
```

MVP drawing primitives for generated indicators are lines, histograms, filled bands, and pane reference levels. Generic integer offsets from -500 to 500 shift series by candle positions while preserving candle-linked timestamps. Bands use paired null warmup values and split fills at crossings. Markers can extend this contract later. Inputs/outputs must be finite, ordered, bounded, and validated atomically. Candle timestamps remain UTC milliseconds. Warmup is represented by null values; it must not connect gaps in lines. Pane time coordinates and crosshair are synchronized. Existing candle/drawing/magnet/data functionality remains intact.

Generated artifact, owned by the runtime lane:

```ts
type IndicatorProgram = {
  version: 1; id: string; name: string; description: string;
  code: string; // declares function calculate(candles, parameters) returning IndicatorOutput
  parameters: { key: string; label: string; type: 'number'; default: number; min: number; max: number; step: number }[];
  sources: { title: string; url: string }[];
  assumptions: string[]; createdAt: string; codeHash: string;
};
```

Runtime API: `validateProgram(value)`, `executeIndicator(program, candles, parameters?, limits?) → Promise<IndicatorOutput>`. Browser client: `IndicatorWorkerClient.execute(program, candles, parameters?)`, `destroy()`. Each invocation uses an isolated context with no application, DOM, filesystem, network, or environment capabilities. Enforce interpreter memory/stack/interrupt limits plus a host Worker timeout and input/output limits. Reject malformed results and recover after failures. No host eval/new Function on generated source.

Backend API: `GET /api/ai/status → {configured:boolean}` and `POST /api/indicators/generate` accepting `{request:string, previous?:IndicatorProgram, webSearch?:boolean}`. Return newline-delimited JSON events `{type:'progress',stage,message}`, `{type:'result',program}`, or `{type:'error',message}`. Cancel on client disconnect. Validate request/body sizes and artifact restoration; permit requests only from the local workspace origin. Bind loopback. Missing API credentials produce an honest configuration error, never synthetic AI output. Research requests actual web search and preserves returned sources. The UI checkbox defaults on and persists locally; webSearch=false bypasses research entirely. Unavailable search may fall back transparently to model knowledge with empty sources; auth/quota errors remain explicit. Code generation uses a strict envelope schema with application validation. OpenRouter models without Structured Outputs receive a JSON-only schema prompt; malformed responses fail or enter the bounded repair path. Semantic validation and tests remain application-owned. At most two repair attempts, bounded total deadline, and recorded check results. Parameter-only edits run the saved artifact; formula edits create a new version.

## Implementation lanes

1. **Renderer Luna** — `src/indicators.ts`, engine integration/public exports, pane layout, scales/crosshair, visible-range drawing, pure validation/layout tests. No application or runtime code.
2. **Runtime/backend Luna** — `runtime/`, `server/`, isolated execution, artifact validation/hash, real provider workflow, cancellation/repair tests using injected provider fixtures, adversarial runtime tests. No package/config/UI edits.
3. **Workspace Luna** — `demo/ai-workspace.ts`, chat-left/chart-right layout, safe DOM, progress/cancellation, parameter editing, code/source inspection, saved artifacts, undo/remove and Worker recalculation lifecycle. No source engine/server/config edits.

## Acceptance gates

- Existing tests pass and package remains free of runtime dependencies and AI/demo files.
- Strict typecheck and production builds pass; external packed-package consumer can use generic series/panes.
- Runtime handles valid custom programs, loops, allocation pressure, denied host capabilities, invalid data/outputs, and recovery after an error.
- Backend fixtures exercise actual research → generation → tests → repair flow and cancellation. Fixtures are test-only; live UI never substitutes them for AI.
- Browser checks: candle overlays and independent pane, log scale, pan/zoom/follow, resizing, drawing/magnet preservation, runtime errors, indicator parameters/removal/undo, stale-result protection across market/source/timeframe switches, and narrow layout.
- Real generation through the configured provider is verified if credentials are available; otherwise record that limitation explicitly and leave a working configuration path.
- Update README/AGENTS and this plan with final verified scope. Retain UNLICENSED and do not publish an npm release.

## Implementation and review status

- All three Luna implementation lanes completed and were reviewed by the primary judge. Revisions fixed renderer limits/geometry, stale job handling, atomic UI commits, keyboard import, citation parsing, cancellation, and timeout cleanup.
- Package remains UNLICENSED with zero runtime dependencies; AI service/runtime stay outside its distribution.
- Current full test run: 126 passed, including strict external packed-consumer imports/types. Production build passes.
- Browser verification covered production Worker/WASM execution, overlay/pane rendering, infinite-loop rejection and subsequent recovery, native numeric parameter updates, removal/undo, market scope restoration, log scale, pan/crosshair, drawings, three-candle history, invalid import preserving state, and responsive layout.
- Earlier provider attempts returned rate limits, unavailable-model errors, or no verified web citations. With the latest configured OpenRouter DeepSeek model and Web search unchecked, a real request successfully generated Wilder RSI and rendered it against 1,000 Binance candles. No fixture was substituted for AI output.
- Final reviewed build and all 126 tests pass. At both 864px and 390px viewport checks, the sidebar and page have no horizontal overflow; saved numeric parameters restore after reload. Knowledge-graph refresh was attempted but its MCP transport was unavailable.
- Indicator formula correctness is evaluated separately from execution/schema checks. Sources, assumptions, and validation status must remain visible; AI-written tests alone are not proof of correctness.

## Manual search control verification (2026-10-12)

- The Web search checkbox defaults on, persists locally, sends a strict boolean, and locks during generation. Disabling it bypasses provider research completely and records user-disabled provenance with no source links.
- Actual UI verification covered successful AI-generated RSI, numeric period editing, live recalculation, removal/undo, dataset scope isolation, reload persistence, search-enabled progress and cancellation, and the 390px responsive layout without horizontal overflow. The enabled research request was cancelled for the cancellation check; successful cited web research with this model remains unverified.
- The exported generated RSI ran in QuickJS and matched a separately written Wilder calculation on 1,000 exported Binance candles at periods 2, 14, 15, and 100 (tolerance 1e-10). Flat, rising-only, and falling-only histories produced 50, 100, and 0 respectively. This checks this artifact and requested variant, not every possible generated indicator.
- Final full suite: 116 passing tests; production build and diff whitespace checks pass.

## Ichimoku/cloud support verification (2026-10-12)

- Reproduced a real Ichimoku generation request failing with the previous 6,000-token truncation error. OpenRouter now defaults to a configurable 16,000-token budget and low reasoning, with one full higher-budget retry capped at 32,000 under the existing deadline. Truncated code is never executed. Authentication, quota, cancellation, and policy failures do not retry. String policy errors are redacted and surfaced explicitly.
- The core now renders generic paired-value bands and integer bar offsets, without an indicator formula catalogue. Bands draw behind candles, split at crossings in screen space on linear/log scales, preserve null gaps, and include shifted visible bounds in auto scaling. Follow mode reserves projection space; historical views remain stable.
- Real generation retry was blocked by HTTP 403: the configured OpenRouter host returned Access denied by security policy, including on its unauthenticated model catalog. Binance browser requests also failed. This prevents claiming successful real AI Ichimoku generation.
- Imported a clearly labeled manually authored Ichimoku renderer validation fixture against 1,800 paused synthetic candles. Full cloud, five lines, forward/backward displacement, green/red crossing fills, numeric displacement edits, linear/log rendering, historical panning, removal/undo, and follow mode were verified in the UI. The fixture is explicitly labeled Imported code and is not a substituted AI result.
- Isolated fixture execution verified standard rolling midpoint expectations, warmup nulls, paired cloud bounds, original timestamps, and positive/negative offsets. Short three-candle warmup, source restoration, live demo recalculation, divider resizing, and a 390px viewport without horizontal overflow also passed. Final full suite: 126 passing tests, production build passes, diff whitespace checks pass. Knowledge-graph refresh was attempted but MCP transport remained unavailable.

## Successful real Ichimoku retry (2026-10-12)

- On the user-requested retry, the unchanged configured OpenRouter DeepSeek model successfully returned a new Ichimoku program. The earlier HTTP 403 access-policy block was absent on this request. Web search remained disabled.
- The real generated artifact was validated and applied to 1,802 demo candles through the actual UI. Removed the prior manually imported validation fixture from that demo scope so only the generated cloud is displayed. The generated artifact remains saved locally and has empty citations with explicit user-disabled research provenance.
- Exported the actual generated code and chart candles through UI download controls. Executed the program in QuickJS and compared every series value against independently calculated rolling high/low midpoints at two parameter sets (standard 9/26/52/26 and 5/20/40/15), tolerance 1e-10. Checked paired warmup nulls, unchanged timestamps, both leading offsets and the lagging offset. All checks passed.
- Verified native UI displacement editing (26 to 27 and back) and visible cloud rendering. Code was unchanged since the 126 passing tests and successful production build. Saved proof: generated-ichimoku-cloud.png; exported actual artifact: generated-ichimoku.indicator.json.
