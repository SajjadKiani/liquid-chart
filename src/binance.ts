import { CandleStore, validateCandle } from './model.ts';
import type { Candle } from './model.ts';
import { HistoryPageError } from './history.ts';

const REST = 'https://data-api.binance.vision/api/v3/klines';
const STREAM = 'wss://data-stream.binance.vision/ws/';
export const binanceSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT'] as const;
export type FeedStatus = 'loading' | 'live' | 'connecting' | 'retrying' | 'error';
export function binanceInterval(label: string): string {
  if (!['1m', '5m', '15m', '1h', '4h', '1D'].includes(label)) throw new Error('Unsupported Binance interval.');
  return label === '1D' ? '1d' : label;
}
function numeric(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) throw new Error('Invalid Binance number.');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Invalid Binance number.');
  return number;
}
export function parseBinanceHistory(value: unknown): Candle[] {
  if (!Array.isArray(value)) throw new Error('Invalid Binance history response.');
  const candles = value.map(row => {
    if (!Array.isArray(row) || row.length < 6) throw new Error('Invalid Binance candle.');
    return validateCandle({ time: numeric(row[0]), open: numeric(row[1]), high: numeric(row[2]), low: numeric(row[3]), close: numeric(row[4]), volume: numeric(row[5]) });
  });
  const store = new CandleStore();
  store.setData(candles);
  return store.candles;
}
export function parseBinanceUpdate(value: unknown, symbol: string, interval: string): { candle: Candle; eventTime: number } | null {
  if (!value || typeof value !== 'object') throw new Error('Invalid Binance stream event.');
  const event = value as Record<string, unknown>;
  if (event.e !== 'kline') return null;
  const k = event.k as Record<string, unknown> | undefined;
  if (event.s !== symbol || !k || k.s !== symbol || k.i !== interval) return null;
  const eventTime = numeric(event.E);
  if (!Number.isSafeInteger(eventTime) || eventTime < 0) throw new Error('Invalid Binance event time.');
  return { eventTime, candle: validateCandle({ time: numeric(k.t), open: numeric(k.o), high: numeric(k.h), low: numeric(k.l), close: numeric(k.c), volume: numeric(k.v) }) };
}

export async function fetchBinanceOlder(symbol: string, label: string, before: number, signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Candle[]> {
  if (!binanceSymbols.includes(symbol as typeof binanceSymbols[number])) throw new Error('Unsupported Binance symbol.');
  const interval = binanceInterval(label);
  if (!Number.isSafeInteger(before) || before < 0) throw new Error('Invalid history cursor.');
  if (before === 0) return [];
  const params = new URLSearchParams({ symbol, interval, limit: '1000', endTime: String(before - 1) });
  const response = await fetcher(`${REST}?${params}`, { signal });
  if (!response.ok) {
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'));
      const wait = Math.max(60_000, Number.isFinite(seconds) ? seconds * 1000 : 60_000);
      throw new HistoryPageError('Binance rate limit reached. Wait before retrying history.', wait);
    }
    throw new HistoryPageError(`Earlier Binance history unavailable (HTTP ${response.status}). Current candles are preserved.`);
  }
  const value: unknown = await response.json();
  if (Array.isArray(value) && value.length === 0) return [];
  return parseBinanceHistory(value);
}

type Socket = Pick<WebSocket, 'readyState' | 'close' | 'onopen' | 'onclose' | 'onerror' | 'onmessage'>;
type Dependencies = {
  fetch: typeof fetch;
  socket: (url: string) => Socket;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};
type Options = {
  symbol: string; interval: string;
  onHistory: (candles: Candle[]) => void;
  onCandle: (candle: Candle) => void;
  onStatus: (status: FeedStatus, message: string) => void;
};

