import { createProgram, validateProgram } from '../runtime/contract.ts';
import type { IndicatorCandle, IndicatorParameter, IndicatorProgram } from '../runtime/contract.ts';
import { executeIndicatorInNodeWorker } from '../runtime/node-execute.ts';
import { randomUUID } from 'node:crypto';

export type ResearchResult = { mode:'web'|'model'; summary: string; sources: { title:string; url:string }[] };
export type GeneratedFields = { name:string; description:string; code:string; parameters:IndicatorParameter[]; assumptions:string[] };
export interface AIProvider {
  readonly researchMode?:'web'|'model';
  research(request: string, signal: AbortSignal): Promise<ResearchResult>;
  generate(request: string, research: ResearchResult, previous: IndicatorProgram | undefined, signal: AbortSignal): Promise<GeneratedFields>;
  repair(request: string, research: ResearchResult, fields: GeneratedFields, failures: string[], signal: AbortSignal): Promise<GeneratedFields>;
}
export type Progress = (stage:string, message:string) => void;

/** Application-owned workflow: actual research, schema generation, independent smoke checks, bounded repair. */
export async function generateIndicator(request: string, previousInput: unknown, provider: AIProvider, signal: AbortSignal, progress: Progress, options: { deadlineMs?:number; maxRepairs?:number; webSearch?:boolean } = {}): Promise<IndicatorProgram> {
  const timeoutMs=Math.min(options.deadlineMs ?? 90_000,120_000);
  const deadline = Date.now() + timeoutMs;
  const deadlineController=new AbortController();
  const check = () => {
    if (signal.aborted) throw new Error('Request was cancelled.');
    if (deadlineController.signal.aborted || Date.now() >= deadline) {
      deadlineController.abort();
      throw new Error('Indicator generation exceeded the total time limit.');
    }
  };
  const deadlineTimer=setTimeout(()=>deadlineController.abort(),Math.max(1,timeoutMs));
  const workflowSignal=AbortSignal.any([signal,deadlineController.signal]);
  try {
  const guarded = <T>(p:Promise<T>):Promise<T> => new Promise((resolve,reject) => {
    const remaining=Math.max(1,deadline-Date.now());
    const timeout=setTimeout(()=>{
      deadlineController.abort();
      finish(new Error('Indicator generation exceeded the total time limit.'));
    },remaining);
    const abort=()=>finish(new Error(signal.aborted?'Request was cancelled.':'Indicator generation exceeded the total time limit.'));
    let done=false;
    const finish=(error?:Error,value?:T)=>{ if(done)return; done=true; clearTimeout(timeout); workflowSignal.removeEventListener('abort',abort); error ? reject(error) : resolve(value!); };
    if(workflowSignal.aborted) abort(); else workflowSignal.addEventListener('abort',abort,{once:true});
    p.then(value=>finish(undefined,value),error=>finish(error instanceof Error?error:new Error(String(error))));
  });
  const previous = previousInput === undefined ? undefined : validateProgram(previousInput);
  const webSearch=options.webSearch!==false;
  const modelKnowledgeFromStart=!webSearch||provider.researchMode==='model';
  check(); progress('research',!webSearch?'Web research disabled by user; generating from model knowledge without citations.':modelKnowledgeFromStart?'Web search skipped; generation will use model knowledge without citations.':'Researching the requested indicator and collecting cited sources.');
  const research:ResearchResult = webSearch
    ? await guarded(provider.research(request, workflowSignal))
    : {mode:'model',summary:'Web research disabled by user. Generate from the user request and model knowledge; do not invent citations, distinguish formula variants where uncertain, and disclose assumptions.',sources:[]};
  check();
  if (research.mode==='web'&&research.sources.length===0) throw new Error('The web research step returned no cited sources.');
  if (research.mode==='model'&&!modelKnowledgeFromStart) progress('research','Web search was unavailable; continuing with model knowledge and no citations.');
  progress('generate',research.mode==='model'?'Generating from model knowledge and the request; no web research or citations were used.':'Building a versioned indicator program from the researched specification.');
  let fields = await guarded(provider.generate(request, research, previous, workflowSignal));
  let failures: string[] = [];
  const maxRepairs = Math.max(0, Math.min(options.maxRepairs ?? 2, 2));
  for (let attempt=0; attempt<=maxRepairs; attempt++) {
    check();
    let program: IndicatorProgram | undefined;
    try {
      const provenance=options.webSearch===false?'Web research disabled by user; generated from model knowledge, formula not independently verified.':research.mode==='model'?'Web research skipped; generated from model knowledge, formula not independently verified.':'Runtime smoke checks passed on synthetic candles; formula correctness has not been independently verified.';
      program = createProgram({ version:1, ...fields, id:randomUUID(), assumptions:[...fields.assumptions,provenance,...(research.mode==='model'?['Runtime smoke checks passed on synthetic candles; formula correctness has not been independently verified.']:[])], sources:research.sources, createdAt:new Date().toISOString() });
      const semantic = semanticCheck(program, research);
      if (semantic.length) throw new Error(`Semantic checks: ${semantic.join(' ')}`);
      progress('test',`Running independent runtime smoke checks${attempt ? ` (repair ${attempt})` : ''}.`);
      const smokeOutput=await executeIndicatorInNodeWorker(program, smokeCandles(), undefined, { timeoutMs:Math.min(2500, deadline-Date.now()), maxCandles:200, maxOutputBytes:250_000 },workflowSignal);
      if (smokeOutput.series.length === 0) throw new Error('Smoke test produced no chart series.');
      check(); return program;
    } catch (error) {
      check();
      failures = [error instanceof Error ? error.message : String(error)];
      if (attempt >= maxRepairs) throw new Error(`Generated indicator did not pass validation: ${failures[0]}`);
      progress('repair',`The independent check found an issue. Applying repair ${attempt + 1} of ${maxRepairs}.`);
      fields = await guarded(provider.repair(request, research, fields, failures, workflowSignal));
    }
  }
  throw new Error('Indicator generation did not complete.');
  } finally { clearTimeout(deadlineTimer); }
}

function semanticCheck(program: IndicatorProgram, research: ResearchResult): string[] {
  const issues: string[] = [];
  if (!program.name.trim() || !program.description.trim()) issues.push('Name and description must explain the generated formula.');
  if (research.sources.length && program.sources.some(s => !research.sources.some(r => r.url === s.url))) issues.push('Sources must come from the research result.');
  if (!/\breturn\b/.test(program.code)) issues.push('calculate must return an IndicatorOutput.');
  if (program.parameters.some(p => p.max === p.min)) issues.push('Parameters need a usable range.');
  return issues;
}

function smokeCandles(): IndicatorCandle[] {
  return Array.from({length:64}, (_,i) => { const close=100+Math.sin(i/4)*7+i*.15, open=close-.4, high=close+1.2, low=open-1.1; return {time:1_700_000_000_000+i*60_000,open,high,low,close,volume:10+i}; });
}
