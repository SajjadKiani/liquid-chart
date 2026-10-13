import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterIndicatorProvider } from '../server/openrouter-provider.ts';
import { selectAIProvider } from '../server/provider.ts';
import { NaraRouterIndicatorProvider } from '../server/nararouter-provider.ts';
import { createAIServer } from '../server/index.ts';
import type { AIProvider } from '../server/ai-service.ts';
import { once } from 'node:events';

const citations=[{type:'url_citation',title:'Formula source',url:'https://example.org/formula'}];
const researchResponse={choices:[{message:{role:'assistant',content:'The researched definition uses a rolling calculation.',annotations:citations},finish_reason:'stop'}],usage:{server_tool_use:{web_search_requests:1}}};
const fields={name:'Example',description:'An example formula.',code:'function calculate(candles, parameters){return {panes:[],series:[{id:"line",name:"Line",paneId:"price",type:"line",color:"#00aa88",points:candles.map(c=>({time:c.time,value:c.close}))}]};}',parameters:[],assumptions:['Synthetic test only.']};
const ok=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

test('provider selection preserves OpenRouter model and key aliases without constructing a provider when credentials are absent',()=>{
  const preferred=selectAIProvider({providerName:'openrouter',openRouterApiKey:'router-key',openAiApiKey:'legacy-key',model:'poolside/laguna-s-2.1:free',baseURL:'https://openrouter.ai/api/v1'});
  assert.equal(preferred.name,'openrouter'); assert.equal(preferred.key,'router-key'); assert.equal(preferred.model,'poolside/laguna-s-2.1:free'); assert.ok(preferred.provider instanceof OpenRouterIndicatorProvider);
  const aliases=selectAIProvider({providerName:'openrouter',openAiApiKey:'legacy-key'});
  assert.equal(aliases.key,'legacy-key'); assert.equal(aliases.model,'poolside/laguna-s-2.1:free');
  const unconfigured=selectAIProvider({providerName:'openrouter',model:''});
  assert.equal(unconfigured.provider,undefined); assert.equal(unconfigured.model,'poolside/laguna-s-2.1:free');
});

test('NaraRouter selection retains model and API-key aliases without requiring separate search credentials',()=>{
  const missing=selectAIProvider({providerName:'nararouter',openAiApiKey:'nara-key',openAiModel:'laguna-s-2.1',baseURL:'https://router.bynara.id/v1'});
  assert.equal(missing.name,'nararouter');assert.equal(missing.model,'laguna-s-2.1');assert.ok(missing.provider instanceof NaraRouterIndicatorProvider);assert.equal(missing.configurationError,undefined);
  const ready=selectAIProvider({providerName:'nararouter',openAiApiKey:'nara-key',openAiModel:'laguna-s-2.1',exaApiKey:'exa-key',baseURL:'https://router.bynara.id/v1'});
  assert.ok(ready.provider instanceof NaraRouterIndicatorProvider);assert.equal(ready.key,'nara-key');
});

test('Nara research uses Exa citations and generation keeps source quotations in untrusted user context',async()=>{
  const calls:{url:string;init:RequestInit;body:Record<string,any>}[]=[];
  const fetcher=async(input:string|URL|Request,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)) as Record<string,any>;calls.push({url:String(input),init:init!,body});
    if(String(input)==='https://api.exa.ai/search')return ok({results:[{title:'Primary technical source',url:'https://example.org/rsi',highlights:['The formula uses mean gains and losses over a period.']}]});
    return ok({choices:[{message:{content:JSON.stringify(fields)},finish_reason:'stop'}]});
  };
  const provider=new NaraRouterIndicatorProvider('nara-secret','exa-secret','laguna-s-2.1','https://router.bynara.id/v1',fetcher);
  const research=await provider.research('Build an RSI-like indicator',new AbortController().signal);
  assert.equal(calls[0].url,'https://api.exa.ai/search');
  assert.equal((calls[0].init.headers as Record<string,string>)['x-api-key'],'exa-secret');
  assert.equal(calls[0].body.numResults,5);assert.equal(calls[0].body.type,'fast');
  assert.deepEqual(research.sources,[{title:'Primary technical source',url:'https://example.org/rsi'}]);
  const generated=await provider.generate('Build an RSI-like indicator',research,undefined,new AbortController().signal);
  assert.equal(generated.code,fields.code);
  assert.equal(calls[1].url,'https://router.bynara.id/v1/chat/completions');
  assert.equal(calls[1].body.model,'laguna-s-2.1');assert.equal(calls[1].body.reasoning_effort,'low');
  assert.equal(calls[1].body.messages[0].role,'system');assert.equal(calls[1].body.messages[1].role,'user');
  assert.equal(calls[1].body.messages[1].content.includes('Primary technical source'),true);
  assert.match(calls[1].body.messages[0].content,/Authoritative runtime contract/);
  assert.match(calls[1].body.messages[0].content,/The artifact JSON must contain exactly name, description, code, parameters, assumptions/);
  assert.match(calls[1].body.messages[0].content,/UTC Unix milliseconds/);
  assert.equal('response_format' in calls[1].body,false);
});

