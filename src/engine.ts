import { CandleStore, movingAverage, priceRange, priceTicks, priceToY, yToPrice, timeToIndex, indexToTime, zoomRightEdge, scrollPriceRange, timeViewportBounds, zoomPriceRange } from './model.ts';
import { DrawingHistory, DEFAULT_DRAWING_STYLE, MAX_BRUSH_POINTS, MAX_DRAWINGS, drawingStyle, drawingPaths, drawingLabels, drawingHandles, hitDrawing, moveDrawing, resizeDrawing, restoreDrawings } from './drawings.ts';
import { freehand, singlePoint, boxShape } from './drawing-tools.ts';
import { snapToCandle } from './magnet.ts';
import type { MagnetMode, Snap } from './magnet.ts';
import type { Projection, Handle } from './drawings.ts';
import type { Anchor, Candle, Drawing, Tool, PriceScale } from './model.ts';
import { validateIndicatorOutput, indicatorRange, indicatorDataRange, indicatorPriceRange, indicatorY, indicatorValueAtY, indicatorLineSegments, bandPolygons, indicatorLayout, MAX_INDICATOR_PANES, MAX_INDICATOR_SERIES, MAX_INDICATOR_TOTAL_POINTS } from './indicators.ts';
import type { BandVertex, IndicatorOutput, IndicatorPane, IndicatorSeries } from './indicators.ts';

export type ChartOptions = {
  upColor: string; downColor: string; upBorderColor: string; downBorderColor: string; showVolume: boolean; showMA: boolean;
  backgroundColor: string; gridColor: string;
  style: 'candles' | 'line'; maPeriod: number; priceScale: PriceScale;
};
export type ChartState = { candle: Candle | null; following: boolean; visible: number; firstVisibleIndex: number; tool: Tool; drawings: number; selectedDrawing: Drawing | null; canUndo: boolean; canRedo: boolean; priceScale: PriceScale; logAvailable: boolean; autoPrice: boolean };
type Point = { x: number; y: number };
type PaneFrame = { key: string; title: string; top: number; bottom: number; plotTop: number; plotBottom: number; range: [number, number]; pane: IndicatorPane; series: IndicatorSeries[] };
type Frame = { width: number; height: number; priceBottom: number; volumeTop: number; bottom: number; low: number; high: number; left: number; priceScale: PriceScale; panes?: PaneFrame[] };
type Gesture = { x: number; y: number; right: number; spacing: number; offset: number; base: [number, number]; range: [number, number]; scale: PriceScale; mode: 'pan' | 'price-zoom' | 'time-zoom'; horizontal: boolean; vertical: boolean; indicatorPane: boolean };

export class ChartEngine {
  readonly store = new CandleStore();
  readonly canvas = document.createElement('canvas');
  readonly overlay = document.createElement('canvas');
  private manualPrice: { base: [number, number]; offset: number; scale: PriceScale } | null = null;
  options: ChartOptions = { upColor: '#5cc9af', downColor: '#dc7883', upBorderColor: '#5cc9af', downBorderColor: '#dc7883', backgroundColor: '#141b1e', gridColor: '#20282b', showVolume: true, showMA: true, style: 'candles', maPeriod: 20, priceScale: 'linear' };
  drawings: Drawing[] = [];
  tool: Tool = 'cursor';
  following = true;
  spacing = 9;
  right = 0;
  private ctx: CanvasRenderingContext2D;
  private over: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private cursor: Point | null = null;
  private drag: Gesture | null = null;
  private pending: Anchor | null = null;
  private sketch: { kind: Drawing['kind']; points: Anchor[]; start: Point; last: Point; projection: Projection; moved: boolean } | null = null;
  private editing: { drawing: Drawing; before: Drawing[]; start: Point; projection: Projection; handle: Handle | null; moved: boolean } | null = null;
  private selectedId: string | null = null;
  private drawingRange: [number, number] | null = null;
  private drawingHistory = new DrawingHistory();
  drawingStyle = { ...DEFAULT_DRAWING_STYLE };
  magnet: MagnetMode = 'off';
  private snap: Snap | null = null;
  private bypassMagnet = false;
  private frame: Frame | null = null;
  private raf = 0;
  private dirty = true;
  private average: (number | null)[] = [];
  private indicators = new Map<string, IndicatorOutput>();
  private listeners = new Set<(state: ChartState) => void>();
  private host: HTMLElement;
  private addedHostClass = false;
  private destroyed = false;
  onDrawingsChange: (drawings: Drawing[]) => void = () => {};

  get priceScale(): PriceScale {
    return this.options.priceScale === 'log' && this.store.supportsLogScale ? 'log' : 'linear';
  }

  constructor(host: HTMLElement, options: Partial<ChartOptions> = {}) {
    this.host = host;
    this.options = { ...this.options, ...options };
    this.addedHostClass = !host.classList.contains('liquid-chart-host');
    host.classList.add('liquid-chart-host');
    this.ctx = this.canvas.getContext('2d')!;
    this.over = this.overlay.getContext('2d')!;
    this.canvas.className = 'chart-canvas';
    this.overlay.className = 'chart-overlay';
    this.overlay.tabIndex = 0;
    this.overlay.setAttribute('role', 'img');
    this.overlay.setAttribute('aria-label', 'Interactive price chart. Drag the plot to pan. Drag or scroll the price axis to zoom vertically; drag or scroll the time axis to zoom horizontally. Shift-scroll pans time, Alt-scroll pans price. Arrow keys pan, plus or minus zoom time, Home follows latest, and A fits prices.');
    host.append(this.canvas, this.overlay);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.overlay.addEventListener('pointerdown', this.pointerDown);
    this.overlay.addEventListener('pointermove', this.pointerMove);
    this.overlay.addEventListener('pointerup', this.pointerUp);
    this.overlay.addEventListener('pointercancel', this.pointerCancel);
    this.overlay.addEventListener('lostpointercapture', this.pointerCancel);
    this.overlay.addEventListener('pointerleave', this.pointerLeave);
    this.overlay.addEventListener('wheel', this.wheel, { passive: false });
    this.overlay.addEventListener('dblclick', this.doubleClick);
    this.overlay.addEventListener('keydown', this.keyDown);
    this.resize();
  }

