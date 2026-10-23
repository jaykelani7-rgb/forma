import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiTutorProvider, ConfiguredTutorProvider, TutorProviderError, classifyProviderError, tutorProviderError, TUTOR_PROVIDER_LIMITS } from '../apps/desktop/main/tutor-provider';
import { pcmToWav } from '../apps/desktop/main/tutor-gemini-provider';
import type { TutorTurn } from '../packages/tutor/types';
const config={provider:'gemini' as const,apiKey:'fixture-secret-not-real',model:'gemini-3.8-flash',transcriptionModel:'gemini-3.8-flash',speechModel:'gemini-3.8-flash-tts'};
function turn():TutorTurn{return {id:'fixture-turn',requestId:'fixture-request',conversationId:'fixture-conversation',action:'small-hint',userText:'One observation?',assistantText:'',context:{version:1,identity:'contest:4:A',problemId:'fixture-problem',title:'Fixture',url:'https://codeforces.com/problemset/problem/4/A',workspaceId:'private-workspace',conversationId:'fixture-conversation',sessionId:null,statement:null,code:{id:'private-code',identity:'contest:4:A',workspaceId:'private-workspace',clientId:'private-client',fileUri:'file:///Users/private/code.cpp',filename:'code.cpp',language:'cpp',startLine:1,endLine:1,text:'int answer=2;',revision:'fixture-revision',capturedAt:'2026-10-21T00:00:00.000Z'},notes:[],evidence:{platform:'unknown',checkedAt:null,localTests:'unknown',submissions:[]},frozenAt:'2026-10-21T00:00:00.000Z'},status:'queued',createdAt:'2026-10-21T00:00:00.000Z',completedAt:null,error:null,hintLevel:1,exposed:false,usage:null,model:config.model,provider:'gemini'};}
const input=()=>({turn:turn(),history:[]});
const frame=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
const delta=(text:string)=>frame({candidates:[{index:0,content:{role:'model',parts:[{text}]}}]});
const complete=()=>frame({candidates:[{index:0,finishReason:'STOP'}],modelVersion:'gemini-3.8-flash-version',usageMetadata:{promptTokenCount:40,candidatesTokenCount:10,totalTokenCount:55,thoughtsTokenCount:5}});
function sse(value:string,bytewise=false):Response {const bytes=new TextEncoder().encode(value);return new Response(new ReadableStream({start(controller){if(bytewise)for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));else controller.enqueue(bytes);controller.close();}}),{headers:{'content-type':'text/event-stream'}});}
const errorCode=(code:string)=>(error:unknown)=>error instanceof TutorProviderError&&error.code===code&&!error.message.includes(config.apiKey);
const interaction=(content:unknown[])=>({status:'completed',steps:[{type:'model_output',content}]});

