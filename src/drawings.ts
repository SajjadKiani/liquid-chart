import type { Anchor, Drawing } from './model.ts';
import { DRAWING_KINDS, freehand, boxShape } from './drawing-tools.ts';

export type Point = { x: number; y: number };
export type Handle = 'a' | 'b' | 'ab' | 'ba';
export type Projection = { point: (a: Anchor) => Point; anchor: (p: Point) => Anchor; width: number; top: number; bottom: number };
export const DEFAULT_DRAWING_STYLE = { color: '#9aaef5', width: 2 };
export const MAX_DRAWINGS = 1000;
export const MAX_BRUSH_POINTS = 2000;
export function drawingStyle(d: Pick<Drawing, 'color' | 'width'>) {
  return { color: d.color ?? '#9aaef5', width: d.width ?? 1.5 };
}
function validAnchor(value: unknown): value is Anchor {
  if (!value || typeof value !== 'object') return false;
  const a = value as Anchor;
  return Number.isFinite(a.time) && a.time >= 0 && a.time <= 8.64e15 && Number.isFinite(a.price);
}
export function restoreDrawings(value: unknown): Drawing[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, Drawing>();
  for (const raw of value.slice(0, MAX_DRAWINGS)) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Drawing;
    if (typeof d.id !== 'string' || !d.id || d.id.length > 128 || !DRAWING_KINDS.includes(d.kind) || !validAnchor(d.a) || !validAnchor(d.b)) continue;
    const base = { id: d.id, a: { ...d.a }, b: { ...d.b }, color: typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#9aaef5', width: typeof d.width === 'number' && Number.isFinite(d.width) && d.width >= 1 && d.width <= 6 ? d.width : 1.5 };
    if (freehand(d.kind)) {
      if (!Array.isArray(d.points!) || d.points!.length < 2 || d.points!.length > MAX_BRUSH_POINTS || !d.points!.every(validAnchor)) continue;
      const points = d.points!.map(a => ({ ...a }));
      result.set(d.id, { ...base, kind: d.kind as 'brush' | 'highlighter', a: points[0], b: points.at(-1)!, points });
    } else result.set(d.id, { ...base, kind: d.kind });
  }
  return [...result.values()];
}

