import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanionStore} from '../apps/desktop/main/store';
import {TutorDraftAutosave} from '../apps/desktop/renderer/tutor-draft-autosave';
import type {TutorDraftContent,TutorDraftSaveInput,TutorDraftView,TutorSendInput} from '../packages/tutor/types';
const now=Date.now();
function fixture(path=':memory:'){
 const store=new CompanionStore(path);
 store.command({id:'draft-attach',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',title:'Watermelon',workspaceId:'practice'}},'desktop',now);
 const conversation=store.tutor.open({workspaceId:'practice'},now);
 return {store,conversation,draft:store.tutor.draft(conversation.id,now)};
}
const input=(draft:TutorDraftView,text='An unfinished question.'):TutorDraftSaveInput=>({conversationId:draft.conversationId,epoch:draft.epoch,expectedRevision:draft.revision,text,action:'discuss',statementId:draft.statementId,codeId:draft.codeId,noteIds:draft.noteIds});
const send=(draft:TutorDraftView):TutorSendInput=>({turnId:'draft-turn',requestId:'draft-request',conversationId:draft.conversationId,text:draft.text,action:draft.action,statementId:draft.statementId,codeId:draft.codeId,noteIds:draft.noteIds,draft:{epoch:draft.epoch,revision:draft.revision}});
test('durable question, mode, associations and frozen selections survive restart without timers or requests',()=>{
 const folder=mkdtempSync(join(tmpdir(),'forma-durable-draft-')),path=join(folder,'notebook.sqlite');let f=fixture(path);
 try{
  const saved=f.store.tutor.saveDraft({...input(f.draft),action:'stronger-hint'},now+1).draft;
  const before=f.store.snapshot();f.store.close();const store=new CompanionStore(path);f={...f,store};
  assert.deepEqual(store.tutor.draft(f.conversation.id,now+2),saved);
  assert.equal(store.tutor.open({},now+2).id,f.conversation.id);
  assert.equal(store.tutor.view(now+2).lastConversationId,f.conversation.id);
  assert.deepEqual(store.snapshot(),before);assert.equal(store.tutor.turns(f.conversation.id).length,0);
 }finally{f.store.close();rmSync(folder,{recursive:true,force:true});}
});
test('out-of-order autosave and writes after conversation deletion cannot overwrite or resurrect data',()=>{
 const f=fixture();try{
  const first=f.store.tutor.saveDraft(input(f.draft,'Newest text'),now+1);
  assert.equal(first.saved,true);const stale=f.store.tutor.saveDraft(input(f.draft,'Late old text'),now+2);
  assert.equal(stale.saved,false);assert.equal(stale.draft.text,'Newest text');
  f.store.tutor.delete(f.conversation.id);
  assert.throws(()=>f.store.tutor.saveDraft(input(first.draft,'Resurrect'),now+3),/no longer available/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM tutor_drafts').get()!.n,0);
 }finally{f.store.close();}
});
test('atomic Send consumes its exact revision and acknowledgement replay produces one durable turn',()=>{
 const f=fixture();try{
  const draft=f.store.tutor.saveDraft(input(f.draft),now+1).draft,request=send(draft);
  const first=f.store.tutor.prepare(request,'fixture-model','gemini',now+2);
  assert.equal(f.store.tutor.draft(f.conversation.id,now+2).text,'');
  assert.equal(f.store.tutor.prepare(request,'fixture-model','gemini',now+3).id,first.id);
  assert.equal(f.store.tutor.turns(f.conversation.id).length,1);
  assert.equal(f.store.tutor.saveDraft(input(draft,'Late pre-Send autosave'),now+3).saved,false);
 }finally{f.store.close();}
});
test('edits committed during Send survive and failed preparation preserves the question',()=>{
 const f=fixture();try{
  const draft=f.store.tutor.saveDraft(input(f.draft),now+1).draft;
  const newer=f.store.tutor.saveDraft(input(draft,'Next question typed while sending'),now+2).draft;
  f.store.tutor.prepare(send(draft),'fixture-model','gemini',now+3);
  assert.equal(f.store.tutor.draft(f.conversation.id,now+3).text,newer.text);
  f.store.tutor.finalize({turnId:'draft-turn',requestId:'draft-request',status:'interrupted'},now+4);
  assert.throws(()=>f.store.tutor.prepare({...send(newer),turnId:'second-turn',requestId:'second-request',action:'check-code'},'fixture-model','gemini',now+5),/complete statement/);
  assert.equal(f.store.tutor.draft(f.conversation.id,now+5).text,newer.text);
 }finally{f.store.close();}
});
test('expired references preserve text and are explicit review requirements; restored epochs fence late writes',()=>{
 const f=fixture();try{
  const draft=f.store.tutor.saveDraft(input(f.draft),now+1).draft;
  const stored={...draft,statementId:'expired-statement',codeId:'expired-code',noteIds:['expired-note']};delete (stored as Partial<TutorDraftView>).statement;delete (stored as Partial<TutorDraftView>).code;
  f.store.db.prepare('UPDATE tutor_drafts SET body=? WHERE conversation_id=?').run(JSON.stringify(stored),draft.conversationId);
  const recovered=f.store.tutor.draft(draft.conversationId,now+2);
  assert.equal(recovered.text,draft.text);assert.deepEqual(recovered.missingReferences.map(ref=>ref.kind),['statement','code','note']);
  const epoch=f.store.tutor.rotateRecoveryEpoch();assert.notEqual(epoch,draft.epoch);
  assert.throws(()=>f.store.tutor.saveDraft(input(draft,'Late old state'),now+3),/restored/);
  assert.throws(()=>f.store.tutor.prepare(send(draft),'fixture-model','gemini',now+3),/earlier restore/);
 }finally{f.store.close();}
});
test('draft quota checks commit atomically and reject unbounded text and note sets',()=>{
 const f=fixture();try{
  assert.throws(()=>f.store.tutor.saveDraft(input(f.draft,'x'.repeat(6001))),/6000/);
  assert.throws(()=>f.store.tutor.saveDraft({...input(f.draft),noteIds:Array.from({length:21},(_,i)=>'note-'+i)}),/note selection/);
  f.store.db.exec("CREATE TRIGGER reject_draft_update BEFORE UPDATE ON tutor_drafts BEGIN SELECT RAISE(ABORT,'draft commit failed'); END;");
  assert.throws(()=>f.store.tutor.saveDraft(input(f.draft)),/draft commit failed/);
  assert.equal(f.store.tutor.draft(f.conversation.id).text,'');assert.equal(f.store.tutor.draft(f.conversation.id).revision,0);
 }finally{f.store.close();}
});
test('autosave acknowledges only committed content, serializes edits and recovers a lost save acknowledgement',async()=>{
 const f=fixture();const statuses:string[]=[];let release:(()=>void)|undefined;let held=true;
 const autosave=new TutorDraftAutosave(async request=>{if(held){held=false;await new Promise<void>(resolve=>{release=resolve;});}return f.store.tutor.saveDraft(request);},(_id,state)=>statuses.push(state),60_000);
 try{
  autosave.seed(f.draft);autosave.edit(f.draft.conversationId,{...f.draft,text:'First edit'});
  const first=autosave.flush(f.draft.conversationId);await new Promise(resolve=>setImmediate(resolve));assert.equal(statuses.at(-1),'saving');assert.equal(f.store.tutor.draft(f.draft.conversationId).text,'');
  autosave.edit(f.draft.conversationId,{...f.draft,text:'Second edit'});release!();await first;await autosave.flush(f.draft.conversationId);
  assert.equal(f.store.tutor.draft(f.draft.conversationId).text,'Second edit');assert.equal(statuses.at(-1),'saved');
  const committed=f.store.tutor.draft(f.draft.conversationId);let lose=true;
  const loss=new TutorDraftAutosave(async request=>{const result=f.store.tutor.saveDraft(request);if(lose){lose=false;throw new Error('Lost save acknowledgement');}return result;},()=>{},60_000);
  loss.seed(committed);loss.edit(committed.conversationId,{...committed,text:'Durable despite lost ack'});await assert.rejects(loss.flush(committed.conversationId),/Lost/);await loss.flush(committed.conversationId);loss.reset();
 }finally{autosave.reset();f.store.close();}
});
test('autosave pause preserves edits during Send, even when the replacement text equals the sent question',async()=>{
 const f=fixture();const autosave=new TutorDraftAutosave(async request=>f.store.tutor.saveDraft(request),()=>{},60_000);
 try{
  autosave.seed(f.draft);const question: TutorDraftContent={...f.draft,text:'Same text deliberately typed again'};
  autosave.edit(f.draft.conversationId,question);const generation=autosave.pause(f.draft.conversationId);const submitted=await autosave.flush(f.draft.conversationId);
  autosave.edit(f.draft.conversationId,{...question,text:'Temporary edit'});autosave.edit(f.draft.conversationId,question);
  f.store.tutor.prepare(send(submitted),'fixture-model','gemini');
  const local=autosave.resume(f.draft.conversationId,f.store.tutor.draft(f.draft.conversationId),question,generation);assert.equal(local.text,question.text);
  await autosave.flush(f.draft.conversationId);assert.equal(f.store.tutor.draft(f.draft.conversationId).text,question.text);
 }finally{autosave.reset();f.store.close();}
});


test('a lost save acknowledgement followed by newer edits reconciles only the exact owned prior commit',async()=>{
 const f=fixture();let lose=true;const autosave=new TutorDraftAutosave(async request=>{const result=f.store.tutor.saveDraft(request);if(lose){lose=false;throw new Error('Lost acknowledgement');}return result;},()=>{},60_000);
 try{
  autosave.seed(f.draft);autosave.edit(f.draft.conversationId,{...f.draft,text:'First persisted edit'});await assert.rejects(autosave.flush(f.draft.conversationId),/Lost/);
  autosave.edit(f.draft.conversationId,{...f.draft,text:'New edits after acknowledgement loss'});await autosave.flush(f.draft.conversationId);
  assert.equal(f.store.tutor.draft(f.draft.conversationId).text,'New edits after acknowledgement loss');
  const current=f.store.tutor.draft(f.draft.conversationId);f.store.tutor.saveDraft(input(current,'Changed by a separate writer'));
  autosave.edit(f.draft.conversationId,{...f.draft,text:'Stale renderer must not overwrite another writer'});await assert.rejects(autosave.flush(f.draft.conversationId),/changed elsewhere/);
  assert.equal(f.store.tutor.draft(f.draft.conversationId).text,'Changed by a separate writer');
 }finally{autosave.reset();f.store.close();}
});