  subscribe(listener: (state: ChartState) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  setData(candles: Candle[]): void {
    this.store.setData(candles);
    this.indicators.clear();
    this.cancelDrawingGesture();
    this.average = movingAverage(this.store.candles, this.options.maPeriod);
    this.cursor = null;
    this.pending = null;
    this.resetView();
  }

  setIndicator(id: string, output: IndicatorOutput): void {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(id)) throw new Error('Indicator id must be a short identifier.');
    const validated = validateIndicatorOutput(output);
    const candidate = new Map(this.indicators);
    candidate.set(id, validated);
    const totals = [...candidate.values()].reduce((sum, item) => {
      sum.panes += item.panes.length;
      sum.series += item.series.length;
      for (const series of item.series) sum.points += series.points.length;
      return sum;
    }, { panes: 0, series: 0, points: 0 });
    if (candidate.size > 20 || totals.panes > MAX_INDICATOR_PANES || totals.series > MAX_INDICATOR_SERIES || totals.points > MAX_INDICATOR_TOTAL_POINTS) {
      throw new Error('Indicator layers exceed the chart-wide owner, pane, series, or point limit.');
    }
    this.indicators.set(id, validated);
    if (this.following) this.right = this.latestRight();
    this.clampViewport();
    this.invalidate();
  }

  removeIndicator(id: string): void {
    if (this.indicators.delete(id)) { if (this.following) this.right = this.latestRight(); this.clampViewport(); this.invalidate(); }
  }

  clearIndicators(): void {
    if (this.indicators.size) { this.indicators.clear(); if (this.following) this.right = this.latestRight(); this.clampViewport(); this.invalidate(); }
  }

  update(candle: Candle): void {
    const result = this.store.upsert(candle);
    // Preserve the same historical viewport when a bar is inserted before it.
    if (result.inserted && !this.following && result.index < this.right) this.right += 1;
    if (this.following && !this.sketch && !this.editing) this.right = this.latestRight();
    this.average = movingAverage(this.store.candles, this.options.maPeriod);
    this.invalidate();
  }

  prependData(candles: Candle[]): number {
    const added = this.store.prepend(candles);
    if (!added) return 0;
    // Every existing bar's index moves by the same amount. Keep its screen position,
    // including the original viewport used by any drag still in progress.
    this.right += added;
    if (this.drag) this.drag.right += added;
    this.average = movingAverage(this.store.candles, this.options.maPeriod);
    this.invalidate();
    return added;
  }

  configure(options: Partial<ChartOptions>): void {
    const scale = this.priceScale;
    this.options = { ...this.options, ...options };
    if (this.priceScale !== scale) { this.cancelDrawingGesture(); this.pending = null; this.manualPrice = null; }
    this.average = movingAverage(this.store.candles, this.options.maPeriod);
    this.invalidate();
  }

  setMagnet(mode: MagnetMode): void {
    if (!['off', 'weak', 'strong'].includes(mode)) return;
    this.magnet = mode; this.snap = null; this.invalidate(false);
  }

  setTool(tool: Tool): void {
    this.cancelDrawingGesture();
    this.tool = tool;
    this.pending = null;
    this.selectedId = null;
    this.overlay.style.cursor = tool === 'cursor' ? 'crosshair' : 'copy';
    this.invalidate(false);
  }

  setDrawings(drawings: Drawing[]): void {
    this.cancelDrawingGesture();
    this.drawings = restoreDrawings(drawings);
    this.selectedId = null;
    this.drawingHistory.reset();
    this.pending = null;
    this.invalidate(false);
  }

  clearDrawings(): void {
    this.cancelDrawingGesture(); this.pending = null;
    if (this.drawings.length) this.commitDrawings([]);
    this.selectedId = null;
    this.invalidate(false);
  }

  deleteSelectedDrawing(): void {
    if (!this.selectedId) return;
    this.cancelDrawingGesture();
    this.commitDrawings(this.drawings.filter(d => d.id !== this.selectedId));
    this.selectedId = null;
  }

  undoDrawing(): void {
    this.cancelDrawingGesture(); this.pending = null;
    const previous = this.drawingHistory.undo(this.drawings);
    if (previous) { this.drawings = previous; this.selectedId = null; this.onDrawingsChange(this.drawings); this.invalidate(false); }
    this.invalidate();
  }

  redoDrawing(): void {
    this.cancelDrawingGesture(); this.pending = null;
    const next = this.drawingHistory.redo(this.drawings);
    if (next) { this.drawings = next; this.selectedId = null; this.onDrawingsChange(this.drawings); this.invalidate(false); }
    this.invalidate();
  }

