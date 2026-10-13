import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { selectAIProvider, type ProviderSelection } from './provider.ts';
import { generateIndicator, type AIProvider } from './ai-service.ts';

const BODY_LIMIT = 64 * 1024;
const REQUEST_LIMIT = 4000;
const MAX_JOBS = 2;
export type AIServerOptions = { provider?:AIProvider; apiKey?:string; model?:string; providerName?:string; baseURL?:string; fetcher?:typeof fetch; exaApiKey?:string; allowedOrigins?:string[]; maxJobs?:number; deadlineMs?:number; bodyTimeoutMs?:number };

/** Create the loopback AI API server; injectable providers keep workflow tests offline. */
export function createAIServer(options:AIServerOptions = {}):Server {
  const selection=selectAIProvider({providerName:options.providerName??process.env.AI_PROVIDER,apiKey:options.apiKey,openRouterApiKey:process.env.OPENROUTER_API_KEY,openAiApiKey:process.env.OPENAI_API_KEY,exaApiKey:options.exaApiKey??process.env.EXA_API_KEY,model:options.model??process.env.AI_MODEL,openAiModel:process.env.OPENAI_MODEL,baseURL:options.baseURL??process.env.OPENAI_BASE_URL,fetcher:options.fetcher,maxOutputTokens:environmentTokenBudget(),reasoningEffort:process.env.AI_REASONING_EFFORT});
  const key=selection.key;
  const provider=options.provider ?? selection.provider;
  const configuredOrigins=options.allowedOrigins ?? process.env.LIQUID_CHART_ORIGINS?.split(',').map(s=>s.trim()).filter(Boolean);
  const allowedOrigins=new Set(configuredOrigins?.length ? configuredOrigins : defaultOrigins());
  const jobs=new Set<AbortController>();
  const server=createServer((req,res)=>{
    void handle(req,res);
  });
  async function handle(req:IncomingMessage,res:ServerResponse):Promise<void> {
    const path=req.url?.split('?')[0];
    const statusRequest=req.method==='GET' && path==='/api/ai/status';
    if (!isLocalRequest(req,allowedOrigins,statusRequest)) { json(res,403,{error:'This local API accepts requests only from the chart workspace origin.'}); return; }
    if (statusRequest) { json(res,200,{configured:!!provider}); return; }
    if (req.method!=='POST' || path!='/api/indicators/generate') { json(res,404,{error:'Not found.'}); return; }
    if (!provider || !key && !options.provider) { json(res,503,{error:selection.configurationError??'AI is not configured. Set the selected provider API key in the local environment.'}); return; }
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '')) { json(res,415,{error:'Content-Type must be application/json.'}); return; }
    if (jobs.size >= Math.min(options.maxJobs ?? MAX_JOBS,MAX_JOBS)) { json(res,429,{error:'The local indicator service is busy. Try again shortly.'}); return; }
    const length=Number(req.headers['content-length'] ?? 0);
    if (req.headers['content-length'] !== undefined && !Number.isSafeInteger(length)) { json(res,400,{error:'Content-Length is invalid.'}); return; }
    if (length > BODY_LIMIT) { json(res,413,{error:'Request body exceeds the 64 KB limit.'}); return; }
    const controller=new AbortController(); jobs.add(controller);
    let bodyText:string;
    try { bodyText=await readBody(req,controller,options.bodyTimeoutMs ?? 8_000); }
    catch(error) {
      jobs.delete(controller);
      if (!res.destroyed) json(res,error instanceof Error && error.message.includes('64 KB')?413:400,{error:error instanceof Error?error.message:'Could not read request body.'});
      return;
    }
    let body:unknown; try { body=JSON.parse(bodyText); } catch { jobs.delete(controller); json(res,400,{error:'Request body must be valid JSON.'}); return; }
    if (!body || typeof body!=='object' || Array.isArray(body)) { jobs.delete(controller); json(res,400,{error:'Request must be a JSON object.'}); return; }
    const payload=body as Record<string,unknown>;
    if (typeof payload.request!=='string' || !payload.request.trim() || payload.request.length>REQUEST_LIMIT) { jobs.delete(controller); json(res,400,{error:`request must be 1 to ${REQUEST_LIMIT} characters.`}); return; }
    if(payload.webSearch!==undefined&&typeof payload.webSearch!=='boolean'){jobs.delete(controller);json(res,400,{error:'webSearch must be a boolean when provided.'});return;}
    const cancel=()=>{ if (!res.writableEnded) controller.abort(); };
    req.once('aborted',cancel); res.once('close',cancel);
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'keep-alive'});
    const emit=(event:unknown)=>{ if (!controller.signal.aborted && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
    try {
      const program=await generateIndicator(payload.request.trim(),payload.previous,provider,controller.signal,(stage,message)=>emit({type:'progress',stage,message}),{deadlineMs:options.deadlineMs,webSearch:payload.webSearch as boolean|undefined});
      emit({type:'result',program});
    } catch(error) {
      if (!controller.signal.aborted) emit({type:'error',message:safeErrorMessage(error,key,selection.name)});
    } finally {
      jobs.delete(controller); req.off('aborted',cancel); res.off('close',cancel);
      if (!res.destroyed) res.end();
    }
  }
  return server;
}

