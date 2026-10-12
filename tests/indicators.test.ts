import test from 'node:test';
import assert from 'node:assert/strict';
import { bandPolygons, indicatorDataRange, indicatorLayout, indicatorLineSegments, indicatorPriceRange, indicatorRange, indicatorValueAtY, indicatorY, validateIndicatorOutput } from '../src/indicators.ts';
import { ChartEngine } from '../src/engine.ts';

const sample = () => ({
  panes: [{ id: 'osc', title: 'Oscillator', levels: [{ value: 0 }, { value: 100 }], range: [0, 100] as [number, number] }],
  series: [{ id: 'wave', name: 'Wave', paneId: 'osc', type: 'line' as const, color: '#61c8ad', points: [{ time: 1000, value: null }, { time: 2000, value: -4 }, { time: 3000, value: 7 }] }],
});

test('indicator validation returns detached output and preserves null warmup points', () => {
  const input = sample();
  const output = validateIndicatorOutput(input);
  assert.notEqual(output, input);
  assert.notEqual(output.series[0].points, input.series[0].points);
  input.series[0].points[1].value = 50;
  assert.equal(output.series[0].points[1].value, -4);
  assert.equal(output.series[0].points[0].value, null);
});

test('indicator validation rejects unordered points and unknown panes atomically', () => {
  const invalid = sample();
  invalid.series[0].points[2].time = 2000;
  assert.throws(() => validateIndicatorOutput(invalid), /strictly increasing/);
  const wrongPane = sample();
  wrongPane.series[0].paneId = 'missing';
  assert.throws(() => validateIndicatorOutput(wrongPane), /unknown pane/);
});

test('indicator ranges handle negative values and honor fixed pane limits', () => {
  const output = validateIndicatorOutput(sample());
  assert.deepEqual(indicatorRange(output.series), [-4.66, 7.66]);
  assert.deepEqual(indicatorRange(output.series, output.panes[0].range), [0, 100]);
  assert.equal(indicatorY(50, [0, 100], 20, 120), 70);
  assert.equal(indicatorY(-3, [-5, 5], 0, 100), 80);
});

test('histogram ranges include their baseline and empty panes remain finite', () => {
  const output = validateIndicatorOutput({ panes: [{ id: 'hist', title: 'Histogram' }], series: [{ id: 'bars', name: 'Bars', paneId: 'hist', type: 'histogram', color: '#fff', baseline: 0, points: [{ time: 1, value: -2 }, { time: 2, value: 3 }] }] });
  const [low, high] = indicatorRange(output.series);
  assert.ok(low < -2 && high > 3);
  assert.deepEqual(indicatorRange([]), [0, 1]);
});

test('visible auto range ignores offscreen values and line segments stop at null gaps', () => {
  const series = validateIndicatorOutput({ panes: [{ id: 'p', title: 'P' }], series: [{ id: 's', name: 'S', paneId: 'p', type: 'line', color: '#fff', points: [{ time: 1, value: 1 }, { time: 2, value: 2 }, { time: 3, value: null }, { time: 4, value: 3 }, { time: 5, value: 1000 }] }] }).series;
  assert.ok(indicatorRange(series, undefined, [1, 4])[1] < 4);
  assert.deepEqual(indicatorLineSegments(series[0].points.slice(0, 4)).map(segment => segment.map(point => point.value)), [[1, 2], [3]]);
});

test('extreme finite values keep autoscale and coordinate transforms finite', () => {
  const output = validateIndicatorOutput({ panes: [{ id: 'p', title: 'P' }], series: [{ id: 's', name: 'S', paneId: 'p', type: 'line', color: '#fff', points: [{ time: 1, value: -Number.MAX_VALUE }, { time: 2, value: Number.MAX_VALUE }] }] });
  const range = indicatorRange(output.series);
  assert.ok(range.every(Number.isFinite) && range[0] < range[1]);
  assert.ok(Number.isFinite(indicatorY(Number.MAX_VALUE, range, 0, 100)));
  assert.ok(Number.isFinite(indicatorValueAtY(50, range, 0, 100)));
});

test('pane layout preserves the no-pane geometry and stays inside the chart', () => {
  const legacy = indicatorLayout(468, 0, true);
  assert.equal(legacy.priceBottom, 468 * 0.77);
  const layout = indicatorLayout(468, 4, true);
  assert.equal(layout.paneCount, 4);
  assert.ok(layout.paneTop >= 0 && layout.paneTop + layout.paneHeight * layout.paneCount <= 468);
  assert.ok(layout.volumeTop < layout.paneTop);
  const tiny = indicatorLayout(50, 4, true);
  assert.equal(tiny.paneCount, 0);
  assert.ok(tiny.priceBottom <= 50);
});