  setDrawingStyle(style: Partial<{ color: string; width: number }>): void {
    const selected = this.drawings.find(d => d.id === this.selectedId);
    const next = { ...(selected ? drawingStyle(selected) : this.drawingStyle) };
    if (typeof style.color === 'string' && /^#[0-9a-f]{6}$/i.test(style.color)) next.color = style.color;
    if (typeof style.width === 'number' && Number.isFinite(style.width) && style.width >= 1 && style.width <= 6) next.width = style.width;
    this.drawingStyle = next;
    if (selected && (drawingStyle(selected).color !== next.color || drawingStyle(selected).width !== next.width)) this.commitDrawings(this.drawings.map(d => d.id === selected.id ? { ...d, ...next } : d));
    this.invalidate(false);
  }

  private commitDrawings(next: Drawing[], previous = this.drawings): void {
    this.drawingHistory.record(previous);
    this.drawings = next;
    this.onDrawingsChange(this.drawings);
    this.invalidate(false);
  }

  private cancelDrawingGesture(): void {
    const hadGesture = !!this.editing || !!this.sketch;
    if (this.editing) this.drawings = this.editing.before;
    this.editing = null; this.sketch = null; this.drawingRange = null; this.snap = null;
    if (hadGesture) this.invalidate();
  }

  resetView(): void {
    this.spacing = 9;
    this.manualPrice = null;
    this.followLatest();
  }

  fitPrices(): void { this.manualPrice = null; this.invalidate(); }

  private panPrices(pixels: number): void {
    if (!this.frame) return;
    this.manualPrice ??= { base: [this.frame.low, this.frame.high], offset: 0, scale: this.frame.priceScale };
    this.manualPrice.offset += pixels / Math.max(1, this.frame.priceBottom - 18);
    this.invalidate();
  }

  private zoomPrices(factor: number, y: number, range?: [number, number]): void {
    if (!this.frame) return;
    const f = this.frame;
    const base = zoomPriceRange(range ?? (this.manualPrice ? scrollPriceRange(this.manualPrice.base, this.manualPrice.offset, f.priceScale) : [f.low, f.high]), factor, (y - 18) / Math.max(1, f.priceBottom - 18), f.priceScale);
    this.manualPrice = { base, offset: 0, scale: f.priceScale };
    this.invalidate();
  }

  followLatest(): void {
    this.following = true;
    this.right = this.latestRight();
    this.invalidate();
  }

  zoom(factor: number, x = (this.frame?.width ?? this.width) / 2): void {
    this.zoomTimeFrom(this.right, this.spacing, factor, x);
  }

  private zoomTimeFrom(right: number, previousSpacing: number, factor: number, x: number): void {
    const width = this.frame?.width ?? Math.max(1, this.width - 82);
    const spacing = Math.max(3, Math.min(48, previousSpacing * factor));
    this.right = zoomRightEdge(right, width, previousSpacing, spacing, Math.max(0, Math.min(width, x)));
    this.spacing = spacing;
    this.following = false;
    this.clampViewport();
    this.invalidate();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelDrawingGesture();
    this.drag = null; this.pending = null; this.cursor = null;
    this.observer.disconnect();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.overlay.removeEventListener('pointerdown', this.pointerDown);
    this.overlay.removeEventListener('pointermove', this.pointerMove);
    this.overlay.removeEventListener('pointerup', this.pointerUp);
    this.overlay.removeEventListener('pointercancel', this.pointerCancel);
    this.overlay.removeEventListener('lostpointercapture', this.pointerCancel);
    this.overlay.removeEventListener('pointerleave', this.pointerLeave);
    this.overlay.removeEventListener('wheel', this.wheel);
    this.overlay.removeEventListener('dblclick', this.doubleClick);
    this.overlay.removeEventListener('keydown', this.keyDown);
    this.canvas.remove();
    this.overlay.remove();
    if (this.addedHostClass) this.host.classList.remove('liquid-chart-host');
    this.listeners.clear();
    this.onDrawingsChange = () => {};
  }

  private state(): ChartState {
    const data = this.store.candles;
    let candle = data[data.length - 1] ?? null;
    if (this.cursor && this.frame) {
      const index = Math.round(this.frame.left + this.cursor.x / this.spacing - 0.5);
      candle = data[index] ?? null;
    }
    const width = this.frame?.width ?? Math.max(1, this.width - 82);
    return { candle, following: this.following, visible: Math.min(data.length, Math.ceil(width / this.spacing)), firstVisibleIndex: Math.max(0, Math.floor(this.right - width / this.spacing)), tool: this.tool, drawings: this.drawings.length, selectedDrawing: this.drawings.find(d => d.id === this.selectedId) ?? null, canUndo: this.drawingHistory.canUndo, canRedo: this.drawingHistory.canRedo, priceScale: this.priceScale, logAvailable: this.store.supportsLogScale, autoPrice: this.manualPrice === null };
  }

  private emit(): void { const state = this.state(); for (const listener of this.listeners) listener(state); }

  private resize(): void {
    if (this.sketch || this.editing) this.cancelDrawingGesture();
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.dpr = window.devicePixelRatio || 1;
    for (const canvas of [this.canvas, this.overlay]) {
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
    }
    if (this.following) this.right = this.latestRight();
    else this.clampViewport();
    this.invalidate();
  }

  private invalidate(base = true): void {
    if (this.destroyed) return;
    this.dirty ||= base;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.dirty) { this.render(); this.dirty = false; }
      this.renderOverlay();
      this.emit();
    });
  }

  private clampViewport(): void {
    const [minimum, maximum] = timeViewportBounds(this.store.candles.length, Math.max(1, this.width - 82), this.spacing);
    this.right = Math.max(minimum, Math.min(maximum + this.maxPositiveIndicatorOffset(), this.right));
  }

  private maxPositiveIndicatorOffset(): number {
    let maximum = 0;
    for (const output of this.indicators.values()) for (const series of output.series) maximum = Math.max(maximum, series.offset ?? 0);
    return maximum;
  }

  private latestRight(): number {
    const visible = Math.max(1, this.width - 82) / this.spacing;
    // Keep short imported histories visible even at maximum zoom on a phone.
    const margin = Math.max(Math.min(6, Math.max(0, (visible - 1) / 2)), Math.min(this.maxPositiveIndicatorOffset(), Math.max(0, visible - 1)));
    return this.store.candles.length + margin;
  }

  private point(event: MouseEvent): Point {
    const rect = this.overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private gestureMode(p: Point): Gesture['mode'] | null {
    if (!this.frame || p.x < 0 || p.y < 0) return null;
    if (p.x <= this.frame.width && p.y >= this.frame.bottom) return 'time-zoom';
    if (p.x > this.frame.width && p.y > this.frame.priceBottom) return null;
    if (p.y > this.frame.priceBottom && !this.frame.panes?.some(pane => p.y >= pane.top && p.y <= pane.bottom)) return null;
    if (p.y < 18 || p.y > this.frame.bottom) return null;
    return p.x > this.frame.width ? 'price-zoom' : 'pan';
  }

  private updatePointerCursor(p?: Point): void {
    const mode = this.drag?.mode ?? (p ? this.gestureMode(p) : null);
    const hit = p && mode === 'pan' && this.tool === 'cursor' && this.frame && p.y <= this.frame.priceBottom ? hitDrawing(this.drawings, p, this.projection(), this.selectedId) : null;
    this.overlay.style.cursor = mode === 'price-zoom' ? 'ns-resize' : mode === 'time-zoom' ? 'ew-resize' : this.editing || hit ? hit?.handle ? 'crosshair' : 'move' : 'crosshair';
    this.overlay.title = mode === 'price-zoom' ? 'Drag up or scroll up to zoom price in · Double-click to fit prices' : mode === 'time-zoom' ? 'Drag right or scroll up to zoom time in · Double-click to reset time' : '';
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.frame) return;
    this.overlay.focus({ preventScroll: true });
    const p = this.point(event);
    this.bypassMagnet = event.altKey;
    const mode = this.gestureMode(p);
    if (!mode) return;
    this.cursor = p;
    if (this.tool !== 'cursor' && mode === 'pan' && p.y <= this.frame.priceBottom && !event.shiftKey) {
      if (this.drawings.length >= MAX_DRAWINGS) return;
      const anchor = this.anchorAt(this.clampDrawingPoint(p), event.altKey || freehand(this.tool));
      if (singlePoint(this.tool)) this.addDrawing(this.tool, anchor, anchor);
      else if (this.pending && !freehand(this.tool)) this.addDrawing(this.tool, this.pending, anchor);
      else {
        this.sketch = { kind: this.tool, points: [anchor], start: p, last: p, projection: this.projection(true), moved: false };
        this.drawingRange = [this.frame.low, this.frame.high];
        this.overlay.setPointerCapture(event.pointerId);
      }
      this.invalidate(false);
      return;
    }
    if (this.tool === 'cursor' && mode === 'pan' && p.y <= this.frame.priceBottom && !event.shiftKey) {
      const hit = hitDrawing(this.drawings, p, this.projection(), this.selectedId);
      this.selectedId = hit?.id ?? null;
      if (hit) {
        const drawing = this.drawings.find(d => d.id === hit.id)!;
        this.editing = { drawing, before: this.drawings, start: p, projection: this.projection(true), handle: hit.handle, moved: false };
        this.drawingRange = [this.frame.low, this.frame.high];
        this.overlay.setPointerCapture(event.pointerId);
        this.invalidate(false);
        return;
      }
    }
    this.drag = { x: p.x, y: p.y, right: this.right, spacing: this.spacing, offset: this.manualPrice?.offset ?? 0, base: this.manualPrice?.base ?? [this.frame.low, this.frame.high], range: [this.frame.low, this.frame.high], scale: this.frame.priceScale, mode, horizontal: false, vertical: false, indicatorPane: (this.frame?.panes ?? []).some(pane => p.y >= pane.top && p.y <= pane.bottom) };
    this.updatePointerCursor(p);
    this.overlay.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent): void => {
    const p = this.point(event);
    this.cursor = p;
    this.bypassMagnet = event.altKey; this.snap = null;
    this.updatePointerCursor(p);
    if (this.sketch) {
      const q = this.clampDrawingPoint(p);
      this.sketch.moved ||= Math.hypot(p.x - this.sketch.start.x, p.y - this.sketch.start.y) > 3;
      if (freehand(this.sketch.kind)) {
        if (Math.hypot(q.x - this.sketch.last.x, q.y - this.sketch.last.y) >= 2) {
          if (this.sketch.points.length >= MAX_BRUSH_POINTS) this.sketch.points = this.sketch.points.filter((_, i) => i % 2 === 0 || i === MAX_BRUSH_POINTS - 1);
          this.sketch.points.push(this.sketch.projection.anchor(q));
          this.sketch.last = q;
        }
      } else this.sketch.points[1] = this.anchorAt(q, event.altKey, this.sketch.projection);
      this.invalidate(false); return;
    }
    if (this.editing) {
      const e = this.editing, dx = p.x - e.start.x, dy = p.y - e.start.y;
      e.moved ||= Math.hypot(dx, dy) > 3;
      if (e.moved) {
        const q = this.clampDrawingPoint(p);
        const anchor = e.handle && !freehand(e.drawing.kind) ? this.anchorAt(q, event.altKey, e.projection) : undefined;
        const snapped = anchor ? e.projection.point(anchor) : q;
        const next = e.handle ? resizeDrawing(e.drawing, e.handle, snapped, e.projection, anchor) : moveDrawing(e.drawing, dx, dy, e.projection);
        const valid = restoreDrawings([next])[0];
        if (valid) this.drawings = e.before.map(d => d.id === e.drawing.id ? valid : d);
      }
      this.invalidate(false); return;
    }
    if (this.drag) {
      const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
      if (this.drag.mode === 'price-zoom') {
        this.drag.vertical ||= Math.abs(dy) > 3;
        if (this.drag.vertical) this.zoomPrices(Math.exp(Math.max(-4, Math.min(4, -dy * 0.008))), this.drag.y, this.drag.range);
        return;
      }
      if (this.drag.mode === 'time-zoom') {
        this.drag.horizontal ||= Math.abs(dx) > 3;
        if (this.drag.horizontal) this.zoomTimeFrom(this.drag.right, this.drag.spacing, Math.exp(Math.max(-4, Math.min(4, dx * 0.008))), this.drag.x);
        return;
      }
      this.drag.horizontal ||= Math.abs(dx) > 3;
      this.drag.vertical ||= Math.abs(dy) > 3;
      if (this.drag.horizontal || this.drag.vertical) {
        if (this.drag.horizontal) {
          this.following = false;
          this.right = this.drag.right - dx / this.spacing;
          this.clampViewport();
        }
        if (this.drag.vertical && !this.drag.indicatorPane) this.manualPrice = { base: this.drag.base, offset: this.drag.offset + dy / Math.max(1, this.frame!.priceBottom - 18), scale: this.drag.scale };
        this.invalidate();
        return;
      }
    }
    if (this.tool !== 'cursor' && !freehand(this.tool) && this.gestureMode(p) === 'pan') this.anchorAt(this.clampDrawingPoint(p), event.altKey);
    this.invalidate(false);
  };

  private pointerUp = (event: PointerEvent): void => {
    const wasDrawing = !!this.sketch || !!this.editing;
    if (this.sketch) {
      const s = this.sketch;
      this.sketch = null;
      if (s.moved) {
        const end = this.anchorAt(this.clampDrawingPoint(this.point(event)), event.altKey || freehand(s.kind), s.projection);
        if (freehand(s.kind)) {
          if (s.points.length >= MAX_BRUSH_POINTS) s.points = s.points.filter((_, i) => i % 2 === 0 || i === MAX_BRUSH_POINTS - 1);
          s.points.push(end);
          this.addDrawing(s.kind, s.points[0], end, s.points);
        } else this.addDrawing(s.kind, s.points[0], end);
      } else if (!freehand(s.kind)) this.pending = s.points[0];
      this.invalidate(false);
    }
    this.drawingRange = null; this.snap = null;
    if (wasDrawing) this.invalidate();
    if (this.editing) {
      const e = this.editing;
      this.editing = null;
      if (e.moved) this.commitDrawings(this.drawings, e.before);
      this.invalidate(false);
    }
    this.drag = null;
    if (this.overlay.hasPointerCapture(event.pointerId)) this.overlay.releasePointerCapture(event.pointerId);
    this.updatePointerCursor(this.point(event));
  };
  private pointerCancel = (): void => { this.drag = null; this.cancelDrawingGesture(); this.updatePointerCursor(this.cursor ?? undefined); this.invalidate(false); };
  private pointerLeave = (): void => { if (!this.drag && !this.sketch && !this.editing) { this.cursor = null; this.snap = null; this.updatePointerCursor(); this.invalidate(false); } };
  private wheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.sketch || this.editing) return;
    const p = this.point(event);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
    const dx = event.deltaX * unit, dy = event.deltaY * unit;
    const mode = this.gestureMode(p);
    const amount = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const factor = Math.exp(-Math.max(-100, Math.min(100, amount)) * 0.0025);
    if (mode === 'price-zoom') { this.zoomPrices(factor, p.y); return; }
    if (mode === 'time-zoom') { this.zoom(factor, p.x); return; }
    if (event.altKey) {
      this.panPrices(-dy); return;
    }
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      this.following = false;
      this.right += (dx || dy) / this.spacing;
      this.clampViewport();
      this.invalidate();
    } else this.zoom(Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.0025), p.x);
  };
  private doubleClick = (event: MouseEvent): void => {
    const mode = this.gestureMode(this.point(event));
    if (mode === 'price-zoom') this.fitPrices();
    else if (mode === 'time-zoom') { this.spacing = 9; this.followLatest(); }
    else if (this.tool === 'cursor' && !this.selectedId) this.resetView();
  };
  private keyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) this.redoDrawing(); else this.undoDrawing(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redoDrawing(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { this.setTool('cursor'); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.deleteSelectedDrawing(); return; }
    if (this.sketch || this.editing) return;
    if (event.key.toLowerCase() === 'a') { event.preventDefault(); this.fitPrices(); }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); this.panPrices(event.key === 'ArrowUp' ? 40 : -40);
    }
    if (event.key === 'Home') { event.preventDefault(); this.followLatest(); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoom(1.2); }
    if (event.key === '-') { event.preventDefault(); this.zoom(1 / 1.2); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); this.following = false;
      this.right += event.key === 'ArrowLeft' ? -10 : 10;
      this.clampViewport(); this.invalidate();
    }
  };

  private anchorAt(p: Point, bypass = this.bypassMagnet, projection = this.projection()): Anchor {
    this.snap = bypass ? null : snapToCandle(this.store.candles, p, projection, this.magnet);
    return this.snap?.anchor ?? projection.anchor(p);
  }

  private projection(snapshot = false): Projection {
    const f = this.frame!, spacing = this.spacing;
    const candles = snapshot ? this.store.candles.slice() : this.store.candles;
    return {
      width: f.width, top: 18, bottom: f.priceBottom,
      point: a => ({ x: (timeToIndex(candles, a.time) - f.left + 0.5) * spacing, y: priceToY(a.price, f.low, f.high, 18, f.priceBottom - 18, f.priceScale) }),
      anchor: p => ({ time: indexToTime(candles, f.left + p.x / spacing - 0.5), price: yToPrice(p.y, f.low, f.high, 18, f.priceBottom - 18, f.priceScale) }),
    };
  }

  private clampDrawingPoint(p: Point): Point {
    return { x: Math.max(0, Math.min(this.frame!.width, p.x)), y: Math.max(18, Math.min(this.frame!.priceBottom, p.y)) };
  }

  private addDrawing(kind: Drawing['kind'], a: Anchor, b: Anchor, points?: Anchor[]): void {
    if (this.drawings.length >= MAX_DRAWINGS) return;
    const base = { id: crypto.randomUUID(), a, b, ...this.drawingStyle };
    const drawing: Drawing = kind === 'brush' || kind === 'highlighter' ? { ...base, kind, points: points!.map(p => ({ ...p })) } : { ...base, kind };
    const valid = restoreDrawings([drawing])[0];
    if (!valid) return;
    this.commitDrawings([...this.drawings, valid]);
    this.selectedId = valid.id; this.pending = null; this.tool = 'cursor';
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.options.backgroundColor;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.store.candles.length) { this.frame = null; return; }
    const width = Math.max(1, this.width - 82);
    const bottom = Math.max(50, this.height - 32);
    const paneDefs: { key: string; pane: IndicatorPane; series: IndicatorSeries[] }[] = [];
    const priceSeries: IndicatorSeries[] = [];
    for (const [owner, output] of this.indicators) {
      for (const pane of output.panes) paneDefs.push({ key: `${owner}:${pane.id}`, pane, series: [] });
      for (const series of output.series) {
        if (series.paneId === 'price') priceSeries.push(series);
        else paneDefs.find(pane => pane.key === `${owner}:${series.paneId}`)?.series.push(series);
      }
    }
    const layout = indicatorLayout(bottom, paneDefs.length, this.options.showVolume);
    const { paneCount, paneTop, paneHeight, priceBottom, volumeTop } = layout;
    const left = this.right - width / this.spacing;
    const start = Math.max(0, Math.floor(left));
    const end = Math.min(this.store.candles.length, Math.ceil(this.right));
    const plotStart = Math.floor(left);
    const plotEnd = Math.ceil(this.right);
    const visible = this.store.candles.slice(start, end);
    const scale = this.priceScale;
    if (this.manualPrice?.scale !== scale) this.manualPrice = null;
    const rangeStart = this.store.candles[Math.max(0, start)]?.time;
    const rangeEnd = this.store.candles[Math.min(this.store.candles.length - 1, end)]?.time;
    const visibleTime = rangeStart === undefined || rangeEnd === undefined ? undefined : [rangeStart, rangeEnd] as [number, number];
    const timeForOffset = (offset: number): [number, number] | undefined => {
      const sourceStart = plotStart - offset - 1, sourceEnd = plotEnd - offset + 1;
      if (sourceEnd < 0 || sourceStart > this.store.candles.length - 1) return undefined;
      return [indexToTime(this.store.candles, Math.max(0, sourceStart)), indexToTime(this.store.candles, Math.min(this.store.candles.length - 1, sourceEnd))];
    };
    const candleRange = this.drawingRange ?? (visible.length ? priceRange(visible, scale) : priceRange([this.store.candles.at(-1)!], scale));
    let autoRange = candleRange ?? (scale === 'log' ? [1, 10] : [0, 1]);
    if (!this.manualPrice && !this.drawingRange) {
      const overlayRange = indicatorDataRange(priceSeries, undefined, timeForOffset, value => scale !== 'log' || value > 0);
      autoRange = indicatorPriceRange(candleRange, overlayRange, scale === 'log');
    }
    const [low, high] = this.manualPrice ? scrollPriceRange(this.manualPrice.base, this.manualPrice.offset, scale) : autoRange;
    const panes: PaneFrame[] = paneDefs.slice(0, paneCount).map(({ key, pane, series }, index) => {
      const top = paneTop + index * paneHeight;
      const paneBottom = top + paneHeight;
      const header = Math.min(18, Math.max(1, paneHeight * 0.22));
      const footer = Math.min(3, Math.max(0, paneHeight * 0.05));
      const plotTop = top + header;
      const plotBottom = Math.max(plotTop + 1, paneBottom - footer);
      return { key, title: pane.title, top, bottom: paneBottom, plotTop, plotBottom, range: indicatorRange(series, pane.range, visibleTime, timeForOffset), pane, series };
    });
    this.frame = { width, height: this.height, priceBottom, volumeTop, bottom, low, high, left, priceScale: scale, panes };
    const y = (p: number) => priceToY(p, low, high, 18, priceBottom - 18, scale);
    const x = (i: number) => (i - left + 0.5) * this.spacing;
    ctx.font = '11px "SFMono-Regular", Consolas, monospace';
    ctx.lineWidth = 1;
    for (const price of priceTicks(low, high, scale)) {
      const py = y(price);
      ctx.strokeStyle = this.options.gridColor; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
      ctx.fillStyle = '#7e8c91'; ctx.fillText(formatPrice(price), width + 12, py + 4);
    }
    const timeStride = Math.max(1, Math.ceil(125 / this.spacing));
    const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    for (let i = Math.ceil(start / timeStride) * timeStride; i < end; i += timeStride) {
      const px = x(i);
      ctx.strokeStyle = this.options.gridColor; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, bottom); ctx.stroke();
      ctx.fillStyle = '#7e8c91'; ctx.textAlign = 'center';
      ctx.fillText(timeFormat.format(this.store.candles[i].time), px, bottom + 21);
    }
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#2b3438'; ctx.beginPath(); ctx.moveTo(width, 0); ctx.lineTo(width, bottom); ctx.moveTo(0, bottom); ctx.lineTo(this.width, bottom); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, bottom); ctx.clip();
    const bodyWidth = Math.max(1, this.spacing * 0.68);
    let maxVolume = 1;
    for (const c of visible) maxVolume = Math.max(maxVolume, c.volume);
    if (this.options.showVolume) {
      ctx.strokeStyle = '#273033'; ctx.beginPath(); ctx.moveTo(0, priceBottom + 15); ctx.lineTo(width, priceBottom + 15); ctx.stroke();
      ctx.fillStyle = '#6e7c82'; ctx.fillText('VOLUME', 14, volumeTop + 8);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 18, width, priceBottom - 18); ctx.clip();
    for (const series of priceSeries) if (series.type === 'band') this.drawIndicatorSeries(ctx, series, { top: 18, bottom: priceBottom - 18, range: [low, high] }, plotStart, plotEnd, x, y);
    if (this.options.style === 'line') { ctx.beginPath(); ctx.strokeStyle = this.options.upColor; ctx.lineWidth = 1.8; }
    for (let i = start; i < end; i++) {
      const c = this.store.candles[i];
      const px = x(i);
      const color = c.close >= c.open ? this.options.upColor : this.options.downColor;
      if (this.options.style === 'candles') {
        ctx.strokeStyle = c.close >= c.open ? this.options.upBorderColor : this.options.downBorderColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, y(c.high)); ctx.lineTo(px, y(c.low)); ctx.stroke();
        ctx.fillStyle = color;
        const bodyTop = y(Math.max(c.open, c.close));
        const bodyHeight = Math.max(1, Math.abs(y(c.open) - y(c.close)));
        ctx.fillRect(px - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
        // Inset the outline so its stroke stays within the candle's OHLC bounds.
        ctx.strokeRect(px - bodyWidth / 2 + 0.5, bodyTop + 0.5, bodyWidth - 1, bodyHeight - 1);
      } else {
        if (i === start) ctx.moveTo(px, y(c.close)); else ctx.lineTo(px, y(c.close));
      }
    }
    if (this.options.style === 'line') ctx.stroke();
    ctx.restore();
    if (this.options.showVolume) {
      ctx.globalAlpha = 0.38;
      for (let i = start; i < end; i++) {
        const c = this.store.candles[i];
        ctx.fillStyle = c.close >= c.open ? this.options.upColor : this.options.downColor;
        const volumeBottom = panes.length ? panes[0].top : bottom;
        const h = c.volume / maxVolume * Math.max(1, volumeBottom - volumeTop - 15);
        ctx.fillRect(x(i) - bodyWidth / 2, volumeBottom - h, bodyWidth, h);
      }
      ctx.globalAlpha = 1;
    }
    if (this.options.showMA) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 18, width, priceBottom - 18); ctx.clip();
      ctx.strokeStyle = '#d6b785'; ctx.lineWidth = 1.5; ctx.beginPath();
      let started = false;
      for (let i = start; i < end; i++) {
        const value = this.average[i];
        if (value === null || value === undefined) continue;
        if (!started) { ctx.moveTo(x(i), y(value)); started = true; } else ctx.lineTo(x(i), y(value));
      }
      ctx.stroke(); ctx.restore();
    }
    for (const series of priceSeries) if (series.type !== 'band') this.drawIndicatorSeries(ctx, series, { top: 18, bottom: priceBottom - 18, range: [low, high] }, plotStart, plotEnd, x, y);
    const last = this.store.candles[this.store.candles.length - 1];
    const lastY = y(last.close);
    if (lastY >= 18 && lastY <= priceBottom) {
      ctx.strokeStyle = last.close >= last.open ? this.options.upColor : this.options.downColor;
      ctx.globalAlpha = 0.55; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(width, lastY); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (lastY >= 18 && lastY <= priceBottom) {
      ctx.fillStyle = last.close >= last.open ? this.options.upColor : this.options.downColor;
      ctx.fillRect(width + 1, lastY - 11, 81, 23);
      ctx.fillStyle = '#101719'; ctx.fillText(formatPrice(last.close), width + 10, lastY + 4);
    }
    for (const pane of panes) {
      ctx.fillStyle = this.options.backgroundColor; ctx.fillRect(0, pane.top, this.width, pane.bottom - pane.top);
      ctx.strokeStyle = '#2b3438'; ctx.beginPath(); ctx.moveTo(0, pane.top); ctx.lineTo(this.width, pane.top); ctx.stroke();
      ctx.fillStyle = '#87959a'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(pane.title, 8, pane.top + 13);
      for (const level of pane.pane.levels ?? []) {
        if (level.value < pane.range[0] || level.value > pane.range[1]) continue;
        const ly = indicatorY(level.value, pane.range, pane.plotTop, pane.plotBottom);
        ctx.strokeStyle = level.color ?? this.options.gridColor; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(width, ly); ctx.stroke(); ctx.setLineDash([]);
        if (level.label) { ctx.fillStyle = level.color ?? '#87959a'; ctx.fillText(level.label, width + 8, ly - 2); }
      }
      const paneY = (value: number) => indicatorY(value, pane.range, pane.plotTop, pane.plotBottom);
      for (const series of pane.series) if (series.type === 'band') this.drawIndicatorSeries(ctx, series, { top: pane.plotTop, bottom: pane.plotBottom, range: pane.range }, plotStart, plotEnd, x, paneY);
      for (const series of pane.series) if (series.type !== 'band') this.drawIndicatorSeries(ctx, series, { top: pane.plotTop, bottom: pane.plotBottom, range: pane.range }, plotStart, plotEnd, x, paneY);
    }
    ctx.textAlign = 'left';
  }

  private drawIndicatorSeries(ctx: CanvasRenderingContext2D, series: IndicatorSeries, plot: { top: number; bottom: number; range: [number, number] }, start: number, end: number, x: (index: number) => number, y: (value: number) => number): void {
    const candles = this.store.candles;
    const offset = series.offset ?? 0;
    const sourceStart = start - offset - 1, sourceEnd = end - offset + 1;
    if (sourceEnd < 0 || sourceStart > candles.length - 1) return;
    const firstTime = indexToTime(candles, Math.max(0, sourceStart));
    const lastTime = indexToTime(candles, Math.min(candles.length - 1, sourceEnd));
    let lo = 0, hi = series.points.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (series.points[mid].time < firstTime) lo = mid + 1; else hi = mid; }
    const begin = Math.max(0, lo - 1);
    lo = begin; hi = series.points.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (series.points[mid].time <= lastTime) lo = mid + 1; else hi = mid; }
    const finish = Math.min(series.points.length, lo + 1);
    ctx.save(); ctx.beginPath(); ctx.rect(0, plot.top, this.frame!.width, plot.bottom - plot.top); ctx.clip();
    ctx.strokeStyle = series.color; ctx.fillStyle = series.color; ctx.lineWidth = 1.6;
    if (series.type === 'band') {
      ctx.globalAlpha = 0.22;
      let run: BandVertex[] = [];
      const flush = () => {
        for (const polygon of bandPolygons(run)) {
          if (polygon.vertices.length < 3) continue;
          ctx.fillStyle = polygon.positive ? series.color : series.negativeColor ?? series.color;
          ctx.beginPath();
          polygon.vertices.forEach((vertex, index) => {
            // Split fills in screen space so crossings land where the two rendered edges meet
            // on both linear and logarithmic scales.
            const px = vertex.x, py = -vertex.value;
            if (!Number.isFinite(px) || !Number.isFinite(py)) return;
            if (!index) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.closePath(); ctx.fill();
        }
        run = [];
      };
      for (let i = begin; i < finish; i++) {
        const point = series.points[i];
        if (point.value === null || point.value2 === null) { flush(); continue; }
        const index = timeToIndex(candles, point.time), px = x(index + offset);
        const firstY = y(point.value), secondY = y(point.value2);
        if (!Number.isFinite(index) || !Number.isFinite(px) || !Number.isFinite(firstY) || !Number.isFinite(secondY)) { flush(); continue; }
        run.push({ x: px, value: -firstY, value2: -secondY });
      }
      flush(); ctx.globalAlpha = 1;
    } else if (series.type === 'line') {
      ctx.beginPath();
      for (const segment of indicatorLineSegments(series.points.slice(begin, finish))) {
        let open = false;
        for (const point of segment) {
          const index = timeToIndex(candles, point.time);
          const px = x(index + offset), py = y(point.value!);
          if (!Number.isFinite(index) || !Number.isFinite(px) || !Number.isFinite(py)) { open = false; continue; }
          if (!open) { ctx.moveTo(px, py); open = true; }
          else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    } else {
      const baseline = series.baseline ?? 0;
      const rawZeroY = y(baseline);
      const zeroY = Number.isFinite(rawZeroY) ? rawZeroY : (baseline <= plot.range[0] ? plot.bottom : plot.top);
      const barWidth = Math.max(1, this.spacing * 0.64);
      for (let i = begin; i < finish; i++) {
        const point = series.points[i]; if (point.value === null) continue;
        const index = timeToIndex(candles, point.time);
        if (!Number.isFinite(index)) continue;
        const valueY = y(point.value);
        if (!Number.isFinite(valueY)) continue;
        ctx.fillRect(x(index + offset) - barWidth / 2, Math.min(valueY, zeroY), barWidth, Math.max(1, Math.abs(zeroY - valueY)));
      }
    }
    ctx.restore();
  }

  private renderOverlay(): void {
    const ctx = this.over;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const f = this.frame;
    if (!f) return;
    const projection = this.projection();
    if (!this.sketch && !this.editing && this.cursor && this.tool !== 'cursor' && !freehand(this.tool) && this.gestureMode(this.cursor) === 'pan') this.anchorAt(this.clampDrawingPoint(this.cursor));
    const draw = (drawing: Drawing, preview = false) => {
      const paths = drawingPaths(drawing, projection);
      if (!paths.length) return;
      const all = paths.flat();
      if (all.every(p => p.x < 0) || all.every(p => p.x > f.width) || all.every(p => p.y < 18) || all.every(p => p.y > f.priceBottom)) return;
      const style = drawingStyle(drawing);
      ctx.strokeStyle = style.color; ctx.lineWidth = drawing.kind === 'highlighter' ? style.width * 8 : style.width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash(preview ? [5, 4] : []);
      ctx.globalAlpha = drawing.kind === 'highlighter' ? 0.3 : 1;
      for (const points of paths) {
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
        if (boxShape(drawing.kind) || drawing.kind === 'circle') { ctx.fillStyle = style.color; ctx.globalAlpha = 0.09; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      ctx.font = '11px "SFMono-Regular", Consolas, monospace'; ctx.fillStyle = style.color;
      for (const label of drawingLabels(drawing, projection)) if (Number.isFinite(label.point.x) && Number.isFinite(label.point.y) && (drawing.kind !== 'fib' || label.point.y >= 18 && label.point.y <= f.priceBottom)) {
        const w = ctx.measureText(label.text).width;
        ctx.fillText(label.text, Math.max(4, Math.min(f.width - w - 4, label.point.x)), Math.max(30, Math.min(f.priceBottom - 4, label.point.y)));
      }
      if (drawing.id === this.selectedId || preview && !freehand(drawing.kind)) {
        const handles = drawingHandles(drawing, projection);
        if (freehand(drawing.kind) && handles.length) {
          const a = handles[0].point, b = handles[1].point;
          ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
        }
        ctx.lineWidth = 1.5;
        for (const { point } of handles) {
          ctx.fillStyle = this.options.backgroundColor; ctx.strokeStyle = '#f0f6f7';
          ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    };
    ctx.save(); ctx.beginPath(); ctx.rect(0, 18, f.width, f.priceBottom - 18); ctx.clip();
    for (const drawing of this.drawings) draw(drawing);
    if (this.sketch) {
      const s = this.sketch, base = { id: 'preview', a: s.points[0], b: s.points.at(-1)!, ...this.drawingStyle };
      draw(s.kind === 'brush' || s.kind === 'highlighter' ? { ...base, kind: s.kind, points: s.points } : { ...base, kind: s.kind as Exclude<Drawing['kind'], 'brush' | 'highlighter'> }, true);
    } else if (this.pending && this.cursor && this.tool !== 'cursor' && !freehand(this.tool)) draw({ id: 'preview', kind: this.tool as Exclude<Drawing['kind'], 'brush' | 'highlighter'>, a: this.pending, b: this.anchorAt(this.clampDrawingPoint(this.cursor)), ...this.drawingStyle }, true);
    if (this.snap) {
      ctx.strokeStyle = '#e6c17a'; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(this.snap.point.x, this.snap.point.y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#e6c17a';
      ctx.fillText(this.snap.field.toUpperCase(), Math.min(f.width - 40, this.snap.point.x + 11), Math.max(30, this.snap.point.y - 10));
    }
    ctx.restore();
    const p = this.cursor;
    if (!p || p.x > f.width || p.x < 0 || p.y > f.bottom || p.y < 0) return;
    const i = Math.round(f.left + p.x / this.spacing - 0.5);
    const candle = this.store.candles[i];
    const px = (i - f.left + 0.5) * this.spacing;
    ctx.strokeStyle = '#88979b'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, f.bottom);
    const activePane = (f.panes ?? []).find(pane => p.y >= pane.top && p.y <= pane.bottom);
    if (p.y <= f.priceBottom || activePane) { ctx.moveTo(0, p.y); ctx.lineTo(f.width, p.y); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '11px "SFMono-Regular", Consolas, monospace';
    if (p.y <= f.priceBottom) {
      ctx.fillStyle = '#465358'; ctx.fillRect(f.width + 1, p.y - 11, 81, 23);
      ctx.fillStyle = '#f4f7f7'; ctx.fillText(formatPrice(yToPrice(p.y, f.low, f.high, 18, f.priceBottom - 18, f.priceScale)), f.width + 10, p.y + 4);
    } else if (activePane) {
      const value = indicatorValueAtY(p.y, activePane.range, activePane.plotTop, activePane.plotBottom);
      ctx.fillStyle = '#465358'; ctx.fillRect(f.width + 1, p.y - 11, 81, 23);
      ctx.fillStyle = '#f4f7f7'; ctx.fillText(formatPrice(value), f.width + 10, p.y + 4);
    }
    // Empty time slots have no candle/time readout; keep the crosshair at the pointer.
    if (!candle) return;
    const label = new Date(candle.time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const labelWidth = ctx.measureText(label).width + 18;
    const labelX = Math.max(0, Math.min(f.width - labelWidth, px - labelWidth / 2));
    ctx.fillStyle = '#344146'; ctx.fillRect(labelX, f.bottom + 1, labelWidth, 29);
    ctx.fillStyle = '#eff4f4'; ctx.fillText(label, labelX + 9, f.bottom + 20);
  }
}

export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { minimumFractionDigits: Math.abs(price) < 1 ? 4 : 2, maximumFractionDigits: Math.abs(price) < 1 ? 6 : 2 });
}
