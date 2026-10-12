import OpenAI from 'openai';
import type { AIProvider, GeneratedFields, ResearchResult } from './ai-service.ts';
import type { IndicatorProgram } from '../runtime/contract.ts';

const schema = {
  type:'object', additionalProperties:false, required:['name','description','code','parameters','assumptions'],
  properties:{
    name:{type:'string'}, description:{type:'string'}, code:{type:'string'},
    parameters:{type:'array',items:{type:'object',additionalProperties:false,required:['key','label','type','default','min','max','step'],properties:{key:{type:'string'},label:{type:'string'},type:{type:'string',enum:['number']},default:{type:'number'},min:{type:'number'},max:{type:'number'},step:{type:'number'}}}},
    assumptions:{type:'array',items:{type:'string'}}
  }
};
const outputContract=`Authoritative output contract: return {panes,series}. Panes have id,title and optional increasing finite range and optional levels [{value,color?,label?}]; at most 4. Series share id,name,paneId,color,optional integer offset in [-500,500] bars. paneId "price" means candle overlay. Positive offset shifts forward and negative shifts backward in bar positions, never changes point timestamps. Variants: line {type:"line",points:[{time,value:number|null}]}; histogram {type:"histogram",points:[{time,value:number|null}],baseline?:finite}; band {type:"band",points:[{time,value:number|null,value2:number|null}],negativeColor?:string}. For bands, color is used when value>=value2 and negativeColor when value<value2; renderer handles crossings. At most 64 series, 100,000 points each, 500,000 total. Point timestamps must be strictly increasing candle timestamps copied exactly from input. Values must be finite or null; band value/value2 are both null or both finite. Use null for warmup. Candles are ordered {time,open,high,low,close,volume}, UTC Unix milliseconds. No DOM, network, filesystem, clock, or randomness.`;

export class OpenAIIndicatorProvider implements AIProvider {
  private client: OpenAI;
  private readonly model:string;
  constructor(apiKey:string, model:string = 'gpt-5.5', baseURL?:string) { this.model=model; this.client = new OpenAI({apiKey, ...(baseURL?{baseURL}:{}), maxRetries:0, timeout:45_000}); }

  async research(request:string, signal:AbortSignal):Promise<ResearchResult> {
    const response = await this.client.responses.create({
      model:this.model, input:`Research the mathematical definition and calculation details for this technical chart indicator request. Prefer original papers, standards, or reputable primary references. Distinguish variants and state the exact formula, warmup behavior, and edge cases. Do not invent sources.\n\nRequest: ${request}`,
      tools:[{type:'web_search',search_context_size:'medium'}], tool_choice:'required', include:['web_search_call.action.sources'], max_output_tokens:3000,
    }, {signal});
    const sources = extractSources(response as unknown as Record<string,unknown>);
    const searched=response.output.some(item=>item.type==='web_search_call' && item.status==='completed');
    if (!searched || sources.length===0) throw new Error('The research tool did not return completed search sources.');
    return { mode:'web', summary:String(response.output_text ?? '').slice(0,14_000), sources };
  }

  async generate(request:string, research:ResearchResult, previous:IndicatorProgram | undefined, signal:AbortSignal):Promise<GeneratedFields> {
    const provenance=research.mode==='web'?'Create a chart indicator program from the verified web-researched facts below. Use only these sources and add no citations.':'Web research was disabled, unavailable, or returned no verified sources. Generate from the user request and model knowledge only; invent no citations and state uncertainty and assumptions.';
    return this.structured(`${provenance} Follow the output schema exactly. ${outputContract} The code must be only a function declaration named calculate(candles, parameters), with no imports or top-level code. Parameter values are supplied in parameters and already range-checked. Generate only the requested indicator; previous artifact is context only unless the request explicitly asks to modify or retain it. Do not claim the formula was proven correct. Include explicit assumptions.\n\nUser request:\n${request}\n\nResearch summary:\n${research.summary}\n\nCited sources:\n${JSON.stringify(research.sources)}\n\nPrevious artifact (if any):\n${previous ? JSON.stringify({name:previous.name,description:previous.description,code:previous.code,parameters:previous.parameters,assumptions:previous.assumptions}) : 'none'}`,signal);
  }

  async repair(request:string, research:ResearchResult, fields:GeneratedFields, failures:string[], signal:AbortSignal):Promise<GeneratedFields> {
    return this.structured(`Repair this generated indicator after independent validation. Follow the authoritative contract: ${outputContract} Change only what is needed. Keep the request's intended formula and disclose assumptions.\n\nUser request: ${request}\nResearch summary: ${research.summary}\nCurrent artifact: ${JSON.stringify(fields)}\nValidation failures: ${failures.join('\n')}`,signal);
  }

  private async structured(input:string, signal:AbortSignal):Promise<GeneratedFields> {
    const response = await this.client.responses.create({ model:this.model, input, text:{format:{type:'json_schema',name:'indicator_program',strict:true,schema}}, max_output_tokens:5000 }, {signal});
    let data:unknown; try { data=JSON.parse(response.output_text); } catch { throw new Error('The model did not return structured indicator data.'); }
    if (!data || typeof data !== 'object') throw new Error('The model response is not an indicator object.');
    const d=data as Record<string,unknown>;
    return { name:String(d.name), description:String(d.description), code:String(d.code), parameters:d.parameters as GeneratedFields['parameters'], assumptions:d.assumptions as string[] };
  }
}

function extractSources(response:Record<string,unknown>):{title:string;url:string}[] {
  const found = new Map<string,{title:string;url:string}>();
  const walk=(value:unknown)=>{
    if (!value || typeof value!=='object') return;
    if (Array.isArray(value)) { for(const item of value) walk(item); return; }
    const item=value as Record<string,unknown>;
    if (typeof item.url==='string' && /^https?:\/\//i.test(item.url)) {
      const url=item.url; const title=typeof item.title==='string' && item.title.trim() ? item.title.trim() : url;
      found.set(url,{title:title.slice(0,300),url});
    }
    for (const child of Object.values(item)) walk(child);
  };
  walk(response.output);
  return [...found.values()].slice(0,30);
}
