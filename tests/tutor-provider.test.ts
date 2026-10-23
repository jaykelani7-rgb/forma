import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAITutorProvider, TutorProviderError, tutorProviderError, speechReadyText, type TutorProvider } from '../apps/desktop/main/tutor-provider';
import { TutorService } from '../apps/desktop/main/tutor-service';
import type { TutorEvent, TutorSendInput, TutorTurn } from '../packages/tutor/types';

const config={apiKey:'mock-secret-never-sent-to-renderer',model:'mock-text',transcriptionModel:'mock-transcribe',speechModel:'mock-speech'};
function turn():TutorTurn{return {id:'turn-one',requestId:'request-one',conversationId:'conversation-one',action:'small-hint',userText:'What should I notice?',assistantText:'',context:{version:1,identity:'contest:4:A',problemId:'problem-one',title:'Parity fixture',url:'https://codeforces.com/problemset/problem/4/A',workspaceId:'workspace-one',conversationId:'conversation-one',sessionId:'session-one',statement:null,code:{id:'code-one',identity:'contest:4:A',workspaceId:'workspace-one',clientId:'client-one',fileUri:'file:///Users/private/secret.cpp',filename:'secret.cpp',language:'cpp',startLine:3,endLine:3,text:'int x = 2;',revision:'code-revision',capturedAt:'2026-10-20T00:00:00.000Z'},notes:[],evidence:{platform:'unknown',checkedAt:null,localTests:'unknown',submissions:[]},frozenAt:'2026-10-20T00:00:00.000Z'},status:'queued',createdAt:'2026-10-20T00:00:00.000Z',completedAt:null,error:null,hintLevel:1,exposed:false,usage:null,model:'mock-text'};}
const delta=(text:string)=>`data: ${JSON.stringify({type:'response.output_text.delta',delta:text})}\n\n`;
const complete=()=>`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',model:'actual-model',usage:{input_tokens:20,output_tokens:10,total_tokens:30}}})}\n\n`;
function streamResponse(text:string,bytewise=false):Response{
  const bytes=new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller){if(bytewise)for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));else controller.enqueue(bytes);controller.close();}}),{headers:{'content-type':'text/event-stream'}});
}
const input=()=>({turn:turn(),history:[]});

