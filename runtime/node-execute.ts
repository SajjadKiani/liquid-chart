import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { validateCandles, validateParameters, validateProgram, type IndicatorLimits, type IndicatorOutput, type IndicatorProgram } from './contract.ts';

/** Host-thread watchdog around the interpreter. It can terminate work even if WASM or host serialization stalls. */
export function executeIndicatorInNodeWorker(program: IndicatorProgram, candles: unknown, parameters?: unknown, limits: IndicatorLimits = {}, signal?:AbortSignal): Promise<IndicatorOutput> {
  const safeProgram=validateProgram(program);
  const safeCandles=validateCandles(candles,limits.maxCandles);
  const safeParameters=validateParameters(safeProgram,parameters);
  const timeoutMs = Math.min(Math.max(50, limits.timeoutMs ?? 1800), 10_000);
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const worker = new Worker(new URL('./node-worker.ts', import.meta.url), { execArgv:['--experimental-strip-types'] });
    let settled = false;
    const finish = (error?: Error, output?: IndicatorOutput) => {
      if (settled) return; settled = true; clearTimeout(timer); void worker.terminate();
      signal?.removeEventListener('abort',onAbort);
      if (error) reject(error); else resolve(output!);
    };
    const onAbort=()=>finish(new Error('Indicator runtime worker was cancelled.'));
    const timer = setTimeout(() => finish(new Error('Indicator runtime worker exceeded its time limit.')), timeoutMs);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort',onAbort,{once:true});
    worker.on('message', (message: { id:string; ok:boolean; output?:IndicatorOutput; error?:string }) => {
      if (message.id !== id) return;
      if (message.ok && message.output) finish(undefined, message.output);
      else finish(new Error(message.error || 'Indicator runtime worker failed.'));
    });
    worker.once('error', error => finish(new Error(`Indicator runtime worker failed: ${error instanceof Error ? error.message : String(error)}`)));
    worker.once('exit', code => { if (!settled && code !== 0) finish(new Error(`Indicator runtime worker exited (${code}).`)); });
    worker.postMessage({ id, program:safeProgram, candles:safeCandles, parameters:safeParameters, limits:{ ...limits, timeoutMs:Math.min(timeoutMs - 25, limits.timeoutMs ?? timeoutMs - 25) } });
  });
}
