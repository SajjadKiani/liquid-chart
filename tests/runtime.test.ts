import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProgram, validateProgram, sha256 } from '../runtime/contract.ts';
import { executeIndicator } from '../runtime/execute.ts';
import { IndicatorWorkerClient } from '../runtime/client.ts';
import { executeIndicatorInNodeWorker } from '../runtime/node-execute.ts';
import type { IndicatorCandle, IndicatorProgram } from '../runtime/contract.ts';

const candles:IndicatorCandle[]=[0,1,2,3].map(i=>({time:1_700_000_000_000+i*60_000,open:10+i,high:12+i,low:9+i,close:11+i,volume:i}));
const code=`function calculate(candles, parameters) {
 const points = candles.map(c => ({time:c.time, value:c.close * parameters.multiplier}));
 return {panes:[], series:[{id:'close',name:'Close',paneId:'price',type:'line',color:'#ff0000',points}]};
}`;
const program=():IndicatorProgram=>createProgram({version:1,id:'custom-line',name:'Custom line',description:'Line from closes.',code,parameters:[{key:'multiplier',label:'Multiplier',type:'number',default:2,min:.5,max:5,step:.5}],sources:[{title:'Reference',url:'https://example.com/formula'}],assumptions:['Close values are used.'],createdAt:'2026-01-01T00:00:00.000Z'});

test('program validation checks version, source shape, parameters, and code hash',()=>{
  const p=program(); assert.equal(validateProgram(p).codeHash,sha256(code));
  for(const sample of ['ascii','Unicode λ 東🙂','a'.repeat(200)]) assert.equal(sha256(sample),createHash('sha256').update(sample).digest('hex'));
  assert.throws(()=>validateProgram({...p,codeHash:'0'.repeat(64)}),/hash/);
  assert.throws(()=>validateProgram({...p,version:2}),/version/);
  assert.throws(()=>validateProgram({...p,sources:[{title:'bad',url:'javascript:alert(1)'}]}),/HTTP or HTTPS/);
  assert.throws(()=>validateProgram({...p,parameters:[{...p.parameters[0]!,default:9}]}),/bounds/);
});

test('QuickJS executes custom code and validates data-linked output',async()=>{
  const result=await executeIndicator(program(),candles);
  assert.equal(result.series[0]?.points[2]?.value,26);
  await assert.rejects(executeIndicator(program(),candles,{multiplier:99}),/outside/);
  const badTime=`function calculate(candles, parameters){return {panes:[],series:[{id:'x',name:'x',paneId:'price',type:'line',color:'red',points:[{time:123,value:1}]}]};}`;
  const bad=createProgram({...program(),code:badTime});
  await assert.rejects(executeIndicator(bad,candles),/not present in the candle input/);
});

test('QuickJS accepts generic band series and bounded bar offsets without changing candle timestamps',async()=>{
  const bandCode=`function calculate(candles, parameters){return {panes:[],series:[{id:'cloud',name:'Cloud',paneId:'price',type:'band',color:'#3399ff',negativeColor:'#ff5566',offset:26,points:candles.map((c,i)=>({time:c.time,value:i<1?null:c.high,value2:i<1?null:c.low}))}]};}`;
  const output=await executeIndicator(createProgram({...program(),code:bandCode}),candles);
  assert.equal(output.series[0]?.type,'band');
  if(output.series[0]?.type==='band'){
    assert.equal(output.series[0].offset,26);assert.equal(output.series[0].negativeColor,'#ff5566');
    assert.deepEqual(output.series[0].points[0],{time:candles[0]?.time,value:null,value2:null});
    assert.deepEqual(output.series[0].points[1],{time:candles[1]?.time,value:candles[1]?.high,value2:candles[1]?.low});
  }
  const mismatch=`function calculate(candles, parameters){return {panes:[],series:[{id:'cloud',name:'Cloud',paneId:'price',type:'band',color:'blue',points:[{time:candles[0].time,value:1,value2:null}]}]};}`;
  await assert.rejects(executeIndicator(createProgram({...program(),code:mismatch}),candles),/null both values/);
  const badOffset=`function calculate(candles, parameters){return {panes:[],series:[{id:'cloud',name:'Cloud',paneId:'price',type:'band',color:'blue',offset:501,points:candles.map(c=>({time:c.time,value:c.high,value2:c.low}))}]};}`;
  await assert.rejects(executeIndicator(createProgram({...program(),code:badOffset}),candles),/offset/);
});

test('generated code cannot access host capabilities and fails safely',async()=>{
  const p=program(); p.code=`function calculate(){ return {panes:[],series:[]}; }`;
  await assert.rejects(executeIndicator(createProgram({...p,code:`function calculate(candles, parameters){ return Date.now(); }`}),candles),/undefined/);
  await assert.rejects(executeIndicator(createProgram({...p,code:`function calculate(candles, parameters){ return Math.random(); }`}),candles),/Randomness is disabled/);
  await assert.rejects(executeIndicator(createProgram({...p,code:`function calculate(candles, parameters){ return eval('1'); }`}),candles),/not a function/);
  await assert.rejects(executeIndicator(createProgram({...p,code:`function calculate(candles, parameters){ return {panes:[],series:[{id:'x',name:'x',paneId:'price',type:'line',color:'red',points:candles.map(c=>({time:c.time,value:NaN}))}]}; }`}),candles),/non-finite/);
  await assert.rejects(executeIndicator(createProgram({...p,code:`function calculate(candles, parameters){ const a=new Array(10000000).fill(1); return {panes:[],series:[]}; }`}),candles,undefined,{memoryBytes:2_000_000}),/execution failed/);
  await assert.rejects(executeIndicator(createProgram({...p,code:`function calculate(candles, parameters){ while(true){} }`}),candles,undefined,{timeoutMs:100}),/execution failed/);
  assert.equal((await executeIndicator(program(),candles)).series.length,1,'fresh contexts recover after a runtime failure');
});

test('invalid and oversized candles are rejected before interpretation',async()=>{
  await assert.rejects(executeIndicator(program(),[{...candles[0]!,high:0}]),/OHLCV/);
  await assert.rejects(executeIndicator(program(),[candles[1],candles[0]]),/unordered/);
  await assert.rejects(executeIndicator(program(),candles,{unknown:1}),/Unknown/);
});

test('Node host watchdog terminates a stuck execution worker',async()=>{
  const busy=createProgram({...program(),code:`function calculate(candles, parameters){ while(true){} }`});
  await assert.rejects(executeIndicatorInNodeWorker(busy,candles,undefined,{timeoutMs:150}),/time limit/);
  assert.equal((await executeIndicatorInNodeWorker(program(),candles,undefined,{timeoutMs:5000})).series.length,1);
});

test('browser client serializes work and rejects queued jobs when destroyed',async()=>{
  class FakeWorker {
    onmessage:(event:{data:unknown})=>void=null as never;
    onerror:((event:{message:string})=>void)|null=null;
    terminated=false;
    postMessage(message:unknown){queueMicrotask(()=>this.onmessage({data:{ok:true,output:{panes:[],series:[]}}}));}
    terminate(){this.terminated=true;}
  }
  const instance=new FakeWorker();
  const client=new IndicatorWorkerClient({workerFactory:()=>instance as unknown as Worker});
  assert.deepEqual(await client.execute(program(),candles),{panes:[],series:[]});
  const waiting=client.execute(program(),candles); client.destroy();
  await assert.rejects(waiting,/cancelled/); assert.equal(instance.terminated,true);
});
