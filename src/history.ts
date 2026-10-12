import type { Candle } from './model.ts';

export class HistoryPageError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs = 0) { super(message); this.retryAfterMs = retryAfterMs; }
}
export type HistoryStatus = { state: 'idle' | 'loading' | 'end' | 'error'; message: string; canRetry: boolean };
type Options = {
  oldestTime: () => number | undefined;
  fetchPage: (before: number, signal: AbortSignal) => Promise<Candle[]>;
  prepend: (candles: Candle[]) => number;
  onStatus: (status: HistoryStatus) => void;
};
type Clock = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};

// Pagination lifetime is separate from the live stream: paused charts can still load history.
export function createHistoryPager(options: Options, overrides: Partial<Clock> = {}) {
  const clock: Clock = { now: Date.now, schedule: (fn, ms) => setTimeout(fn, ms), cancel: timer => clearTimeout(timer), ...overrides };
  let active = true, loading = false, ended = false, failed = false, blockedUntil = 0;
  let request: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined, cooldown: ReturnType<typeof setTimeout> | undefined;
  const clear = (timer: ReturnType<typeof setTimeout> | undefined) => { if (timer !== undefined) clock.cancel(timer); };
  function status(state: HistoryStatus['state'], message: string): void {
    if (active) options.onStatus({ state, message, canRetry: failed && clock.now() >= blockedUntil });
  }
  async function load(): Promise<void> {
    if (!active || loading || ended || clock.now() < blockedUntil) return;
    const before = options.oldestTime();
    if (before === undefined) return;
    if (before <= 0) { ended = true; status('end', 'Beginning of available history'); return; }
    loading = true; failed = false;
    const controller = new AbortController(); request = controller;
    let timedOut = false;
    status('loading', 'Loading earlier candles…');
    timeout = clock.schedule(() => { timedOut = true; controller.abort(); }, 15_000);
    try {
      const page = await options.fetchPage(before, controller.signal);
      if (!active || controller.signal.aborted) {
        if (active && timedOut) throw new HistoryPageError('Earlier history timed out. Retry to continue.');
        return;
      }
      // The provider must move strictly backward, even if its page includes overlaps.
      const earlier = page.filter(c => c.time < before);
      const added = options.prepend(earlier);
      if (!added) { ended = true; status('end', 'Beginning of available history'); }
      else status('idle', `Loaded ${added.toLocaleString()} earlier candles · Scroll left for more`);
    } catch (error) {
      if (!active) return;
      failed = true;
      const wait = error instanceof HistoryPageError ? Math.max(0, error.retryAfterMs) : 0;
      blockedUntil = clock.now() + wait;
      const message = timedOut ? 'Earlier history timed out. Retry to continue.' : error instanceof Error ? error.message : 'Earlier history could not load.';
      status('error', message);
      if (wait > 0) cooldown = clock.schedule(() => { cooldown = undefined; status('error', `${message} You can retry now.`); }, wait);
    } finally {
      clear(timeout); timeout = undefined;
      loading = false;
      if (request === controller) request = undefined;
    }
  }
  return {
    consider(firstVisibleIndex: number, visibleBars: number): void {
      if (!failed && firstVisibleIndex <= Math.max(100, Math.ceil(visibleBars / 2))) void load();
    },
    retry(): void { if (failed) void load(); },
    stop(): void { active = false; request?.abort(); clear(timeout); clear(cooldown); },
  };
}