function finite(p: Point): boolean { return Number.isFinite(p.x) && Number.isFinite(p.y); }
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_TIMES = [0, 1, 2, 3, 5, 8, 13, 21];
function arrowHead(a: Point, b: Point): Point[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x), size = 12;
  return [{ x: b.x - size * Math.cos(angle - 0.5), y: b.y - size * Math.sin(angle - 0.5) }, b,
    { x: b.x - size * Math.cos(angle + 0.5), y: b.y - size * Math.sin(angle + 0.5) }];
}
export function drawingPaths(d: Drawing, projection: Projection): Point[][] {
  const a = projection.point(d.a), b = projection.point(d.b), { width, top, bottom } = projection;
  const horizontal = [{ x: 0, y: a.y }, { x: width, y: a.y }];
  const vertical = [{ x: a.x, y: top }, { x: a.x, y: bottom }];
  if (d.kind === 'vertical') return Number.isFinite(a.x) ? [vertical] : [];
  if (d.kind === 'horizontal') return Number.isFinite(a.y) ? [horizontal] : [];
  if (d.kind === 'horizontal-ray') return finite(a) ? [[a, { x: width, y: a.y }]] : [];
  if (d.kind === 'fib-time') return FIB_TIMES.map(level => {
    const x = projection.point({ time: d.a.time + (d.b.time - d.a.time) * level, price: d.a.price }).x;
    return [{ x, y: top }, { x, y: bottom }];
  }).filter(path => path.every(finite));
  if (!finite(a) || !finite(b)) return [];
  if (d.kind === 'crossline') return [horizontal, vertical];
  if (freehand(d.kind)) { const points = d.points!.map(projection.point); return points.every(finite) ? [points] : []; }
  if (d.kind === 'ray' || d.kind === 'extended') {
    // Parametric clipping handles vertical lines and both ray directions.
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 0.001) return [[a, b]];
    let lo = d.kind === 'ray' ? 0 : -Infinity, hi = Infinity;
    for (const [origin, delta, min, max] of [[a.x, dx, 0, width], [a.y, dy, top, bottom]]) {
      if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) return []; continue; }
      const u = (min - origin) / delta, v = (max - origin) / delta;
      lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
    }
    return lo <= hi ? [[{ x: a.x + lo * dx, y: a.y + lo * dy }, { x: a.x + hi * dx, y: a.y + hi * dy }]] : [];
  }
  if (d.kind === 'fib') return FIB_LEVELS.map(level => {
    // Interpolate in price space; project each level independently in log mode.
    const y = projection.point({ time: d.a.time, price: d.a.price + (d.b.price - d.a.price) * level }).y;
    return [{ x: Math.min(a.x, b.x), y }, { x: Math.max(a.x, b.x), y }];
  }).filter(path => path.every(finite));
  if (d.kind === 'arrow') return [[a, b], arrowHead(a, b)];
  if (d.kind === 'arrow-up' || d.kind === 'arrow-down') {
    const direction = d.kind === 'arrow-up' ? 1 : -1, tail = { x: a.x, y: a.y + direction * 24 };
    return [[tail, a], arrowHead(tail, a)];
  }
  if (d.kind === 'price-range') return [[a, { x: a.x, y: b.y }], [{ x: a.x - 6, y: a.y }, { x: a.x + 6, y: a.y }], [{ x: a.x - 6, y: b.y }, { x: a.x + 6, y: b.y }]];
  if (d.kind === 'date-range') return [[a, { x: b.x, y: a.y }], [{ x: a.x, y: a.y - 6 }, { x: a.x, y: a.y + 6 }], [{ x: b.x, y: a.y - 6 }, { x: b.x, y: a.y + 6 }]];
  if (d.kind === 'rectangle' || d.kind === 'range') return [[a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]];
  if (d.kind === 'ellipse' || d.kind === 'circle') {
    const center = d.kind === 'circle' ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rx = d.kind === 'circle' ? Math.hypot(b.x - a.x, b.y - a.y) : Math.abs(b.x - a.x) / 2;
    const ry = d.kind === 'circle' ? rx : Math.abs(b.y - a.y) / 2;
    return [Array.from({ length: 97 }, (_, i) => ({ x: center.x + rx * Math.cos(i * Math.PI / 48), y: center.y + ry * Math.sin(i * Math.PI / 48) }))];
  }
  return [[a, b]];
}
export function drawingPoints(d: Drawing, projection: Projection): Point[] { return drawingPaths(d, projection).flat(); }
export function drawingLabels(d: Drawing, projection: Projection): { point: Point; text: string }[] {
  const a = projection.point(d.a), b = projection.point(d.b);
  if (d.kind === 'fib-time') return FIB_TIMES.map(level => ({ point: { x: projection.point({ time: d.a.time + (d.b.time - d.a.time) * level, price: d.a.price }).x + 4, y: projection.top + 15 }, text: String(level) })).filter(label => label.point.x >= 0 && label.point.x <= projection.width);
  if (!finite(a) || !finite(b)) return [];
  const number = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (d.kind === 'fib') return FIB_LEVELS.map(level => ({
    point: { x: Math.min(a.x, b.x) + 4, y: projection.point({ time: d.a.time, price: d.a.price + (d.b.price - d.a.price) * level }).y - 5 },
    text: `${level} (${number(d.a.price + (d.b.price - d.a.price) * level)})`,
  }));
  const change = d.b.price - d.a.price, percent = d.a.price === 0 ? '—' : `${number(change / Math.abs(d.a.price) * 100)}%`;
  const price = `${change >= 0 ? '+' : ''}${number(change)} (${percent})`;
  const days = Math.abs(d.b.time - d.a.time) / 86400000;
  const duration = days >= 1 ? `${number(days)} days` : `${number(days * 24)} hours`;
  const text = d.kind === 'price-range' ? price : d.kind === 'date-range' ? duration : d.kind === 'range' || d.kind === 'info' ? `${price} · ${duration}` : '';
  return text ? [{ point: { x: (a.x + b.x) / 2 + 4, y: Math.min(a.y, b.y) - 8 }, text }] : [];
}
function singlePointKind(kind: string) { return ['horizontal-ray', 'crossline', 'arrow-up', 'arrow-down'].includes(kind); }
export function drawingHandles(d: Drawing, projection: Projection): { handle: Handle; point: Point }[] {
  const points = drawingPoints(d, projection);
  if (!points.length) return [];
  if (d.kind === 'horizontal') return [{ handle: 'a', point: { x: projection.width / 2, y: points[0].y } }];
  if (d.kind === 'vertical') return [{ handle: 'a', point: { x: points[0].x, y: (projection.top + projection.bottom) / 2 } }];
  if (d.kind === 'fib-time') return ['a', 'b'].map(handle => ({ handle: handle as Handle, point: { x: projection.point(d[handle as 'a' | 'b']).x, y: (projection.top + projection.bottom) / 2 } }));
  if (singlePointKind(d.kind)) return [{ handle: 'a', point: projection.point(d.a) }];
  let a = projection.point(d.a), b = projection.point(d.b);
  if (d.kind === 'price-range') b = { x: a.x, y: b.y };
  if (d.kind === 'date-range') b = { x: b.x, y: a.y };
  if (freehand(d.kind)) {
    a = { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) };
    b = { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) };
  }
  const handles: { handle: Handle; point: Point }[] = [{ handle: 'a', point: a }, { handle: 'b', point: b }];
  if (boxShape(d.kind) || freehand(d.kind)) handles.push({ handle: 'ab', point: { x: a.x, y: b.y } }, { handle: 'ba', point: { x: b.x, y: a.y } });
  return handles;
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hitDrawing(drawings: Drawing[], p: Point, projection: Projection, selectedId: string | null): { id: string; handle: Handle | null } | null {
  const selected = drawings.find(d => d.id === selectedId);
  if (selected) for (const h of drawingHandles(selected, projection)) if (Math.hypot(p.x - h.point.x, p.y - h.point.y) <= 8) return { id: selected.id, handle: h.handle };
  // Topmost stroke wins. Rectangles can also be grabbed by their interior.
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i], paths = drawingPaths(d, projection), points = paths.flat();
    if (!points.length) continue;
    if ((d.kind === 'rectangle' || d.kind === 'range') && p.x >= Math.min(points[0].x, points[2].x) && p.x <= Math.max(points[0].x, points[2].x) && p.y >= Math.min(points[0].y, points[2].y) && p.y <= Math.max(points[0].y, points[2].y)) return { id: d.id, handle: null };
    if (d.kind === 'ellipse' || d.kind === 'circle') {
      const a = projection.point(d.a), b = projection.point(d.b);
      const center = d.kind === 'circle' ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rx = d.kind === 'circle' ? Math.hypot(b.x - a.x, b.y - a.y) : Math.abs(b.x - a.x) / 2;
      const ry = d.kind === 'circle' ? rx : Math.abs(b.y - a.y) / 2;
      if (rx > 0 && ry > 0 && ((p.x - center.x) / rx) ** 2 + ((p.y - center.y) / ry) ** 2 <= 1) return { id: d.id, handle: null };
    }
    for (const points of paths) for (let j = 1; j < points.length; j++) if (segmentDistance(p, points[j - 1], points[j]) <= Math.max(6, drawingStyle(d).width * (d.kind === 'highlighter' ? 4 : 1) + 3)) return { id: d.id, handle: null };
  }
  return null;
}
export function moveDrawing(d: Drawing, dx: number, dy: number, projection: Projection): Drawing {
  if (d.kind === 'horizontal') {
    const price = projection.anchor({ x: projection.width / 2, y: projection.point(d.a).y + dy }).price;
    return { ...d, a: { ...d.a, price }, b: { ...d.b, price } };
  }
  if (d.kind === 'vertical') {
    const time = projection.anchor({ x: projection.point(d.a).x + dx, y: (projection.top + projection.bottom) / 2 }).time;
    return { ...d, a: { ...d.a, time }, b: { ...d.b, time } };
  }
  if (d.kind === 'fib-time') {
    const move = (a: Anchor) => ({ ...a, time: projection.anchor({ x: projection.point(a).x + dx, y: projection.top }).time });
    return { ...d, a: move(d.a), b: move(d.b) };
  }
  const move = (a: Anchor) => { const p = projection.point(a); return projection.anchor({ x: p.x + dx, y: p.y + dy }); };
  if (d.kind === 'brush' || d.kind === 'highlighter') { const points = d.points.map(move); return { ...d, points, a: points[0], b: points.at(-1)! }; }
  return { ...d, a: move(d.a), b: move(d.b) };
}
export function resizeDrawing(d: Drawing, handle: Handle, p: Point, projection: Projection, a = projection.anchor(p)): Drawing {
  if (d.kind === 'horizontal') return { ...d, a: { ...d.a, price: a.price }, b: { ...d.b, price: a.price } };
  if (d.kind === 'vertical') return { ...d, a: { ...d.a, time: a.time }, b: { ...d.b, time: a.time } };
  if (d.kind === 'fib-time') return handle === 'a' ? { ...d, a: { ...d.a, time: a.time } } : { ...d, b: { ...d.b, time: a.time } };
  if (!freehand(d.kind)) {
    if (handle === 'a') return { ...d, a };
    if (handle === 'b') return { ...d, b: a };
    if (handle === 'ab') return { ...d, a: { ...d.a, time: a.time }, b: { ...d.b, price: a.price } };
    return { ...d, a: { ...d.a, price: a.price }, b: { ...d.b, time: a.time } };
  }
  const handles = drawingHandles(d, projection);
  const opposite: Record<Handle, Handle> = { a: 'b', b: 'a', ab: 'ba', ba: 'ab' };
  const from = handles.find(h => h.handle === handle)!.point, fixed = handles.find(h => h.handle === opposite[handle])!.point;
  const sx = Math.abs(from.x - fixed.x) < 0.001 ? 1 : (p.x - fixed.x) / (from.x - fixed.x);
  const sy = Math.abs(from.y - fixed.y) < 0.001 ? 1 : (p.y - fixed.y) / (from.y - fixed.y);
  const points = d.points!.map(a => { const q = projection.point(a); return projection.anchor({ x: fixed.x + (q.x - fixed.x) * sx, y: fixed.y + (q.y - fixed.y) * sy }); });
  return { ...d, kind: d.kind as 'brush' | 'highlighter', points, a: points[0], b: points.at(-1)! };
}

export class DrawingHistory {
  private past: Drawing[][] = [];
  private future: Drawing[][] = [];
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  record(previous: Drawing[]): void { this.past.push(previous.slice()); if (this.past.length > 50) this.past.shift(); this.future = []; }
  undo(current: Drawing[]): Drawing[] | null { if (!this.past.length) return null; this.future.push(current.slice()); return this.past.pop()!; }
  redo(current: Drawing[]): Drawing[] | null { if (!this.future.length) return null; this.past.push(current.slice()); return this.future.pop()!; }
  reset(): void { this.past = []; this.future = []; }
}
