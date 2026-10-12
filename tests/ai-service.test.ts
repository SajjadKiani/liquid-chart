import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAIServer } from '../server/index.ts';
import { generateIndicator, type AIProvider, type GeneratedFields, type ResearchResult } from '../server/ai-service.ts';
import type { IndicatorProgram } from '../runtime/contract.ts';

const researchResult:ResearchResult={mode:'web',summary:'A sample research result with an explicit calculation reference.',sources:[{title:'Reference',url:'https://example.com/math'}]};
const goodCode=`function calculate(candles, parameters){return {panes:[],series:[{id:'line',name:'Line',paneId:'price',type:'line',color:'#00aa88',points:candles.map(c=>({time:c.time,value:c.close}))}]};}`;
const goodFields=():GeneratedFields=>({name:'Research line',description:'Closes from the requested formula.',code:goodCode,parameters:[],assumptions:['Synthetic smoke run only.']});
class FixtureProvider implements AIProvider {
  calls:string[]=[];
  async research(_request:string,_signal:AbortSignal){this.calls.push('research');return researchResult;}
  async generate(_request:string,_research:ResearchResult,_previous:IndicatorProgram|undefined,_signal:AbortSignal){this.calls.push('generate');return goodFields();}
  async repair(_request:string,_research:ResearchResult,_fields:GeneratedFields,_failures:string[],_signal:AbortSignal){this.calls.push('repair');return goodFields();}
}

test('service runs research, structured generation, independent runtime smoke test, and returns cited versioned program',async()=>{
  const provider=new FixtureProvider(), stages:string[]=[];
  const program=await generateIndicator('Create a researched custom signal.',undefined,provider,new AbortController().signal,(stage)=>stages.push(stage),{deadlineMs:10_000});
  assert.deepEqual(provider.calls,['research','generate']);
  assert.deepEqual(stages,['research','generate','test']);
  assert.equal(program.code,goodCode); assert.deepEqual(program.sources,researchResult.sources); assert.match(program.codeHash,/^[a-f0-9]{64}$/);
});

test('service repairs a runtime-invalid artifact at most twice',async()=>{
  const provider=new FixtureProvider();
  provider.generate=async()=>{provider.calls.push('generate');return {...goodFields(),code:`function calculate(){return {panes:[],series:[]};}`} };
  provider.repair=async()=>{provider.calls.push('repair');return goodFields();};
  const result=await generateIndicator('Custom formula',undefined,provider,new AbortController().signal,()=>{},{maxRepairs:2,deadlineMs:10_000});
  assert.equal(result.code,goodCode); assert.deepEqual(provider.calls,['research','generate','repair']);
});

test('service caps repair attempts at two',async()=>{
  const provider=new FixtureProvider();
  const invalid={...goodFields(),code:`function calculate(candles, parameters){return {panes:[],series:[]};}`};
  provider.generate=async()=>{provider.calls.push('generate');return invalid;};
  provider.repair=async()=>{provider.calls.push('repair');return invalid;};
  await assert.rejects(generateIndicator('Still invalid',undefined,provider,new AbortController().signal,()=>{},{maxRepairs:10,deadlineMs:10_000}),/did not pass validation/);
  assert.deepEqual(provider.calls,['research','generate','repair','repair']);
});

test('service validates restored programs before performing research',async()=>{
  const provider=new FixtureProvider();
  await assert.rejects(generateIndicator('Formula',{version:9},provider,new AbortController().signal,()=>{}),/version/);
  assert.deepEqual(provider.calls,[]);
});

test('disabling web search skips provider research and records explicit model-knowledge provenance',async()=>{
  const provider=new FixtureProvider(),stages:Array<{stage:string;message:string}>=[];
  const program=await generateIndicator('Custom formula',undefined,provider,new AbortController().signal,(stage,message)=>stages.push({stage,message}),{deadlineMs:10_000,webSearch:false});
  assert.deepEqual(provider.calls,['generate']);
  assert.deepEqual(program.sources,[]);
  assert.ok(program.assumptions.includes('Web research disabled by user; generated from model knowledge, formula not independently verified.'));
  assert.match(stages[0].message,/Web research disabled by user/);
  assert.match(stages.find(item=>item.stage==='generate')?.message??'',/model knowledge/);
});

test('service cancellation reaches a pending provider request',async()=>{
  const provider=new FixtureProvider();
  provider.research=(_request,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('fixture aborted')),{once:true}));
  const controller=new AbortController();
  const running=generateIndicator('Cancel me',undefined,provider,controller.signal,()=>{});
  controller.abort(); await assert.rejects(running,/cancelled|aborted/);
});

