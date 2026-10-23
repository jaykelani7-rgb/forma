import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionStore } from '../apps/desktop/main/store';
import { BACKUP_LIMIT, backupHash, validateLocalBackup } from '../apps/desktop/main/backup-schema';
import { RecoveryFence, writeVerifiedRecovery } from '../apps/desktop/main/local-recovery';
import { tutorHash } from '../packages/tutor/context';

const now=Date.parse('2026-10-23T10:00:00.000Z');
function fixture(store=new CompanionStore(':memory:')){
  store.command({id:'attach',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',fileUri:'file:///practice/a.cpp',clientId:'vscode-one',workspaceId:'workspace-one',source:'manual'}},'vscode',now);
  store.command({id:'thought',type:'thought',payload:{text:'A learning record worth retaining.'}},'desktop',now);
  const conversation=store.tutor.open({workspaceId:'workspace-one'},now),statement=store.tutor.statement({identity:'contest:4:A',url:'https://codeforces.com/contest/4/problem/A',title:'Watermelon',description:'Split into two positive even integers.',input:'A weight.',output:'YES or NO.',constraints:'1 to 100',samples:[{input:'8',output:'YES'}],explanation:'4 + 4',complete:true,source:'manual'},now)!;
  const text='int main() {}';store.tutor.code({id:'code-one',identity:'contest:4:A',workspaceId:'workspace-one',clientId:'vscode-one',fileUri:'file:///practice/a.cpp',filename:'a.cpp',language:'cpp',startLine:1,endLine:1,text,revision:`sha256:${tutorHash(text)}`,capturedAt:new Date(now).toISOString()});
  const turn=store.tutor.prepare({turnId:'turn-one',requestId:'request-one',conversationId:conversation.id,action:'discuss',text:'A persisted question.',statementId:statement.id,codeId:'code-one',noteIds:[]},'fixture-model','gemini',now);
  store.tutor.append({turnId:turn.id,requestId:turn.requestId,text:'A partial answer.'});
  const draft=store.tutor.draft(conversation.id,now);
  store.tutor.saveDraft({conversationId:conversation.id,epoch:draft.epoch,expectedRevision:draft.revision,text:'An unfinished question.',action:'small-hint',statementId:statement.id,codeId:'code-one',noteIds:[]},now);
  return {store,conversation,statement,turn};
}
function full(store:CompanionStore){return store.backups.export({scope:'companion',includeTutor:true},now);}
function receipt(store:CompanionStore){const json=full(store);return {json,sha256:backupHash(json)};}
test('versioned full backup round trip preserves learning, immutable provenance and drafts without credentials or permissions',()=>{
  const source=fixture(),target=new CompanionStore(':memory:');
  try{
    source.store.db.prepare('INSERT INTO preferences VALUES(?,?)').run('pairing','never-export-this-secret');
    source.store.db.prepare('INSERT INTO preferences VALUES(?,?)').run('developmentLaunchPath','/machine/executable');
    const json=full(source.store),backup=JSON.parse(json);assert.equal(json.includes('never-export-this-secret'),false);assert.equal(json.includes('/machine/executable'),false);assert.deepEqual(backup.companion.bindings,[]);assert.equal(backup.tutor.drafts.length,1);
    const preview=target.backups.preview(json);assert.equal(preview.includeTutor,true);assert.equal(preview.counts.drafts,1);
    target.backups.restore(json,receipt(target),now);
    assert.equal(target.snapshot().state.thoughts[0].text,'A learning record worth retaining.');assert.deepEqual(target.snapshot().state.bindings,[]);
    const restored=target.tutor.turns(source.conversation.id)[0];assert.deepEqual(restored.context,source.turn.context);assert.equal(restored.status,'interrupted');assert.equal(restored.assistantText,'A partial answer.');
    assert.equal(target.tutor.draft(source.conversation.id,now).text,'An unfinished question.');assert.equal(target.tutor.view(now).lastConversationId,source.conversation.id);assert.equal(target.snapshot().data.session,null);
    assert.equal(target.db.prepare('SELECT COUNT(*) n FROM tutor_requests').get()!.n,0);
  }finally{source.store.close();target.close();}
});
test('notebook-only and companion without Tutor preserve outside scopes and reject orphaning replacements',()=>{
  const f=fixture();try{
    const text=f.store.backups.export({scope:'notebook',includeTutor:false},now),before=f.store.tutor.turns(f.conversation.id),thoughts=f.store.snapshot().state.thoughts;
    f.store.backups.restore(text,receipt(f.store),now);assert.deepEqual(f.store.tutor.turns(f.conversation.id),before);assert.deepEqual(f.store.snapshot().state.thoughts,thoughts);
    const changed=JSON.parse(text);changed.notebook.problems=[];
    assert.throws(()=>f.store.backups.preview(JSON.stringify(changed)),/orphan/);
    assert.deepEqual(f.store.tutor.turns(f.conversation.id),before);
  }finally{f.store.close();}
});
test('strict parse rejects unsupported formats, nesting, oversize, duplicate and invalid relational records',()=>{
  const f=fixture();try{
    const data=f.store.snapshot().data;
    assert.throws(()=>validateLocalBackup(' '.repeat(BACKUP_LIMIT+1),data),/64 MiB/);
    assert.throws(()=>validateLocalBackup('{"deep":'+ '['.repeat(40)+'0'+']'.repeat(40)+'}',data),/nested/);
    const change=(edit:(b:ReturnType<typeof JSON.parse>)=>void)=>{const b=JSON.parse(full(f.store));edit(b);return JSON.stringify(b);};
    assert.throws(()=>f.store.backups.preview(change(b=>b.version=99)),/version/);
    assert.throws(()=>f.store.backups.preview(change(b=>b.credential='secret')),/Unsupported/);
    assert.throws(()=>f.store.backups.preview(change(b=>b.tutor.conversations.push(b.tutor.conversations[0]))),/duplicate/);
    assert.throws(()=>f.store.backups.preview(change(b=>b.tutor.turns[0].conversationId='missing')),/conversation/);
    assert.throws(()=>f.store.backups.preview(change(b=>b.tutor.captures[0].statementId='missing')),/reference/);
    assert.throws(()=>f.store.backups.preview(change(b=>b.tutor.statements[0].description='tampered')),/revision/);
    assert.throws(()=>f.store.backups.preview(change(b=>b.tutor.captures[0].sequence=Number.MAX_SAFE_INTEGER)),/revision/);
    assert.throws(()=>f.store.backups.preview(change(b=>b.tutor.drafts[0].revision=Number.MAX_SAFE_INTEGER)),/revision/);
  }finally{f.store.close();}
});
test('failed pre-restore verification leaves every record and draft generation untouched',()=>{
  const f=fixture();try{const before=full(f.store),draft=f.store.tutor.draft(f.conversation.id,now);assert.throws(()=>f.store.backups.restore(before,{json:before,sha256:'bad'},now),/verified/);assert.equal(full(f.store),before);assert.equal(f.store.tutor.draft(f.conversation.id,now).epoch,draft.epoch);}finally{f.store.close();}
});
test('a mid-restore failure rolls back notebook, Tutor tables and draft epoch atomically',()=>{
  const f=fixture();try{
    const before=full(f.store),draft=f.store.tutor.draft(f.conversation.id,now);
    f.store.db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON tutor_drafts BEGIN SELECT RAISE(ABORT,'injected disk failure'); END;");
    assert.throws(()=>f.store.backups.restore(before,receipt(f.store),now),/injected/);assert.equal(full(f.store),before);assert.equal(f.store.tutor.draft(f.conversation.id,now).epoch,draft.epoch);
  }finally{f.store.close();}
});
test('restore rotates draft leases even for matching IDs; expired refs retain text and old callbacks cannot save',()=>{
  const f=fixture();try{
    const old=f.store.tutor.draft(f.conversation.id,now),b=JSON.parse(full(f.store));b.tutor.codes=[];
    f.store.backups.restore(JSON.stringify(b),receipt(f.store),now);
    const recovered=f.store.tutor.draft(f.conversation.id,now);assert.notEqual(recovered.epoch,old.epoch);assert.equal(recovered.text,old.text);assert.deepEqual(recovered.missingReferences,[{kind:'code',id:'code-one'}]);
    assert.throws(()=>f.store.tutor.saveDraft({conversationId:old.conversationId,epoch:old.epoch,expectedRevision:old.revision,text:'late overwrite',action:old.action,statementId:old.statementId,codeId:old.codeId,noteIds:[]},now),/restor|changed|epoch/i);
    assert.equal(f.store.tutor.draft(f.conversation.id,now).text,old.text);
  }finally{f.store.close();}
});
test('legacy notebook, full companion and Tutor exports migrate explicitly with preview limitations',()=>{
  const f=fixture();try{
    assert.equal(f.store.backups.preview(f.store.exportNotebook()).scope,'notebook');
    const companion=f.store.backups.preview(f.store.exportCompanion());assert.equal(companion.scope,'companion');assert.equal(companion.includeTutor,false);assert.ok(companion.warnings.some(w=>w.includes('Legacy')));
    const tutor=f.store.backups.preview(f.store.tutor.export(f.conversation.id));assert.equal(tutor.scope,'tutor');assert.equal(tutor.counts.turns,1);assert.equal(tutor.counts.drafts,0);assert.ok(tutor.warnings.some(w=>w.includes('Unsent drafts')));
  }finally{f.store.close();}
});
test('recovery files are exclusive, verified and bounded; IO failure produces no restore receipt',()=>{
  const directory=mkdtempSync(join(tmpdir(),'forma-recovery-')),f=fixture();try{
    const json=full(f.store),saved=writeVerifiedRecovery(join(directory,'backups'),json);assert.equal(readFileSync(saved.path,'utf8'),json);assert.equal(saved.receipt.sha256,backupHash(json));
    writeFileSync(join(directory,'occupied'),'not a folder');assert.throws(()=>writeVerifiedRecovery(join(directory,'occupied','backups'),json));
    assert.equal(full(f.store),json);
  }finally{f.store.close();rmSync(directory,{recursive:true,force:true});}
});
test('recovery fence invalidates every asynchronous lease across replacement and rejects new work while held',()=>{
  const fence=new RecoveryFence(),before=fence.lease();before();const release=fence.begin();assert.throws(before,/restore/);assert.throws(()=>fence.lease(),/restore/);release();assert.throws(before,/predates/);fence.lease()();
});
test('current measured time is captured before backup and Tutor-only replacement pauses without losing the live interval',()=>{
  const f=fixture();try{
    f.store.command({id:'measured-start',type:'start',payload:{}},'desktop',now);
    const exported=JSON.parse(f.store.backups.export({scope:'companion',includeTutor:true},now+5000));
    assert.equal(exported.notebook.session.runningSince,null);assert.equal(exported.notebook.session.elapsedMs,5000);
    assert.notEqual(f.store.snapshot().data.session!.runningSince,null);
    const tutorOnly=f.store.tutor.export(f.conversation.id);
    f.store.backups.restore(tutorOnly,receipt(f.store),now+8000);
    assert.equal(f.store.snapshot().data.session!.runningSince,null);assert.equal(f.store.snapshot().data.session!.elapsedMs,8000);
    const target=new CompanionStore(':memory:');try{target.backups.restore(JSON.stringify(exported),receipt(target),now+86400000);assert.equal(target.snapshot().data.session!.elapsedMs,5000);assert.equal(target.snapshot().data.session!.runningSince,null);}finally{target.close();}
  }finally{f.store.close();}
});
