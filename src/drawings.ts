import type { Anchor, Drawing } from './model.ts';

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
    if (typeof d.id !== 'string' || !d.id || d.id.length > 128 || !['trend', 'horizontal', 'vertical', 'rectangle', 'brush'].includes(d.kind) || !validAnchor(d.a) || !validAnchor(d.b)) continue;
    const base = { id: d.id, a: { ...d.a }, b: { ...d.b }, color: typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#9aaef5', width: typeof d.width === 'number' && Number.isFinite(d.width) && d.width >= 1 && d.width <= 6 ? d.width : 1.5 };
    if (d.kind === 'brush') {
      if (!Array.isArray(d.points) || d.points.length < 2 || d.points.length > MAX_BRUSH_POINTS || !d.points.every(validAnchor)) continue;
      const points = d.points.map(a => ({ ...a }));
      result.set(d.id, { ...base, kind: 'brush', a: points[0], b: points.at(-1)!, points });
    } else result.set(d.id, { ...base, kind: d.kind });
  }
  return [...result.values()];
}

function finite(p: Point): boolean { return Number.isFinite(p.x) && Number.isFinite(p.y); }
export function drawingPoints(d: Drawing, projection: Projection): Point[] {
  const a = projection.point(d.a), b = projection.point(d.b);
  if (d.kind === 'vertical') return Number.isFinite(a.x) ? [{ x: a.x, y: projection.top }, { x: a.x, y: projection.bottom }] : [];
  if (d.kind === 'horizontal') return Number.isFinite(a.y) ? [{ x: 0, y: a.y }, { x: projection.width, y: a.y }] : [];
  const points = d.kind === 'brush' ? d.points.map(projection.point) : d.kind === 'rectangle' ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a] : [a, b];
  return points.every(finite) ? points : [];
}
export function drawingHandles(d: Drawing, projection: Projection): { handle: Handle; point: Point }[] {
  const points = drawingPoints(d, projection);
  if (!points.length) return [];
  if (d.kind === 'horizontal') return [{ handle: 'a', point: { x: projection.width / 2, y: points[0].y } }];
  if (d.kind === 'vertical') return [{ handle: 'a', point: { x: points[0].x, y: (projection.top + projection.bottom) / 2 } }];
  let a = projection.point(d.a), b = projection.point(d.b);
  if (d.kind === 'brush') {
    a = { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) };
    b = { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) };
  }
  const handles: { handle: Handle; point: Point }[] = [{ handle: 'a', point: a }, { handle: 'b', point: b }];
  if (d.kind === 'rectangle' || d.kind === 'brush') handles.push({ handle: 'ab', point: { x: a.x, y: b.y } }, { handle: 'ba', point: { x: b.x, y: a.y } });
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
    const d = drawings[i], points = drawingPoints(d, projection);
    if (!points.length) continue;
    if (d.kind === 'rectangle' && p.x >= Math.min(points[0].x, points[2].x) && p.x <= Math.max(points[0].x, points[2].x) && p.y >= Math.min(points[0].y, points[2].y) && p.y <= Math.max(points[0].y, points[2].y)) return { id: d.id, handle: null };
    for (let j = 1; j < points.length; j++) if (segmentDistance(p, points[j - 1], points[j]) <= Math.max(6, drawingStyle(d).width + 3)) return { id: d.id, handle: null };
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
  const move = (a: Anchor) => { const p = projection.point(a); return projection.anchor({ x: p.x + dx, y: p.y + dy }); };
  if (d.kind === 'brush') { const points = d.points.map(move); return { ...d, points, a: points[0], b: points.at(-1)! }; }
  return { ...d, a: move(d.a), b: move(d.b) };
}
export function resizeDrawing(d: Drawing, handle: Handle, p: Point, projection: Projection): Drawing {
  const a = projection.anchor(p);
  if (d.kind === 'horizontal') return { ...d, a: { ...d.a, price: a.price }, b: { ...d.b, price: a.price } };
  if (d.kind === 'vertical') return { ...d, a: { ...d.a, time: a.time }, b: { ...d.b, time: a.time } };
  if (d.kind !== 'brush') {
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
  const points = d.points.map(a => { const q = projection.point(a); return projection.anchor({ x: fixed.x + (q.x - fixed.x) * sx, y: fixed.y + (q.y - fixed.y) * sy }); });
  return { ...d, points, a: points[0], b: points.at(-1)! };
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
