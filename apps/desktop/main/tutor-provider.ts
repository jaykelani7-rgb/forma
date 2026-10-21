import type { TutorProviderStatus, TutorTurn, TutorUsage } from '../../../packages/tutor/types';
import { buildProviderMessages, policyInstructions } from '../../../packages/tutor/policy';
import { TUTOR_BUDGET } from '../../../packages/tutor/context';

export interface TutorProviderConfig { apiKey?:string; model:string; transcriptionModel:string; speechModel:string }
export interface TutorStreamInput {turn:TutorTurn;history:TutorTurn[];instructions?:string}
export interface TutorStreamResult {usage:TutorUsage|null;model:string}
export interface TutorProvider {
  status():TutorProviderStatus;
  stream(input:TutorStreamInput,signal:AbortSignal,onDelta:(text:string)=>void|Promise<void>):Promise<TutorStreamResult>;
  transcribe(bytes:Uint8Array,mime:string,signal:AbortSignal):Promise<string>;
  speech(text:string,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:string}>;
}
export type TutorProviderErrorCode='setup'|'authentication'|'rate-limit'|'timeout'|'aborted'|'network'|'malformed'|'refused'|'busy'|'too-large';
const ERROR_MESSAGES:Record<TutorProviderErrorCode,string>={
  setup:'Set up an OpenAI API key in Tutor settings to send a message.',
  authentication:'OpenAI rejected the configured credential. Check Tutor setup.',
  'rate-limit':'OpenAI is temporarily rate limited. Wait before explicitly trying again.',
  timeout:'The Tutor request timed out. Any partial answer has been retained.',
  aborted:'The Tutor request was stopped.',
  network:'OpenAI could not complete this request. Check your connection and try again.',
  malformed:'OpenAI returned an incomplete or unreadable response. Any partial answer has been retained.',
  refused:'OpenAI could not answer this request.',
  busy:'Tutor is already processing a request. Stop it or wait for it to finish.',
  'too-large':'This Tutor request exceeds the supported size. Include a smaller selection or recording.',
};
export class TutorProviderError extends Error {
  constructor(public readonly code:TutorProviderErrorCode){super(ERROR_MESSAGES[code]);this.name='TutorProviderError';}
}
/** Never surface transport messages: they can contain request bodies or credentials. */
export function tutorProviderError(error:unknown):string{return error instanceof TutorProviderError?error.message:ERROR_MESSAGES.network;}
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
function record(input:unknown):Record<string,unknown>{if(!input||typeof input!=='object'||Array.isArray(input))throw new TutorProviderError('malformed');return input as Record<string,unknown>;}

