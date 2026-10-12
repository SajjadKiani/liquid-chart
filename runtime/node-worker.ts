import { parentPort } from 'node:worker_threads';
import { executeIndicator } from './execute.ts';

if (!parentPort) throw new Error('Indicator Node worker requires a parent port.');
parentPort.on('message', async (message: { id: string; program: unknown; candles: unknown; parameters?: unknown; limits?: unknown }) => {
  try {
    const output = await executeIndicator(message.program, message.candles, message.parameters, message.limits as never);
    parentPort!.postMessage({ id:message.id, ok:true, output });
  } catch (error) {
    parentPort!.postMessage({ id:message.id, ok:false, error:(error instanceof Error ? error.message : String(error)).slice(0, 500) });
  }
});
