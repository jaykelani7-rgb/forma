import test from 'node:test';
import assert from 'node:assert/strict';
import { CompanionStore } from '../apps/desktop/main/store';
import { TutorService } from '../apps/desktop/main/tutor-service';
import type { TutorProvider } from '../apps/desktop/main/tutor-provider';
import type { TutorProviderId, TutorSendInput } from '../packages/tutor/types';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
  const store=new CompanionStore(':memory:');
  store.command({id:'switch-attach',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',title:'Watermelon'}});
  const conversation=store.tutor.open({});let selected:TutorProviderId='gemini',calls=0;
  let release:()=>void=()=>{},prepareRelease:()=>void=()=>{},heldPrepare=false;
  let late:(text:string)=>void|Promise<void>=()=>{},signal:AbortSignal|undefined;
  const provider:TutorProvider={
    status:()=>({provider:selected,name:selected==='gemini'?'Gemini':'OpenAI',configured:true,capabilities:{text:true,transcription:true,speech:true},model:`${selected}-requested`,transcriptionModel:'fixture-stt',speechModel:'fixture-tts',message:'Fixture only'}),
    async stream(_input,s,onDelta){calls++;signal=s;late=onDelta;await onDelta('Retained partial.');await new Promise<void>(resolve=>{release=resolve;});return {model:'actual-response-model',provider:selected,usage:{inputTokens:1,outputTokens:2,totalTokens:3}};},
    async transcribe(){throw new Error('No audio dispatch in this fixture');},async speech(){throw new Error('No audio dispatch in this fixture');},
  };
  const service=new TutorService({async call<T>(method:string,...args:unknown[]):Promise<T>{
    switch(method){
      case 'tutor-prepare':{
        const prepared=store.tutor.prepare(args[0],args[1],args[2]);
        if(heldPrepare)await new Promise<void>(resolve=>{prepareRelease=resolve;});
        return prepared as T;
      }
      case 'tutor-turns':return store.tutor.turns(args[0]) as T;
      case 'tutor-append':return store.tutor.append(args[0]) as T;
      case 'tutor-finalize':return store.tutor.finalize(args[0]) as T;
      default:throw new Error('Unexpected fixture operation');
    }
  },emit(){}},provider);
  const input:TutorSendInput={turnId:'switch-turn',requestId:'switch-request',conversationId:conversation.id,action:'discuss',text:'Discuss my approach.',statementId:null,codeId:null,noteIds:[]};
  return {store,service,input,turn:()=>store.tutor.turns(conversation.id)[0],switchProvider:()=>{selected='openai';},holdPrepare:()=>{heldPrepare=true;},releasePrepare:()=>prepareRelease(),release:()=>release(),late:(text:string)=>late(text),get calls(){return calls;},get signal(){return signal;}};
}

test('provider switch interrupts a partial response; replay and late callbacks cannot duplicate dispatch or overwrite provenance',async()=>{
  const f=fixture();try{
    await f.service.send(f.input);await tick();assert.equal(f.turn().assistantText,'Retained partial.');assert.equal(f.turn().provider,'gemini');
    await f.service.configure(f.switchProvider);assert.equal(f.signal?.aborted,true);assert.equal(f.turn().status,'interrupted');
    await f.late('Late old-provider answer');f.release();await tick();
    assert.equal(f.turn().assistantText,'Retained partial.');assert.equal(f.turn().model,'gemini-requested');
    await f.service.send(f.input);assert.equal(f.calls,1);
    await f.service.send({...f.input,requestId:'explicit-openai-retry'});await tick();
    assert.equal(f.calls,2);assert.equal(f.turn().provider,'openai');assert.equal(f.turn().model,'openai-requested');
    f.release();await f.service.whenIdle();assert.equal(f.turn().status,'completed');assert.equal(f.turn().responseModel,'actual-response-model');
    const archived=JSON.parse(f.store.tutor.export(f.input.conversationId)).conversations[0].previousRequests[0];assert.equal(archived.provider,'gemini');assert.equal(archived.assistantText,'Retained partial.');
  }finally{await f.service.dispose();f.store.close();}
});

test('configuration gate blocks new sends while a request is preparing and cancels it before changing providers',async()=>{
  const f=fixture();try{
    f.holdPrepare();const preparing=f.service.send(f.input);const changing=f.service.configure(f.switchProvider);
    assert.equal(f.service.isConfiguring,true);
    await assert.rejects(f.service.send({...f.input,turnId:'second-turn',requestId:'second-request'}),/already processing/);
    await assert.rejects(f.service.configure(()=>{}),/already processing/);
    f.releasePrepare();await preparing;await changing;await tick();
    assert.equal(f.turn().status,'interrupted');assert.equal(f.turn().provider,'gemini');assert.equal(f.service.isConfiguring,false);
    const dispatched=f.calls;await f.late('Late preparation callback');f.release();await tick();assert.equal(f.calls,dispatched);assert.equal(f.turn().status,'interrupted');
  }finally{await f.service.dispose();f.store.close();}
});

test('configuration failure releases the send gate without losing the original question or partial response',async()=>{
  const f=fixture();try{
    await f.service.send(f.input);await tick();
    await assert.rejects(f.service.configure(()=>{throw new Error('Local setup failed.');}),/setup failed/);
    assert.equal(f.service.isConfiguring,false);assert.equal(f.turn().userText,f.input.text);assert.equal(f.turn().assistantText,'Retained partial.');assert.equal(f.turn().status,'interrupted');
    f.release();await tick();assert.equal(f.calls,1);
  }finally{await f.service.dispose();f.store.close();}
});
