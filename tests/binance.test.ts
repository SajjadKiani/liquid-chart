import test from 'node:test';
import assert from 'node:assert/strict';
import { binanceInterval, connectBinance, parseBinanceHistory, parseBinanceUpdate } from '../src/binance.ts';

const row = (time = 1000, volume = '5', close = '102') => [time, '100', '110', '90', close, volume];
const event = (volume = '6', close = '103', eventTime = 2000, time = 1000) => ({ e: 'kline', E: eventTime, s: 'BTCUSDT', k: { s: 'BTCUSDT', i: '1h', t: time, o: '100', h: '110', l: '90', c: close, v: volume } });
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const sockets: any[] = [], requests: any[] = [], timers = new Map<number, { callback: () => void; delay: number }>();
  const history: any[] = [], updates: any[] = [], statuses: any[] = [];
  let id = 0;
  const connection = connectBinance({ symbol: 'BTCUSDT', interval: '1h', onHistory: cs => history.push(cs), onCandle: c => updates.push(c), onStatus: (s, m) => statuses.push({ s, m }) }, {
    fetch: ((url: string, options: RequestInit) => new Promise<Response>(resolve => requests.push({ url, signal: options.signal, resolve }))) as typeof fetch,
    socket: url => {
      const socket = { url, readyState: 0, onopen: null, onclose: null, onerror: null, onmessage: null, closed: 0, close() { this.closed++; } } as any;
      sockets.push(socket); return socket;
    },
    schedule: (callback, delay) => { timers.set(++id, { callback, delay }); return id as any; },
    cancel: timer => { timers.delete(timer as any); },
  });
  const send = (value: unknown) => sockets.at(-1).onmessage?.({ data: JSON.stringify(value) });
  const open = () => { sockets.at(-1).readyState = 1; sockets.at(-1).onopen?.({}); };
  const resolve = (body = [row()], status = 200, headers = {}) => requests.at(-1).resolve(new Response(JSON.stringify(body), { status, headers }));
  const run = (delay: number) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `Expected a ${delay}ms timer`);
    timers.delete(entry[0]); entry[1].callback();
  };
  return { connection, sockets, requests, timers, history, updates, statuses, send, open, resolve, run };
}

test('Binance history maps numeric strings, sorts and deduplicates UTC open times', () => {
  assert.equal(binanceInterval('1D'), '1d');
  assert.throws(() => binanceInterval('1M'));
  const candles = parseBinanceHistory([row(2000), row(), row(2000, '8', '104')]);
  assert.deepEqual(candles.map(c => c.time), [1000, 2000]);
  assert.equal(candles[1].close, 104);
  assert.equal(candles[1].volume, 8);
});

test('Binance rejects malformed prices, invalid OHLC, empty responses and wrong stream identity', () => {
  for (const data of [[], {}, [row(1000, '')], [row(1000, 'NaN')], [row(1000, '5', '999')], [[1000, null, '110', '90', '102', '5']]]) assert.throws(() => parseBinanceHistory(data));
  assert.equal(parseBinanceUpdate(event(), 'ETHUSDT', '1h'), null);
  assert.equal(parseBinanceUpdate(event(), 'BTCUSDT', '1d'), null);
  assert.equal(parseBinanceUpdate({ e: 'ping' }, 'BTCUSDT', '1h'), null);
  assert.equal(parseBinanceUpdate(event(), 'BTCUSDT', '1h')!.candle.time, 1000);
});

test('stream updates buffered during history loading cannot regress a newer REST candle', async () => {
  const h = harness(); h.open(); h.send(event('3', '101'));
  h.resolve([row(1000, '5', '102')]); await flush();
  assert.equal(h.history.length, 1); assert.equal(h.updates.length, 0);
  h.send(event('6', '103', 3000)); h.send(event('7', '104', 2500));
  assert.equal(h.updates.length, 1); assert.equal(h.updates[0].close, 103);
  assert.equal(h.statuses.at(-1).s, 'live');
  assert.match(h.requests[0].url, /symbol=BTCUSDT&interval=1h&limit=1000/);
  h.connection.stop(); assert.equal(h.timers.size, 0);
});

test('buffered new bars survive the initial history snapshot', async () => {
  const h = harness(); h.open(); h.send(event('6', '104', 3000, 2000));
  h.resolve(); await flush();
  assert.equal(h.updates[0].time, 2000); assert.equal(h.updates[0].close, 104);
  h.connection.stop();
});

test('stopping a pending connection aborts history and ignores late callbacks', async () => {
  const h = harness(); const lateMessage = h.sockets[0].onmessage;
  h.connection.stop(); h.resolve(); lateMessage({ data: JSON.stringify(event()) }); await flush();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.sockets[0].closed, 1); assert.equal(h.timers.size, 0);
  assert.equal(h.history.length, 0); assert.equal(h.updates.length, 0);
});

test('disconnect reconnects with fresh history and never reuses old socket callbacks', async () => {
  const h = harness(); h.open(); h.resolve(); await flush();
  const oldMessage = h.sockets[0].onmessage;
  h.sockets[0].onclose({}); assert.equal(h.statuses.at(-1).s, 'retrying');
  h.run(1000); h.open(); h.resolve([row(), row(2000)]); await flush();
  oldMessage({ data: JSON.stringify(event('10', '105', 4000)) });
  assert.equal(h.history.length, 2); assert.equal(h.history[1].length, 2);
  assert.equal(h.updates.length, 0); assert.equal(h.sockets[0].closed, 1);
  h.connection.stop();
});

test('regional errors stop automatic retries and rate limits wait at least one minute', async () => {
  const blocked = harness(); blocked.resolve([], 451); await flush();
  assert.equal(blocked.statuses.at(-1).s, 'error'); assert.equal(blocked.timers.size, 0);
  blocked.connection.stop();
  const limited = harness(); limited.resolve([], 429, { 'Retry-After': '120' }); await flush();
  assert.deepEqual([...limited.timers.values()].map(t => t.delay), [120_000]);
  limited.connection.stop();
});

test('silent streams reconnect after the watchdog deadline', async () => {
  const h = harness(); h.open(); h.resolve(); await flush();
  h.run(30_000); assert.equal(h.statuses.at(-1).s, 'retrying');
  assert.equal(h.sockets[0].closed, 1); h.connection.stop(); assert.equal(h.timers.size, 0);
});