test('mock provider: chunked UTF-8/CRLF SSE preserves text, actual usage and restricted request',async()=>{
  let request:RequestInit|undefined;let url='';
  const provider=new OpenAITutorProvider(()=>config,async(target,init)=>{url=String(target);request=init;return streamResponse((delta('Try café 🙂.')+complete()).replace(/\n/g,'\r\n'),true);});
  let text='';const result=await provider.stream(input(),new AbortController().signal,chunk=>{text+=chunk;});
  assert.equal(text,'Try café 🙂.');assert.equal(result.model,'actual-model');assert.deepEqual(result.usage,{inputTokens:20,outputTokens:10,totalTokens:30});
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(request?.redirect,'error');
  const body=JSON.parse(String(request?.body));assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.model,'mock-text');assert.equal('tools' in body,false);
  assert.match(body.instructions,/untrusted/);assert.doesNotMatch(String(request?.body),/Users\/private|file:\/\/|mock-secret/);
});
test('mock provider: rate limit is sanitized and never automatically retried',async()=>{
  let calls=0;const provider=new OpenAITutorProvider(()=>config,async()=>{calls++;return new Response(config.apiKey,{status:429});});
  await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),(error:unknown)=>error instanceof TutorProviderError&&error.code==='rate-limit'&&!error.message.includes(config.apiKey));assert.equal(calls,1);
  assert.doesNotMatch(tutorProviderError(new Error(config.apiKey)),/mock-secret/);
});
test('mock provider: partial output is retained by caller but missing completion fails',async()=>{
  const provider=new OpenAITutorProvider(()=>config,async()=>streamResponse(delta('Partial answer')));let partial='';
  await assert.rejects(provider.stream(input(),new AbortController().signal,text=>{partial+=text;}),/incomplete or unreadable/);assert.equal(partial,'Partial answer');
});
test('mock provider: malformed SSE and invalid completion do not become a successful answer',async()=>{
  for(const text of ['data: {broken}\n\n',delta('partial')+'data: {"type":"response.completed","response":{"status":"incomplete"}}\n\n']){
    const provider=new OpenAITutorProvider(()=>config,async()=>streamResponse(text));await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),/incomplete or unreadable/);
  }
});
test('mock provider: cancellation reaches transport and late text never reaches caller',async()=>{
  let signal:AbortSignal|undefined;
  const provider=new OpenAITutorProvider(()=>config,async(_url,init)=>{signal=init?.signal as AbortSignal;return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error(config.apiKey)),{once:true}));});
  const controller=new AbortController();const pending=provider.stream(input(),controller.signal,()=>assert.fail('Unexpected text'));controller.abort();
  await assert.rejects(pending,/stopped/);assert.equal(signal?.aborted,true);
});
test('mock provider: request timeout aborts network and returns a safe explicit timeout',async()=>{
  const provider=new OpenAITutorProvider(()=>config,async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('raw body and secret')),{once:true})),{timeoutMs:5});
  await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),/timed out/);
});
test('mock provider: no key and oversized audio never dispatch; transcription uses bounded multipart',async()=>{
  let calls=0;const missing=new OpenAITutorProvider(()=>({...config,apiKey:undefined}),async()=>{calls++;throw new Error('Should not dispatch');});
  await assert.rejects(missing.stream(input(),new AbortController().signal,()=>{}),/Set up/);assert.equal(calls,0);
  const provider=new OpenAITutorProvider(()=>config,async(url,init)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/audio/transcriptions');assert.ok(init?.body instanceof FormData);assert.equal(init.body.get('model'),'mock-transcribe');return Response.json({text:'  Can you clarify this idea?  '});});
  await assert.rejects(provider.transcribe(new Uint8Array(13*1024*1024),'audio/webm',new AbortController().signal),/exceeds/);assert.equal(calls,0);
  assert.equal(await provider.transcribe(new Uint8Array([1,2,3]),'audio/webm;codecs=opus',new AbortController().signal),'Can you clarify this idea?');assert.equal(calls,1);
});
test('mock provider: optional speech uses configured model and fixed voice with bounded output',async()=>{
  const provider=new OpenAITutorProvider(()=>config,async(url,init)=>{assert.equal(String(url),'https://api.openai.com/v1/audio/speech');const body=JSON.parse(String(init?.body));assert.equal(body.model,'mock-speech');assert.equal(body.voice,'coral');return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/mpeg'}});});
  const output=await provider.speech('Consider parity.',new AbortController().signal);assert.equal(output.mime,'audio/mpeg');assert.deepEqual([...output.bytes],[1,2,3]);
});
test('mock provider: concurrency is bounded and timeout also interrupts an unresponsive injected stream',async()=>{
  const provider=new OpenAITutorProvider(()=>config,async()=>new Response(new ReadableStream({start(){/* Deliberately never responds. */}}),{headers:{'content-type':'text/event-stream'}}),{timeoutMs:10,maxConcurrent:1});
  const pending=provider.stream(input(),new AbortController().signal,()=>{});
  await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),/already processing/);
  await assert.rejects(pending,/timed out/);
});
test('mock provider: oversized context, malformed UTF-8 and non-audio speech are rejected honestly',async()=>{
  let calls=0;const provider=new OpenAITutorProvider(()=>config,async()=>{calls++;return new Response(new Uint8Array([0xff]),{headers:{'content-type':'text/event-stream'}});});
  const oversized=input();oversized.turn.userText='x'.repeat(80_000);await assert.rejects(provider.stream(oversized,new AbortController().signal,()=>{}),/exceeds/);assert.equal(calls,0);
  await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),/incomplete or unreadable/);
  const speechProvider=new OpenAITutorProvider(()=>config,async()=>Response.json({error:config.apiKey}));await assert.rejects(speechProvider.speech('Hello',new AbortController().signal),/incomplete or unreadable/);
});
test('mock provider: valid large selected context uses the same total character budget as the domain',async()=>{
  const current=turn();current.userText='Q'.repeat(1000);current.context.code!.text='x'.repeat(22_000);
  current.context.statement={id:'statement-large',revision:'revision-large',identity:current.context.identity,url:current.context.url,title:current.context.title,description:'A'.repeat(38_000),input:'Input requirements.',output:'Output requirements.',constraints:'Fixture constraints.',samples:[],explanation:'',complete:true,source:'manual',capturedAt:current.createdAt};
  const previous={...turn(),id:'previous-turn',requestId:'previous-request',userText:'B'.repeat(1000),assistantText:'C'.repeat(12_000),status:'completed' as const};let size=0;
  const provider=new OpenAITutorProvider(()=>config,async(_url,request)=>{size=String(request?.body).length;return streamResponse(delta('A bounded answer.')+complete());});
  await provider.stream({turn:current,history:[previous]},new AbortController().signal,()=>{});assert.ok(size>64_000);assert.ok(size<95_000);
});
test('speech formatting: code, long formulas and links stay readable in text and spoken output is bounded',()=>{
  const original='## Reasoning\nUse `count` for the total.\n```cpp\nfor(int i=0;i<n;i++){count+=a[i]>0;}\n```\nThe invariant is $$c=\\sum_{i=0}^{n-1} [a_i>0]$$. Read [the example](https://example.com/private).';
  const spoken=speechReadyText(original);assert.match(spoken,/Use count/);assert.match(spoken,/code example is available/);assert.match(spoken,/formula is available/);assert.doesNotMatch(spoken,/for\(int|\\sum|https:|```/);assert.match(original,/for\(int/);
  assert.ok(speechReadyText('Explanation. '.repeat(1000)).length<=6000);
});

function harness(){
  const saved=turn();const events:TutorEvent[]=[];let calls=0;let release:()=>void=()=>{};let signal:AbortSignal|undefined;let late:(text:string)=>void|Promise<void>=()=>{};
  const provider:TutorProvider={status:()=>({provider:'openai',name:'OpenAI',capabilities:{text:true,transcription:true,speech:true},configured:true,model:'mock-text',transcriptionModel:'mock-transcribe',speechModel:'mock-speech',message:'Mock'}),async stream(_input,s,onDelta){calls++;signal=s;late=onDelta;await onDelta('First hint.');await new Promise<void>(resolve=>{release=resolve;});return {model:'mock-text',usage:{inputTokens:1,outputTokens:2,totalTokens:3}};},async transcribe(){return 'mock';},async speech(){return {bytes:new Uint8Array(),mime:'audio/mpeg'};}};
  const ports={async call<T>(method:string,...args:unknown[]):Promise<T>{
    if(method==='tutor-prepare')return structuredClone(saved) as T;
    if(method==='tutor-turns')return [structuredClone(saved)] as T;
    const value=args[0] as {turnId:string;requestId:string;text:string;status:TutorTurn['status'];error?:string;usage?:TutorTurn['usage']};
    if(value.requestId!==saved.requestId||saved.status==='interrupted'||saved.status==='completed'||saved.status==='failed')return null as T;
    if(method==='tutor-append'){saved.status='streaming';saved.assistantText+=value.text;saved.exposed=true;return structuredClone(saved) as T;}
    if(method==='tutor-finalize'){saved.status=value.status;saved.error=value.error??null;saved.usage=value.usage??null;return structuredClone(saved) as T;}
    throw new Error('Unexpected worker method');
  },emit(event:TutorEvent){events.push(event);}};
  return {service:new TutorService(ports,provider),saved,events,get calls(){return calls;},release:()=>release(),late:(text:string)=>late(text),get signal(){return signal;}};
}
const sendInput:TutorSendInput={turnId:'turn-one',requestId:'request-one',conversationId:'conversation-one',action:'small-hint',text:'What should I notice?',statementId:null,codeId:'code-one',noteIds:[]};
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('mock service: turn is durable before dispatch, repeated acknowledgement cannot duplicate generation',async()=>{
  const h=harness();const first=h.service.send(sendInput);const second=h.service.send(sendInput);assert.deepEqual(await first,await second);await tick();
  assert.equal(h.calls,1);assert.equal(h.saved.assistantText,'First hint.');h.release();await h.service.whenIdle();assert.equal(h.saved.status,'completed');assert.equal(h.saved.usage?.totalTokens,3);
  await h.service.send(sendInput);assert.equal(h.calls,1);
});
test('mock service: Stop preserves partial answer, aborts request, and discards late chunks',async()=>{
  const h=harness();await h.service.send(sendInput);await tick();await h.service.stop('request-one');assert.equal(h.signal?.aborted,true);assert.equal(h.saved.status,'interrupted');
  await h.late('unwanted late text');h.release();await tick();assert.equal(h.saved.assistantText,'First hint.');assert.equal(h.events.filter(event=>event.kind==='delta').length,1);assert.equal(h.service.activeRequestId,null);
});
test('mock service: unrelated request is rejected while one stream is active',async()=>{
  const h=harness();await h.service.send(sendInput);await assert.rejects(h.service.send({...sendInput,requestId:'request-two'}),/already processing/);await assert.rejects(h.service.send({...sendInput,text:'Different message under the same ID'}),/different message/);await h.service.cancelAll();h.release();
});

test('OpenAI whitespace-only completion is typed as malformed without losing the caller partial buffer',async()=>{
 const provider=new OpenAITutorProvider(()=>config,async()=>streamResponse(delta(' \n ')+complete()));let partial='';
 await assert.rejects(provider.stream(input(),new AbortController().signal,text=>{partial+=text;}),(error:unknown)=>error instanceof TutorProviderError&&error.code==='malformed');assert.equal(partial,' \n ');
});
