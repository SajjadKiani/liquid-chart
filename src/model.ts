export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Anchor = { time: number; price: number };
export type Drawing = { id: string; kind: 'trend' | 'horizontal'; a: Anchor; b: Anchor };
export type Tool = 'cursor' | 'trend' | 'horizontal';
export type PriceScale = 'linear' | 'log';

export function validateCandle(value: unknown): Candle {
  if (!value || typeof value !== 'object') throw new Error('Each candle must be an object.');
  const c = value as Record<string, unknown>;
  for (const key of ['time', 'open', 'high', 'low', 'close']) {
    if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) {
      throw new Error(`Candle ${key} must be a finite number.`);
    }
  }
  if (!Number.isSafeInteger(c.time) || (c.time as number) < 0 || (c.time as number) > 8.64e15) {
    throw new Error('Candle time must be a valid UTC timestamp in milliseconds.');
  }
  const volume = c.volume ?? 0;
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) {
    throw new Error('Candle volume must be a non-negative number.');
  }
  const candle = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume } as Candle;
  if (candle.low > Math.min(candle.open, candle.close) ||
      candle.high < Math.max(candle.open, candle.close) || candle.low > candle.high) {
    throw new Error('Candle high/low must contain its open and close.');
  }
  return candle;
}

export class CandleStore {
  candles: Candle[] = [];
  private nonPositiveCount = 0;

  get supportsLogScale(): boolean {
    return this.candles.length > 0 && this.nonPositiveCount === 0;
  }

  setData(input: unknown[]): void {
    if (!input.length) throw new Error('Provide at least one candle.');
    if (input.length > 100_000) throw new Error('The MVP supports imports up to 100,000 candles.');
    // Validate the entire batch before replacing existing data.
    const unique = new Map<number, Candle>();
    for (const item of input) {
      const c = validateCandle(item);
      unique.set(c.time, c);
    }
    this.candles = [...unique.values()].sort((a, b) => a.time - b.time);
    this.nonPositiveCount = this.candles.reduce((count, c) => count + Number(c.low <= 0), 0);
  }

  upsert(input: Candle): { index: number; inserted: boolean } {
    const candle = validateCandle(input);
    const index = lowerBound(this.candles, candle.time);
    if (this.candles[index]?.time === candle.time) {
      this.nonPositiveCount -= Number(this.candles[index].low <= 0);
      this.nonPositiveCount += Number(candle.low <= 0);
      this.candles[index] = candle;
      return { index, inserted: false };
    }
    this.candles.splice(index, 0, candle);
    this.nonPositiveCount += Number(candle.low <= 0);
    return { index, inserted: true };
  }

  prepend(input: Candle[]): number {
    if (!input.length) return 0;
    // Validate the whole page before changing data; overlaps cannot overwrite live bars.
    const page = new CandleStore();
    page.setData(input);
    const oldest = this.candles[0]?.time ?? Infinity;
    const earlier = page.candles.filter(c => c.time < oldest);
    if (!earlier.length) return 0;
    this.candles = earlier.concat(this.candles);
    this.nonPositiveCount += earlier.reduce((count, c) => count + Number(c.low <= 0), 0);
    return earlier.length;
  }
}

export function lowerBound(candles: Candle[], time: number): number {
  let left = 0, right = candles.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (candles[middle].time < time) left = middle + 1;
    else right = middle;
  }
  return left;
}

export function movingAverage(candles: Candle[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new Error('Invalid moving average period.');
  let total = 0;
  return candles.map((c, i) => {
    total += c.close;
    if (i >= period) total -= candles[i - period].close;
    return i >= period - 1 ? total / period : null;
  });
}

export function priceRange(candles: Candle[], scale: PriceScale = 'linear'): [number, number] {
  if (!candles.length) return scale === 'log' ? [1, 10] : [0, 1];
  let low = Infinity, high = -Infinity;
  for (const c of candles) { low = Math.min(low, c.low); high = Math.max(high, c.high); }
  if (scale === 'log') {
    if (low <= 0) throw new Error('Logarithmic scale requires strictly positive prices.');
    const logLow = Math.log(low), logHigh = Math.log(high);
    const padding = Math.max((logHigh - logLow) * 0.12, 0.0001);
    return [Math.max(Number.MIN_VALUE, Math.exp(logLow - padding)), Math.min(Number.MAX_VALUE, Math.exp(logHigh + padding))];
  }
  const padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.0001, 0.000001);
  return [low - padding, high + padding];
}

