import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceToY, yToPrice, scrollPriceRange, timeViewportBounds } from '../src/model.ts';
import type { PriceScale } from '../src/model.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1e-10, Math.abs(b) * 1e-10), `${a} ≈ ${b}`);

test('time scrolling exposes space after the latest candle while keeping it in view', () => {
  for (const [count, width, spacing] of [[1800, 500, 9], [3, 210, 48], [1, 200, 3]]) {
    const [minimum, maximum] = timeViewportBounds(count, width, spacing);
    assert.ok(maximum > count);
    assert.ok(minimum <= count && minimum < maximum);
    const left = maximum - width / spacing;
    const lastX = (count - 1 - left + 0.5) * spacing;
    near(lastX, spacing / 2);
    assert.ok(lastX > 0 && lastX < width);
    // Enough future space to move the last candle to the middle too.
    const centeredRight = count - 0.5 + width / (2 * spacing);
    assert.ok(centeredRight >= minimum && centeredRight <= maximum);
  }
});

for (const scale of ['linear', 'log'] as PriceScale[]) {
  test(`${scale} scrolling translates candles and anchors by the requested pixels`, () => {
    const range: [number, number] = [10, 1000];
    const shifted = scrollPriceRange(range, 0.25, scale);
    for (const price of [20, 100, 500]) {
      const before = priceToY(price, ...range, 18, 400, scale);
      const after = priceToY(price, ...shifted, 18, 400, scale);
      near(after - before, 100);
      near(yToPrice(after, ...shifted, 18, 400, scale), price);
    }
    const restored = scrollPriceRange(shifted, -0.25, scale);
    near(restored[0], range[0]); near(restored[1], range[1]);
  });
}

test('linear scrolling supports negative prices without changing price spacing', () => {
  assert.deepEqual(scrollPriceRange([-10, 10], -2, 'linear'), [-50, -30]);
});

test('log scrolling preserves ratios and stays positive at numeric limits', () => {
  const shifted = scrollPriceRange([10, 100], 2, 'log');
  near(shifted[0], 1000); near(shifted[1], 10000);
  for (const offset of [-1e6, 1e6]) {
    const range = scrollPriceRange([1, 10], offset, 'log');
    assert.ok(range[0] > 0 && range[1] > range[0] && range.every(Number.isFinite));
  }
});

test('invalid scroll offsets and degenerate ranges do not corrupt the viewport', () => {
  assert.deepEqual(scrollPriceRange([1, 10], NaN, 'log'), [1, 10]);
  assert.deepEqual(scrollPriceRange([10, 10], 1, 'linear'), [10, 10]);
});
