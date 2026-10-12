import type { Candle } from 'liquid-chart';

export const instruments = [
  { symbol: 'BTC/USD', name: 'Bitcoin', base: 64218, tag: 'BTC', color: '#e7af66' },
  { symbol: 'ETH/USD', name: 'Ethereum', base: 3482, tag: 'ETH', color: '#a7ade9' },
  { symbol: 'SOL/USD', name: 'Solana', base: 148, tag: 'SOL', color: '#80c6ba' },
  { symbol: 'AVAX/USD', name: 'Avalanche', base: 28.72, tag: 'AVAX', color: '#df8f94' },
];

export const intervals = [
  { label: '1m', ms: 60_000 }, { label: '5m', ms: 300_000 },
  { label: '15m', ms: 900_000 }, { label: '1h', ms: 3_600_000 },
  { label: '4h', ms: 14_400_000 }, { label: '1D', ms: 86_400_000 },
];

export function generateCandles(base: number, interval: number, count = 1800): Candle[] {
  let seed = Math.round(base * 100 + interval);
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const end = Math.floor(Date.now() / interval) * interval;
  let price = base * 0.94;
  const result: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = Math.sin(i / 61) * 0.00045 + Math.cos(i / 137) * 0.00025;
    price = Math.max(base * 0.1, open * (1 + (random() - 0.48) * 0.005 + drift));
    const wick = base * (0.0003 + random() * 0.0016);
    result.push({
      time: end - (count - 1 - i) * interval,
      open, close: price, high: Math.max(open, price) + wick,
      low: Math.max(0.000001, Math.min(open, price) - wick * random()),
      volume: 10 + random() * 240 + Math.abs(price - open) / base * 30_000,
    });
  }
  // Bring the latest close close to the recognizable demo price.
  const ratio = base / result[result.length - 1].close;
  return result.map(c => ({ ...c, open: c.open * ratio, high: c.high * ratio, low: c.low * ratio, close: c.close * ratio }));
}
