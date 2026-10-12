import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingPaths, drawingHandles, drawingLabels, hitDrawing, restoreDrawings, resizeDrawing, moveDrawing } from '../src/drawings.ts';
import type { Projection } from '../src/drawings.ts';
import { DRAWING_KINDS } from '../src/drawing-tools.ts';
import { snapToCandle } from '../src/magnet.ts';
import { priceToY, yToPrice, timeToIndex, indexToTime } from '../src/model.ts';
import type { Drawing, Candle, PriceScale } from '../src/model.ts';
import { ChartEngine } from '../src/engine.ts';

const p: Projection = { width: 400, top: 0, bottom: 300, point: a => ({ x: a.time, y: a.price }), anchor: q => ({ time: q.x, price: q.y }) };
const shape = (kind: Drawing['kind']): Drawing => restoreDrawings([{ id: kind, kind, a: { time: 100, price: 60 }, b: { time: 200, price: 160 }, points: [{ time: 100, price: 60 }, { time: 200, price: 160 }] }])[0];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('all menu tools restore cleanly and expose finite geometry and editable handles', () => {
  for (const kind of DRAWING_KINDS) {
    const d = shape(kind);
    assert.equal(d.kind, kind);
    assert.ok(drawingPaths(d, p).length > 0);
    assert.ok(drawingPaths(d, p).flat().every(q => Number.isFinite(q.x) && Number.isFinite(q.y)));
    assert.ok(drawingHandles(d, p).length > 0);
    assert.equal(restoreDrawings([moveDrawing(d, 10, 10, p)])[0].kind, kind);
  }
  assert.deepEqual(restoreDrawings([{ ...shape('highlighter'), points: [{ time: 100, price: NaN }] }]), []);
});
test('rays clip in either direction, extended lines span both sides, and vertical rays remain finite', () => {
  assert.deepEqual(drawingPaths(shape('ray'), p)[0], [{ x: 100, y: 60 }, { x: 340, y: 300 }]);
  assert.deepEqual(drawingPaths(shape('extended'), p)[0], [{ x: 40, y: 0 }, { x: 340, y: 300 }]);
  const reversed = { ...shape('ray'), a: { time: 200, price: 160 }, b: { time: 100, price: 60 } };
  assert.deepEqual(drawingPaths(reversed, p)[0], [{ x: 200, y: 160 }, { x: 40, y: 0 }]);
  assert.deepEqual(drawingPaths({ ...shape('ray'), b: { time: 100, price: 160 } }, p)[0], [{ x: 100, y: 60 }, { x: 100, y: 300 }]);
  assert.equal(hitDrawing([shape('ray')], { x: 300, y: 260 }, p, null)?.id, 'ray');
});
test('multi-line tools do not create invisible diagonal hit targets between disconnected strokes', () => {
  const fib = { ...shape('fib'), b: { time: 200, price: 260 } };
  assert.equal(hitDrawing([fib], { x: 150, y: 83.6 }, p, null), null);
  assert.equal(hitDrawing([fib], { x: 150, y: 60 }, p, null)?.id, 'fib');
  assert.equal(hitDrawing([shape('crossline')], { x: 50, y: 100 }, p, null), null);
});
test('Fibonacci levels interpolate actual prices in log mode and time zones use elapsed timestamps', () => {
  const log: Projection = { ...p, point: a => ({ x: a.time, y: priceToY(a.price, 10, 1000, 0, 300, 'log') }), anchor: q => ({ time: q.x, price: yToPrice(q.y, 10, 1000, 0, 300, 'log') }) };
  const fib = { ...shape('fib'), a: { time: 100, price: 100 }, b: { time: 200, price: 900 } };
  const paths = drawingPaths(fib, log);
  close(paths[4][0].y, priceToY(594.4, 10, 1000, 0, 300, 'log'));
  assert.match(drawingLabels(fib, log)[4].text, /0.618.*594.4/);
  assert.deepEqual(drawingPaths(shape('fib-time'), p).map(path => path[0].x), [100, 200, 300, 400, 600, 900, 1400, 2200]);
});
test('ellipse interiors, circle radii, and thick highlighter strokes are selectable', () => {
  assert.equal(hitDrawing([shape('ellipse')], { x: 150, y: 110 }, p, null)?.id, 'ellipse');
  assert.equal(hitDrawing([shape('ellipse')], { x: 105, y: 65 }, p, null), null);
  const circle = drawingPaths(shape('circle'), p)[0];
  close(circle[0].x, 100 + Math.sqrt(20000)); close(circle[0].y, 60);
  assert.equal(hitDrawing([shape('circle')], { x: 100, y: 60 }, p, null)?.id, 'circle');
  assert.equal(hitDrawing([{ ...shape('highlighter'), width: 6 }], { x: 150, y: 130 }, p, null)?.id, 'highlighter');
});
test('measurements handle reverse direction and zero starting prices; axis handles sit on their strokes', () => {
  const d = { ...shape('range'), a: { time: 86400000, price: 200 }, b: { time: 0, price: 100 } };
  assert.match(drawingLabels(d, p)[0].text, /-100 \(-50%\).*1 days/);
  assert.match(drawingLabels({ ...d, a: { time: 86400000, price: 0 } }, p)[0].text, /100 \(—\)/);
  assert.deepEqual(drawingHandles(shape('price-range'), p)[1].point, { x: 100, y: 160 });
  assert.deepEqual(drawingHandles(shape('date-range'), p)[1].point, { x: 200, y: 60 });
});
test('time-only Fibonacci zones remain visible and editable when price anchors cannot use log scale', () => {
  const projection: Projection = { ...p, point: a => ({ x: a.time, y: priceToY(a.price, 10, 1000, 0, 300, 'log') }), anchor: q => ({ time: q.x, price: yToPrice(q.y, 10, 1000, 0, 300, 'log') }) };
  const d = { ...shape('fib-time'), a: { time: 100, price: -2 }, b: { time: 200, price: 0 } };
  assert.equal(drawingPaths(d, projection).length, 8);
  assert.ok(drawingHandles(d, projection).every(h => Number.isFinite(h.point.y)));
  assert.equal(moveDrawing(d, 10, 50, projection).a.price, -2);
  assert.deepEqual(resizeDrawing(d, 'b', { x: 250, y: 100 }, projection).b, { time: 250, price: 0 });
});

