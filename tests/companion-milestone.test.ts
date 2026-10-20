import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionStore } from '../apps/desktop/main/store';
import { applyCompanionCommand, initialCompanionState, validateCompanionState, type CompanionSnapshot } from '../packages/core/src/companion';
import { DISCOVERY_MS, PENDING_MS, reconcileFollowups, expireFollowups, followupDue } from '../packages/core/src/verdict-followup';
import { companionToday } from '../packages/core/src/companion-today';
import { emptyData, localDate, addDays } from '../src/lib/model';
import { reconcilePracticePlan } from '../src/lib/practice-plan';
import { AttentionPolicy } from '../apps/desktop/main/attention';
import type { CompanionCommand } from '../packages/contracts/src';
import type { SubmissionInput } from '../src/lib/codeforces-types';
const T=Date.parse('2026-10-19T12:00:00Z');
const iso=(n:number)=>new Date(n).toISOString();
function send(s:CompanionSnapshot,type:CompanionCommand['type'],payload:unknown={},at=T,id=type as string){return applyCompanionCommand(s.data,s.state,{id,type,payload},at);}
function setup(){let s={data:emptyData(),state:initialCompanionState()};s=send(s,'set-handle',{handle:'tourist'});s=send(s,'attach',{url:'https://codeforces.com/gym/123456/problem/A1'});return send(s,'start');}
function row(verdict:string|null=null,id=7,at=T+50_000):SubmissionInput{return {id,submittedAt:iso(at),verdict,language:'C++23',problem:{key:'gym:123456:A1',code:'123456A1',url:'https://codeforces.com/gym/123456/problem/A1',title:'Split index',rating:null,tags:[]}};}
test('submit, finish before discovery, reflect pending, and rejudge preserve the original interval and reflection',()=>{
 let s=send(setup(),'finish',{},T+60_000);const deadline=s.state.followups![0].discoveryUntil;
 s={...s,state:reconcileFollowups(s.state,'tourist',[row()],T+70_000)};
 assert.equal(s.state.followups![0].status,'pending');assert.equal(s.state.followups![0].pendingUntil,iso(T+70_000+PENDING_MS));
 s=send(s,'reflect',{outcome:'editorial',takeaway:'Keep my memory'},T+120_000);
 s={...s,state:reconcileFollowups(s.state,'tourist',[row('OK')],T+150_000)};
 assert.equal(s.state.platform,'accepted');assert.equal(s.data.attempts[0].outcome,'editorial');assert.equal(s.data.attempts[0].elapsedMs,60_000);
 s={...s,state:reconcileFollowups(s.state,'tourist',[row('WRONG_ANSWER')],T+160_000)};
 assert.equal(s.state.submissions.length,1);assert.equal(s.state.submissions[0].submittedAt,iso(T+50_000));assert.equal(s.state.platform,'rejected');assert.equal(s.state.followups![0].discoveryUntil,deadline);
 assert.deepEqual(validateCompanionState(s.state,s.data),s.state);
});
test('outside-window and ambiguous evidence stays unassigned; no manufactured attempts',()=>{
 const s=send(setup(),'finish',{},T+60_000);
 s.state=reconcileFollowups(s.state,'tourist',[row('OK',8,T+61_000)],T+70_000);
 assert.equal(s.state.submissions[0].sessionId,undefined);assert.equal(s.state.platform,'unknown');assert.equal(s.data.attempts.length,0);
 s.state.followups!.push({...s.state.followups![0],id:'other-attempt'});
 s.state=reconcileFollowups(s.state,'tourist',[row('OK',9)],T+80_000);
 assert.equal(s.state.submissions.find(r=>r.id===9)?.sessionId,undefined);
});
test('old handle and problem results cannot accept the newly selected problem',()=>{
 let s=send(send(setup(),'finish',{},T+60_000),'reflect',{outcome:'hint'},T+65_000);
 s=send(s,'attach',{url:'https://codeforces.com/contest/4/problem/A'},T+70_000,'switch');
 s=send(s,'set-handle',{handle:'another'},T+71_000,'handle');
 s.state=reconcileFollowups(s.state,'tourist',[row('OK')],T+80_000);
 assert.equal(s.state.platform,'unknown');assert.equal(s.state.followups![0].status,'final');assert.equal(s.state.submissions[0].sessionId,'companion:start');
 assert.equal(s.data.attempts[0].outcome,'hint');
});
test('temporary failures and empty/incomplete fetched history do not become wrong answers; deadlines never slide',()=>{
 const s=send(setup(),'finish',{},T+60_000);const deadline=iso(T+60_000+DISCOVERY_MS);
 s.state=reconcileFollowups(s.state,'tourist',[],T+70_000,'Rate limited');assert.equal(s.state.followups![0].status,'temporary-failure');
 s.state=reconcileFollowups(s.state,'tourist',[],T+100_000);assert.equal(s.state.followups![0].status,'searching');assert.equal(s.state.platform,'unknown');
 assert.equal(s.state.followups![0].discoveryUntil,deadline);
 s.state=expireFollowups(s.state,T+60_001+DISCOVERY_MS);assert.equal(s.state.followups![0].status,'expired');assert.equal(followupDue(s.state.followups![0],T+999_999),false);
});
test('pending polling expires independently and ignores duplicates and identity/time mutation',()=>{
 const s=send(setup(),'finish',{},T+60_000);s.state=reconcileFollowups(s.state,'tourist',[row()],T+70_000);
 const until=s.state.followups![0].pendingUntil;
 s.state=reconcileFollowups(s.state,'tourist',[row(),row()],T+80_000);assert.equal(s.state.submissions.length,1);assert.equal(s.state.followups![0].pendingUntil,until);
 s.state=reconcileFollowups(s.state,'tourist',[row('OK',7,T+51_000)],T+90_000);assert.equal(s.state.submissions[0].verdict,null);
 s.state=expireFollowups(s.state,T+70_001+PENDING_MS);assert.equal(s.state.followups![0].status,'expired');assert.equal(s.state.platform,'pending');
});
test('SQLite restart retains deadlines, pauses measured time, and expires without counting sleep',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-followup-'));const path=join(folder,'notebook.sqlite');let store=new CompanionStore(path);
 try{for(const c of [{id:'h',type:'set-handle',payload:{handle:'tourist'}},{id:'a',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A'}},{id:'s',type:'start',payload:{}},{id:'f',type:'finish',payload:{}}])store.command(c,'desktop',c.id==='f'?T+60_000:T);
 const before=store.snapshot();store.close();store=new CompanionStore(path);store.pauseForLifecycle('restart',T+100_000);assert.deepEqual(store.snapshot().state.followups,before.state.followups);
 store.reconcile(T+60_001+DISCOVERY_MS);assert.equal(store.snapshot().state.followups![0].status,'expired');assert.equal(store.snapshot().data.session!.elapsedMs,60_000);
 }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
test('Today reads do not create plans; saved reads stay stable and resume creates no duplicate or auto-resume',()=>{
 const empty=emptyData();assert.deepEqual(companionToday(empty,new Date(T)).items,[]);assert.equal(empty.practicePlans,undefined);
 let s=setup();s=send(s,'pause',{},T+30_000);s.data=reconcilePracticePlan(s.data,new Date(T+30_000));
 const today=companionToday(s.data,new Date(T+30_000)), before=JSON.stringify(s.data);assert.equal(today.items[0].resume,true);assert.equal(JSON.stringify(s.data),before);
 s=send(s,'plan-select',{itemId:today.items[0].id,start:true},T+40_000,'resume-choice');
 assert.equal(s.data.session?.id,'companion:start');assert.equal(s.data.session?.runningSince,null);assert.equal(s.data.attempts.length,0);assert.equal(s.state.bindings.length,0);
});
test('Later uses shared activity deferral, survives saved reads, and unfinished reflection blocks switching',()=>{
 let s=setup();s=send(s,'finish',{},T+60_000);s.data=reconcilePracticePlan(s.data,new Date(T+60_000));
 const item=companionToday(s.data,new Date(T+60_000)).items[0];
 s=send(s,'reflect',{outcome:'independent'},T+70_000);s.data=reconcilePracticePlan(s.data,new Date(T+70_000));
 assert.equal(companionToday(s.data,new Date(T+70_000)).items.some(i=>i.id===item.id),false);
 let fresh=send({data:emptyData(),state:initialCompanionState()},'attach',{url:'https://codeforces.com/contest/4/problem/A'});fresh.data=reconcilePracticePlan(fresh.data,new Date(T));
 const next=companionToday(fresh.data,new Date(T)).items[0];assert.ok(next);
 fresh=send(fresh,'plan-later',{itemId:next.id,until:localDate(addDays(new Date(T),1))});
 assert.equal(companionToday(reconcilePracticePlan(fresh.data,new Date(T)),new Date(T)).items.some(i=>i.id===next.id),false);
});
test('one attention slot suppresses routine notices during coding, expires and retains the saved result',()=>{
 const policy=new AttentionPolicy();const s=setup();policy.view(s.state,null,false,T);
 s.state=reconcileFollowups(s.state,'tourist',[row('OK')],T+70_000);
 const notice=policy.view(s.state,null,false,T+70_000);assert.ok(notice.verdict);assert.equal(policy.view(s.state,null,false,T+79_000).verdict,null);
 assert.equal(policy.view(s.state,null,false,T+80_000).verdict,null);assert.equal(s.state.submissions[0].verdict,'OK');
 const restarted=new AttentionPolicy();assert.equal(restarted.view(s.state,null,false,T+90_000).verdict,null);
});

test('injected scheduler coalesces handle history, persists failure, and never polls expired records',async()=>{
 const {VerdictScheduler}=await import('../packages/integrations/verdict-scheduler');
 let now=T+70_000,calls=0;const s=send(setup(),'finish',{},T+60_000);
 s.state.followups!.push({...s.state.followups![0],id:'second',identity:'gym:123456:A2'});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const scheduler=new VerdictScheduler({now:()=>now,read:async()=>s.state,fetch:async(handle,identities)=>{calls++;assert.equal(handle,'tourist');assert.equal(identities.length,2);await gate;return [row()];},write:async e=>{s.state=reconcileFollowups(s.state,e.handle,e.submissions,now,e.error??null);}});
 const first=scheduler.run(),second=scheduler.run();assert.equal(first,second);release();await first;assert.equal(calls,1);
 await scheduler.run();assert.equal(calls,1);now=T+70_001+PENDING_MS;s.state=expireFollowups(s.state,now);await scheduler.run();assert.equal(calls,1);
 const failed=new VerdictScheduler({now:()=>T+70_000,read:async()=>send(setup(),'finish',{},T+60_000).state,fetch:async()=>{throw new Error('429 temporary');},write:async e=>{assert.equal(e.error,'429 temporary');assert.deepEqual(e.submissions,[]);}});await failed.run();
});

test('fresh track starts preserve shared domain context and never associate an arbitrary editor file',async()=>{
 const {importTrack}=await import('../src/lib/tracks');
 let data=importTrack(emptyData(),{id:'track',title:'Practice',sourceName:'manual',sourceFingerprint:'fixture',stages:[{id:'stage',title:'Stage',description:'',suggestedTime:'',entries:[{id:'entry',title:'Watermelon',code:'4A',url:'',rating:null,pattern:'Hidden solution hint'}]}]},undefined,new Date(T));
 data=reconcilePracticePlan(data,new Date(T));let s={data,state:initialCompanionState()};const item=companionToday(data,new Date(T)).items[0];assert.ok(item);
 assert.equal(JSON.stringify(item).includes('Hidden solution hint'),false);
 s=send(s,'plan-select',{itemId:item.id,start:true},T,'planned');
 assert.ok(s.data.session?.trackContext);assert.equal(s.data.problems.length,1);assert.equal(s.state.bindings.length,0);
 assert.equal(s.data.practicePlans![0].items.find(i=>i.id===item.id)?.sessionId,'companion:planned');
 assert.throws(()=>send(s,'plan-select',{itemId:'missing',start:true},T,'bad'),/changed/);
});

test('planned recall keeps its activity, hides prior notes and records no timed attempt',async()=>{
 const {saveRevision}=await import('../src/lib/memory');
 let s=send({data:emptyData(),state:initialCompanionState()},'attach',{url:'https://codeforces.com/contest/4/problem/A'});
 s.data=saveRevision(s.data,{id:'prior',problemId:s.state.problemId!,handle:null,activity:'complexity',outcome:'cue',response:'Private previous explanation',cue:'Private hint',completedAt:iso(T-86_400_000),nextReviewAt:localDate(new Date(T))});
 s.data=reconcilePracticePlan(s.data,new Date(T));const item=companionToday(s.data,new Date(T)).items.find(i=>i.activity!=='coding');assert.ok(item);
 assert.equal(JSON.stringify(companionToday(s.data,new Date(T))).includes('Private'),false);
 s=send(s,'plan-select',{itemId:item.id,start:false},T,'recall-choice');assert.equal(s.data.session,null);
 s=send(s,'recall',{activity:item.activity,outcome:'independent',response:'My new explanation',cue:''},T+60_000);
 s.data=reconcilePracticePlan(s.data,new Date(T+60_000));assert.equal(s.data.attempts.length,0);assert.equal(s.data.revisions!.at(-1)?.activity,item.activity);assert.equal(companionToday(s.data,new Date(T+60_000)).items.some(i=>i.id===item.id),false);
});

test('legacy overlapping attempts remain ambiguous and a failed refresh preserves verified final evidence',()=>{
 const s=send(setup(),'finish',{},T+60_000);
 s.data.attempts.push({id:'legacy',problemId:s.state.problemId!,startedAt:iso(T),completedAt:iso(T+60_000),elapsedMs:60_000,outcome:'hint',difficulty:null,notes:'Retained',takeaway:''});
 s.state=reconcileFollowups(s.state,'tourist',[row('OK')],T+70_000,null,s.data);assert.equal(s.state.submissions[0].sessionId,undefined);assert.equal(s.state.platform,'unknown');
 const legacyOnly={...s.state,followups:[],submissions:[]};const retained=reconcileFollowups(legacyOnly,'tourist',[row('OK')],T+70_000,null,s.data);assert.equal(retained.submissions[0].sessionId,undefined);
 const clean=send(setup(),'finish',{},T+60_000);clean.state=reconcileFollowups(clean.state,'tourist',[row('OK')],T+70_000);
 clean.state=reconcileFollowups(clean.state,'tourist',[],T+80_000,'Temporary outage');assert.equal(clean.state.followups![0].status,'final');assert.equal(clean.state.platform,'accepted');
});

test('import reconciles the planner/profile atomically and calendar changes are saved once, never by rendering',async()=>{
 const {encodeBackup}=await import('../src/lib/concurrency');
 const store=new CompanionStore(':memory:');
 try{
   let imported=send({data:emptyData(),state:initialCompanionState()},'set-handle',{handle:'tourist'});
   imported=send(imported,'attach',{url:'https://codeforces.com/contest/4/problem/A'});
   store.importNotebook(encodeBackup(imported.data),T);assert.equal(store.snapshot().state.handle,'tourist');
   const first=store.reconcile(T);const view=companionToday(first.data,new Date(T));assert.ok(view.items.length);
   assert.equal(store.reconcile(T+1000).revision,first.revision);
   const next=store.reconcile(T+86_400_000);assert.notEqual(companionToday(next.data,new Date(T+86_400_000)).day,view.day);
   assert.equal(store.reconcile(T+86_401_000).revision,next.revision);
   const before=JSON.stringify(store.snapshot());companionToday(next.data,new Date(T+2*86_400_000));assert.equal(JSON.stringify(store.snapshot()),before);
 }finally{store.close();}
});

test('Today Continue retains current platform/test evidence while selecting a new session clears old learning',()=>{
 let s=setup();s=send(s,'pause',{},T+60_000);s.state=reconcileFollowups(s.state,'tourist',[row('OK')],T+70_000);s.state.localTests='passed';
 s.data=reconcilePracticePlan(s.data,new Date(T+70_000));const item=companionToday(s.data,new Date(T+70_000)).items[0];
 s=send(s,'plan-select',{itemId:item.id,start:true},T+80_000,'continue');assert.equal(s.state.platform,'accepted');assert.equal(s.state.localTests,'passed');assert.equal(s.data.session?.runningSince,null);
 s=send(s,'finish',{},T+90_000);s=send(s,'reflect',{outcome:'editorial'},T+95_000);
 s=send(s,'attach',{url:'https://codeforces.com/contest/4/problem/A'},T+100_000,'new-problem');s.data=reconcilePracticePlan(s.data,new Date(T+86_400_000));
 const next=companionToday(s.data,new Date(T+86_400_000)).items.find(i=>i.identity==='contest:4:A');
 assert.ok(next);s=send(s,'plan-select',{itemId:next.id,start:true},T+86_400_000,'new-session');assert.equal(s.state.learning,'unrecorded');assert.equal(s.state.platform,'unknown');
});

test('active discovery and final discovery catch a newer submission even after an earlier final verdict',()=>{
 const s=setup();s.state=reconcileFollowups(s.state,'tourist',[row('WRONG_ANSWER')],T+70_000);
 assert.equal(followupDue(s.state.followups![0],T+110_000),true);
 const finished=send(s,'finish',{},T+120_000);assert.equal(followupDue(finished.state.followups![0],T+120_000),true);
 finished.state=reconcileFollowups(finished.state,'tourist',[row('OK',8,T+115_000),row('WRONG_ANSWER')],T+150_000);
 assert.equal(finished.state.platform,'accepted');assert.equal(followupDue(finished.state.followups![0],T+190_000),true);
 assert.equal(followupDue(finished.state.followups![0],T+120_001+DISCOVERY_MS),false);
 const delayed=setup();delayed.state=reconcileFollowups(delayed.state,'tourist',[row()],T+70_000);
 const long=send(delayed,'finish',{},T+PENDING_MS+200_000);assert.equal(followupDue(long.state.followups![0],T+PENDING_MS+200_000),true);
});
