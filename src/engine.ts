import { CandleStore, movingAverage, priceRange, priceTicks, priceToY, yToPrice, timeToIndex, zoomRightEdge, scrollPriceRange, timeViewportBounds, zoomPriceRange } from './model.ts';
import type { Anchor, Candle, Drawing, Tool, PriceScale } from './model.ts';

export type ChartOptions = {
  upColor: string; downColor: string; upBorderColor: string; downBorderColor: string; showVolume: boolean; showMA: boolean;
  backgroundColor: string; gridColor: string;
  style: 'candles' | 'line'; maPeriod: number; priceScale: PriceScale;
};
export type ChartState = { candle: Candle | null; following: boolean; visible: number; tool: Tool; drawings: number; priceScale: PriceScale; logAvailable: boolean; autoPrice: boolean };
type Point = { x: number; y: number };
type Frame = { width: number; height: number; priceBottom: number; volumeTop: number; bottom: number; low: number; high: number; left: number; priceScale: PriceScale };
type Gesture = { x: number; y: number; right: number; spacing: number; offset: number; base: [number, number]; range: [number, number]; scale: PriceScale; mode: 'pan' | 'price-zoom' | 'time-zoom'; horizontal: boolean; vertical: boolean };

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
  private frame: Frame | null = null;
  private raf = 0;
  private dirty = true;
  private average: (number | null)[] = [];
  private listeners = new Set<(state: ChartState) => void>();
  onDrawingsChange: (drawings: Drawing[]) => void = () => {};

  get priceScale(): PriceScale {
    return this.options.priceScale === 'log' && this.store.supportsLogScale ? 'log' : 'linear';
  }

  constructor(private host: HTMLElement) {
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
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  setData(candles: Candle[]): void {
    this.store.setData(candles);
    this.average = movingAverage(this.store.candles, this.options.maPeriod);
    this.cursor = null;
    this.pending = null;
    this.resetView();
  }

  update(candle: Candle): void {
    const result = this.store.upsert(candle);
    // Preserve the same historical viewport when a bar is inserted before it.
    if (result.inserted && !this.following && result.index < this.right) this.right += 1;
    if (this.following) this.right = this.latestRight();
    this.average = movingAverage(this.store.candles, this.options.maPeriod);
    this.invalidate();
  }

  configure(options: Partial<ChartOptions>): void {
    const scale = this.priceScale;
    this.options = { ...this.options, ...options };
    if (this.priceScale !== scale) this.manualPrice = null;
    this.average = movingAverage(this.store.candles, this.options.maPeriod);
    this.invalidate();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.pending = null;
    this.overlay.style.cursor = tool === 'cursor' ? 'crosshair' : 'copy';
    this.invalidate(false);
  }

  setDrawings(drawings: Drawing[]): void {
    this.drawings = drawings;
    this.pending = null;
    this.invalidate(false);
  }

  clearDrawings(): void {
    this.drawings = [];
    this.pending = null;
    this.onDrawingsChange(this.drawings);
    this.invalidate(false);
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
    this.observer.disconnect();
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    this.overlay.remove();
    this.listeners.clear();
  }

  private state(): ChartState {
    const data = this.store.candles;
    let candle = data[data.length - 1] ?? null;
    if (this.cursor && this.frame) {
      const index = Math.round(this.frame.left + this.cursor.x / this.spacing - 0.5);
      candle = data[index] ?? null;
    }
    return { candle, following: this.following, visible: Math.min(data.length, Math.ceil((this.frame?.width ?? 0) / this.spacing)), tool: this.tool, drawings: this.drawings.length, priceScale: this.priceScale, logAvailable: this.store.supportsLogScale, autoPrice: this.manualPrice === null };
  }

  private emit(): void { const state = this.state(); for (const listener of this.listeners) listener(state); }

  private resize(): void {
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
    this.right = Math.max(minimum, Math.min(maximum, this.right));
  }

  private latestRight(): number {
    const visible = Math.max(1, this.width - 82) / this.spacing;
    // Keep short imported histories visible even at maximum zoom on a phone.
    const margin = Math.min(6, Math.max(0, (visible - 1) / 2));
    return this.store.candles.length + margin;
  }

  private point(event: MouseEvent): Point {
    const rect = this.overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private gestureMode(p: Point): Gesture['mode'] | null {
    if (!this.frame || p.x < 0 || p.y < 0) return null;
    if (p.x <= this.frame.width && p.y >= this.frame.bottom) return 'time-zoom';
    if (p.y < 18 || p.y > this.frame.priceBottom) return null;
    return p.x > this.frame.width ? 'price-zoom' : 'pan';
  }

  private updatePointerCursor(p?: Point): void {
    const mode = this.drag?.mode ?? (p ? this.gestureMode(p) : null);
    this.overlay.style.cursor = mode === 'price-zoom' ? 'ns-resize' : mode === 'time-zoom' ? 'ew-resize' : this.tool === 'cursor' ? 'crosshair' : 'copy';
    this.overlay.title = mode === 'price-zoom' ? 'Drag up or scroll up to zoom price in · Double-click to fit prices' : mode === 'time-zoom' ? 'Drag right or scroll up to zoom time in · Double-click to reset time' : '';
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.frame) return;
    this.overlay.focus({ preventScroll: true });
    const p = this.point(event);
    const mode = this.gestureMode(p);
    if (!mode) return;
    this.cursor = p;
    if (this.tool !== 'cursor' && mode === 'pan') {
      const anchor = this.anchorAt(p);
      if (this.tool === 'horizontal') this.addDrawing('horizontal', anchor, anchor);
      else if (!this.pending) this.pending = anchor;
      else { this.addDrawing('trend', this.pending, anchor); this.pending = null; }
      this.invalidate(false);
      return;
    }
    this.drag = { x: p.x, y: p.y, right: this.right, spacing: this.spacing, offset: this.manualPrice?.offset ?? 0, base: this.manualPrice?.base ?? [this.frame.low, this.frame.high], range: [this.frame.low, this.frame.high], scale: this.frame.priceScale, mode, horizontal: false, vertical: false };
    this.updatePointerCursor(p);
    this.overlay.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent): void => {
    const p = this.point(event);
    this.cursor = p;
    this.updatePointerCursor(p);
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
        if (this.drag.vertical) this.manualPrice = { base: this.drag.base, offset: this.drag.offset + dy / Math.max(1, this.frame!.priceBottom - 18), scale: this.drag.scale };
        this.invalidate();
        return;
      }
    }
    this.invalidate(false);
  };

  private pointerUp = (event: PointerEvent): void => {
    this.drag = null;
    if (this.overlay.hasPointerCapture(event.pointerId)) this.overlay.releasePointerCapture(event.pointerId);
    this.updatePointerCursor(this.point(event));
  };
  private pointerCancel = (): void => { this.drag = null; this.updatePointerCursor(this.cursor ?? undefined); };
  private pointerLeave = (): void => { if (!this.drag) { this.cursor = null; this.updatePointerCursor(); this.invalidate(false); } };
  private wheel = (event: WheelEvent): void => {
    event.preventDefault();
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
    else if (this.tool === 'cursor') this.resetView();
  };
  private keyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { this.setTool('cursor'); return; }
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

  private anchorAt(p: Point): Anchor {
    const f = this.frame!;
    const index = Math.max(0, Math.min(this.store.candles.length - 1, Math.round(f.left + p.x / this.spacing - 0.5)));
    return { time: this.store.candles[index].time, price: yToPrice(p.y, f.low, f.high, 18, f.priceBottom - 18, f.priceScale) };
  }

  private addDrawing(kind: Drawing['kind'], a: Anchor, b: Anchor): void {
    this.drawings.push({ id: crypto.randomUUID(), kind, a, b });
    this.onDrawingsChange(this.drawings);
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.options.backgroundColor;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.store.candles.length) return;
    const width = Math.max(1, this.width - 82);
    const bottom = Math.max(50, this.height - 32);
    const priceBottom = this.options.showVolume ? bottom * 0.77 : bottom - 12;
    const volumeTop = priceBottom + 28;
    const left = this.right - width / this.spacing;
    const start = Math.max(0, Math.floor(left));
    const end = Math.min(this.store.candles.length, Math.ceil(this.right));
    const visible = this.store.candles.slice(start, end);
    const scale = this.priceScale;
    if (this.manualPrice?.scale !== scale) this.manualPrice = null;
    const [low, high] = this.manualPrice ? scrollPriceRange(this.manualPrice.base, this.manualPrice.offset, scale) : priceRange(visible, scale);
    this.frame = { width, height: this.height, priceBottom, volumeTop, bottom, low, high, left, priceScale: scale };
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
    if (this.options.style === 'line') { ctx.beginPath(); ctx.strokeStyle = this.options.upColor; ctx.lineWidth = 1.8; }
    for (let i = start; i < end; i++) {
      const c = this.store.candles[i];
      const px = x(i);
      const color = c.close >= c.open ? this.options.upColor : this.options.downColor;
      if (this.options.style === 'candles') {
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, y(c.high)); ctx.lineTo(px, y(c.low)); ctx.stroke();
        ctx.fillStyle = color;
        const bodyTop = y(Math.max(c.open, c.close));
        const bodyHeight = Math.max(1, Math.abs(y(c.open) - y(c.close)));
        ctx.fillRect(px - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
        ctx.strokeStyle = c.close >= c.open ? this.options.upBorderColor : this.options.downBorderColor;
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
        const h = c.volume / maxVolume * Math.max(1, bottom - volumeTop - 15);
        ctx.fillRect(x(i) - bodyWidth / 2, bottom - h, bodyWidth, h);
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
  }

  private renderOverlay(): void {
    const ctx = this.over;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const f = this.frame;
    if (!f) return;
    const x = (a: Anchor) => (timeToIndex(this.store.candles, a.time) - f.left + 0.5) * this.spacing;
    const y = (a: Anchor) => priceToY(a.price, f.low, f.high, 18, f.priceBottom - 18, f.priceScale);
    const draw = (drawing: Drawing, preview = false) => {
      // Preserve non-positive anchors, but hide them while log mode is active.
      if (!Number.isFinite(y(drawing.a)) || (drawing.kind === 'trend' && !Number.isFinite(y(drawing.b)))) return;
      ctx.strokeStyle = '#9aaef5'; ctx.lineWidth = 1.5;
      ctx.setLineDash(preview ? [5, 4] : []);
      ctx.beginPath();
      if (drawing.kind === 'horizontal') { ctx.moveTo(0, y(drawing.a)); ctx.lineTo(f.width, y(drawing.a)); }
      else { ctx.moveTo(x(drawing.a), y(drawing.a)); ctx.lineTo(x(drawing.b), y(drawing.b)); }
      ctx.stroke(); ctx.setLineDash([]);
      if (drawing.kind === 'trend') {
        for (const anchor of [drawing.a, drawing.b]) {
          ctx.fillStyle = '#141b1f'; ctx.beginPath(); ctx.arc(x(anchor), y(anchor), 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    };
    ctx.save(); ctx.beginPath(); ctx.rect(0, 18, f.width, f.priceBottom - 18); ctx.clip();
    for (const drawing of this.drawings) draw(drawing);
    if (this.pending && this.cursor) draw({ id: 'preview', kind: 'trend', a: this.pending, b: this.anchorAt(this.cursor) }, true);
    ctx.restore();
    const p = this.cursor;
    if (!p || p.x > f.width || p.x < 0 || p.y > f.bottom || p.y < 0) return;
    const i = Math.round(f.left + p.x / this.spacing - 0.5);
    const candle = this.store.candles[i];
    const px = (i - f.left + 0.5) * this.spacing;
    ctx.strokeStyle = '#88979b'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, f.bottom);
    if (p.y <= f.priceBottom) { ctx.moveTo(0, p.y); ctx.lineTo(f.width, p.y); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '11px "SFMono-Regular", Consolas, monospace';
    if (p.y <= f.priceBottom) {
      ctx.fillStyle = '#465358'; ctx.fillRect(f.width + 1, p.y - 11, 81, 23);
      ctx.fillStyle = '#f4f7f7'; ctx.fillText(formatPrice(yToPrice(p.y, f.low, f.high, 18, f.priceBottom - 18, f.priceScale)), f.width + 10, p.y + 4);
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
