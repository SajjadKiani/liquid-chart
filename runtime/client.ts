import type { IndicatorCandle, IndicatorOutput, IndicatorProgram } from './contract.ts';
import { validateCandles, validateParameters, validateProgram } from './contract.ts';
import { validateIndicatorOutput } from '../src/indicators.ts';

type Job = { program: IndicatorProgram; candles: IndicatorCandle[]; parameters?: Record<string, number>; resolve: (value: IndicatorOutput) => void; reject: (reason: Error) => void; timer?: ReturnType<typeof setTimeout> };

/** Executes generated programs in a terminable browser Worker. A timeout replaces the worker before another job starts. */
export class IndicatorWorkerClient {
  private worker?: Worker;
  private queue: Job[] = [];
  private active?: Job;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly makeWorker: () => Worker;
  private readonly maxQueuedJobs: number;

  constructor(options: { timeoutMs?: number; workerFactory?: () => Worker; maxQueuedJobs?:number } = {}) {
    this.timeoutMs = Math.max(50, Math.min(options.timeoutMs ?? 2500, 15_000));
    this.makeWorker = options.workerFactory ?? (() => new Worker(new URL('./indicator.worker.ts', import.meta.url), { type:'module', name:'liquid-chart-indicator' }));
    this.maxQueuedJobs=Math.max(0,Math.min(options.maxQueuedJobs ?? 2,10));
  }

  execute(program: IndicatorProgram, candles: IndicatorCandle[], parameters?: Record<string, number>): Promise<IndicatorOutput> {
    if (this.closed) return Promise.reject(new Error('Indicator worker client has been destroyed.'));
    if (this.queue.length+(this.active?1:0)>=this.maxQueuedJobs+1) return Promise.reject(new Error('Indicator execution queue is full.'));
    let safeProgram:IndicatorProgram, safeCandles:IndicatorCandle[], safeParameters:Record<string,number>;
    try { safeProgram=validateProgram(program); safeCandles=validateCandles(candles); safeParameters=validateParameters(safeProgram,parameters); }
    catch(error) { return Promise.reject(error instanceof Error?error:new Error(String(error))); }
    return new Promise((resolve, reject) => { this.queue.push({ program:safeProgram, candles:safeCandles, parameters:safeParameters, resolve, reject }); this.pump(); });
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true; this.worker?.terminate(); this.worker = undefined;
    const error = new Error('Indicator execution cancelled because the workspace was closed.');
    if (this.active?.timer) clearTimeout(this.active.timer);
    this.active?.reject(error); this.active = undefined;
    for (const job of this.queue.splice(0)) job.reject(error);
  }

  private pump(): void {
    if (this.closed || this.active || this.queue.length === 0) return;
    const job = this.queue.shift()!; this.active = job;
    try {
      this.worker ??= this.makeWorker();
      const currentWorker=this.worker;
      this.worker.onmessage = event => {
        if (this.worker !== currentWorker || this.active !== job) return;
        if (job.timer) clearTimeout(job.timer);
        this.active = undefined;
        const message = event.data as { ok?: boolean; output?: IndicatorOutput; error?: string };
        try { if (message.ok && message.output) job.resolve(validateIndicatorOutput(message.output)); else job.reject(new Error(message.error || 'Indicator worker returned an invalid response.')); }
        catch(error) { job.reject(error instanceof Error?error:new Error(String(error))); }
        this.pump();
      };
      this.worker.onerror = event => { if(this.worker===currentWorker) this.failWorker(new Error(event.message || 'Indicator worker failed to load.')); };
      this.worker.onmessageerror = () => { if(this.worker===currentWorker) this.failWorker(new Error('Indicator worker response could not be decoded.')); };
      job.timer = setTimeout(() => this.failWorker(new Error('Indicator execution exceeded its time limit.')), this.timeoutMs);
      this.worker.postMessage({ program:job.program, candles:job.candles, parameters:job.parameters });
    } catch (error) { this.failWorker(error instanceof Error ? error : new Error(String(error))); }
  }

  private failWorker(error: Error): void {
    this.worker?.terminate(); this.worker = undefined;
    if (this.active) {
      if (this.active.timer) clearTimeout(this.active.timer);
      this.active.reject(error); this.active = undefined;
    }
    this.pump();
  }
}
