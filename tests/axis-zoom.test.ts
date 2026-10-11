import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomPriceRange, priceToY, yToPrice, zoomRightEdge } from '../src/model.ts';
import type { PriceScale } from '../src/model.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1e-10, Math.abs(b) * 1e-10), `${a} ≈ ${b}`);

for (const scale of ['linear', 'log'] as PriceScale[]) {
  test(`${scale} price-axis zoom anchors the pointer and doubles price distances`, () => {
    const range: [number, number] = [10, 1000];
    for (const fraction of [0, 0.2, 0.5, 0.9, 1]) {
      const anchorY = 18 + fraction * 400;
      const anchorPrice = yToPrice(anchorY, ...range, 18, 400, scale);
      const zoomed = zoomPriceRange(range, 2, fraction, scale);
      near(priceToY(anchorPrice, ...zoomed, 18, 400, scale), anchorY);
      const distance = (r: [number, number]) => priceToY(100, ...r, 18, 400, scale) - priceToY(500, ...r, 18, 400, scale);
      near(distance(zoomed), distance(range) * 2);
      const restored = zoomPriceRange(zoomed, 0.5, fraction, scale);
      near(restored[0], range[0]); near(restored[1], range[1]);
    }
  });
}

test('vertical zoom supports zero and negative prices in linear mode', () => {
  assert.deepEqual(zoomPriceRange([-100, 100], 2, 0.5, 'linear'), [-50, 50]);
});

test('extreme or invalid zoom inputs retain finite ordered price ranges', () => {
  for (const scale of ['linear', 'log'] as PriceScale[]) {
    for (const factor of [1e300, 1e-300, NaN, 0, -1, Infinity]) {
      const range = zoomPriceRange([10, 1000], factor, 0.5, scale);
      assert.ok(range.every(Number.isFinite) && range[1] > range[0]);
      if (scale === 'log') assert.ok(range[0] > 0);
    }
  }
  assert.deepEqual(zoomPriceRange([1, 1], 2, 0.5, 'log'), [1, 1]);
});

test('time-axis drag zoom uses the original gesture viewport and preserves its anchor', () => {
  const right = 1806, width = 500, spacing = 9, anchorX = 180;
  const index = right - (width - anchorX) / spacing;
  for (const factor of [0.5, 1, 2, 3]) {
    const newSpacing = spacing * factor;
    const newRight = zoomRightEdge(right, width, spacing, newSpacing, anchorX);
    near(newRight - (width - anchorX) / newSpacing, index);
  }
});
