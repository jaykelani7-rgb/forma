import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { emptyData } from '../../src/lib/model';
import { initialCompanionState } from '../../packages/core/src/companion';
import type { CompanionSnapshot } from '../../apps/desktop/renderer/api';
import type { TutorSendInput, TutorTurn, SharedCode, StatementSnapshot } from '../../packages/tutor/types';

/** Real compiled renderer; only the Electron bridge, provider and audio devices are mocked. */
interface MockControls {
  calls:{action:string;payload?:unknown}[];turns:TutorTurn[];sendCount:number;approvals:number;approvalIds:string[];loseNextApprovalAck:boolean;microphoneRequests:number;tracksStopped:number;audioCreated:number;audioPlayed:number;audioPaused:number;
  denyMicrophone:boolean;holdMicrophone:boolean;switchFile():void;replaceCode():void;delta(text:string):void;finish(text?:string):void;
  releaseMicrophone():void;releaseTranscription(text:string):void;releaseSpeech():void;
}
declare global {interface Window {__tutorMock:MockControls;__tutorInjected?:number}}

async function openTutor(page:Page,configured=true){
  const root=resolve('.companion-build/renderer');
  await page.route('**/__tutor__/**',async route=>{
    const relative=decodeURIComponent(new URL(route.request().url()).pathname.slice('/__tutor__/'.length))||'index.html';
    const path=resolve(root,relative);if(!path.startsWith(root+sep)){await route.abort();return;}
    const contentType=path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.png')?'image/png':'application/octet-stream';
    await route.fulfill({body:await readFile(path),contentType});
  });
  const stamp='2026-10-20T10:00:00.000Z',identity='contest:4:A',problemId='mock-problem',conversationId='mock-conversation';
  const data=emptyData();data.problems.push({id:problemId,title:'Mock parity practice',platform:'Codeforces',url:'https://codeforces.com/problemset/problem/4/A',problemCode:'4A',tags:[],rating:800,createdAt:stamp,reviewAt:null,reviewCount:0});
  const state={...initialCompanionState(),identity,problemId};
  const snapshot:CompanionSnapshot={data,state,revision:1,savedAt:stamp,preferences:{theme:'light',reducedMotion:true,snoozedUntil:null},integration:{paired:true,connected:true,status:'Mock fixture connection'},codeforces:{checking:false,checkedAt:null,error:null},presentation:{expanded:true,panelRequest:{id:1,panel:'tutor',conversationId},activeFileUri:'file:///fixture/4A.cpp'}};
  const statement:StatementSnapshot={id:'mock-statement-v1',revision:'statement-revision-one',identity,title:'Mock parity practice',url:data.problems[0].url,description:'Fixture statement: split an integer into two positive even parts.',input:'One integer n.',output:'YES or NO.',constraints:'1 <= n <= 100.',samples:[{input:'8',output:'YES'}],explanation:'Both parts must be positive.',complete:true,source:'manual',capturedAt:stamp};
  const code:SharedCode={id:'mock-code-v1',identity,workspaceId:'mock-workspace',clientId:'mock-client',fileUri:'file:///fixture/4A.cpp',filename:'4A.cpp',language:'cpp',startLine:3,endLine:3,text:'int n; cin >> n;',revision:'code-revision-one',capturedAt:stamp};
  await page.addInitScript(({snapshot,statement,code,configured,stamp,conversationId})=>{
    const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
    const listeners=new Set<(value:typeof snapshot)=>void>(),tutorListeners=new Set<(event:{kind:'delta'|'updated';conversationId:string;turnId:string;requestId:string;text?:string})=>void>();
    const conversation={id:conversationId,identity:statement.identity,problemId:'mock-problem',workspaceId:'mock-workspace',title:'Mock parity practice',createdAt:stamp,updatedAt:stamp};
    const settings={contestMode:false,retentionDays:90,voiceOutput:false};let pendingCode=code;
    let resolveMicrophone:((value:{getTracks:()=>{stop:()=>void}[]})=>void)|null=null,resolveTranscription:((value:{text:string})=>void)|null=null,resolveSpeech:((value:{bytes:Uint8Array;mime:string})=>void)|null=null;
    const currentTurn=()=>control.turns.at(-1)!;
    const emit=(kind:'delta'|'updated',text?:string)=>{const turn=currentTurn();for(const listener of tutorListeners)listener({kind,conversationId,turnId:turn.id,requestId:turn.requestId,text});};
    const stream=()=>({getTracks:()=>[{stop:()=>{control.tracksStopped++;}}]});
    const control:MockControls={calls:[],turns:[],sendCount:0,approvals:0,approvalIds:[],loseNextApprovalAck:false,microphoneRequests:0,tracksStopped:0,audioCreated:0,audioPlayed:0,audioPaused:0,denyMicrophone:false,holdMicrophone:false,
      switchFile(){snapshot.state.identity='contest:5:A';snapshot.state.problemId='mock-other';snapshot.data.problems.push({...snapshot.data.problems[0],id:'mock-other',title:'Another editor problem',url:'https://codeforces.com/problemset/problem/5/A',problemCode:'5A'});snapshot.presentation!.activeFileUri='file:///fixture/5A.cpp';for(const listener of listeners)listener(clone(snapshot));},
      replaceCode(){pendingCode={...code,id:'mock-code-v2',revision:'code-revision-two',text:'int newer; cin >> newer;'};snapshot.presentation!.panelRequest={id:2,panel:'tutor',conversationId};for(const listener of listeners)listener(clone(snapshot));},
      delta(text){const turn=currentTurn();turn.assistantText+=text;turn.status='streaming';emit('delta',text);},
      finish(text){const turn=currentTurn();if(text)turn.assistantText+=text;turn.status='completed';turn.completedAt=stamp;turn.usage={inputTokens:10,outputTokens:5,totalTokens:15};emit('updated');},
      releaseMicrophone(){resolveMicrophone?.(stream());resolveMicrophone=null;},releaseTranscription(text){resolveTranscription?.({text});resolveTranscription=null;},releaseSpeech(){resolveSpeech?.({bytes:new Uint8Array([1,2,3]),mime:'audio/mpeg'});resolveSpeech=null;},
    };
    const bridge={getSnapshot:async()=>clone(snapshot),subscribe:(listener:(value:typeof snapshot)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},subscribeTutor:(listener:Parameters<typeof tutorListeners.add>[0])=>{tutorListeners.add(listener);return()=>tutorListeners.delete(listener);},command:async()=>{throw new Error('Mock fixture forbids unsolicited notebook commands.');},async ui(action:string,payload?:unknown):Promise<unknown>{
      control.calls.push({action,payload:clone(payload??null)});
      switch(action){
        case 'tutor-open':return clone(conversation);
        case 'tutor-view':return clone({conversations:[conversation],settings,pendingCode,provider:{configured,model:'mock-text',transcriptionModel:'mock-transcribe',speechModel:'mock-speech',message:configured?'Mock provider configured.':'Set up an OpenAI API key in Tutor settings to send a message.'},activeRequestId:control.turns.find(turn=>['queued','streaming'].includes(turn.status))?.requestId??null});
        case 'tutor-context':return clone({conversation,statement,pendingCode,notes:[{id:'mock-note',text:'A private prior learning note, excluded by default.'}],sessionId:null,evidence:{platform:'unknown',checkedAt:null,localTests:'unknown',submissions:[]}});
        case 'tutor-turns':return clone(control.turns);
        case 'tutor-send':{
          const input=payload as TutorSendInput;const existing=control.turns.find(turn=>turn.id===input.turnId);if(existing?.requestId===input.requestId)return {turnId:existing.id,requestId:existing.requestId};
          control.sendCount++;
          const turn:TutorTurn={id:input.turnId,requestId:input.requestId,conversationId,action:input.action,userText:input.text,assistantText:'Early mock observation. ',context:{version:1,identity:conversation.identity,problemId:conversation.problemId,title:conversation.title,url:statement.url,workspaceId:conversation.workspaceId,conversationId,sessionId:null,statement:input.statementId?statement:null,code:input.codeId?clone(pendingCode):null,notes:input.noteIds.includes('mock-note')?[{id:'mock-note',text:'A private prior learning note, excluded by default.'}]:[],evidence:{platform:'unknown',checkedAt:null,localTests:'unknown',submissions:[]},frozenAt:stamp},status:'streaming',createdAt:stamp,completedAt:null,error:null,hintLevel:input.action==='small-hint'?1:0,exposed:false,usage:null,model:'mock-text'};
          if(existing)control.turns.splice(control.turns.indexOf(existing),1,turn);else control.turns.push(turn);emit('delta','Early mock observation. ');return {turnId:turn.id,requestId:turn.requestId};
        }
        case 'tutor-stop':{const turn=currentTurn();turn.status='interrupted';turn.completedAt=stamp;emit('updated');return null;}
        case 'tutor-exposed':{const input=payload as {turnId:string;requestId:string};const turn=control.turns.find(turn=>turn.id===input.turnId&&turn.requestId===input.requestId);if(turn)turn.exposed=true;return turn?clone(turn):null;}
        case 'tutor-propose':{const input=payload as {id:string;turnId:string;kind:'thought'|'takeaway';text:string};return {...input,conversationId,problemId:conversation.problemId,identity:conversation.identity,sessionId:null,createdAt:stamp,saved:false};}
        case 'tutor-approve':{const id=String(payload);if(!control.approvalIds.includes(id)){control.approvalIds.push(id);control.approvals++;}if(control.loseNextApprovalAck){control.loseNextApprovalAck=false;throw new Error('Mock saved approval acknowledgement was lost.');}return {saved:true};}
        case 'tutor-settings':Object.assign(settings,payload);return clone(settings);
        case 'tutor-microphone':control.microphoneRequests++;if(control.denyMicrophone)throw new Error('Mock microphone access was denied.');return {allowed:true};
        case 'tutor-transcribe':return new Promise(resolve=>{resolveTranscription=resolve;});
        case 'tutor-speech':return new Promise(resolve=>{resolveSpeech=resolve;});
        case 'tutor-voice-cancel':return null; // Deliberately permit late replies to exercise renderer cancellation.
        default:return null;
      }
    }};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>control.holdMicrophone?await new Promise(resolve=>{resolveMicrophone=resolve;}):stream()}});
    class MockRecorder {
      static isTypeSupported(){return true;}mimeType='audio/webm';state='inactive';ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
      constructor(_stream:unknown,options?:{mimeType?:string}){this.mimeType=options?.mimeType??'audio/webm';}
      start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([1,2,3])],{type:this.mimeType})});this.onstop?.();}
    }
    class MockAudio {onended:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(){control.audioCreated++;}async play(){control.audioPlayed++;}pause(){control.audioPaused++;}removeAttribute(){}load(){}}
    Object.assign(window,{forma:bridge,__tutorMock:control,MediaRecorder:MockRecorder,Audio:MockAudio});
  },{snapshot,statement,code,configured,stamp,conversationId});
  await page.goto('/__tutor__/index.html');
  await expect(page.getByLabel('Your question or editable voice transcript')).toBeVisible();
}

