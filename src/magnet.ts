import { timeToIndex } from './model.ts';
import type { Anchor, Candle } from './model.ts';
import type { Point, Projection } from './drawings.ts';

export type MagnetMode = 'off' | 'weak' | 'strong';
export type Snap = { anchor: Anchor; point: Point; field: 'open' | 'high' | 'low' | 'close' };

// Screen distance keeps weak snapping consistent at every zoom and in log mode.
// Search neighboring bars only; drawing never scans the complete loaded history.
export function snapToCandle(candles: Candle[], p: Point, projection: Projection, mode: MagnetMode): Snap | null {
  if (mode === 'off' || !candles.length || p.x < 0 || p.x > projection.width || p.y < projection.top || p.y > projection.bottom) return null;
  const index = Math.round(timeToIndex(candles, projection.anchor(p).time));
  if (index < 0 || index >= candles.length) return null; // Keep future drawing space free.
  const x = (time: number) => projection.point({ time, price: candles[0].close }).x;
  const first = x(candles[0].time), last = x(candles.at(-1)!.time);
  const leftStep = candles.length > 1 ? x(candles[1].time) - first : x(candles[0].time + 3_600_000) - first;
  const rightStep = candles.length > 1 ? last - x(candles.at(-2)!.time) : leftStep;
  if (p.x < first - leftStep / 2 || p.x > last + rightStep / 2) return null;
  let nearest: Candle | undefined, horizontal = Infinity;
  for (let i = Math.max(0, index - 1); i <= Math.min(candles.length - 1, index + 1); i++) {
    const candle = candles[i], x = projection.point({ time: candle.time, price: candle.close }).x;
    if (x < 0 || x > projection.width) continue;
    if (Math.abs(x - p.x) < horizontal) { nearest = candle; horizontal = Math.abs(x - p.x); }
  }
  if (!nearest) return null;
  let result: Snap | null = null, distance = Infinity;
  for (const field of ['close', 'open', 'high', 'low'] as const) {
    const anchor = { time: nearest.time, price: nearest[field] }, point = projection.point(anchor);
    if (!Number.isFinite(point.y) || point.y < projection.top || point.y > projection.bottom) continue;
    const delta = Math.hypot(point.x - p.x, point.y - p.y);
    if (delta < distance) { result = { anchor, point, field }; distance = delta; }
  }
  return mode === 'weak' && distance > 12 ? null : result;
}
