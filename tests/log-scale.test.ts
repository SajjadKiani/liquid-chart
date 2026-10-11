import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CandleStore, priceRange, priceTicks, priceToY, yToPrice } from '../src/model.ts';

const candle = (time: number, price: number) => ({ time, open: price, high: price, low: price, close: price, volume: 1 });
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-12), `${actual} ≈ ${expected}`);

test('equal percentage changes have equal pixel distances in log mode', () => {
  const y = (price: number) => priceToY(price, 5, 160, 18, 400, 'log');
  near(y(10) - y(20), y(20) - y(40));
  near(y(20) - y(40), y(40) - y(80));
  assert.equal(y(160), 18);
  assert.equal(y(5), 418);
  // The existing linear default still places equal absolute changes equally.
  near(priceToY(10, 5, 160, 18, 400) - priceToY(20, 5, 160, 18, 400),
    priceToY(20, 5, 160, 18, 400) - priceToY(30, 5, 160, 18, 400));
});

test('log crosshair and drawing price coordinates round-trip across decades', () => {
  for (const price of [0.000001, 0.0001, 1, 1000, 1e9]) {
    const y = priceToY(price, 0.000001, 1e9, 18, 800, 'log');
    near(yToPrice(y, 0.000001, 1e9, 18, 800, 'log'), price);
  }
  // A midway screen point represents the geometric, not arithmetic, midpoint.
  near(yToPrice(218, 10, 1000, 18, 400, 'log'), 100);
});

test('log range pads both ends proportionally and handles flat tiny prices', () => {
  const [low, high] = priceRange([candle(1000, 1), candle(2000, 1000)], 'log');
  assert.ok(low > 0 && low < 1 && high > 1000);
  near(1 / low, high / 1000);
  const [flatLow, flatHigh] = priceRange([candle(1000, 1e-8)], 'log');
  assert.ok(flatLow > 0 && flatLow < 1e-8 && flatHigh > 1e-8);
  assert.ok(Number.isFinite(priceToY(1e-8, flatLow, flatHigh, 18, 400, 'log')));
  const [emptyLow, emptyHigh] = priceRange([], 'log');
  assert.ok(emptyLow > 0 && emptyHigh > emptyLow);
});

test('log ticks are real prices with regular screen spacing', () => {
  const ticks = priceTicks(1, 1000, 'log');
  assert.ok(ticks.length >= 3 && ticks.length <= 20);
  assert.ok(ticks.every((p, i) => p >= 1 && p < 1000 && (i === 0 || p > ticks[i - 1])));
  const positions = ticks.map(p => priceToY(p, 1, 1000, 18, 400, 'log'));
  for (let i = 2; i < positions.length; i++) near(positions[i - 1] - positions[i], positions[0] - positions[1]);
  assert.deepEqual(priceTicks(0, 10), [0, 2, 4, 6, 8]);
});

test('non-positive prices are valid data but cannot use a real log scale', () => {
  assert.throws(() => priceRange([candle(1000, 0)], 'log'), /positive/);
  assert.throws(() => priceRange([candle(1000, -5)], 'log'), /positive/);
  assert.ok(Number.isNaN(priceToY(0, 1, 100, 18, 400, 'log')));
  assert.ok(Number.isNaN(priceToY(-5, 1, 100, 18, 400, 'log')));
  assert.ok(Number.isNaN(yToPrice(200, 0, 100, 18, 400, 'log')));
  assert.deepEqual(priceTicks(0, 100, 'log'), []);
  const [low, high] = priceRange([candle(1000, -5)]);
  assert.ok(Number.isFinite(priceToY(-5, low, high, 18, 400)));
});

test('log availability tracks corrected, inserted, deduplicated, and invalid data', () => {
  const store = new CandleStore();
  assert.equal(store.supportsLogScale, false);
  store.setData([candle(1000, 0), candle(1000, 5), candle(2000, 8)]);
  assert.equal(store.supportsLogScale, true);
  store.upsert({ ...candle(2000, 8), low: 0 });
  assert.equal(store.supportsLogScale, false);
  store.upsert(candle(2000, 8));
  assert.equal(store.supportsLogScale, true);
  store.upsert(candle(1500, -1));
  assert.equal(store.supportsLogScale, false);
  store.upsert(candle(1500, 1));
  assert.equal(store.supportsLogScale, true);
  assert.throws(() => store.setData([candle(1000, 0), { ...candle(2000, 8), high: 1 }]));
  assert.equal(store.supportsLogScale, true);
});
