import test from 'node:test';
import assert from 'node:assert/strict';
import { CandleStore, indexToTime, timeToIndex, priceToY, yToPrice } from '../src/model.ts';
import type { Drawing, PriceScale } from '../src/model.ts';
import { DrawingHistory, drawingPoints, drawingHandles, hitDrawing, moveDrawing, resizeDrawing, restoreDrawings, MAX_BRUSH_POINTS, MAX_DRAWINGS } from '../src/drawings.ts';
import type { Projection } from '../src/drawings.ts';
import { ChartEngine } from '../src/engine.ts';

const a = { time: 100, price: 20 }, b = { time: 200, price: 40 };
const line: Drawing = { id: 'line', kind: 'trend', a, b, color: '#9aaef5', width: 2 };
const projection: Projection = { width: 400, top: 0, bottom: 100, point: p => ({ x: p.time, y: p.price }), anchor: p => ({ time: p.x, price: p.y }) };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`);

test('legacy drawings migrate safely while malformed anchors, paths and duplicate ids are handled', () => {
  const result = restoreDrawings([
    { id: 'old', kind: 'trend', a, b }, { id: 'bad', kind: 'rectangle', a: { time: '100', price: 20 }, b },
    { id: 'old', kind: 'horizontal', a, b, color: 'invalid', width: 999 },
    { id: 'bad-brush', kind: 'brush', a, b, points: [a, { time: 200, price: Infinity }] },
    { id: 'brush', kind: 'brush', a, b, points: [a, b], width: 4, color: '#ffffff' },
    { id: 'too-long', kind: 'brush', a, b, points: Array(MAX_BRUSH_POINTS + 1).fill(a) },
  ]);
  assert.deepEqual(result.map(d => d.id), ['old', 'brush']);
  assert.equal(result[0].kind, 'horizontal'); assert.equal(result[0].width, 1.5); assert.equal(result[0].color, '#9aaef5');
  assert.equal(result[1].width, 4); assert.equal(result[1].color, '#ffffff');
  assert.equal(restoreDrawings(Array.from({ length: 1100 }, (_, i) => ({ ...line, id: String(i) }))).length, MAX_DRAWINGS);
});

test('hit testing finds topmost strokes, rectangle interiors, and selected resize handles', () => {
  const rect: Drawing = { ...line, id: 'rect', kind: 'rectangle' };
  assert.equal(hitDrawing([line, rect], { x: 150, y: 30 }, projection, null)!.id, 'rect');
  assert.equal(hitDrawing([line], { x: 150, y: 34 }, projection, null)!.id, 'line');
  assert.equal(hitDrawing([line], { x: 150, y: 90 }, projection, null), null);
  assert.deepEqual(hitDrawing([rect], { x: 200, y: 20 }, projection, 'rect'), { id: 'rect', handle: 'ba' });
  const brush: Drawing = { ...line, id: 'brush', kind: 'brush', points: [a, { time: 130, price: 70 }, b] };
  assert.equal(hitDrawing([brush], { x: 130, y: 71 }, projection, null)!.id, 'brush');
});

test('moving horizontal and vertical lines changes only their relevant axis', () => {
  const horizontal = moveDrawing({ ...line, kind: 'horizontal' }, 100, 10, projection);
  assert.equal(horizontal.a.time, a.time); assert.equal(horizontal.a.price, 30); assert.equal(horizontal.b.price, 30);
  const vertical = moveDrawing({ ...line, kind: 'vertical' }, 50, 80, projection);
  assert.equal(vertical.a.time, 150); assert.equal(vertical.b.time, 150); assert.equal(vertical.a.price, a.price);
});

test('line and brush movement preserve shape in screen space on linear and log scales', () => {
  for (const scale of ['linear', 'log'] as PriceScale[]) {
    const p: Projection = { ...projection, point: a => ({ x: a.time, y: priceToY(a.price, 10, 100, 0, 300, scale) }), anchor: q => ({ time: q.x, price: yToPrice(q.y, 10, 100, 0, 300, scale) }) };
    const brush: Drawing = { ...line, kind: 'brush', points: [a, { time: 150, price: 60 }, b] };
    for (const original of [line, brush]) {
      const before = drawingPoints(original, p), after = drawingPoints(moveDrawing(original, 25, -12, p), p);
      before.forEach((point, i) => { close(after[i].x, point.x + 25); close(after[i].y, point.y - 12); });
    }
    assert.equal(brush.points[0], a); assert.equal(line.a, a);
  }
});

test('rectangle corner resizing retains the opposite corner and supports crossing it', () => {
  const rect: Drawing = { ...line, kind: 'rectangle' };
  const moved = resizeDrawing(rect, 'ab', { x: 250, y: 10 }, projection);
  assert.deepEqual(moved.a, { time: 250, price: 20 }); assert.deepEqual(moved.b, { time: 200, price: 10 });
  const handles = drawingHandles(moved, projection);
  assert.deepEqual(handles.find(h => h.handle === 'ba')!.point, { x: 200, y: 20 });
  assert.equal(rect.a, a);
});

test('brush bounding-box resizing transforms every point without mutating the original stroke', () => {
  const brush: Drawing = { ...line, kind: 'brush', points: [a, { time: 150, price: 30 }, b] };
  const resized = resizeDrawing(brush, 'b', { x: 300, y: 60 }, projection);
  assert.equal(resized.kind, 'brush');
  if (resized.kind === 'brush') assert.deepEqual(resized.points, [a, { time: 200, price: 40 }, { time: 300, price: 60 }]);
  assert.deepEqual(brush.points, [a, { time: 150, price: 30 }, b]);
});

test('log-invalid price shapes stay stored but unselectable; vertical time lines remain visible', () => {
  const p: Projection = { ...projection, point: a => ({ x: a.time, y: priceToY(a.price, 1, 100, 0, 100, 'log') }), anchor: q => ({ time: q.x, price: yToPrice(q.y, 1, 100, 0, 100, 'log') }) };
  const invalid: Drawing = { ...line, a: { time: 100, price: -5 } };
  assert.deepEqual(drawingPoints(invalid, p), []);
  const vertical: Drawing = { ...invalid, kind: 'vertical' };
  assert.equal(drawingPoints(vertical, p).length, 2);
  const moved = moveDrawing(vertical, 20, 30, p);
  assert.equal(moved.a.time, 120); assert.equal(moved.a.price, -5);
});

test('time/index conversions support fractional anchors, missing sessions and future space', () => {
  const candle = (time: number) => ({ time, open: 10, high: 12, low: 8, close: 10, volume: 1 });
  const data = [candle(10000), candle(20000), candle(50000)];
  for (const index of [-0.5, 0.25, 1.5, 3.25]) close(timeToIndex(data, indexToTime(data, index)), index);
  const single = [candle(10_000_000)];
  for (const index of [-1, 0.25, 2]) close(timeToIndex(single, indexToTime(single, index)), index);
  assert.equal(indexToTime(data, -1000), 0);
});

test('undo/redo keeps immutable edits, drops redo on new actions and bounds history', () => {
  const h = new DrawingHistory(); const initial = [line], changed = [moveDrawing(line, 10, 0, projection)];
  h.record(initial); assert.deepEqual(h.undo(changed), initial); assert.equal(h.canRedo, true);
  assert.deepEqual(h.redo(initial), changed);
  h.undo(changed); h.record(initial); assert.equal(h.canRedo, false);
  for (let i = 0; i < 70; i++) h.record([{ ...line, id: String(i) }]);
  let count = 0; while (h.undo([])) count++; assert.equal(count, 50);
  h.reset(); assert.equal(h.canRedo, false);
});

function engineHarness() {
  const engine = Object.create(ChartEngine.prototype) as any;
  engine.drawings = []; engine.drawingHistory = new DrawingHistory(); engine.selectedId = null;
  engine.drawingStyle = { color: '#9aaef5', width: 2 }; engine.tool = 'cursor';
  engine.invalidate = () => {}; engine.overlay = { style: {} };
  engine.onDrawingsChange = () => {};
  return engine;
}

test('style editing, delete, clear, undo and dataset reset use separate atomic drawing actions', () => {
  const e = engineHarness(); e.setDrawings([line]); e.selectedId = line.id;
  e.setDrawingStyle({ color: '#ffffff', width: 4 });
  assert.equal(e.drawings[0].width, 4); assert.equal(e.drawings[0].color, '#ffffff');
  e.undoDrawing(); assert.equal(e.drawings[0].color, line.color);
  e.redoDrawing(); e.selectedId = line.id; e.deleteSelectedDrawing(); assert.equal(e.drawings.length, 0);
  e.undoDrawing(); assert.equal(e.drawings.length, 1);
  e.clearDrawings(); e.undoDrawing(); assert.equal(e.drawings.length, 1);
  e.setDrawings([]); assert.equal(e.drawingHistory.canUndo, false);
});

test('cancelling an unfinished edit restores the original shape without an undo action', () => {
  const e = engineHarness(); e.setDrawings([line]);
  const before = e.drawings;
  e.editing = { before }; e.drawings = [moveDrawing(line, 40, 10, projection)];
  e.setTool('brush'); assert.equal(e.drawings, before); assert.equal(e.drawingHistory.canUndo, false);
});

test('a partial style change preserves the selected legacy stroke width', () => {
  const e = engineHarness(); e.setDrawings([{ id: 'old', kind: 'trend', a, b }]); e.selectedId = 'old';
  e.setDrawingStyle({ color: '#ffffff' });
  assert.equal(e.drawings[0].width, 1.5); assert.equal(e.drawings[0].color, '#ffffff');
});

test('captured drawing projections keep time anchors stable while older history is prepended', () => {
  const e = engineHarness(); e.store = new CandleStore(); e.spacing = 9;
  const candle = (time: number) => ({ time, open: 10, high: 12, low: 8, close: 10, volume: 1 });
  e.store.setData([candle(10000), candle(20000), candle(50000)]);
  e.frame = { left: 0, width: 400, low: 1, high: 100, priceBottom: 300, priceScale: 'log' };
  const p = e.projection(true), anchor = p.anchor({ x: 13.5, y: 100 });
  e.store.prepend([candle(1000), candle(2000)]);
  assert.deepEqual(p.anchor({ x: 13.5, y: 100 }), anchor);
  close(p.point(anchor).x, 13.5); close(p.point(anchor).y, 100);
});
