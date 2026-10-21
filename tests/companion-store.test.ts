import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionStore } from '../apps/desktop/main/store';
import { decodeBackup } from '../src/lib/concurrency';
import { clampPosition, defaultPreferences, validatePreferences } from '../apps/desktop/main/preferences';
import { ClockContinuity } from '../apps/desktop/main/clock-continuity';
import { applySubmissionEvidence } from '../packages/core/src/companion';
import { parseEvent } from '../packages/contracts/src';

const start=Date.parse('2026-10-19T10:00:00Z');
const attach={id:'attach-1',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',title:'Watermelon'}};
test('SQLite command, immutable receipt and outbox commit atomically; retries survive reopen',()=>{
  const folder=mkdtempSync(join(tmpdir(),'forma-store-'));const path=join(folder,'notebook.sqlite');
  let store=new CompanionStore(path);
  try{
    const first=store.command(attach,'desktop',start);
    assert.equal(first.data.attempts.length,0);
    store.close();store=new CompanionStore(path);
    assert.equal(store.command(attach,'desktop',start).revision,first.revision);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM applied_commands').get()!.n,1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM observations').get()!.n,1);
    assert.ok(store.db.prepare('SELECT id FROM outbox WHERE id=?').get(attach.id));
    assert.throws(()=>store.command({...attach,payload:{...attach.payload,title:'Other'}}),/already used/);
    const before=store.snapshot();
    assert.throws(()=>store.command({id:'bad',type:'reflect',payload:{outcome:'independent'}},'desktop',start),/Start a timed/);
    assert.deepEqual(store.snapshot(),before);
    assert.equal(store.db.prepare('SELECT id FROM applied_commands WHERE id=?').get('bad'),undefined);
  }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
test('captured thoughts survive a crash and canonical export never invents untimed attempts',()=>{
  const store=new CompanionStore(':memory:');
  try{
    store.command(attach,'desktop',start);
    store.command({id:'thought',type:'thought',payload:{text:'Try a parity argument.'}},'desktop',start+1000);
    assert.equal(store.snapshot().state.thoughts[0].text,'Try a parity argument.');
    const backup=decodeBackup(store.exportNotebook());
    assert.equal(backup.attempts.length,0);
    assert.equal(backup.session,null);
    const companion=JSON.parse(store.exportCompanion());
    assert.equal(companion.state.thoughts[0].text,'Try a parity argument.');
    assert.equal(companion.observations.length,2);
    assert.equal('credential' in companion,false);
  }finally{store.close();}
});
test('recovery uses only checkpointed time and retains a real session for reflection',()=>{
  const store=new CompanionStore(':memory:');
  try{
    store.command(attach,'desktop',start);
    store.command({id:'start',type:'start',payload:{}},'desktop',start);
    store.checkpoint(start+15000);
    const recovered=store.pauseForLifecycle('restart',start+86400000);
    assert.equal(recovered.data.session!.elapsedMs,15000);
    assert.equal(recovered.data.session!.runningSince,null);
    assert.equal(recovered.state.lifecycle,'paused');
    store.command({id:'finish',type:'finish',payload:{}},'desktop',start+86400000);
    const reflected=store.command({id:'reflection',type:'reflect',payload:{outcome:'hint',takeaway:'Parity.'}},'desktop',start+86400001);
    assert.equal(reflected.data.attempts[0].elapsedMs,15000);
    assert.equal(reflected.data.attempts[0].outcome,'hint');
    assert.ok(reflected.data.problems[0].reviewAt);
    assert.equal(reflected.data.session,null);
  }finally{store.close();}
});
test('monitor removal, negative display origins and oversized cards stay within work area',()=>{
  assert.deepEqual(clampPosition({x:3000,y:-2000},{width:380,height:700},{x:-1920,y:0,width:1920,height:1080}),{x:-380,y:0});
  assert.deepEqual(clampPosition({x:0,y:0},{width:380,height:700},{x:20,y:30,width:300,height:500}),{x:20,y:30});
  assert.throws(()=>validatePreferences({...defaultPreferences(),position:{x:Infinity,y:1}}),/position/);
});
test('small forward and backward clock corrections are detected before writes, while normal elapsed time is accepted',()=>{
  const clock=new ClockContinuity(start,0);
  assert.equal(clock.sample(start+15000,15000),false);
  assert.equal(clock.sample(start+50000,30000),true);
  assert.equal(clock.sample(start+65000,45000),false);
  assert.equal(clock.sample(start+60000,60000),true);
});
test('unchanged successful platform polls update freshness without growing the evidence journal',()=>{
  const store=new CompanionStore(':memory:');
  try{
    store.command(attach,'desktop',start);
    const before=store.db.prepare('SELECT COUNT(*) AS n FROM observations').get()!.n;
    for(let n=0;n<10;n++)store.updateEvidence(`poll-${n}`,(data,state)=>({data,state:{...state,checkedAt:new Date(start+n*30000).toISOString()}}),{},start+n*30000);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM observations').get()!.n,before);
    assert.equal(store.snapshot().state.checkedAt,new Date(start+270000).toISOString());
  }finally{store.close();}
});
test('changed verdicts append validated small batches while prior evidence and learning survive',()=>{
  const store=new CompanionStore(':memory:');
  try{
    store.command({id:'handle',type:'set-handle',payload:{handle:'tourist'}},'desktop',start);
    store.command(attach,'desktop',start);
    store.command({id:'start',type:'start',payload:{}},'desktop',start);
    const row={id:9,submittedAt:new Date(start+1000).toISOString(),verdict:'OK',language:'C++',problem:{key:'contest:4:A',title:'Watermelon',code:'4A',url:attach.payload.url,rating:null,tags:[]}};
    for(const [id,verdict,offset] of [['first','OK',2000],['rejudge','WRONG_ANSWER',3000]] as const){
      const evidence={handle:'tourist',submissions:[{...row,verdict}],checkedAt:new Date(start+offset).toISOString()};
      store.updateEvidence(id,(data,state)=>applySubmissionEvidence(data,state,evidence,start+offset),evidence,start+offset);
    }
    const events=store.db.prepare("SELECT body FROM observations WHERE kind='platform'").all().map(row=>parseEvent(JSON.parse(String(row.body))));
    assert.equal(events.length,2);assert.equal(events[0].eventType,'SubmissionBatchObserved');
    assert.equal(store.snapshot().state.platform,'rejected');assert.equal(store.snapshot().data.attempts.length,0);
  }finally{store.close();}
});
test('an older desktop cannot overwrite a newer SQLite schema version',()=>{
  const folder=mkdtempSync(join(tmpdir(),'forma-newer-'));const path=join(folder,'notebook.sqlite');
  const store=new CompanionStore(path);store.db.exec('PRAGMA user_version=4');store.close();
  try{assert.throws(()=>new CompanionStore(path),/newer Forma Companion/);}finally{rmSync(folder,{recursive:true,force:true});}
});
test('version-one notebooks migrate without dropping bindings, thoughts, receipts or outbox captures',()=>{
  const folder=mkdtempSync(join(tmpdir(),'forma-upgrade-'));const path=join(folder,'notebook.sqlite');
  let store=new CompanionStore(path);
  try{
    store.command({id:'legacy-attach',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',fileUri:'file:///practice/a.cpp',source:'manual'}});
    store.command({id:'legacy-thought',type:'thought',payload:{text:'Retain this thought'}});
    const before=store.snapshot();const receipts=store.db.prepare('SELECT * FROM applied_commands').all();const outbox=store.db.prepare('SELECT * FROM outbox').all();
    store.db.exec('PRAGMA user_version=1');store.close();store=new CompanionStore(path);
    assert.deepEqual(store.snapshot(),before);assert.deepEqual(store.db.prepare('SELECT * FROM applied_commands').all(),receipts);assert.deepEqual(store.db.prepare('SELECT * FROM outbox').all(),outbox);
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,3);
  }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