test('Nara skips web search without Exa configuration and generation uses the complete authoritative output contract',async()=>{
  let calls=0;let body:Record<string,any>|undefined;
  const provider=new NaraRouterIndicatorProvider('nara-key',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async(_url,init)=>{calls++;body=JSON.parse(String(init?.body));return ok({choices:[{message:{content:JSON.stringify(fields)},finish_reason:'stop'}]});});
  assert.equal(provider.researchMode,'model');
  const research=await provider.research('Custom indicator',new AbortController().signal);
  assert.equal(research.mode,'model');assert.deepEqual(research.sources,[]);assert.match(research.summary,/No web research was performed/);
  await provider.generate('Custom indicator',research,undefined,new AbortController().signal);
  assert.equal(calls,1);assert.equal(body?.messages[0].role,'system');
  assert.match(body?.messages[0].content,/unique and cannot be "price"/);
  assert.match(body?.messages[0].content,/at most 4 objects/);
  assert.match(body?.messages[0].content,/at most 64/);
  assert.match(body?.messages[0].content,/at most 500,000 total/);
  assert.match(body?.messages[0].content,/There is no DOM, network, filesystem, clock, or randomness/);
  assert.match(body?.messages[0].content,/web research was skipped or unavailable/);
});

test('Nara fallback on Exa unavailability retains empty sources and configured-key errors do not silently fallback',async()=>{
  const unavailable=new NaraRouterIndicatorProvider('nara-key','exa-key','laguna-s-2.1','https://router.bynara.id/v1',async()=>new Response(JSON.stringify({error:'temporarily unavailable'}),{status:503}));
  const research=await unavailable.research('Task',new AbortController().signal);assert.equal(research.mode,'model');assert.deepEqual(research.sources,[]);assert.equal(unavailable.researchMode,'web','shared provider capability must not mutate when one request falls back');
  const unauthorized=new NaraRouterIndicatorProvider('nara-key','exa-key','laguna-s-2.1','https://router.bynara.id/v1',async()=>new Response(JSON.stringify({error:'invalid'}),{status:401}));
  await assert.rejects(unauthorized.research('Task',new AbortController().signal),/Exa rejected/);
  const rateLimited=new NaraRouterIndicatorProvider('nara-key','exa-key','laguna-s-2.1','https://router.bynara.id/v1',async()=>new Response(JSON.stringify({error:'rate'}),{status:429}));
  await assert.rejects(rateLimited.research('Task',new AbortController().signal),/rate limited/);
});

test('Nara errors redact provider and Exa credentials',async()=>{
  const nara=new NaraRouterIndicatorProvider('nara-secret','exa-secret','laguna-s-2.1','https://router.bynara.id/v1',async()=>new Response(JSON.stringify({error:{message:'request included nara-secret'}}),{status:401}));
  await assert.rejects(nara.generate('Task',{mode:'model',summary:'Research',sources:[]},undefined,new AbortController().signal),error=>error instanceof Error&&!error.message.includes('nara-secret'));
  const exa=new NaraRouterIndicatorProvider('nara-secret','exa-secret','laguna-s-2.1','https://router.bynara.id/v1',async()=>new Response(JSON.stringify({error:'bad key exa-secret'}),{status:401}));
  await assert.rejects(exa.research('Task',new AbortController().signal),error=>error instanceof Error&&!error.message.includes('exa-secret'));
  const malformed=new NaraRouterIndicatorProvider('nara-key',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async()=>ok({choices:[{message:{content:'not json'},finish_reason:'stop'}]}));
  await assert.rejects(malformed.generate('Task',{mode:'model',summary:'No web research',sources:[]},undefined,new AbortController().signal),error=>error instanceof Error&&error.message.includes('Provider response')&&!error.message.includes('OpenRouter'));
});