// Public data only. Each cycle buffers stream events until its REST snapshot is ready.
export function connectBinance(options: Options, overrides: Partial<Dependencies> = {}): { stop: () => void } {
  if (!binanceSymbols.includes(options.symbol as typeof binanceSymbols[number])) throw new Error('Unsupported Binance symbol.');
  const interval = binanceInterval(options.interval);
  const deps: Dependencies = { fetch: globalThis.fetch.bind(globalThis), socket: url => new WebSocket(url), schedule: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer), ...overrides };
  let active = true, generation = 0, failures = 0;
  let socket: Socket | undefined, request: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const cancel = (timer: ReturnType<typeof setTimeout> | undefined) => { if (timer !== undefined) deps.cancel(timer); };
  function release(): void {
    cancel(timeout); cancel(watchdog);
    request?.abort();
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close(); socket = undefined;
    }
  }
  function fail(message: string, retry = true): void {
    if (!active) return;
    generation++; release();
    options.onStatus(retry ? 'retrying' : 'error', message);
    if (retry) retryTimer = deps.schedule(() => { retryTimer = undefined; void start(); }, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
  }
  async function start(): Promise<void> {
    if (!active) return;
    const current = ++generation;
    const valid = () => active && current === generation;
    let ready = false, connected = false, reportedLive = false;
    const buffered = new Map<number, { candle: Candle; eventTime: number }>();
    const versions = new Map<number, number>();
    const volumes = new Map<number, number>();
    const statusLive = () => {
      if (ready && connected && !reportedLive) {
        reportedLive = true;
        options.onStatus('live', 'Binance spot · Live candle updates · USDT');
      }
    };
    const armWatchdog = () => {
      cancel(watchdog);
      watchdog = deps.schedule(() => { if (valid()) fail('Binance stream stalled. Reconnecting…'); }, 30_000);
    };
    options.onStatus('loading', 'Loading Binance candle history…');
    request = new AbortController();
    const controller = request;
    timeout = deps.schedule(() => { if (valid()) fail('Binance history timed out. Retrying…'); }, 15_000);
    try {
      socket = deps.socket(`${STREAM}${options.symbol.toLowerCase()}@kline_${interval}`);
      socket.onopen = () => { if (valid()) { connected = true; armWatchdog(); statusLive(); } };
      socket.onclose = () => { if (valid()) fail('Binance disconnected. Reconnecting…'); };
      socket.onerror = () => { if (valid()) fail('Cannot reach Binance live data. Retrying…'); };
      socket.onmessage = event => {
        if (!valid()) return;
        try {
          const raw: unknown = JSON.parse(String(event.data));
          if (raw && typeof raw === 'object' && (raw as { e?: string }).e === 'serverShutdown') { fail('Binance stream restarting. Reconnecting…'); return; }
          const update = parseBinanceUpdate(raw, options.symbol, interval);
          if (!update) return;
          const { candle, eventTime } = update;
          if (eventTime < (versions.get(candle.time) ?? -1)) return;
          versions.set(candle.time, eventTime);
          if (versions.size > 1000) versions.delete(versions.keys().next().value!);
          armWatchdog();
          if (!ready) {
            buffered.set(candle.time, update);
            if (buffered.size > 1000) buffered.delete(buffered.keys().next().value!);
            return;
          }
          if (candle.volume < (volumes.get(candle.time) ?? 0)) return;
          volumes.set(candle.time, candle.volume);
          if (volumes.size > 1000) volumes.delete(volumes.keys().next().value!);
          options.onCandle(candle);
          failures = 0; statusLive();
        } catch { fail('Invalid Binance stream data. Reconnecting…'); }
      };
      const params = new URLSearchParams({ symbol: options.symbol, interval, limit: '1000' });
      const response = await deps.fetch(`${REST}?${params}`, { signal: controller.signal });
      if (!valid()) return;
      if (!response.ok) {
        const blocked = [403, 418, 451].includes(response.status);
        fail(blocked ? `Binance unavailable from this network (HTTP ${response.status}). Choose Demo or retry later.` : `Binance history unavailable (HTTP ${response.status}). Retrying…`, !blocked);
        // Respect rate limiting rather than rapidly repeating requests.
        if (response.status === 429 && retryTimer !== undefined) {
          cancel(retryTimer);
          const seconds = Number(response.headers.get('Retry-After'));
          retryTimer = deps.schedule(() => { retryTimer = undefined; void start(); }, Math.max(60_000, Number.isFinite(seconds) ? seconds * 1000 : 60_000));
        }
        return;
      }
      const candles = parseBinanceHistory(await response.json());
      if (!valid()) return;
      cancel(timeout); timeout = undefined;
      for (const c of candles) volumes.set(c.time, c.volume);
      options.onHistory(candles);
      ready = true;
      for (const { candle } of [...buffered.values()].sort((a, b) => a.candle.time - b.candle.time)) {
        if (candle.volume >= (volumes.get(candle.time) ?? 0)) { volumes.set(candle.time, candle.volume); options.onCandle(candle); }
      }
      buffered.clear();
      if (!connected) options.onStatus('connecting', 'History loaded · Connecting Binance live updates…');
      armWatchdog(); statusLive();
    } catch (error) {
      if (valid()) fail(error instanceof Error ? `Binance connection failed: ${error.message}` : 'Binance connection failed. Retrying…');
    }
  }
  void start();
  return { stop: () => { active = false; generation++; cancel(retryTimer); release(); } };
}
