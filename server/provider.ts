import type { AIProvider } from './ai-service.ts';
import { OpenAIIndicatorProvider } from './openai-provider.ts';
import { OpenRouterIndicatorProvider } from './openrouter-provider.ts';
import { NaraRouterIndicatorProvider } from './nararouter-provider.ts';
import { ChatCompletionsIndicatorProvider } from './chat-completions-provider.ts';

export type ProviderConfig={providerName?:string;apiKey?:string;openRouterApiKey?:string;openAiApiKey?:string;exaApiKey?:string;model?:string;openAiModel?:string;baseURL?:string;fetcher?:typeof fetch;maxOutputTokens?:number;reasoningEffort?:string};
export type ProviderSelection={name:'openai'|'openrouter'|'nararouter'|'chat-completions';key?:string;model:string;provider?:AIProvider;configurationError?:string};

export function selectAIProvider(config:ProviderConfig):ProviderSelection {
  const name=(config.providerName?.trim().toLowerCase()||'openai');
  if(name!=='openai'&&name!=='openrouter'&&name!=='nararouter'&&name!=='chat-completions')throw new Error(`Unsupported AI_PROVIDER: ${name}. Use openai, openrouter, nararouter, or chat-completions.`);
  const key=config.apiKey?.trim()||(name==='openrouter'?(config.openRouterApiKey?.trim()||config.openAiApiKey?.trim()):config.openAiApiKey?.trim());
  const model=config.model?.trim()||config.openAiModel?.trim()||(name==='openrouter'?'poolside/laguna-s-2.1:free':name==='nararouter'||name==='chat-completions'?'':'gpt-5.5');
  if(!key)return {name,key,model,configurationError:name==='nararouter'?'NaraRouter is missing its API key. Configure OPENAI_API_KEY.':name==='openrouter'?'AI is not configured. Set OPENROUTER_API_KEY (or OPENAI_API_KEY).':'AI is not configured. Set OPENAI_API_KEY.'};
  if(!model)return {name,key,model,configurationError:'The selected provider needs a model. Configure AI_MODEL or OPENAI_MODEL.'};
  if(name==='chat-completions'){
    if(!config.baseURL?.trim())return {name,key,model,configurationError:'Chat Completions needs an API base URL. Configure OPENAI_BASE_URL.'};
    return {name,key,model,provider:new ChatCompletionsIndicatorProvider(key,config.exaApiKey?.trim(),model,config.baseURL.trim(),config.fetcher,{maxOutputTokens:config.maxOutputTokens,reasoningEffort:normalizeReasoningEffort(config.reasoningEffort?.trim()||'none')})};
  }
  if(name==='nararouter'){
    return {name,key,model,provider:new NaraRouterIndicatorProvider(key,config.exaApiKey?.trim(),model,config.baseURL||'https://router.bynara.id/v1',config.fetcher)};
  }
  const provider=name==='openrouter'
    ? new OpenRouterIndicatorProvider(key,model,config.baseURL||'https://openrouter.ai/api/v1',config.fetcher,{maxOutputTokens:config.maxOutputTokens,reasoningEffort:normalizeReasoningEffort(config.reasoningEffort)})
    : new OpenAIIndicatorProvider(key,model,config.baseURL);
  return {name,key,model,provider};
}

function normalizeReasoningEffort(value:string|undefined):'low'|'medium'|'high'|'xhigh'|'none' {
  if(value===undefined||!value.trim())return 'low';
  const normalized=value.trim().toLowerCase();
  if(normalized==='none')return 'none';
  if(normalized==='low'||normalized==='medium'||normalized==='high'||normalized==='xhigh')return normalized;
  throw new Error('AI_REASONING_EFFORT must be low, medium, high, xhigh, or none.');
}