/** Host-only adapter. There is no caller-supplied URL, proxy, tool, or retry path. */
export class OpenAITutorProvider implements TutorProvider {
  private active=0;
  constructor(private readonly getConfig:()=>TutorProviderConfig,private readonly transport:typeof fetch=fetch,private readonly options:{timeoutMs?:number;maxConcurrent?:number}={}){}
  status():TutorProviderStatus {
    const c=this.getConfig();
    return {configured:!!c.apiKey?.trim(),model:c.model,transcriptionModel:c.transcriptionModel,speechModel:c.speechModel,message:c.apiKey?.trim()?'Selected context is sent to OpenAI. Conversations stay in the local notebook.':ERROR_MESSAGES.setup};
  }
  private async request<T>(signal:AbortSignal,run:(config:TutorProviderConfig,signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(signal.aborted)throw new TutorProviderError('aborted');
    const config=this.getConfig();
    if(!config.apiKey?.trim())throw new TutorProviderError('setup');
    if(this.active>=(this.options.maxConcurrent??2))throw new TutorProviderError('busy');
    this.active++;
    const controller=new AbortController();let timedOut=false;
    const interrupted=new Promise<never>((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(new TutorProviderError(timedOut?'timeout':'aborted')),{once:true}));
    const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.options.timeoutMs??TUTOR_PROVIDER_LIMITS.timeoutMs);
    try{return await Promise.race([run(config,controller.signal),interrupted]);}catch(error){
      if(timedOut)throw new TutorProviderError('timeout');
      if(signal.aborted)throw new TutorProviderError('aborted');
      if(error instanceof TutorProviderError)throw error;
      throw new TutorProviderError('network');
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);this.active--;}
  }
  private async post(path:'/responses'|'/audio/transcriptions'|'/audio/speech',config:TutorProviderConfig,signal:AbortSignal,body:BodyInit,json=true):Promise<Response>{
    const response=await this.transport(`${endpoint}${path}`,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey!.trim()}`,...(json?{'Content-Type':'application/json'}:{})},body,signal,redirect:'error'});
    if(!response.ok){
      await response.body?.cancel();
      throw new TutorProviderError(response.status===429?'rate-limit':response.status===401||response.status===403?'authentication':response.status===413?'too-large':'network');
    }
    return response;
  }
  async stream(input:TutorStreamInput,signal:AbortSignal,onDelta:(text:string)=>void|Promise<void>):Promise<TutorStreamResult>{
    let messages:ReturnType<typeof buildProviderMessages>;
    try{messages=buildProviderMessages(input.turn,input.history).filter(message=>message.role!=='system');}catch{throw new TutorProviderError('too-large');}
    const instructions=input.instructions??policyInstructions(input.turn.action,input.turn.hintLevel);
    if(messages.reduce((count,message)=>count+message.content.length,0)+instructions.length>TUTOR_PROVIDER_LIMITS.inputChars)throw new TutorProviderError('too-large');
    return this.request(signal,async(config,requestSignal)=>{
      const response=await this.post('/responses',config,requestSignal,JSON.stringify({model:config.model,instructions,input:messages,stream:true,store:false,max_output_tokens:3000}));
      if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw new TutorProviderError('malformed');
      const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});
      let pending='';let completed=false;let chars=0;let result:TutorStreamResult={usage:null,model:config.model};
      const frame=async(raw:string)=>{
        const data=raw.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
        if(!data||data==='[DONE]')return;
        let event:Record<string,unknown>;try{event=record(JSON.parse(data));}catch{throw new TutorProviderError('malformed');}
        if(event.type==='response.output_text.delta'){
          if(completed||typeof event.delta!=='string')throw new TutorProviderError('malformed');
          chars+=event.delta.length;if(chars>TUTOR_PROVIDER_LIMITS.responseChars)throw new TutorProviderError('too-large');
          if(requestSignal.aborted)throw new TutorProviderError('aborted');
          await onDelta(event.delta);
        }else if(event.type==='response.completed'){
          const r=record(event.response);if(r.status!=='completed')throw new TutorProviderError('malformed');
          completed=true;result={usage:usage(r.usage),model:typeof r.model==='string'&&r.model.length<=120?r.model:config.model};
        }else if(event.type==='response.refusal.delta'||event.type==='response.refusal.done')throw new TutorProviderError('refused');
        else if(event.type==='error'||event.type==='response.failed'||event.type==='response.incomplete')throw new TutorProviderError('malformed');
      };
      try{
        for(;;){
          const next=await reader.read();if(next.done)break;
          try{pending+=decoder.decode(next.value,{stream:true});}catch{throw new TutorProviderError('malformed');}pending=pending.replace(/\r\n/g,'\n');
          if(pending.length>TUTOR_PROVIDER_LIMITS.eventChars)throw new TutorProviderError('malformed');
          let boundary:number;
          while((boundary=pending.indexOf('\n\n'))>=0){const raw=pending.slice(0,boundary);pending=pending.slice(boundary+2);await frame(raw);}
        }
        try{pending+=decoder.decode();}catch{throw new TutorProviderError('malformed');}if(pending.trim())await frame(pending);
        if(requestSignal.aborted)throw new TutorProviderError('aborted');
        if(!completed||!chars)throw new TutorProviderError('malformed');
        return result;
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    });
  }
  async transcribe(bytes:Uint8Array,mime:string,signal:AbortSignal):Promise<string>{
    const types:Record<string,string>={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav'};
    const media=mime.split(';')[0].trim().toLowerCase();
    if(!types[media]||!bytes.byteLength||bytes.byteLength>TUTOR_PROVIDER_LIMITS.audioBytes)throw new TutorProviderError('too-large');
    return this.request(signal,async(config,requestSignal)=>{
      const form=new FormData();form.set('model',config.transcriptionModel);form.set('response_format','json');
      form.set('file',new Blob([Uint8Array.from(bytes).buffer],{type:media}),`recording.${types[media]}`);
      const response=await this.post('/audio/transcriptions',config,requestSignal,form,false);
      const payload=record(await this.boundedJson(response,128_000));
      if(typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>12_000)throw new TutorProviderError('malformed');
      return payload.text.trim();
    });
  }
  async speech(text:string,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:string}>{
    if(!text.trim()||text.length>TUTOR_PROVIDER_LIMITS.speechChars)throw new TutorProviderError('too-large');
    return this.request(signal,async(config,requestSignal)=>{
      const response=await this.post('/audio/speech',config,requestSignal,JSON.stringify({model:config.speechModel,voice:'coral',input:text,response_format:'mp3'}));
      if(!response.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg')){await response.body?.cancel();throw new TutorProviderError('malformed');}
      const bytes=await this.boundedBytes(response,TUTOR_PROVIDER_LIMITS.audioBytes);
      if(!bytes.byteLength)throw new TutorProviderError('malformed');return {bytes,mime:'audio/mpeg'};
    });
  }
  private async boundedJson(response:Response,max:number):Promise<unknown>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await this.boundedBytes(response,max)));}catch(error){if(error instanceof TutorProviderError)throw error;throw new TutorProviderError('malformed');}}
  private async boundedBytes(response:Response,max:number):Promise<Uint8Array>{
    if(!response.body)throw new TutorProviderError('malformed');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>max)throw new TutorProviderError('too-large');chunks.push(next.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}return output;
  }
}
