import type { IndicatorOutput } from '../src/indicators.ts';

export type IndicatorParameter = { key: string; label: string; type: 'number'; default: number; min: number; max: number; step: number };
export type IndicatorProgram = {
  version: 1; id: string; name: string; description: string; code: string;
  parameters: IndicatorParameter[]; sources: { title: string; url: string }[];
  assumptions: string[]; createdAt: string; codeHash: string;
};
export type IndicatorCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type IndicatorLimits = { timeoutMs?: number; memoryBytes?: number; stackBytes?: number; maxCandles?: number; maxOutputBytes?: number };

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const CODE_LIMIT = 32_000;
const MAX_CANDLES = 100_000;
const MAX_OUTPUT_BYTES = 8_000_000;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function string(value: unknown, label: string, max: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (nonempty && value.trim().length === 0)) throw new Error(`${label} is invalid.`);
}

// SHA-256 in portable JS so browser and Node validators enforce the identical artifact contract.
export function sha256(text: string): string {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = new TextEncoder().encode(text), bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6); padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000)); view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (r(a,7)^r(a,18)^(a>>>3)) + w[i - 7] + (r(b,17)^r(b,19)^(b>>>10))) >>> 0; }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) { const t1 = (hh + (r(e,6)^r(e,11)^r(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i]) >>> 0, t2 = ((r(a,2)^r(a,13)^r(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0; hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0; h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return h.map(n => n.toString(16).padStart(8,'0')).join('');
}

export function validateProgram(value: unknown): IndicatorProgram {
  if (!object(value) || value.version !== 1) throw new Error('Indicator program version must be 1.');
  if (typeof value.id !== 'string' || !ID.test(value.id)) throw new Error('Indicator program id is invalid.');
  string(value.name, 'Program name', 120, true); string(value.description, 'Program description', 2000);
  string(value.code, 'Program code', CODE_LIMIT, true);
  if (new TextEncoder().encode(value.code).byteLength > 64_000) throw new Error('Program code exceeds the byte limit.');
  if (!/^\s*(?:'use strict';\s*)?function\s+calculate\s*\(\s*candles\s*,\s*parameters\s*\)\s*\{[\s\S]*\}\s*;?\s*$/.test(value.code)) throw new Error('Code must declare function calculate(candles, parameters).');
  if (!Array.isArray(value.parameters) || value.parameters.length > 30) throw new Error('Program parameters are invalid.');
  const keys = new Set<string>();
  const parameters = value.parameters.map((p, i) => {
    if (!object(p) || typeof p.key !== 'string' || !ID.test(p.key) || keys.has(p.key)) throw new Error(`Parameter ${i} key is invalid or duplicated.`);
    keys.add(p.key); string(p.label, `Parameter ${i} label`, 120, true);
    const { default: def, min, max, step } = p;
    if (p.type !== 'number' || ![def,min,max,step].every(n => typeof n === 'number' && Number.isFinite(n)) || (min as number) > (def as number) || (def as number) > (max as number) || (step as number) <= 0 || (max as number) - (min as number) > 1e12) throw new Error(`Parameter ${p.key} bounds are invalid.`);
    return { key:p.key, label:p.label, type:'number' as const, default:def as number, min:min as number, max:max as number, step:step as number };
  });
  if (!Array.isArray(value.sources) || value.sources.length > 30) throw new Error('Program sources are invalid.');
  const sources = value.sources.map((s, i) => {
    if (!object(s)) throw new Error(`Source ${i} is invalid.`); string(s.title, `Source ${i} title`, 300, true); string(s.url, `Source ${i} URL`, 2048, true);
    let u: URL; try { u = new URL(s.url); } catch { throw new Error(`Source ${i} URL is invalid.`); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`Source ${i} URL must use HTTP or HTTPS.`);
    return { title:s.title, url:u.toString() };
  });
  if (!Array.isArray(value.assumptions) || value.assumptions.length > 30) throw new Error('Program assumptions are invalid.');
  const assumptions = value.assumptions.map((s, i) => { string(s, `Assumption ${i}`, 500); return s; });
  string(value.createdAt, 'Created date', 80, true); if (!Number.isFinite(Date.parse(value.createdAt))) throw new Error('Created date is invalid.');
  if (typeof value.codeHash !== 'string' || !HASH.test(value.codeHash) || sha256(value.code) !== value.codeHash) throw new Error('Program code hash does not match its source.');
  return { version:1, id:value.id, name:value.name, description:value.description, code:value.code, parameters, sources, assumptions, createdAt:value.createdAt, codeHash:value.codeHash };
}

export function createProgram(value: Omit<IndicatorProgram, 'codeHash'>): IndicatorProgram {
  return validateProgram({ ...value, codeHash: sha256(value.code) });
}

export function validateCandles(input: unknown, maxCandles = MAX_CANDLES): IndicatorCandle[] {
  if (!Array.isArray(input) || input.length > Math.min(maxCandles, MAX_CANDLES)) throw new Error('Candle input is invalid or exceeds the limit.');
  let previous = -1;
  return input.map((c, i) => {
    if (!object(c) || !Number.isSafeInteger(c.time) || (c.time as number) < 0 || (c.time as number) <= previous || !['open','high','low','close','volume'].every(k => typeof c[k] === 'number' && Number.isFinite(c[k]))) throw new Error(`Candle ${i} is invalid or unordered.`);
    if ((c.high as number) < Math.max(c.open as number,c.close as number) || (c.low as number) > Math.min(c.open as number,c.close as number) || (c.volume as number) < 0) throw new Error(`Candle ${i} violates OHLCV bounds.`);
    previous = c.time as number; return { time:c.time as number, open:c.open as number, high:c.high as number, low:c.low as number, close:c.close as number, volume:c.volume as number };
  });
}

export function validateParameters(program: IndicatorProgram, input?: unknown): Record<string, number> {
  if (input !== undefined && !object(input)) throw new Error('Indicator parameters must be an object.');
  const provided = (input ?? {}) as Record<string, unknown>;
  if (Object.keys(provided).some(k => !program.parameters.some(p => p.key === k))) throw new Error('Unknown indicator parameter.');
  return Object.fromEntries(program.parameters.map(p => {
    const n = provided[p.key] === undefined ? p.default : provided[p.key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < p.min || n > p.max) throw new Error(`Parameter ${p.key} is outside its declared range.`);
    return [p.key,n];
  }));
}

export type { IndicatorOutput };
export const RUNTIME_BOUNDS = { maxCandles:MAX_CANDLES, maxOutputBytes:MAX_OUTPUT_BYTES, maxCodeBytes:CODE_LIMIT } as const;