export function priceToY(price: number, low: number, high: number, top: number, height: number, scale: PriceScale = 'linear'): number {
  if (scale === 'log') {
    if (price <= 0 || low <= 0 || high <= 0) return NaN;
    return top + (Math.log(high) - Math.log(price)) / (Math.log(high) - Math.log(low)) * height;
  }
  return top + (high - price) / (high - low) * height;
}

export function yToPrice(y: number, low: number, high: number, top: number, height: number, scale: PriceScale = 'linear'): number {
  if (scale === 'log') {
    if (low <= 0 || high <= 0) return NaN;
    return Math.exp(Math.log(high) - (y - top) / height * (Math.log(high) - Math.log(low)));
  }
  return high - (y - top) / height * (high - low);
}

export function priceTicks(low: number, high: number, scale: PriceScale = 'linear'): number[] {
  if (scale === 'log' && low <= 0) return [];
  const from = scale === 'log' ? Math.log10(low) : low;
  const to = scale === 'log' ? Math.log10(high) : high;
  const rawStep = (to - from) / 6;
  if (!Number.isFinite(rawStep) || rawStep <= 0) return [];
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const unit = rawStep / magnitude;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * magnitude;
  const first = Math.ceil(from / step);
  const ticks: number[] = [];
  // Integer steps avoid accumulated floating-point error and bound work.
  for (let i = 0; i < 20; i++) {
    const value = (first + i) * step;
    if (value >= to) break;
    const price = scale === 'log' ? Math.pow(10, value) : value;
    if (price >= low && price < high && Number.isFinite(price)) ticks.push(price);
  }
  return ticks;
}

export function zoomRightEdge(right: number, width: number, oldSpacing: number, newSpacing: number, anchorX: number): number {
  const anchorIndex = right - (width - anchorX) / oldSpacing;
  return anchorIndex + (width - anchorX) / newSpacing;
}

export function timeViewportBounds(count: number, width: number, spacing: number): [number, number] {
  // Allow almost a full screen of space after the last candle, keeping it visible.
  const visible = Math.max(1, width) / spacing;
  return [Math.min(10, count), count + Math.max(0, visible - 1)];
}

// Keep the price at the chosen screen fraction fixed while changing vertical span.
export function zoomPriceRange(range: [number, number], factor: number, fraction: number, scale: PriceScale): [number, number] {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(fraction)) return range;
  const from = scale === 'log' ? Math.log(range[0]) : range[0];
  const to = scale === 'log' ? Math.log(range[1]) : range[1];
  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return range;
  const position = Math.max(0, Math.min(1, fraction));
  const anchor = to * (1 - position) + from * position;
  const minimumSpan = Math.max(Math.abs(anchor) * Number.EPSILON * 32, Number.MIN_VALUE * 32);
  const nextSpan = Math.max(minimumSpan, span / factor);
  const low = anchor - (1 - position) * nextSpan;
  const high = anchor + position * nextSpan;
  const result: [number, number] = scale === 'log' ? [Math.exp(low), Math.exp(high)] : [low, high];
  return result.every(Number.isFinite) && result[1] > result[0] && (scale !== 'log' || result[0] > 0) ? result : range;
}

// Translate a viewport by a fraction of its height, preserving its scale/span.
export function scrollPriceRange(range: [number, number], offset: number, scale: PriceScale): [number, number] {
  const [low, high] = range;
  const from = scale === 'log' ? Math.log(low) : low;
  const to = scale === 'log' ? Math.log(high) : high;
  const span = to - from;
  if (!Number.isFinite(offset) || !Number.isFinite(span) || span <= 0) return range;
  const minimum = scale === 'log' ? Math.log(Number.MIN_VALUE) : -Number.MAX_VALUE;
  const maximum = scale === 'log' ? Math.log(Number.MAX_VALUE) : Number.MAX_VALUE;
  const shift = Math.max(minimum - from, Math.min(maximum - to, span * offset));
  const result: [number, number] = scale === 'log'
    ? [Math.max(Number.MIN_VALUE, Math.exp(from + shift)), Math.min(Number.MAX_VALUE, Math.exp(to + shift))]
    : [from + shift, to + shift];
  return result.every(Number.isFinite) && result[1] > result[0] ? result : range;
}

export function timeToIndex(candles: Candle[], time: number): number {
  if (!candles.length) return 0;
  if (candles.length === 1) return 0;
  const i = lowerBound(candles, time);
  const a = i === 0 ? 0 : i >= candles.length ? candles.length - 2 : i - 1;
  const b = a + 1;
  return a + (time - candles[a].time) / (candles[b].time - candles[a].time);
}