test('chart-wide pane limit rejects a new layer without replacing existing outputs', () => {
  const chart = Object.create(ChartEngine.prototype) as ChartEngine & { indicators: Map<string, ReturnType<typeof validateIndicatorOutput>>; invalidate: () => void; clampViewport: () => void };
  chart.indicators = new Map();
  chart.invalidate = () => {};
  chart.clampViewport = () => {};
  const fourPanes = { panes: Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, title: `Pane ${index}` })), series: [] };
  chart.setIndicator('kept', fourPanes);
  assert.throws(() => chart.setIndicator('rejected', { panes: [{ id: 'other', title: 'Other' }], series: [] }), /chart-wide/);
  assert.deepEqual([...chart.indicators.keys()], ['kept']);
});

test('band output validates paired nulls and bounded bar offsets', () => {
  const valid = validateIndicatorOutput({ panes: [], series: [{ id: 'cloud', name: 'Cloud', paneId: 'price', type: 'band', color: '#3ca47b', negativeColor: '#cc6670', offset: 26, points: [{ time: 1, value: null, value2: null }, { time: 2, value: 10, value2: 8 }] }] });
  assert.equal(valid.series[0].offset, 26);
  assert.throws(() => validateIndicatorOutput({ panes: [], series: [{ id: 'cloud', name: 'Cloud', paneId: 'price', type: 'band', color: '#fff', offset: 501, points: [] }] }), /offset/);
  assert.throws(() => validateIndicatorOutput({ panes: [], series: [{ id: 'cloud', name: 'Cloud', paneId: 'price', type: 'band', color: '#fff', points: [{ time: 1, value: null, value2: 2 }] }] }), /null both values/);
});

test('band geometry splits fill colors exactly at crossings', () => {
  const polygons = bandPolygons([{ x: 0, value: 10, value2: 0 }, { x: 20, value: 0, value2: 10 }]);
  assert.equal(polygons.length, 2);
  assert.deepEqual(polygons.map(polygon => polygon.positive), [true, false]);
  assert.deepEqual(polygons[0].vertices[1], { x: 10, value: 5 });
  assert.deepEqual(polygons[1].vertices[0], { x: 10, value: 5 });
  assert.equal(bandPolygons([{ x: 0, value: 1, value2: 1 }, { x: 1, value: 1, value2: 1 }]).length, 0);
});

test('band crossing geometry follows transformed screen edges on a log scale', () => {
  const logY = (value: number) => 100 - Math.log(value) / Math.log(100) * 100;
  const polygons = bandPolygons([
    { x: 0, value: -logY(100), value2: -logY(10) },
    { x: 10, value: -logY(1), value2: -logY(10) },
  ]);
  assert.equal(polygons.length, 2);
  assert.ok(Math.abs(polygons[0].vertices[1].x - 5) < 1e-9);
  assert.ok(Math.abs(polygons[0].vertices[1].value + 50) < 1e-9);
});

test('offset auto-ranges use shifted source times and omit non-overlapping series', () => {
  const series = validateIndicatorOutput({ panes: [], series: [{ id: 's', name: 'S', paneId: 'price', type: 'line', color: '#fff', offset: 2, points: [{ time: 1, value: 100 }, { time: 2, value: 200 }] }] }).series;
  assert.deepEqual(indicatorDataRange(series, undefined, offset => offset === 2 ? [1, 1] : undefined), [100, 100]);
  assert.equal(indicatorDataRange(series, undefined, () => undefined), null);
  const base: [number, number] = [5, 15];
  assert.ok(indicatorPriceRange(base, [20, 30], false)[1] > 30);
  const logarithmic = indicatorPriceRange([5, 15], [30, 40], true);
  assert.ok(logarithmic[0] > 0 && logarithmic[0] < 5 && logarithmic[1] > 40);
});

test('offset auto-range can include the source tail beyond the final candle', () => {
  const series = validateIndicatorOutput({ panes: [], series: [{ id: 'cloud', name: 'Cloud', paneId: 'price', type: 'band', color: '#fff', offset: 26, points: [{ time: 1, value: 1, value2: 2 }, { time: 100, value: 900, value2: 1000 }] }] }).series;
  // A viewport extending 26 bars past the last candle must request the un-clamped source tail.
  assert.deepEqual(indicatorDataRange(series, undefined, offset => offset === 26 ? [100, 100] : undefined), [900, 1000]);
  assert.equal(indicatorDataRange(series, undefined, () => undefined), null);
});
