import type { TutorEvent, TutorSendInput, TutorTurn, TutorUsage } from '../../../packages/tutor/types';
import type { TutorProvider } from './tutor-provider';
import { TutorProviderError, tutorProviderError } from './tutor-provider';

export interface TutorServicePorts {
  call<T>(method:string,...args:unknown[]):Promise<T>;
  emit(event:TutorEvent):void;
}
interface ActiveRequest {turn:TutorTurn;fingerprint:string;controller:AbortController;task:Promise<void>}
/** Owns dispatch, not notebook writes. Every chunk is accepted by the single writer first. */
export class TutorService {
  private active:ActiveRequest|null=null;
  private preparing:{requestId:string;fingerprint:string;promise:Promise<{turnId:string;requestId:string}>}|null=null;
  private closed=false;
  constructor(private readonly ports:TutorServicePorts,private readonly provider:TutorProvider){}
  get activeRequestId():string|null{return this.active?.turn.requestId??this.preparing?.requestId??null;}
  send(input:TutorSendInput):Promise<{turnId:string;requestId:string}>{
    if(this.closed)return Promise.reject(new Error('Tutor has closed. Reopen the companion to continue.'));
    const fingerprint=JSON.stringify([input.turnId,input.requestId,input.conversationId,input.action,input.text,input.statementId,input.codeId,input.noteIds]);
    if(this.preparing?.requestId===input.requestId)return this.preparing.fingerprint===fingerprint?this.preparing.promise:Promise.reject(new Error('This request identifier already belongs to a different message.'));
    if(this.active?.turn.requestId===input.requestId)return this.active.fingerprint===fingerprint?Promise.resolve({turnId:this.active.turn.id,requestId:input.requestId}):Promise.reject(new Error('This request identifier already belongs to a different message.'));
    if(this.active||this.preparing)return Promise.reject(new TutorProviderError('busy'));
    if(!this.provider.status().configured)return Promise.reject(new TutorProviderError('setup'));
    const promise=this.prepare(input,fingerprint).finally(()=>{if(this.preparing?.requestId===input.requestId)this.preparing=null;});
    this.preparing={requestId:input.requestId,fingerprint,promise};return promise;
  }
  private async prepare(input:TutorSendInput,fingerprint:string):Promise<{turnId:string;requestId:string}>{
    // The writer verifies contest mode, canonical target, permissions and request identity.
    const turn=await this.ports.call<TutorTurn>('tutor-prepare',input,this.provider.status().model);
    const result={turnId:turn.id,requestId:turn.requestId};
    if(this.closed){await this.finalize(turn,'interrupted');return result;}
    if(turn.status==='completed'||turn.status==='failed'||turn.status==='interrupted')return result;
    const request:ActiveRequest={turn,fingerprint,controller:new AbortController(),task:Promise.resolve()};
    this.active=request;
    request.task=this.generate(request);
    return result;
  }
  private current(request:ActiveRequest):boolean{return this.active===request&&!request.controller.signal.aborted&&!this.closed;}
  private async generate(request:ActiveRequest):Promise<void>{
    try{
      const history=await this.ports.call<TutorTurn[]>('tutor-turns',request.turn.conversationId);
      if(!this.current(request))return;
      const result=await this.provider.stream({turn:request.turn,history},request.controller.signal,async text=>{
        if(!this.current(request))return;
        const accepted=await this.ports.call<TutorTurn|null>('tutor-append',{turnId:request.turn.id,requestId:request.turn.requestId,text});
        if(accepted&&this.current(request))this.emit(request.turn,'delta',text);
      });
      if(this.current(request))await this.finalize(request.turn,'completed',undefined,result.usage);
    }catch(error){
      if(this.current(request)){
        try{await this.finalize(request.turn,'failed',tutorProviderError(error));}catch{/* The queued/partial turn recovers as interrupted if storage is unavailable. */}
      }
    }finally{if(this.active===request)this.active=null;this.emit(request.turn,'updated');}
  }
  private emit(turn:TutorTurn,kind:TutorEvent['kind'],text?:string):void{
    try{this.ports.emit({kind,conversationId:turn.conversationId,turnId:turn.id,requestId:turn.requestId,...(text===undefined?{}:{text})});}catch{/* A closing renderer must not affect durable completion. */}
  }
  private async finalize(turn:TutorTurn,status:'completed'|'interrupted'|'failed',error?:string,usage?:TutorUsage|null):Promise<void>{
    await this.ports.call('tutor-finalize',{turnId:turn.id,requestId:turn.requestId,status,error,usage});
  }
  async stop(requestId:string):Promise<void>{
    if(this.preparing?.requestId===requestId)await this.preparing.promise;
    const request=this.active;
    if(!request||request.turn.requestId!==requestId)return;
    this.active=null;request.controller.abort();
    await this.finalize(request.turn,'interrupted');this.emit(request.turn,'updated');
  }
  async cancelAll():Promise<void>{
    if(this.preparing)await this.preparing.promise.catch(()=>{});
    if(this.active)await this.stop(this.active.turn.requestId);
  }
  async dispose():Promise<void>{this.closed=true;await this.cancelAll();}
  async whenIdle():Promise<void>{if(this.preparing)await this.preparing.promise.catch(()=>{});await this.active?.task;}
}
