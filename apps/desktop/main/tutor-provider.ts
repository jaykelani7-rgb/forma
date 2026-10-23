import type { TutorProviderId, TutorProviderStatus, TutorTurn, TutorUsage } from '../../../packages/tutor/types';
import { buildProviderMessages, policyInstructions } from '../../../packages/tutor/policy';
import { TUTOR_BUDGET } from '../../../packages/tutor/context';
import { GeminiTutorProvider } from './tutor-gemini-provider';
import { TutorProviderError, providerName, classifyProviderError } from './tutor-provider-errors';
import { TutorRequests, boundedBytes, boundedJson, checkResponse, consumeSse, record, type RequestOptions } from './tutor-provider-transport';
export { TutorProviderError, tutorProviderError, classifyProviderError } from './tutor-provider-errors';
export type { TutorProviderErrorCode } from './tutor-provider-errors';

export interface TutorProviderConfig { provider?:TutorProviderId; apiKey?:string; model:string; transcriptionModel:string; speechModel:string }
export interface TutorStreamInput {turn:TutorTurn;history:TutorTurn[];instructions?:string}
export interface TutorStreamResult {usage:TutorUsage|null;model:string;provider?:TutorProviderId}
export interface TutorProvider {
  status():TutorProviderStatus;
  stream(input:TutorStreamInput,signal:AbortSignal,onDelta:(text:string)=>void|Promise<void>):Promise<TutorStreamResult>;
  transcribe(bytes:Uint8Array,mime:string,signal:AbortSignal):Promise<string>;
  speech(text:string,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:string}>;
}
export const TUTOR_PROVIDER_LIMITS={inputChars:TUTOR_BUDGET.total,responseChars:24_000,audioBytes:12*1024*1024,speechChars:6_000,timeoutMs:120_000,eventChars:262_144} as const;
const endpoint='https://api.openai.com/v1';