test('Nara API reports skipped web research and records model-knowledge provenance',async t=>{
  const server=createAIServer({providerName:'nararouter',apiKey:'nara-key',model:'laguna-s-2.1',exaApiKey:'',baseURL:'https://router.bynara.id/v1',fetcher:async(_url,init)=>ok({choices:[{message:{content:JSON.stringify(fields)},finish_reason:'stop'}]}),allowedOrigins:['http://127.0.0.1:5173']});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const base=`http://127.0.0.1:${addr.port}`;
  assert.deepEqual(await (await fetch(`${base}/api/ai/status`,{headers:{origin:'http://127.0.0.1:5173'}})).json(),{configured:true});
  const response=await fetch(`${base}/api/indicators/generate`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Generate an indicator'})});
  assert.equal(response.status,200);
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line) as {type:string;stage?:string;message?:string;program?:{assumptions:string[];sources:unknown[]}});
  assert.equal(events[0].stage,'research');assert.match(events[0].message??'',/Web search skipped/);
  assert.equal(events[1].stage,'generate');assert.match(events[1].message??'',/model knowledge/);assert.doesNotMatch(events[1].message??'',/researched specification/);
  const program=events.at(-1)?.program;assert.deepEqual(program?.sources,[]);assert.ok(program?.assumptions.some(item=>item.startsWith('Web research skipped; generated from model knowledge')));
});

