import { newQuickJSAsyncWASMModule } from 'quickjs-emscripten';
import { validateIndicatorOutput } from '../src/indicators.ts';
import { validateCandles, validateParameters, validateProgram, RUNTIME_BOUNDS } from './contract.ts';
import type { IndicatorLimits, IndicatorOutput, IndicatorProgram } from './contract.ts';

const DEFAULT_LIMITS: Required<IndicatorLimits> = { timeoutMs:1500, memoryBytes:64 * 1024 * 1024, stackBytes:512 * 1024, maxCandles:RUNTIME_BOUNDS.maxCandles, maxOutputBytes:RUNTIME_BOUNDS.maxOutputBytes };

/** Run an artifact in a fresh QuickJS context. No host functions or objects enter the context. */
export async function executeIndicator(programInput: IndicatorProgram | unknown, candleInput: unknown, parameterInput?: unknown, overrides: IndicatorLimits = {}): Promise<IndicatorOutput> {
  const program = validateProgram(programInput);
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid execution limit: ${key}.`);
  limits.timeoutMs = Math.min(limits.timeoutMs, 10_000);
  limits.memoryBytes = Math.min(limits.memoryBytes, 128 * 1024 * 1024);
  limits.stackBytes = Math.min(limits.stackBytes, 2 * 1024 * 1024);
  limits.maxCandles = Math.min(limits.maxCandles, RUNTIME_BOUNDS.maxCandles);
  limits.maxOutputBytes = Math.min(limits.maxOutputBytes, RUNTIME_BOUNDS.maxOutputBytes);
  const candles = validateCandles(candleInput, limits.maxCandles);
  const parameters = validateParameters(program, parameterInput);
  const allowedTimes = new Set(candles.map(c => c.time));
  const deadline = Date.now() + limits.timeoutMs;
  const quickjs = await newQuickJSAsyncWASMModule();
  const runtime = quickjs.newRuntime();
  let context: ReturnType<typeof runtime.newContext> | undefined;
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(() => Date.now() > deadline);
  try {
    context = runtime.newContext();
    const payload = JSON.stringify({ candles, parameters });
    const setup = `
      'use strict';
      globalThis.Date = undefined;
      Object.defineProperty(globalThis, 'Date', {value:undefined,writable:false,configurable:false});
      Math.random = function(){ throw new Error('Randomness is disabled'); };
      Object.freeze(Math);
      Object.defineProperty(globalThis, 'eval', {value:undefined,writable:false,configurable:false});
      Object.defineProperty(globalThis, 'Function', {value:undefined,writable:false,configurable:false});
      const __stringify = JSON.stringify;
      const __finite = Number.isFinite;
      const __input = JSON.parse(${JSON.stringify(payload)});
      const __run = function(){
        ${program.code}
        return calculate(__input.candles, Object.freeze(__input.parameters));
      };
      const __output = __run();
      const __text = __stringify(__output, function(_key, value){
        if (typeof value === 'number' && !__finite(value)) throw new Error('Indicator output contains a non-finite number');
        return value;
      });
      if (typeof __text !== 'string' || __text.length > ${limits.maxOutputBytes}) throw new Error('Indicator output exceeds the size limit');
      __text;
    `;
    const result = context.evalCode(setup, 'indicator.js');
    let serialized: string;
    try { serialized = context.unwrapResult(result).consume(context.getString); }
    catch (error) { throw new Error(`Indicator execution failed: ${safeError(error)}`); }
    if (new TextEncoder().encode(serialized).byteLength > limits.maxOutputBytes) throw new Error('Indicator output exceeds the size limit.');
    let decoded: unknown;
    try { decoded = JSON.parse(serialized); } catch { throw new Error('Indicator returned invalid JSON output.'); }
    const output = validateIndicatorOutput(decoded);
    let points = 0;
    for (const series of output.series) {
      points += series.points.length;
      if (points > RUNTIME_BOUNDS.maxCandles * 10) throw new Error('Indicator output exceeds the aggregate point limit.');
      for (const point of series.points) if (!allowedTimes.has(point.time)) throw new Error(`Indicator output time ${point.time} is not present in the candle input.`);
    }
    return output;
  } finally {
    context?.dispose();
    runtime.dispose();
  }
}

function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}
