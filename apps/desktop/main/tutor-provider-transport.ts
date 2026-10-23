import type { TutorProviderId } from '../../../packages/tutor/types';
import { TutorProviderError, classifyProviderError } from './tutor-provider-errors';
export interface RequestOptions {timeoutMs?:number;maxConcurrent?:number}
/** One dispatch only. Cancellation interrupts even an unresponsive injected reader and suppresses late frames. */
export class TutorRequests {
  private active=0;
  constructor(private readonly provider:TutorProviderId,private readonly options:RequestOptions={}){}
  async run<T>(signal:AbortSignal,hasKey:boolean,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(signal.aborted)throw new TutorProviderError('aborted',this.provider);
    if(!hasKey)throw new TutorProviderError('setup',this.provider);
    if(this.active>=(this.options.maxConcurrent??2))throw new TutorProviderError('busy',this.provider);
    this.active++;
    const controller=new AbortController();let timedOut=false;
    const interrupted=new Promise<never>((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(new TutorProviderError(timedOut?'timeout':'aborted',this.provider)),{once:true}));
    const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.options.timeoutMs??120_000);
    try{return await Promise.race([run(controller.signal),interrupted]);}
    catch(error){if(timedOut)throw new TutorProviderError('timeout',this.provider);if(signal.aborted)throw new TutorProviderError('aborted',this.provider);if(error instanceof TutorProviderError)throw error;throw new TutorProviderError('network',this.provider);}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);this.active--;}
  }
}
export function record(input:unknown,provider:TutorProviderId):Record<string,unknown>{if(!input||typeof input!=='object'||Array.isArray(input))throw new TutorProviderError('malformed',provider);return input as Record<string,unknown>;}
export async function boundedBytes(response:Response,max:number,provider:TutorProviderId,signal?:AbortSignal):Promise<Uint8Array>{
  if(!response.body)throw new TutorProviderError('malformed',provider);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{for(;;){if(signal?.aborted)throw new TutorProviderError('aborted',provider);const next=await reader.read();if(signal?.aborted)throw new TutorProviderError('aborted',provider);if(next.done)break;size+=next.value.byteLength;if(size>max)throw new TutorProviderError('too-large',provider);chunks.push(next.value);}}
  finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
  const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}return output;
}
export async function boundedJson(response:Response,max:number,provider:TutorProviderId,signal?:AbortSignal):Promise<unknown>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(response,max,provider,signal)));}catch(error){if(error instanceof TutorProviderError)throw error;throw new TutorProviderError('malformed',provider);}}
export async function checkResponse(response:Response,provider:TutorProviderId,signal:AbortSignal):Promise<Response>{
  if(response.ok)return response;
  let payload:unknown;try{payload=await boundedJson(response,32768,provider,signal);}catch{if(signal.aborted)throw new TutorProviderError('aborted',provider);}
  throw classifyProviderError(provider,response.status,payload);
}
export async function consumeSse(response:Response,signal:AbortSignal,provider:TutorProviderId,maxFrame:number,onFrame:(data:unknown)=>Promise<void>):Promise<void>{
  if(!response.body||!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')){await response.body?.cancel();throw new TutorProviderError('malformed',provider);}
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let pending='';let frameCount=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  const frame=async(raw:string)=>{
    if(signal.aborted)throw new TutorProviderError('aborted',provider);
    if(raw.length>maxFrame||++frameCount>4096)throw new TutorProviderError('malformed',provider);
    const data=raw.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    if(!data||data==='[DONE]')return;
    let value:unknown;try{value=JSON.parse(data);}catch{throw new TutorProviderError('malformed',provider);}
    await onFrame(value);
  };
  try{
    for(;;){
      if(signal.aborted)throw new TutorProviderError('aborted',provider);
      const next=await reader.read();if(signal.aborted)throw new TutorProviderError('aborted',provider);if(next.done)break;
      try{pending+=decoder.decode(next.value,{stream:true});}catch{throw new TutorProviderError('malformed',provider);}
      // CRLF can be split between chunks. Do not normalize a trailing CR until the next chunk.
      pending=pending.replace(/\r\n/g,'\n');
      let boundary:number;while((boundary=pending.indexOf('\n\n'))>=0){const raw=pending.slice(0,boundary);pending=pending.slice(boundary+2);await frame(raw);}
      if(pending.length>maxFrame)throw new TutorProviderError('malformed',provider);
    }
    try{pending+=decoder.decode();}catch{throw new TutorProviderError('malformed',provider);}
    if(pending.trim())await frame(pending);
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
