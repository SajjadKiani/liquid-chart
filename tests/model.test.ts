import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CandleStore, movingAverage, priceRange, priceToY, yToPrice, timeToIndex, zoomRightEdge, validateCandle } from '../src/model.ts';

const candle = (time: number, close = 10) => ({ time, open: 10, high: Math.max(12, close), low: Math.min(8, close), close, volume: 100 });

test('history is ordered, deduplicated, and later updates replace matching timestamps', () => {
  const store = new CandleStore();
  store.setData([candle(3000), candle(1000), candle(2000), candle(2000, 11)]);
  assert.deepEqual(store.candles.map(c => c.time), [1000, 2000, 3000]);
  assert.equal(store.candles[1].close, 11);
  assert.deepEqual(store.upsert(candle(2000, 9)), { index: 1, inserted: false });
  assert.equal(store.candles.length, 3);
  assert.deepEqual(store.upsert(candle(1500)), { index: 1, inserted: true });
  assert.deepEqual(store.candles.map(c => c.time), [1000, 1500, 2000, 3000]);
});

test('a malformed import does not overwrite working history', () => {
  const store = new CandleStore();
  store.setData([candle(1000)]);
  assert.throws(() => store.setData([candle(2000), { ...candle(3000), high: 1 }]), /high\/low/);
  assert.equal(store.candles[0].time, 1000);
  assert.throws(() => store.setData([]), /at least one/);
  assert.throws(() => validateCandle({ ...candle(1000), close: NaN }), /finite/);
  assert.throws(() => validateCandle({ ...candle(1000), volume: -1 }), /non-negative/);
  assert.throws(() => validateCandle({ ...candle(1000), time: -10 }), /timestamp/);
});

test('price scales round-trip and flat prices retain a usable range', () => {
  const [low, high] = priceRange([{ ...candle(1000), open: 10, high: 10, low: 10, close: 10 }]);
  assert.ok(low < 10 && high > 10);
  for (const price of [low, 10, high]) {
    assert.ok(Math.abs(yToPrice(priceToY(price, low, high, 18, 400), low, high, 18, 400) - price) < 1e-10);
  }
  assert.equal(priceToY(high, low, high, 18, 400), 18);
  assert.equal(priceToY(low, low, high, 18, 400), 418);
});

test('zoom preserves the bar coordinate underneath the pointer', () => {
  const right = 1806, width = 900, anchorX = 327, oldSpacing = 9, newSpacing = 17;
  const next = zoomRightEdge(right, width, oldSpacing, newSpacing, anchorX);
  assert.ok(Math.abs((right - (width - anchorX) / oldSpacing) - (next - (width - anchorX) / newSpacing)) < 1e-10);
});

test('saved time anchors map correctly with missing sessions and new history', () => {
  const candles = [candle(1000), candle(2000), candle(5000)];
  assert.equal(timeToIndex(candles, 2000), 1);
  assert.equal(timeToIndex(candles, 3500), 1.5);
  assert.equal(timeToIndex([candle(500), ...candles], 2000), 2);
  assert.equal(timeToIndex([candle(1000)], 1000), 0);
});

test('moving average requires a full warmup and matches expected closes', () => {
  const candles = [candle(1000, 1), candle(2000, 2), candle(3000, 3), candle(4000, 4)];
  assert.deepEqual(movingAverage(candles, 3), [null, null, 2, 3]);
  assert.throws(() => movingAverage(candles, 0), /period/);
});
