import { executeIndicator } from './execute.ts';
import type { IndicatorCandle, IndicatorProgram } from './contract.ts';

self.onmessage = async (event: MessageEvent<{ program: IndicatorProgram; candles: IndicatorCandle[]; parameters?: Record<string, number> }>) => {
  try {
    const output = await executeIndicator(event.data.program, event.data.candles, event.data.parameters, { timeoutMs: 1800 });
    self.postMessage({ ok:true, output });
  } catch (error) {
    self.postMessage({ ok:false, error:(error instanceof Error ? error.message : String(error)).slice(0, 500) });
  }
};