test('Nara consumes bounded Chat Completions SSE across split UTF-8 chunks and ignores reasoning deltas',async()=>{
  const generated={...fields,name:'Indicateur éclair'};
  const text=JSON.stringify(generated),cut=Math.floor(text.length/2);
  const events=[
    `data: ${JSON.stringify({choices:[{delta:{reasoning:'hidden chain of thought'}}]})}\n\n`,
    `data: ${JSON.stringify({choices:[{delta:{content:text.slice(0,cut)}}]})}\n\n`,
    `data: ${JSON.stringify({choices:[{delta:{content:text.slice(cut)}}]})}\n\n`,
    `data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const bytes=new TextEncoder().encode(events);
  const stream=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i++)controller.enqueue(bytes.slice(i,i+1));controller.close();}});
  let requestBody:Record<string,any>|undefined;
  const provider=new NaraRouterIndicatorProvider('key',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async(_input,init)=>{requestBody=JSON.parse(String(init?.body));return new Response(stream,{headers:{'content-type':'text/event-stream; charset=utf-8'}});});
  const result=await provider.generate('Create an indicator',{mode:'model',summary:'No web research',sources:[]},undefined,new AbortController().signal);
  assert.equal(result.name,generated.name);assert.equal(requestBody?.stream,true);assert.equal(requestBody?.messages[0].content.includes('Authoritative runtime contract'),true);
});

test('Nara rejects truncated/length SSE and caps accumulated bytes',async()=>{
  const response=(text:string)=>new Response(text,{headers:{'content-type':'text/event-stream'}});
  const truncated=new NaraRouterIndicatorProvider('key',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async()=>response(`data: ${JSON.stringify({choices:[{delta:{content:'{}'}}]})}\n\n`));
  await assert.rejects(truncated.generate('Task',{mode:'model',summary:'No search',sources:[]},undefined,new AbortController().signal),/terminal finish/);
  const length=new NaraRouterIndicatorProvider('key',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async()=>response(`data: ${JSON.stringify({choices:[{delta:{content:'{}'},finish_reason:'length'}]})}\n\ndata: [DONE]\n\n`));
  await assert.rejects(length.generate('Task',{mode:'model',summary:'No search',sources:[]},undefined,new AbortController().signal),/truncated/);
  const huge=`data: ${JSON.stringify({choices:[{delta:{content:'x'.repeat(2_000_001)}}]})}\n\n`;
  const oversized=new NaraRouterIndicatorProvider('key',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async()=>response(huge));
  await assert.rejects(oversized.generate('Task',{mode:'model',summary:'No search',sources:[]},undefined,new AbortController().signal),/size limit/);
});

test('Nara cancels a pending SSE stream and redacts keys from streamed errors',async()=>{
  let cancelled=false,receivedSignal:AbortSignal|undefined;
  const hangingStream=()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{"}}]}\n\n'));},cancel(){cancelled=true;}});
  const provider=new NaraRouterIndicatorProvider('nara-stream-secret',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async(_input,init)=>{receivedSignal=init?.signal as AbortSignal;return new Response(hangingStream(),{headers:{'content-type':'text/event-stream'}});});
  const controller=new AbortController();const running=provider.generate('Task',{mode:'model',summary:'No search',sources:[]},undefined,controller.signal);
  await new Promise(resolve=>setTimeout(resolve,1));controller.abort();
  await assert.rejects(running,/cancelled/);assert.equal(receivedSignal?.aborted,true);assert.equal(cancelled,true);
  const badEvent=`data: ${JSON.stringify({error:{message:'upstream echoed nara-stream-secret'}})}\n\ndata: [DONE]\n\n`;
  const unsafe=new NaraRouterIndicatorProvider('nara-stream-secret',undefined,'laguna-s-2.1','https://router.bynara.id/v1',async()=>new Response(badEvent,{headers:{'content-type':'text/event-stream'}}));
  await assert.rejects(unsafe.generate('Task',{mode:'model',summary:'No search',sources:[]},undefined,new AbortController().signal),error=>error instanceof Error&&!error.message.includes('nara-stream-secret'));
});

test('OpenRouter research uses bounded Exa server search and preserves returned source citations',async()=>{
  let captured:{url:string;init:RequestInit}|undefined;
  const provider=new OpenRouterIndicatorProvider('router-secret','poolside/laguna-s-2.1:free','https://openrouter.ai/api/v1',async(input,init)=>{captured={url:String(input),init:init!};return ok(researchResponse);});
  const result=await provider.research('Research a custom oscillator',new AbortController().signal);
  assert.equal(captured?.url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal((captured?.init.headers as Record<string,string>).Authorization,'Bearer router-secret');
  const payload=JSON.parse(String(captured?.init.body)) as Record<string,any>;
  assert.equal(payload.model,'poolside/laguna-s-2.1:free');
  assert.deepEqual(payload.tools,[{type:'openrouter:web_search',parameters:{engine:'exa',max_uses:2,max_results:5,max_total_results:10,max_characters:2500}}]);
  assert.equal(payload.max_tool_calls,2);
  assert.equal(result.summary,'The researched definition uses a rolling calculation.');
  assert.deepEqual(result.sources,[{title:'Formula source',url:'https://example.org/formula'}]);
});

test('OpenRouter extracts citations using the documented nested url_citation annotation shape',async()=>{
  const body={...researchResponse,choices:[{message:{content:'Nested citation result.',annotations:[{type:'url_citation',url_citation:{url:'https://example.org/nested',title:'Nested source',content:'A useful excerpt.'}}]}}]};
  const provider=new OpenRouterIndicatorProvider('key','model',undefined,async()=>ok(body));
  const result=await provider.research('Research',new AbortController().signal);
  assert.deepEqual(result.sources,[{title:'Nested source',url:'https://example.org/nested'}]);
});

test('OpenRouter transparently falls back when a successful call lacks verified web-search evidence',async()=>{
  const noUse=new OpenRouterIndicatorProvider('key','model',undefined,async()=>ok({...researchResponse,usage:{server_tool_use:{web_search_requests:0}}}));
  const noUseResult=await noUse.research('Research',new AbortController().signal);assert.equal(noUseResult.mode,'model');assert.deepEqual(noUseResult.sources,[]);assert.match(noUseResult.summary,/no verified search usage and citations/);
  const noCitation=new OpenRouterIndicatorProvider('key','model',undefined,async()=>ok({...researchResponse,choices:[{message:{content:'No citation.'}}]}));
  const noCitationResult=await noCitation.research('Research',new AbortController().signal);assert.equal(noCitationResult.mode,'model');assert.deepEqual(noCitationResult.sources,[]);
});

test('OpenRouter falls back only on specific search-capability errors, never auth or quota failures',async()=>{
  const unsupported=new OpenRouterIndicatorProvider('key','model',undefined,async()=>new Response(JSON.stringify({error:{message:'The web_search tool is not supported for this model.',code:'unsupported_tool'}}),{status:400}));
  assert.equal((await unsupported.research('Research',new AbortController().signal)).mode,'model');
  const unauthorized=new OpenRouterIndicatorProvider('key','model',undefined,async()=>new Response(JSON.stringify({error:{message:'invalid api key',code:'invalid_api_key'}}),{status:401}));
  await assert.rejects(unauthorized.research('Research',new AbortController().signal),/rejected the configured API key/);
  const quota=new OpenRouterIndicatorProvider('key','model',undefined,async()=>new Response(JSON.stringify({error:{message:'quota exceeded'}}),{status:429}));
  await assert.rejects(quota.research('Research',new AbortController().signal),/rate limited/);
  const invalidModel=new OpenRouterIndicatorProvider('key','model',undefined,async()=>new Response(JSON.stringify({error:{message:'model not found',code:'model_not_found'}}),{status:400}));
  await assert.rejects(invalidModel.research('Research',new AbortController().signal),/model not found/);
});

test('OpenRouter rejects API error envelopes even when HTTP status is successful',async()=>{
  const provider=new OpenRouterIndicatorProvider('top-secret-value','model',undefined,async()=>ok({error:{message:'provider reported top-secret-value',code:'error'}}));
  await assert.rejects(provider.research('Research',new AbortController().signal),error=>error instanceof Error&&error.message.includes('[redacted]')&&!error.message.includes('top-secret-value'));
});

test('OpenRouter reports string policy errors without retrying or exposing credentials',async()=>{
  let calls=0;
  const provider=new OpenRouterIndicatorProvider('private-policy-key','model',undefined,async()=>{
    calls++;
    return new Response(JSON.stringify({success:false,error:'Access denied by security policy. private-policy-key'}),{status:403});
  });
  await assert.rejects(provider.generate('Task',{mode:'model',summary:'No search',sources:[]},undefined,new AbortController().signal),error=>error instanceof Error&&error.message.includes('Access denied by security policy.')&&!error.message.includes('private-policy-key'));
  assert.equal(calls,1);
});

test('OpenRouter generation requests raw JSON and strictly validates the local envelope',async()=>{
  let bodies:Record<string,any>[]=[];
  const provider=new OpenRouterIndicatorProvider('key','poolside/laguna-s-2.1:free',undefined,async(_input,init)=>{const body=JSON.parse(String(init?.body)) as Record<string,any>;bodies.push(body);return ok({choices:[{message:{content:JSON.stringify(fields)},finish_reason:'stop'}]});});
  const result=await provider.generate('Custom', {mode:'web',summary:'Facts',sources:[{title:'Source',url:'https://example.com'}]},undefined,new AbortController().signal);
  assert.equal(result.code,fields.code); assert.equal(bodies.length,1); assert.equal('response_format' in bodies[0]||'text' in bodies[0],false);
  assert.equal(bodies[0].messages[0].role,'system');assert.equal(bodies[0].messages[1].role,'user');
  assert.match(bodies[0].messages[0].content,/Authoritative runtime contract/);
  assert.match(bodies[0].messages[0].content,/type:"band"/);assert.match(bodies[0].messages[0].content,/offset.*-500 to 500/);
  const modelKnowledge=new OpenRouterIndicatorProvider('key','model',undefined,async(_input,init)=>{const body=JSON.parse(String(init?.body)) as Record<string,any>;bodies.push(body);return ok({choices:[{message:{content:JSON.stringify(fields)}}]});});
  await modelKnowledge.generate('Custom',{mode:'model',summary:'Search unavailable',sources:[]},undefined,new AbortController().signal);
  assert.match(bodies.at(-1)?.messages[0].content,/use model knowledge and the request only/);
  const invalid=new OpenRouterIndicatorProvider('key','model',undefined,async()=>ok({choices:[{message:{content:JSON.stringify({...fields,unexpected:true})}}]}));
  await assert.rejects(invalid.generate('Custom',{mode:'web',summary:'Facts',sources:[]},undefined,new AbortController().signal),/schema/);
});

test('OpenRouter retries exactly once after a length finish with a bounded larger budget and keeps reasoning low',async()=>{
  const bodies:Record<string,any>[]=[];
  const provider=new OpenRouterIndicatorProvider('key','deepseek/deepseek-v4.1-flash',undefined,async(_input,init)=>{
    const body=JSON.parse(String(init?.body)) as Record<string,any>;bodies.push(body);
    return bodies.length===1?ok({choices:[{message:{content:'partial json'},finish_reason:'length'}],usage:{prompt_tokens:500,completion_tokens:16000,total_tokens:16500}}):ok({choices:[{message:{content:JSON.stringify(fields)},finish_reason:'stop'}]});
  });
  const result=await provider.generate('Build an Ichimoku-style cloud',{mode:'model',summary:'Model knowledge only',sources:[]},undefined,new AbortController().signal);
  assert.equal(result.code,fields.code);assert.equal(bodies.length,2);
  assert.equal(bodies[0].max_tokens,16000);assert.equal(bodies[1].max_tokens,32000);
  assert.equal(bodies[0].reasoning_effort,'low');assert.equal(bodies[1].reasoning_effort,'low');
  const stillTruncated=new OpenRouterIndicatorProvider('key','model',undefined,async(_input,init)=>{const body=JSON.parse(String(init?.body)) as Record<string,any>;return ok({choices:[{message:{content:'partial'},finish_reason:'length'}],usage:{completion_tokens:body.max_tokens}});});
  await assert.rejects(stillTruncated.generate('Task',{mode:'model',summary:'No web research',sources:[]},undefined,new AbortController().signal),error=>error instanceof Error&&/one bounded higher-budget retry/.test(error.message)&&/tokens:/.test(error.message));
});

test('OpenRouter output budget is configurable and capped, with reasoning opt-out',async()=>{
  let payload:Record<string,any>|undefined;
  const provider=new OpenRouterIndicatorProvider('key','model',undefined,async(_input,init)=>{payload=JSON.parse(String(init?.body));return ok({choices:[{message:{content:JSON.stringify(fields)},finish_reason:'stop'}]});},{maxOutputTokens:40_000,reasoningEffort:'none'});
  await provider.generate('Task',{mode:'model',summary:'No web research',sources:[]},undefined,new AbortController().signal);
  assert.equal(payload?.max_tokens,32_000);assert.equal('reasoning_effort' in (payload??{}),false);
});

test('OpenRouter does not retry a cancelled or unauthorized truncated generation',async()=>{
  const cancelled=new AbortController();let calls=0;
  const provider=new OpenRouterIndicatorProvider('key','model',undefined,async()=>{calls++;cancelled.abort();return ok({choices:[{message:{content:'partial'},finish_reason:'length'}]});});
  await assert.rejects(provider.generate('Task',{mode:'model',summary:'No web research',sources:[]},undefined,cancelled.signal),/cancelled/);
  assert.equal(calls,1);
  let authCalls=0;
  const unauthorized=new OpenRouterIndicatorProvider('key','model',undefined,async()=>{authCalls++;return new Response(JSON.stringify({error:{message:'invalid key',code:'invalid_api_key'}}),{status:401});});
  await assert.rejects(unauthorized.generate('Task',{mode:'model',summary:'No web research',sources:[]},undefined,new AbortController().signal),/rejected the configured API key/);
  assert.equal(authCalls,1);
});

test('OpenRouter sends cancellation signal and removes credentials from provider errors',async()=>{
  let receivedSignal:AbortSignal|undefined;
  const pending=new OpenRouterIndicatorProvider('ultra-secret-key','model',undefined,(_input,init)=>new Promise((_resolve,reject)=>{receivedSignal=init?.signal as AbortSignal;receivedSignal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
  const controller=new AbortController(); const running=pending.research('Cancel',controller.signal); controller.abort();
  await assert.rejects(running,/aborted/); assert.equal(receivedSignal?.aborted,true);
  const unauthorized=new OpenRouterIndicatorProvider('ultra-secret-key','model',undefined,async()=>new Response(JSON.stringify({error:{message:'invalid api key ultra-secret-key',code:'invalid_api_key'}}),{status:401}));
  await assert.rejects(unauthorized.research('Private',new AbortController().signal),error=>error instanceof Error&&error.message.includes('OpenRouter rejected the configured API key')&&!error.message.includes('ultra-secret-key'));
});

test('HTTP adapter maps OpenRouter auth failures without exposing provider error or credentials',async t=>{
  const provider:AIProvider={
    async research(){const error=new Error('OpenRouter rejected key ultra-secret-key') as Error&{status:number;code:string};error.status=401;error.code='invalid_api_key';throw error;},
    async generate(){throw new Error('unreachable');}, async repair(){throw new Error('unreachable');},
  };
  const server=createAIServer({provider,apiKey:'ultra-secret-key',providerName:'openrouter',allowedOrigins:['http://127.0.0.1:5173']});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const response=await fetch(`http://127.0.0.1:${addr.port}/api/indicators/generate`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({request:'Test auth'})});
  const body=await response.text();
  assert.equal(body.includes('ultra-secret-key'),false);assert.match(body,/OpenRouter rejected the configured API key/);
});