test('deadline aborts the active provider request',async()=>{
  let aborted=false;
  const provider=new FixtureProvider();
  provider.research=(_request,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted by deadline'));},{once:true}));
  await assert.rejects(generateIndicator('Timeout',undefined,provider,new AbortController().signal,()=>{},{deadlineMs:40}),/total time limit/);
  assert.equal(aborted,true);
});

test('cancellation during smoke checks prevents starting repair work',async()=>{
  const provider=new FixtureProvider(); provider.generate=async()=>({...goodFields(),code:`function calculate(candles, parameters){return {panes:[],series:[]};}`});
  provider.repair=async()=>{provider.calls.push('repair');return goodFields();};
  const controller=new AbortController();
  const running=generateIndicator('Cancel before repair',undefined,provider,controller.signal,stage=>{if(stage==='test')controller.abort();});
  await assert.rejects(running,/cancelled/); assert.deepEqual(provider.calls,['research']);
});

test('HTTP API is loopback-origin restricted, reports status, and streams NDJSON events',async(t)=>{
  const provider=new FixtureProvider();
  const server=createAIServer({provider,apiKey:'fixture-secret',allowedOrigins:['http://127.0.0.1:5173'],deadlineMs:10_000});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  const denied=await fetch(`${base}/api/ai/status`,{headers:{origin:'https://evil.example'}}); assert.equal(denied.status,403);
  assert.deepEqual(await (await fetch(`${base}/api/ai/status`)).json(),{configured:true},'same-origin status requests may omit Origin');
  const status=await fetch(`${base}/api/ai/status`,{headers:{origin:'http://127.0.0.1:5173'}});
  const statusJson=await status.json() as Record<string,unknown>; assert.deepEqual(statusJson,{configured:true});
  const invalidSearch=await fetch(`${base}/api/indicators/generate`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Bad checkbox',webSearch:'false'})});
  assert.equal(invalidSearch.status,400);assert.match((await invalidSearch.json()).error,/webSearch must be a boolean/);
  const response=await fetch(`${base}/api/indicators/generate`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Build a line from a researched formula.'})});
  assert.equal(response.status,200);
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line) as {type:string;program?:IndicatorProgram});
  assert.deepEqual(events.map(event=>event.type),['progress','progress','progress','result']);
  assert.equal(events.at(-1)?.program?.sources[0]?.url,'https://example.com/math');
  assert.equal(JSON.stringify(statusJson).includes('fixture-secret'),false);
  provider.calls.length=0;
  const modelOnly=await fetch(`${base}/api/indicators/generate`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Build a model-only line.',webSearch:false})});
  assert.equal(modelOnly.status,200);const modelEvents=(await modelOnly.text()).trim().split('\n').map(line=>JSON.parse(line) as {stage?:string;message?:string;program?:IndicatorProgram});
  assert.deepEqual(provider.calls,['generate']);assert.match(modelEvents[0].message??'',/disabled by user/);assert.match(modelEvents[1].message??'',/model knowledge/);
  assert.deepEqual(modelEvents.at(-1)?.program?.sources,[]);assert.ok(modelEvents.at(-1)?.program?.assumptions.some(item=>item.startsWith('Web research disabled by user; generated from model knowledge')));
});

test('HTTP API reports missing credentials without returning a substitute program',async(t)=>{
  const server=createAIServer({apiKey:'',allowedOrigins:['http://127.0.0.1:5173']});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`, headers={origin:'http://127.0.0.1:5173','content-type':'application/json'};
  assert.deepEqual(await (await fetch(`${base}/api/ai/status`,{headers})).json(),{configured:false});
  const response=await fetch(`${base}/api/indicators/generate`,{method:'POST',headers,body:JSON.stringify({request:'Generate an indicator'})});
  assert.equal(response.status,503); assert.match((await response.json()).error,/OPENAI_API_KEY/);
});

test('HTTP disconnect aborts an active research request',async(t)=>{
  let observedAbort!:()=>void;
  const abortObserved=new Promise<void>(resolve=>{observedAbort=resolve;});
  let beginResearch!:()=>void;
  const researchStarted=new Promise<void>(resolve=>{beginResearch=resolve;});
  const provider=new FixtureProvider();
  provider.research=(_request,signal)=>new Promise((_resolve,reject)=>{beginResearch();signal.addEventListener('abort',()=>{observedAbort();reject(new Error('aborted'));},{once:true});});
  const server=createAIServer({provider,apiKey:'fixture-secret',allowedOrigins:['http://127.0.0.1:5173']});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const controller=new AbortController();
  const response=fetch(`http://127.0.0.1:${address.port}/api/indicators/generate`,{method:'POST',signal:controller.signal,headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Cancel research'})});
  await researchStarted; controller.abort();
  await assert.rejects(response,/abort/i); await abortObserved;
});

test('HTTP concurrency is reserved before a second request body is read',async(t)=>{
  let beginResearch!:()=>void; const researchStarted=new Promise<void>(resolve=>{beginResearch=resolve;});
  const provider=new FixtureProvider(); provider.research=(_request,signal)=>new Promise((_resolve,reject)=>{beginResearch();signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});
  const server=createAIServer({provider,apiKey:'fixture-secret',maxJobs:1,allowedOrigins:['http://127.0.0.1:5173']});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const controller=new AbortController(), url=`http://127.0.0.1:${address.port}/api/indicators/generate`;
  const first=fetch(url,{method:'POST',signal:controller.signal,headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'First'})});
  await researchStarted;
  const second=await fetch(url,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Second'})});
  assert.equal(second.status,429); const firstResponse=await first; controller.abort(); await assert.rejects(firstResponse.text(),/abort/i);
});

test('HTTP errors redact API key material before streaming to the browser',async(t)=>{
  const provider=new FixtureProvider();
  provider.research=async()=>{throw new Error('authorization rejected for fixture-secret; saw sk-proj-abcdefghijklmnopqrstuvwxyz');};
  const server=createAIServer({provider,apiKey:'fixture-secret',allowedOrigins:['http://127.0.0.1:5173']});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const response=await fetch(`http://127.0.0.1:${address.port}/api/indicators/generate`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Generate'})});
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line) as {type:string;message?:string});
  const message=events.at(-1)?.message??'';
  assert.equal(message.includes('fixture-secret'),false); assert.equal(message.includes('sk-proj-'),false); assert.match(message,/redacted/);
});
