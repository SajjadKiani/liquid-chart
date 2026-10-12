import test from 'node:test';
import assert from 'node:assert/strict';
import { CandleStore, priceToY, timeToIndex } from '../src/model.ts';
import type { Candle } from '../src/model.ts';
import { ChartEngine } from '../src/engine.ts';
import { createHistoryPager, HistoryPageError } from 'liquid-chart/history';
import { fetchBinanceOlder } from '../demo/binance.ts';

const candle = (time: number, close = 102): Candle => ({ time, open: 100, high: 110, low: 90, close, volume: 5 });
const flush = () => new Promise(resolve => setImmediate(resolve));

function pagerHarness() {
  let oldest = 3000, now = 0, timerId = 0;
  const pages: Candle[][] = [], requests: any[] = [], statuses: any[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const pager = createHistoryPager({
    oldestTime: () => oldest,
    fetchPage: (before, signal) => new Promise<Candle[]>((resolve, reject) => requests.push({ before, signal, resolve, reject })),
    prepend: cs => { pages.push(cs); if (cs.length) oldest = Math.min(...cs.map(c => c.time)); return cs.length; },
    onStatus: state => statuses.push(state),
  }, {
    now: () => now,
    schedule: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId as any; },
    cancel: id => { timers.delete(id as any); },
  });
  const advance = (delay: number) => {
    now += delay;
    const timer = [...timers].find(([, value]) => value.delay === delay);
    assert.ok(timer); timers.delete(timer[0]); timer[1].callback();
  };
  return { pager, requests, pages, statuses, timers, advance };
}

test('approaching the left edge fetches one page and advances the cursor strictly backward', async () => {
  const h = pagerHarness();
  h.pager.consider(500, 60); assert.equal(h.requests.length, 0);
  h.pager.consider(90, 60); h.pager.consider(0, 60); h.pager.consider(0, 60);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].before, 3000);
  h.requests[0].resolve([candle(1000), candle(2000), candle(3000)]); await flush();
  assert.deepEqual(h.pages[0].map(c => c.time), [1000, 2000]);
  h.pager.consider(1000, 60); assert.equal(h.requests.length, 1);
  h.pager.consider(0, 60); assert.equal(h.requests.length, 2); assert.equal(h.requests[1].before, 1000);
  h.pager.stop();
});

test('empty or non-progressing history ends pagination without an infinite fetch loop', async () => {
  for (const page of [[], [candle(3000), candle(4000)]]) {
    const h = pagerHarness(); h.pager.consider(0, 60); h.requests[0].resolve(page); await flush();
    assert.equal(h.statuses.at(-1).state, 'end');
    h.pager.consider(0, 60); h.pager.retry(); assert.equal(h.requests.length, 1);
    h.pager.stop();
  }
});

test('failed pages retain the cursor and retry only when explicitly requested', async () => {
  const h = pagerHarness(); h.pager.consider(0, 60); h.requests[0].reject(new Error('Network unavailable')); await flush();
  assert.equal(h.pages.length, 0); assert.equal(h.statuses.at(-1).canRetry, true);
  h.pager.consider(0, 60); assert.equal(h.requests.length, 1);
  h.pager.retry(); assert.equal(h.requests[1].before, 3000);
  h.requests[1].resolve([candle(2000)]); await flush();
  assert.equal(h.statuses.at(-1).state, 'idle'); h.pager.stop();
});

test('switching datasets aborts pending pages and ignores late results', async () => {
  const h = pagerHarness(); h.pager.consider(0, 60); h.pager.stop();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve([candle(1000)]); await flush();
  assert.equal(h.pages.length, 0); assert.equal(h.timers.size, 0);
  h.pager.consider(0, 60); assert.equal(h.requests.length, 1);
});

test('history rate limits block manual retry until the provider cooldown expires', async () => {
  const h = pagerHarness(); h.pager.consider(0, 60);
  h.requests[0].reject(new HistoryPageError('Rate limited', 60_000)); await flush();
  assert.equal(h.statuses.at(-1).canRetry, false);
  h.pager.retry(); assert.equal(h.requests.length, 1);
  h.advance(60_000); assert.equal(h.statuses.at(-1).canRetry, true);
  h.pager.retry(); assert.equal(h.requests.length, 2); h.pager.stop();
});