test('Gemini REST streams bytewise UTF-8/CRLF, maps roles and actual usage, excludes local identifiers and tools',async()=>{
  let url='',request:RequestInit|undefined;
  const provider=new GeminiTutorProvider(()=>config,async(target,init)=>{url=String(target);request=init;return sse((frame({candidates:[{content:{parts:[{text:'private thought',thought:true}]}}]})+delta('Observe café 🙂.')+complete()).replace(/\n/g,'\r\n'),true);});
  let answer='';const result=await provider.stream(input(),new AbortController().signal,text=>{answer+=text;});
  assert.equal(answer,'Observe café 🙂.');assert.equal(result.provider,'gemini');assert.equal(result.model,'gemini-3.8-flash-version');assert.deepEqual(result.usage,{inputTokens:40,outputTokens:10,totalTokens:55});
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');assert.equal(request?.redirect,'error');assert.equal((request?.headers as Record<string,string>)['x-goog-api-key'],config.apiKey);
  const body=JSON.parse(String(request?.body));assert.equal(body.contents[0].role,'user');assert.match(body.systemInstruction.parts[0].text,/untrusted/);assert.equal('tools' in body,false);assert.equal(body.generationConfig.candidateCount,1);assert.equal(body.store,false);assert.doesNotMatch(String(request?.body),/Users\/private|file:\/\/|private-client|private-workspace|fixture-secret/);
});
test('Gemini preserves partial text but requires a final STOP and rejects refusal, malformed, empty, or truncated completions',async()=>{
  const cases:[string,string][]=[
    [delta('Partial answer'),'malformed'],[delta('Partial answer')+frame({candidates:[{finishReason:'MAX_TOKENS'}]}),'malformed'],
    [delta('Partial answer')+frame({candidates:[{finishReason:'SAFETY'}]}),'refused'],[frame({promptFeedback:{blockReason:'PROHIBITED_CONTENT'}}),'refused'],
    ['data: {invalid}\n\n','malformed'],[complete(),'malformed'],[delta('Partial answer')+frame({candidates:[{content:{parts:[{functionCall:{name:'unrequested'}}]}}]}),'malformed'],
  ];
  for(const [response,code] of cases){let answer='';const provider=new GeminiTutorProvider(()=>config,async()=>sse(response));await assert.rejects(provider.stream(input(),new AbortController().signal,text=>{answer+=text;}),errorCode(code));assert.equal(answer,response.startsWith(delta('Partial answer'))?'Partial answer':'');}
});
test('Gemini cancellation interrupts a stuck reader, cancels transport, and ignores late frames',async()=>{
  let signal:AbortSignal|undefined,readerCancelled=false;let streamController:ReadableStreamDefaultController<Uint8Array>|undefined;
  const provider=new GeminiTutorProvider(()=>config,async(_url,init)=>{signal=init?.signal as AbortSignal;return new Response(new ReadableStream({start(controller){streamController=controller;controller.enqueue(new TextEncoder().encode(delta('First.')));},cancel(){readerCancelled=true;}}),{headers:{'content-type':'text/event-stream'}});});
  const controller=new AbortController();let answer='';const pending=provider.stream(input(),controller.signal,text=>{answer+=text;});await new Promise<void>(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,errorCode('aborted'));assert.equal(signal?.aborted,true);assert.equal(readerCancelled,true);assert.equal(answer,'First.');assert.throws(()=>streamController!.enqueue(new TextEncoder().encode(delta('Late'))));
});
test('Gemini timeout cancels a stalled HTTP body and never retries',async()=>{
  let calls=0,cancelled=false;
  const provider=new GeminiTutorProvider(()=>config,async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});},{timeoutMs:5});
  await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),errorCode('timeout'));assert.equal(calls,1);assert.equal(cancelled,true);
});
test('Gemini bounds streams, rejects malformed UTF-8, and classifies structured errors during a successful HTTP stream',async()=>{
  for(const response of [new Response(new Uint8Array([0xff]),{headers:{'content-type':'text/event-stream'}}),sse(delta('x'.repeat(TUTOR_PROVIDER_LIMITS.responseChars+1)))]){
    const provider=new GeminiTutorProvider(()=>config,async()=>response);await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),error=>error instanceof TutorProviderError&&['malformed','too-large'].includes(error.code));
  }
  const provider=new GeminiTutorProvider(()=>config,async()=>sse(delta('Partial')+frame({error:{code:429,status:'RESOURCE_EXHAUSTED',message:config.apiKey}})));let partial='';
  await assert.rejects(provider.stream(input(),new AbortController().signal,text=>{partial+=text;}),errorCode('rate-limit'));assert.equal(partial,'Partial');
});