function environmentTokenBudget():number|undefined {
  const raw=process.env.AI_MAX_OUTPUT_TOKENS;
  if(raw===undefined||raw.trim()==='')return undefined;
  if(!/^\d+$/.test(raw.trim()))throw new Error('AI_MAX_OUTPUT_TOKENS must be a positive integer.');
  return Number(raw.trim());
}

function defaultOrigins():string[] { return [5173,5174,4173,4174].flatMap(port=>[`http://127.0.0.1:${port}`,`http://localhost:${port}`]); }
function isLocalRequest(req:IncomingMessage,allowed:Set<string>,readOnlyStatus=false):boolean {
  const host=req.headers.host;
  if (!host) return false;
  let hostName:string; try { hostName=new URL(`http://${host}`).hostname; } catch { return false; }
  if (!(hostName==='127.0.0.1'||hostName==='localhost'||hostName==='[::1]')) return false;
  let origin=req.headers.origin;
  if (!origin && req.headers.referer) { try { origin=new URL(req.headers.referer).origin; } catch { return false; } }
  if (!origin && readOnlyStatus) return true;
  if (!origin || !allowed.has(origin)) return false;
  try { const u=new URL(origin); return u.protocol==='http:' && (u.hostname==='127.0.0.1' || u.hostname==='localhost' || u.hostname==='[::1]'); } catch { return false; }
}
function readBody(req:IncomingMessage,controller:AbortController,timeoutMs:number):Promise<string> {
  return new Promise((resolveBody,rejectBody)=>{
    const chunks:Buffer[]=[]; let size=0,settled=false;
    const cleanup=()=>{clearTimeout(timer);req.off('data',onData);req.off('end',onEnd);req.off('error',onError);req.off('aborted',onAborted);};
    const finish=(error?:Error,value?:string)=>{if(settled)return;settled=true;cleanup();error?rejectBody(error):resolveBody(value!);};
    const onData=(chunk:Buffer|string)=>{const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=part.byteLength;if(size>BODY_LIMIT){req.pause();req.resume();finish(new Error('Request body exceeds the 64 KB limit.'));return;}chunks.push(part);};
    const onEnd=()=>finish(undefined,Buffer.concat(chunks,size).toString('utf8'));
    const onError=(error:Error)=>finish(error);
    const onAborted=()=>finish(new Error('Client disconnected while sending the request.'));
    const timer=setTimeout(()=>{controller.abort();req.destroy();finish(new Error('Request body timed out.'));},Math.max(100,timeoutMs));
    req.on('data',onData);req.once('end',onEnd);req.once('error',onError);req.once('aborted',onAborted);
  });
}
function json(res:ServerResponse,status:number,value:unknown):void { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(value)); }
function safeErrorMessage(error:unknown,key?:string,providerName:ProviderSelection['name']='openai'):string {
  const candidate=error instanceof Error?error as Error & {status?:number;code?:string}:undefined;
  const label=providerName==='openrouter'?'OpenRouter':providerName==='nararouter'?'NaraRouter':providerName==='chat-completions'?'Chat Completions provider':'OpenAI';
  const keySetting=providerName==='openrouter'?'OPENROUTER_API_KEY (or OPENAI_API_KEY)':providerName==='nararouter'?'OPENAI_API_KEY':'OPENAI_API_KEY';
  if (candidate?.status===401 || candidate?.code==='invalid_api_key' || /invalid api key/i.test(candidate?.message??'')) return `${label} rejected the configured API key. Check ${keySetting}.`;
  if (candidate?.status===429 || /rate.?limit|quota/i.test(candidate?.message??'')) return `${label} rate limited the request or the account has no available quota.`;
  let message=candidate?.message??String(error);
  if (key) message=message.split(key).join('[redacted]');
  return message.replace(/sk-[A-Za-z0-9_-]{12,}/g,'[redacted API key]').slice(0,700);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port=Number(process.env.API_PORT ?? 8787);
  if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('API_PORT must be a valid port.');
  const server=createAIServer();
  server.listen(port,'127.0.0.1',()=>console.log(`LiquidChart AI service listening on http://127.0.0.1:${port}`));
}