const candles: Candle[] = [
  { time: 1000, open: 100, high: 130, low: 90, close: 110, volume: 1 },
  { time: 2000, open: 120, high: 150, low: 100, close: 125, volume: 1 },
  { time: 9000, open: 140, high: 180, low: 130, close: 170, volume: 1 },
];
const marketProjection = (scale: PriceScale, data = candles): Projection => ({
  width: 400, top: 0, bottom: 300,
  point: a => ({ x: 50 + timeToIndex(data, a.time) * 100, y: priceToY(a.price, 50, 200, 0, 300, scale) }),
  anchor: q => ({ time: indexToTime(data, (q.x - 50) / 100), price: yToPrice(q.y, 50, 200, 0, 300, scale) }),
});
test('weak magnet snaps each OHLC value within 12 CSS pixels on both linear and log scales', () => {
  for (const scale of ['linear', 'log'] as const) for (const field of ['open', 'high', 'low', 'close'] as const) {
    const projection = marketProjection(scale), anchor = { time: candles[1].time, price: candles[1][field] }, q = projection.point(anchor);
    assert.deepEqual(snapToCandle(candles, { x: q.x + 2, y: q.y + 2 }, projection, 'weak')?.anchor, anchor);
    assert.equal(snapToCandle(candles, { x: q.x + 13, y: q.y }, projection, 'weak'), null);
    assert.equal(snapToCandle(candles, q, projection, 'off'), null);
  }
});
test('strong magnet chooses the nearest bar before its nearest OHLC and leaves future slots unsnapped', () => {
  const projection = marketProjection('linear');
  const q = { x: 151, y: 20 };
  assert.equal(snapToCandle(candles, q, projection, 'weak'), null);
  assert.deepEqual(snapToCandle(candles, q, projection, 'strong')?.anchor, { time: 2000, price: 150 });
  assert.equal(snapToCandle(candles, { x: 351, y: 100 }, projection, 'strong'), null);
  assert.equal(snapToCandle([], q, projection, 'strong'), null);
  assert.equal(snapToCandle(candles, { x: 150, y: -5 }, projection, 'strong'), null);
});
test('magnet respects missing sessions, prepends, epoch-zero boundaries, singleton history and hidden log prices', () => {
  const projection = marketProjection('log');
  const target = projection.point({ time: 9000, price: 180 });
  const prefix = { ...candles[0], time: 0 };
  assert.deepEqual(snapToCandle([prefix, ...candles], target, projection, 'weak')?.anchor, { time: 9000, price: 180 });
  const epoch = [{ ...candles[0], time: 0 }, { ...candles[1], time: 1000 }];
  const ep = { ...marketProjection('linear', epoch), point: (a: { time: number; price: number }) => ({ x: 200 + timeToIndex(epoch, a.time) * 100, y: a.price }), anchor: (q: { x: number; y: number }) => ({ time: indexToTime(epoch, (q.x - 200) / 100), price: q.y }) };
  assert.equal(snapToCandle(epoch, { x: 20, y: 100 }, ep, 'strong'), null);
  const one = [candles[0]], op = marketProjection('linear', one);
  assert.deepEqual(snapToCandle(one, op.point({ time: 1000, price: 100 }), op, 'weak')?.anchor, { time: 1000, price: 100 });
  const negative = [{ ...candles[0], open: -100, low: -100, close: 0, high: 130 }];
  const np = marketProjection('log', negative);
  assert.equal(snapToCandle(negative, np.point({ time: 1000, price: 130 }), np, 'weak')?.field, 'high');
});
test('engine anchor placement bypasses magnet with Alt and resized anchors retain exact snapped values', () => {
  const chart = Object.create(ChartEngine.prototype) as ChartEngine & { anchorAt: (q: { x: number; y: number }, bypass: boolean, p: Projection) => { time: number; price: number } };
  Object.assign(chart, { store: { candles }, magnet: 'strong' });
  const projection = marketProjection('log'), q = { x: 149, y: 80 };
  const anchor = chart.anchorAt(q, false, projection);
  assert.deepEqual(anchor, snapToCandle(candles, q, projection, 'strong')!.anchor);
  assert.deepEqual(chart.anchorAt(q, true, projection), projection.anchor(q));
  assert.deepEqual(resizeDrawing(shape('trend'), 'b', projection.point(anchor), projection, anchor).b, anchor);
});