test('shared provider errors use structured reason/status without treating all 400 as model or all 403 as key errors',()=>{
 const cases:[number,unknown,string][]=[
  [400,{error:{status:'INVALID_ARGUMENT'}},'configuration'],[200,{error:{code:429}},'rate-limit'],[200,{error:{code:503}},'service'],[404,{},'model-capability'],[403,{},'permission'],[401,{},'authentication'],[429,{},'rate-limit'],[500,{},'service'],[503,{},'service'],[408,{},'timeout'],
  [400,{error:{details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'API_KEY_INVALID'}]}},'authentication'],
  [400,{error:{status:'FAILED_PRECONDITION'}},'configuration'],[403,{error:{code:'misalignment_policy_violation'}},'refused'],
  [400,{error:{code:'model_not_found'}},'model-capability'],[401,{error:{code:'ip_not_authorized'}},'permission'],[200,{error:{code:'content_blocked'}},'refused'],
 ];
 for(const provider of ['gemini','openai'] as const)for(const [status,payload,expected] of cases){const error=classifyProviderError(provider,status,payload);assert.equal(error.code,expected);assert.equal(error.provider,provider);assert.doesNotMatch(error.message,/INVALID_ARGUMENT|API_KEY_INVALID/);}
 assert.doesNotMatch(tutorProviderError(new Error(config.apiKey)),/fixture-secret/);
});
test('Gemini HTTP 400/403/404 guidance is safe, actionable, and dispatches once',async()=>{
 for(const [status,code] of [[400,'configuration'],[403,'permission'],[404,'model-capability']] as const){let calls=0;const provider=new GeminiTutorProvider(()=>config,async()=>{calls++;return Response.json({error:{message:config.apiKey}},{status});});await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),errorCode(code));assert.equal(calls,1);}
});
test('Gemini recorded transcription uses documented inline audio and returns text only to an editable caller',async()=>{
 let calls=0;
 const provider=new GeminiTutorProvider(()=>config,async(url,init)=>{calls++;assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/interactions');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.model,config.transcriptionModel);assert.equal(body.input[1].mime_type,'audio/webm');assert.equal(body.input[1].data,'AQID');assert.match(body.input[0].text,/Do not answer/);assert.equal('tools' in body,false);return Response.json(interaction([{type:'text',text:'  Explain the invariant.  '}]));});
 assert.equal(await provider.transcribe(new Uint8Array([1,2,3]),'audio/webm;codecs=opus',new AbortController().signal),'Explain the invariant.');assert.equal(calls,1);
 await assert.rejects(provider.transcribe(new Uint8Array(),'audio/webm',new AbortController().signal),errorCode('malformed'));
 await assert.rejects(provider.transcribe(new Uint8Array([1]),'video/unknown',new AbortController().signal),errorCode('configuration'));assert.equal(calls,1);
});
test('Gemini empty, oversize, unsupported and failed audio never become successful transcripts',async()=>{
 for(const payload of [interaction([]),interaction([{type:'text',text:' '}]),interaction([{type:'audio',data:'AQID'}]),{status:'failed',error:{code:'safety'}}]){
 const provider=new GeminiTutorProvider(()=>config,async()=>Response.json(payload));await assert.rejects(provider.transcribe(new Uint8Array([1,2]),'audio/ogg',new AbortController().signal),error=>error instanceof TutorProviderError&&['malformed','refused'].includes(error.code));}
 let calls=0;const provider=new GeminiTutorProvider(()=>({...config,transcriptionModel:'unsupported-model'}),async()=>{calls++;throw new Error('must not dispatch');});assert.equal(provider.status().capabilities.transcription,false);await assert.rejects(provider.transcribe(new Uint8Array([1,2]),'audio/webm',new AbortController().signal),errorCode('model-capability'));assert.equal(calls,0);
});
test('Gemini TTS uses documented Interactions WAV schema, verifies audio, and preserves existing RIFF header',async()=>{
 const wav=pcmToWav(new Uint8Array([0,0,255,127]));
 const provider=new GeminiTutorProvider(()=>config,async(url,init)=>{assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/interactions');const body=JSON.parse(String(init?.body));assert.equal(body.model,config.speechModel);assert.equal(body.store,false);assert.equal(body.input[0].content[0].text,'A calm explanation.');assert.equal(body.generation_config.speech_config[0].voice,'Kore');assert.deepEqual(body.response_format,{type:'audio',mime_type:'audio/wav',sample_rate:24000});return Response.json(interaction([{type:'audio',mime_type:'audio/wav',data:Buffer.from(wav).toString('base64')}]));});
 const output=await provider.speech('A calm explanation.',new AbortController().signal);assert.equal(output.mime,'audio/wav');assert.deepEqual(output.bytes,wav);assert.equal(output.bytes.length,48);
});
test('Gemini raw PCM is wrapped at the documented rate and invalid audio is rejected',async()=>{
 const provider=new GeminiTutorProvider(()=>config,async()=>Response.json(interaction([{type:'audio',mime_type:'audio/l16',data:'AAD/fw=='}])));
 const output=await provider.speech('Observation.',new AbortController().signal);const view=new DataView(output.bytes.buffer);assert.equal(new TextDecoder().decode(output.bytes.slice(0,4)),'RIFF');assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint16(34,true),16);
 for(const audio of [{mime_type:'audio/wav',data:'AQID'},{mime_type:'audio/l16',data:'AQ=='},{mime_type:'audio/mpeg',data:'AQID'},{mime_type:'audio/l16',data:'not-base64!'},{mime_type:'audio/l16;rate=99999',data:'AAA='}]){const malformed=new GeminiTutorProvider(()=>config,async()=>Response.json(interaction([{type:'audio',...audio}])));await assert.rejects(malformed.speech('Observation.',new AbortController().signal),errorCode('malformed'));}
});
test('Gemini transcription and speech cancellation suppress late completions and release stalled bodies',async()=>{
 for(const capability of ['transcribe','speech'] as const){let cancel=false;const provider=new GeminiTutorProvider(()=>config,async()=>new Response(new ReadableStream({cancel(){cancel=true;}}),{headers:{'content-type':'application/json'}}));const controller=new AbortController();const pending=capability==='speech'?provider.speech('Fixture.',controller.signal):provider.transcribe(new Uint8Array([1,2]),'audio/webm',controller.signal);await new Promise<void>(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,errorCode('aborted'));assert.equal(cancel,true);}
});
test('selected adapter has no silent fallback, freezes the model, and publishes capability/setup state without keys',async()=>{
 let selected:'gemini'|'openai'='gemini',calls=0;const requests:string[]=[];
 const provider=new ConfiguredTutorProvider(id=>({...config,provider:id??selected,...((id??selected)==='openai'?{model:'openai-model',transcriptionModel:'openai-stt',speechModel:'openai-tts'}:{})}),async url=>{calls++;requests.push(String(url));return Response.json({error:{message:'fixture-secret-not-real'}},{status:403});});
 await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),errorCode('permission'));assert.equal(calls,1);assert.match(requests[0],/generativelanguage/);
 selected='openai';assert.equal(provider.status().provider,'openai');assert.equal(provider.statusFor('gemini').model,config.model);assert.doesNotMatch(JSON.stringify(provider.status()),/fixture-secret/);
 const missing=new GeminiTutorProvider(()=>({...config,apiKey:undefined}),async()=>assert.fail('Missing key must not dispatch'));assert.equal(missing.status().configured,false);await assert.rejects(missing.stream(input(),new AbortController().signal,()=>{}),errorCode('setup'));
 const unsupported=new GeminiTutorProvider(()=>({...config,speechModel:'gemini-3.8-flash'}),async()=>assert.fail('Unsupported speech must not dispatch'));assert.equal(unsupported.status().capabilities.speech,false);await assert.rejects(unsupported.speech('Hello',new AbortController().signal),errorCode('model-capability'));
});


test('Gemini PCM metadata controls WAV rate and rejects conflicting rate or channel declarations',async()=>{
 const provider=new GeminiTutorProvider(()=>config,async()=>Response.json(interaction([{type:'audio',mime_type:'audio/l16',sample_rate:16000,channels:1,data:'AAD/fw=='}])));
 const audio=await provider.speech('An observation.',new AbortController().signal);assert.equal(new DataView(audio.bytes.buffer).getUint32(24,true),16000);
 for(const part of [{mime_type:'audio/l16;rate=24000',sample_rate:16000},{mime_type:'audio/l16',channels:2},{mime_type:'audio/l16',sample_rate:'16000'}]){
  const invalid=new GeminiTutorProvider(()=>config,async()=>Response.json(interaction([{type:'audio',...part,data:'AAD/fw=='}])));await assert.rejects(invalid.speech('An observation.',new AbortController().signal),errorCode('malformed'));
 }
});

test('Gemini whitespace-only completion is a typed malformed response rather than a successful answer',async()=>{
 const provider=new GeminiTutorProvider(()=>config,async()=>sse(delta('  \n ')+complete()));
 await assert.rejects(provider.stream(input(),new AbortController().signal,()=>{}),errorCode('malformed'));
});