/** Completed replies only: keep code/formulas readable on screen instead of spelling them aloud. */
export function speechReadyText(text:string):string {
  const spoken=text
    .replace(/```[\s\S]*?(?:```|$)/g,' The code example is available in the text response. ')
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g,' The displayed formula is available in the text response. ')
    .replace(/\$[^\n$]+\$|\\\([^\n]*?\\\)/g,' the formula shown in the text ')
    .replace(/`([^`]+)`/g,(_match,value:string)=>value.length>48?'the code shown in the text':value)
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/https?:\/\/\S+/g,'the linked reference')
    .replace(/<\/?[a-z][^>]*>/gi,' ')
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s?)/gm,'')
    .replace(/\*\*|__/g,'').replace(/\s+/g,' ').trim();
  if(spoken.length<=TUTOR_PROVIDER_LIMITS.speechChars)return spoken;
  const prefix=spoken.slice(0,TUTOR_PROVIDER_LIMITS.speechChars-100);
  return `${prefix.slice(0,prefix.lastIndexOf(' '))}. The rest is available in the text response.`;
}

function usage(input:unknown):TutorUsage|null {
  if(!input||typeof input!=='object')return null;
  const v=input as Record<string,unknown>;
  const n=[v.input_tokens,v.output_tokens,v.total_tokens];
  if(n.some(x=>typeof x!=='number'||!Number.isSafeInteger(x)||x<0))return null;
  return {inputTokens:n[0] as number,outputTokens:n[1] as number,totalTokens:n[2] as number};
}

/** Host-only adapter. There is no caller-supplied URL, proxy, tool, or retry path. */
export class OpenAITutorProvider implements TutorProvider {
  private readonly requests:TutorRequests;
  constructor(private readonly getConfig:()=>TutorProviderConfig,private readonly transport:typeof fetch=fetch,options:RequestOptions={}){this.requests=new TutorRequests('openai',options);}
  status():TutorProviderStatus {
    const c=this.getConfig();
    return {provider:'openai',name:providerName('openai'),capabilities:{text:true,transcription:true,speech:true},configured:!!c.apiKey?.trim(),model:c.model,transcriptionModel:c.transcriptionModel,speechModel:c.speechModel,message:c.apiKey?.trim()?'Selected context is sent to OpenAI. Conversations stay in the local notebook.':new TutorProviderError('setup','openai').message};
  }
  private request<T>(signal:AbortSignal,run:(config:TutorProviderConfig,signal:AbortSignal)=>Promise<T>):Promise<T>{
    const config={...this.getConfig()};
    return this.requests.run(signal,!!config.apiKey?.trim(),requestSignal=>run(config,requestSignal));
  }
  private async post(path:'/responses'|'/audio/transcriptions'|'/audio/speech',config:TutorProviderConfig,signal:AbortSignal,body:BodyInit,json=true):Promise<Response>{
    const response=await this.transport(`${endpoint}${path}`,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey!.trim()}`,...(json?{'Content-Type':'application/json'}:{})},body,signal,redirect:'error'});
    return checkResponse(response,'openai',signal);
  }
  async stream(input:TutorStreamInput,signal:AbortSignal,onDelta:(text:string)=>void|Promise<void>):Promise<TutorStreamResult>{
    let messages:ReturnType<typeof buildProviderMessages>;
    try{messages=buildProviderMessages(input.turn,input.history).filter(message=>message.role!=='system');}catch{throw new TutorProviderError('too-large');}
    const instructions=input.instructions??policyInstructions(input.turn.action,input.turn.hintLevel);
    if(messages.reduce((count,message)=>count+message.content.length,0)+instructions.length>TUTOR_PROVIDER_LIMITS.inputChars)throw new TutorProviderError('too-large');
    return this.request(signal,async(config,requestSignal)=>{
      const response=await this.post('/responses',config,requestSignal,JSON.stringify({model:config.model,instructions,input:messages,stream:true,store:false,max_output_tokens:3000}));
      let completed=false,meaningful=false;let chars=0;let result:TutorStreamResult={usage:null,model:config.model,provider:'openai'};
      const frame=async(data:unknown)=>{
        const event=record(data,'openai');
        if(event.type==='response.output_text.delta'){
          if(completed||typeof event.delta!=='string')throw new TutorProviderError('malformed');
          chars+=event.delta.length;if(chars>TUTOR_PROVIDER_LIMITS.responseChars)throw new TutorProviderError('too-large');
          if(event.delta.trim())meaningful=true;
          if(requestSignal.aborted)throw new TutorProviderError('aborted');
          await onDelta(event.delta);
        }else if(event.type==='response.completed'){
          const r=record(event.response,'openai');if(r.status!=='completed')throw new TutorProviderError('malformed');
          completed=true;result={usage:usage(r.usage),model:typeof r.model==='string'&&r.model.length<=120?r.model:config.model,provider:'openai'};
        }else if(event.type==='response.refusal.delta'||event.type==='response.refusal.done')throw new TutorProviderError('refused');
        else if(event.type==='error'||event.type==='response.failed'){const failure=event.type==='error'?event:record(event.response,'openai');throw classifyProviderError('openai',0,failure.error??failure);}
        else if(event.type==='response.incomplete')throw new TutorProviderError('malformed');
      };
      await consumeSse(response,requestSignal,'openai',TUTOR_PROVIDER_LIMITS.eventChars,frame);
      if(requestSignal.aborted)throw new TutorProviderError('aborted');
      if(!completed||!meaningful)throw new TutorProviderError('malformed');
      return result;
    });
  }
  async transcribe(bytes:Uint8Array,mime:string,signal:AbortSignal):Promise<string>{
    const types:Record<string,string>={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav'};
    const media=mime.split(';')[0].trim().toLowerCase();
    if(!types[media])throw new TutorProviderError('configuration');
    if(!bytes.byteLength)throw new TutorProviderError('malformed');
    if(bytes.byteLength>TUTOR_PROVIDER_LIMITS.audioBytes)throw new TutorProviderError('too-large');
    return this.request(signal,async(config,requestSignal)=>{
      const form=new FormData();form.set('model',config.transcriptionModel);form.set('response_format','json');
      form.set('file',new Blob([Uint8Array.from(bytes).buffer],{type:media}),`recording.${types[media]}`);
      const response=await this.post('/audio/transcriptions',config,requestSignal,form,false);
      const payload=record(await boundedJson(response,128_000,'openai',requestSignal),'openai');
      if(typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>12_000)throw new TutorProviderError('malformed');
      return payload.text.trim();
    });
  }
  async speech(text:string,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:string}>{
    if(!text.trim()||text.length>TUTOR_PROVIDER_LIMITS.speechChars)throw new TutorProviderError('too-large');
    return this.request(signal,async(config,requestSignal)=>{
      const response=await this.post('/audio/speech',config,requestSignal,JSON.stringify({model:config.speechModel,voice:'coral',input:text,response_format:'mp3'}));
      if(!response.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg')){await response.body?.cancel();throw new TutorProviderError('malformed');}
      const bytes=await boundedBytes(response,TUTOR_PROVIDER_LIMITS.audioBytes,'openai',requestSignal);
      if(!bytes.byteLength)throw new TutorProviderError('malformed');return {bytes,mime:'audio/mpeg'};
    });
  }
}

/** Resolves exactly the selected provider. Each call freezes its configuration; no fallback/retry. */
export class ConfiguredTutorProvider implements TutorProvider {
  private readonly adapters:Record<TutorProviderId,TutorProvider>;
  constructor(private readonly getConfig:(provider?:TutorProviderId)=>TutorProviderConfig,transport:typeof fetch=fetch,options:RequestOptions={}){
    this.adapters={gemini:new GeminiTutorProvider(()=>({...getConfig('gemini'),provider:'gemini'}),transport,options),openai:new OpenAITutorProvider(()=>({...getConfig('openai'),provider:'openai'}),transport,options)};
  }
  private selected():TutorProvider{return this.adapters[this.getConfig().provider??'openai'];}
  status():TutorProviderStatus{return this.selected().status();}
  statusFor(provider:TutorProviderId):TutorProviderStatus{return this.adapters[provider].status();}
  stream(input:TutorStreamInput,signal:AbortSignal,onDelta:(text:string)=>void|Promise<void>):Promise<TutorStreamResult>{return this.selected().stream(input,signal,onDelta);}
  transcribe(bytes:Uint8Array,mime:string,signal:AbortSignal):Promise<string>{return this.selected().transcribe(bytes,mime,signal);}
  speech(text:string,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:string}>{return this.selected().speech(text,signal);}
}
export { GeminiTutorProvider } from './tutor-gemini-provider';
