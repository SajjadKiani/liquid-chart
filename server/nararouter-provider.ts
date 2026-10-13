import { ChatCompletionsIndicatorProvider } from './chat-completions-provider.ts';

/** NaraRouter preset; transport and research are shared with the generic adapter. */
export class NaraRouterIndicatorProvider extends ChatCompletionsIndicatorProvider {
  constructor(apiKey:string,exaApiKey:string|undefined,model:string,baseURL:string,fetcher:typeof fetch=fetch){
    super(apiKey,exaApiKey,model,baseURL,fetcher,{label:'NaraRouter',stream:true,maxOutputTokens:6000,reasoningEffort:'low',retryTruncated:false});
  }
}