test('mock bridge: setup is honest and file changes preserve the original conversation and unsent draft',async({page})=>{
  await openTutor(page,false);const draft=page.getByLabel('Your question or editable voice transcript');
  await draft.fill('My unsent approach belongs to the original problem.');await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  await expect(page.getByText(/Set up an OpenAI API key/)).toBeVisible();
  await page.evaluate(()=>window.__tutorMock.switchFile());await expect(page.getByText(/This conversation and draft still belong to Mock parity practice/)).toBeVisible();
  await expect(draft).toHaveValue('My unsent approach belongs to the original problem.');
  await page.evaluate(()=>window.__tutorMock.replaceCode());await expect(page.getByText(/Selected context changed since this draft/)).toBeVisible();await expect(draft).toHaveValue('My unsent approach belongs to the original problem.');
  expect(await page.evaluate(()=>window.__tutorMock.sendCount)).toBe(0);
});

test('mock provider: explicit context, early streaming, Stop and Retry preserve frozen identity and a single user turn',async({page})=>{
  await openTutor(page);await page.getByText(/^Context included/).click();await page.getByText('Inspect selected code',{exact:true}).click();await expect(page.locator('pre').filter({hasText:'int n; cin >> n;'})).toBeVisible();
  await page.locator('label.toggle-row').filter({hasText:'Problem statement'}).getByRole('checkbox').uncheck();await page.locator('label.toggle-row').filter({hasText:'Shared code'}).getByRole('checkbox').uncheck();
  await page.getByLabel('How can Fenn help?').selectOption('small-hint');await page.getByLabel('Your question or editable voice transcript').fill('One observation, please.');
  await page.locator('.tutor-composer').evaluate((form:HTMLFormElement)=>{form.requestSubmit();form.requestSubmit();});
  await expect(page.getByText('Early mock observation.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__tutorMock.sendCount)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.__tutorMock.turns[0].exposed)).toBe(true);
  const frozen=await page.evaluate(()=>window.__tutorMock.turns[0]);expect(frozen.context.statement).toBeNull();expect(frozen.context.code).toBeNull();expect(frozen.context.notes).toEqual([]);
  await page.evaluate(()=>window.__tutorMock.switchFile());await expect(page.getByText(/This conversation and draft still belong to Mock parity practice/)).toBeVisible();expect((await page.evaluate(()=>window.__tutorMock.turns[0])).context.identity).toBe('contest:4:A');
  await expect(page.getByLabel('Your question or editable voice transcript')).toHaveValue('');await page.getByRole('button',{name:'Stop response',exact:true}).click();
  await expect(page.getByText('FENN · interrupted',{exact:true})).toBeVisible();await page.getByRole('button',{name:/Retry this turn/}).click();
  await expect(page.getByRole('button',{name:'Stop response',exact:true})).toBeVisible();const retry=await page.evaluate(()=>({turns:window.__tutorMock.turns,calls:window.__tutorMock.calls.filter(call=>call.action==='tutor-send')}));
  expect(retry.turns).toHaveLength(1);expect(retry.turns[0].id).toBe(frozen.id);expect(retry.turns[0].requestId).not.toBe(frozen.requestId);expect(retry.turns[0].context.statement).toBeNull();expect(retry.turns[0].context.code).toBeNull();expect(retry.calls).toHaveLength(2);
  await page.evaluate(()=>window.__tutorMock.finish('A completed fixture response.'));await expect(page.getByText('FENN · completed',{exact:true})).toBeVisible();
});

test('mock provider: unsafe output stays text and notebook changes require reviewed approval',async({page})=>{
  await openTutor(page);await page.getByLabel('Your question or editable voice transcript').fill('Discuss this approach.');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.evaluate(()=>window.__tutorMock.finish('<img src=x onerror="window.__tutorInjected=1"> This is advice, not a saved note.'));
  await expect(page.locator('.tutor-answer')).toContainText('<img src=x onerror="window.__tutorInjected=1">');expect(await page.locator('.tutor-answer img').count()).toBe(0);expect(await page.evaluate(()=>window.__tutorInjected)).toBeUndefined();
  expect(await page.evaluate(()=>window.__tutorMock.approvals)).toBe(0);await page.getByRole('button',{name:'Save a useful explanation',exact:true}).click();
  await expect(page.getByText('REVIEW BEFORE SAVING',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__tutorMock.approvals)).toBe(0);
  await page.locator('.tutor-proposal textarea').fill('I approved this concise thought.');await page.evaluate(()=>{window.__tutorMock.loseNextApprovalAck=true;});await page.getByRole('button',{name:'Approve and save',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Mock saved approval acknowledgement was lost.');expect(await page.evaluate(()=>window.__tutorMock.approvals)).toBe(1);
  await page.getByRole('button',{name:'Approve and save',exact:true}).click();
  await expect(page.getByText('Approved text saved to its original learning destination.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__tutorMock.approvals)).toBe(1);
  const approvalCalls=await page.evaluate(()=>window.__tutorMock.calls.filter(call=>call.action==='tutor-approve'));expect(approvalCalls).toHaveLength(2);expect(approvalCalls[0].payload).toBe(approvalCalls[1].payload);
  await page.getByRole('button',{name:'Prepare a recall question',exact:true}).click();await expect(page.getByLabel('Your question or editable voice transcript')).toHaveValue(/Help me draft one concise recall question/);expect(await page.evaluate(()=>window.__tutorMock.sendCount)).toBe(1);
});

test('mock audio devices: denial, cancellation and late speech/transcription cannot auto-send or revive playback',async({page})=>{
  await openTutor(page);const mic=page.getByRole('button',{name:'Record voice question',exact:true}),draft=page.getByLabel('Your question or editable voice transcript');
  await page.evaluate(()=>{window.__tutorMock.denyMicrophone=true;});await mic.click();await expect(page.getByRole('alert')).toContainText('Mock microphone access was denied');
  await page.evaluate(()=>{window.__tutorMock.denyMicrophone=false;window.__tutorMock.holdMicrophone=true;});await mic.click();await page.getByRole('button',{name:'Stop speaking / cancel voice',exact:true}).click();await page.evaluate(()=>window.__tutorMock.releaseMicrophone());
  await expect.poll(()=>page.evaluate(()=>window.__tutorMock.tracksStopped)).toBe(1);await expect(page.getByText(/Recording · microphone on/)).toHaveCount(0);
  await page.evaluate(()=>{window.__tutorMock.holdMicrophone=false;});await mic.click();await page.getByRole('button',{name:'Finish recording and transcribe',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__tutorMock.calls.filter(call=>call.action==='tutor-transcribe').length)).toBe(1);await page.getByRole('button',{name:'Stop speaking / cancel voice',exact:true}).click();await page.evaluate(()=>window.__tutorMock.releaseTranscription('Cancelled late transcript.'));await expect(draft).toHaveValue('');
  await mic.click();await page.getByRole('button',{name:'Finish recording and transcribe',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__tutorMock.calls.filter(call=>call.action==='tutor-transcribe').length)).toBe(2);
  await page.evaluate(()=>window.__tutorMock.releaseTranscription('Editable voice follow-up.'));await expect(draft).toHaveValue('Editable voice follow-up.');expect(await page.evaluate(()=>window.__tutorMock.sendCount)).toBe(0);
  await draft.fill('Reviewed voice follow-up.');await page.getByRole('button',{name:'Send',exact:true}).click();await page.evaluate(()=>window.__tutorMock.finish('Completed answer for optional speech.'));
  await page.getByLabel('Allow spoken replies · AI-generated voice').check();await page.getByRole('button',{name:'Read completed reply',exact:true}).click();await page.getByRole('button',{name:'Back to practice',exact:true}).click();await page.evaluate(()=>window.__tutorMock.releaseSpeech());
  expect(await page.evaluate(()=>({created:window.__tutorMock.audioCreated,played:window.__tutorMock.audioPlayed}))).toEqual({created:0,played:0});
  await page.getByRole('button',{name:'Ask Fenn',exact:true}).click();await page.getByRole('button',{name:'Read completed reply',exact:true}).click();await page.evaluate(()=>window.__tutorMock.releaseSpeech());await expect.poll(()=>page.evaluate(()=>window.__tutorMock.audioPlayed)).toBe(1);
  await mic.click();await expect(page.getByRole('button',{name:'Finish recording and transcribe',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__tutorMock.audioPaused)).toBe(1);
  await page.getByRole('button',{name:'Cancel recording',exact:true}).click();expect(await page.evaluate(()=>window.__tutorMock.calls.filter(call=>call.action==='tutor-transcribe').length)).toBe(2);
});