test('history timeout aborts the request and allows a safe retry', async () => {
  const h = pagerHarness(); h.pager.consider(0, 60); h.advance(15_000);
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].reject(new Error('Aborted')); await flush();
  assert.match(h.statuses.at(-1).message, /timed out/);
  h.pager.retry(); assert.equal(h.requests.length, 2); h.pager.stop();
});

test('Binance pagination excludes the oldest candle and accepts the listing boundary', async () => {
  const requests: any[] = [];
  const controller = new AbortController();
  const fetcher = (async (url: string, options: RequestInit) => {
    requests.push({ url, signal: options.signal });
    return new Response(JSON.stringify([[1000, '100', '110', '90', '102', '5']]));
  }) as typeof fetch;
  const result = await fetchBinanceOlder('BTCUSDT', '1D', 2000, controller.signal, fetcher);
  const url = new URL(requests[0].url);
  assert.equal(url.searchParams.get('endTime'), '1999');
  assert.equal(url.searchParams.get('interval'), '1d'); assert.equal(url.searchParams.get('limit'), '1000');
  assert.equal(requests[0].signal, controller.signal); assert.equal(result[0].time, 1000);
  assert.deepEqual(await fetchBinanceOlder('BTCUSDT', '1h', 0, controller.signal, fetcher), []);
  assert.equal(requests.length, 1);
  assert.deepEqual(await fetchBinanceOlder('BTCUSDT', '1h', 1000, controller.signal, (async () => new Response('[]')) as typeof fetch), []);
  await assert.rejects(fetchBinanceOlder('BTCUSDT', '1h', 1000, controller.signal, (async () => new Response('[]', { status: 429, headers: { 'Retry-After': '120' } })) as typeof fetch), (error: any) => error.retryAfterMs === 120_000);
});

test('bulk prepend is atomic, ordered, deduplicated and cannot overwrite live candles', () => {
  const store = new CandleStore(); store.setData([candle(3000), candle(4000, 105)]);
  assert.equal(store.prepend([candle(2000), candle(1000), candle(2000, 104), candle(4000, 101)]), 2);
  assert.deepEqual(store.candles.map(c => c.time), [1000, 2000, 3000, 4000]);
  assert.equal(store.candles[1].close, 104); assert.equal(store.candles[3].close, 105);
  const previous = store.candles;
  assert.throws(() => store.prepend([candle(500), candle(600, 999)]));
  assert.equal(store.candles, previous); assert.equal(store.prepend([candle(3000)]), 0);
  assert.equal(store.supportsLogScale, true);
  store.prepend([{ time: 0, open: 0, high: 1, low: -1, close: 0, volume: 0 }]);
  assert.equal(store.supportsLogScale, false);
});

test('prepends preserve candle pixels, manual price ranges, following and active drag anchors', () => {
  for (const following of [false, true]) {
    // Exercise the real engine method without constructing a browser canvas.
    const engine = Object.create(ChartEngine.prototype) as any;
    engine.store = new CandleStore(); engine.store.setData(Array.from({ length: 80 }, (_, i) => candle((i + 20) * 1000)));
    engine.options = { maPeriod: 20 }; engine.right = 55.5; engine.spacing = 9; engine.following = following;
    engine.manualPrice = { base: [80, 120], offset: 0.1, scale: 'log' };
    engine.drag = { right: 50.25, spacing: 9, x: 100, mode: 'pan' };
    engine.drawings = [{ kind: 'horizontal', a: { time: 40_000, price: 102 } }];
    engine.invalidate = () => {};
    const pixel = () => (timeToIndex(engine.store.candles, 40_000) - engine.right + 0.5) * engine.spacing + 400;
    const beforeX = pixel(), manual = engine.manualPrice, drawings = engine.drawings;
    const beforeY = priceToY(102, 80, 120, 18, 250, 'log');
    assert.equal(engine.prependData(Array.from({ length: 20 }, (_, i) => candle(i * 1000))), 20);
    assert.equal(pixel(), beforeX); assert.equal(engine.drag.right, 70.25);
    assert.equal(engine.following, following); assert.equal(engine.spacing, 9);
    assert.equal(engine.manualPrice, manual); assert.equal(engine.drawings, drawings);
    assert.equal(priceToY(102, manual.base[0], manual.base[1], 18, 250, 'log'), beforeY);
    const right = engine.right;
    assert.throws(() => engine.prependData([candle(0, 999)])); assert.equal(engine.right, right);
  }
});
