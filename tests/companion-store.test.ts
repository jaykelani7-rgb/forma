import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionStore } from '../apps/desktop/main/store';
import { backupHash } from '../apps/desktop/main/backup-schema';
import { decodeBackup } from '../src/lib/concurrency';
import { clampPosition, defaultPreferences, validatePreferences } from '../apps/desktop/main/preferences';
import { ClockContinuity } from '../apps/desktop/main/clock-continuity';
import { applySubmissionEvidence } from '../packages/core/src/companion';
import { parseEvent } from '../packages/contracts/src';
import { withPracticeSession } from '../src/lib/practice-session';

const start=Date.parse('2026-10-19T10:00:00Z');
const attach={id:'attach-1',type:'attach',payload:{url:'https://codeforces.com/contest/4/problem/A',title:'Watermelon'}};

test('desktop workspace merges independent changes and preserves conflicting proposals', () => {
  const store = new CompanionStore(':memory:');
  try {
    const base = store.readWorkspace();
    const proposed = (settings: Partial<typeof base.data.settings>) => ({ ...base.data, settings: { ...base.data.settings, ...settings } });
    const first = store.commitWorkspace({ base, proposed: proposed({ displayName: 'First window' }), replace: false }, start);
    const second = store.commitWorkspace({ base, proposed: proposed({ weeklyGoal: 7 }), replace: false }, start + 1);
    assert.deepEqual(first.conflicts, []);
    assert.deepEqual(second.conflicts, []);
    assert.equal(second.record.data.settings.displayName, 'First window');
    assert.equal(second.record.data.settings.weeklyGoal, 7);
    const collision = store.commitWorkspace({ base, proposed: proposed({ displayName: 'Other window' }), replace: false }, start + 2);
    assert.deepEqual(collision.conflicts, ['workspace.settings.displayName']);
    assert.equal(collision.record.revision, second.record.revision);
    assert.equal(store.workspaceRecoveries().find(row => row.id === collision.recoveryId)?.data.settings.displayName, 'Other window');
    store.preserveWorkspaceRecovery({ data: base.data, reason: 'Kept for review' }, start + 3);
    assert.equal(store.workspaceRecoveries()[0].reason, 'Kept for review');

    const replacement = store.commitWorkspace({ base: store.readWorkspace(), proposed: base.data, replace: true }, start + 4);
    assert.deepEqual(replacement.conflicts, []);
    assert.notEqual(replacement.record.recoveryEpoch, base.recoveryEpoch);
    assert.equal(store.workspaceRecoveries().find(row => row.id === replacement.recoveryId)?.data.settings.displayName, 'First window');
    const stale = store.commitWorkspace({ base, proposed: proposed({ displayName: 'Before restore' }), replace: false }, start + 5);
    assert.match(stale.conflicts[0], /notebook was restored/);
    assert.deepEqual(store.readWorkspace(), replacement.record);
  } finally {
    store.close();
  }
});

test('workspace and Ribbon share one session through a running checkpoint, pause, resume and reflection', () => {
  const store = new CompanionStore(':memory:');
  try {
    store.command({ id: 'profile', type: 'set-handle', payload: { handle: 'sample' } }, 'desktop', start);
    store.command(attach, 'desktop', start);
    const base = store.readWorkspace();
    const problem = base.data.problems[0];
    const opened = store.commitWorkspace({
      base, proposed: withPracticeSession(base.data, problem, 30, start, 'workspace-session'), replace: false,
    }, start);
    assert.deepEqual(opened.conflicts, []);
    assert.equal(store.snapshot().state.lifecycle, 'working');
    assert.equal(store.snapshot().state.followups?.[0].id, 'workspace-session');
    const running = store.readWorkspace();
    store.checkpoint(start + 15_000);
    assert.equal(store.readWorkspace().data.session?.elapsedMs, 15_000);
    const paused = store.commitWorkspace({ base: running, replace: false, proposed: {
      ...running.data, session: { ...running.data.session!, runningSince: null, elapsedMs: 16_000 },
    } }, start + 16_000);
    assert.deepEqual(paused.conflicts, []);
    assert.equal(paused.record.data.session?.elapsedMs, 16_000);
    assert.equal(store.snapshot().state.lifecycle, 'paused');
    assert.ok(store.commitWorkspace({ base: store.readWorkspace(), proposed: base.data, replace: true }, start + 17_000).conflicts.length);

    store.command({ id: 'ribbon-resume', type: 'resume', payload: {} }, 'desktop', start + 18_000);
    const resumed = store.readWorkspace();
    const reflecting = store.commitWorkspace({ base: resumed, replace: false, proposed: {
      ...resumed.data, session: { ...resumed.data.session!, runningSince: null, elapsedMs: 17_000, phase: 'reflection' },
    } }, start + 19_000);
    assert.deepEqual(reflecting.conflicts, []);
    assert.equal(store.snapshot().state.followups?.[0].finishedAt, new Date(start + 19_000).toISOString());
    const revising = store.commitWorkspace({ base: reflecting.record, replace: false, proposed: {
      ...reflecting.record.data, session: { ...reflecting.record.data.session!, phase: 'focus' },
    } }, start + 20_000);
    assert.deepEqual(revising.conflicts, []);
    assert.equal(store.snapshot().state.followups?.[0].finishedAt, null);
    store.command({ id: 'ribbon-finish', type: 'finish', payload: {} }, 'desktop', start + 21_000);
    store.command({ id: 'ribbon-save', type: 'reflect', payload: { outcome: 'independent', takeaway: 'Track the boundary.' } }, 'desktop', start + 22_000);
    const saved = store.readWorkspace().data;
    assert.equal(saved.session, null);
    assert.deepEqual(saved.attempts.map(row => [row.id, row.elapsedMs, row.takeaway]), [['workspace-session', 17_000, 'Track the boundary.']]);
    assert.equal(store.snapshot().state.lifecycle, 'closed');
  } finally {
    store.close();
  }
});

test('Ribbon can pause a workspace session on another practice platform', () => {
  const store = new CompanionStore(':memory:');
  try {
    store.command(attach, 'desktop', start);
    const base = store.readWorkspace();
    const problem = { ...base.data.problems[0], id: 'other-platform', platform: 'Custom', url: 'https://example.com/practice', problemCode: '' };
    const result = store.commitWorkspace({
      base, proposed: withPracticeSession(base.data, problem, 30, start, 'custom-session', true), replace: false,
    }, start);
    assert.deepEqual(result.conflicts, []);
    assert.equal(store.snapshot().state.problemId, problem.id);
    assert.equal(store.snapshot().state.identity, null);
    store.command({ id: 'ribbon-pause', type: 'pause', payload: {} }, 'desktop', start + 5000);
    assert.equal(store.readWorkspace().data.session?.elapsedMs, 5000);
  } finally {
    store.close();
  }
});

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
test("desk captures follow the original problem, survive restart and restore, and remain removable", () => {
  const folder = mkdtempSync(join(tmpdir(), "forma-desk-"));
  const path = join(folder, "notebook.sqlite");
  let store = new CompanionStore(path);
  const restored = new CompanionStore(":memory:");
  try {
    const fileUri = "file:///practice/a.cpp";
    const attached = store.command({ ...attach, payload: { ...attach.payload, fileUri } }, "vscode", start);
    const problemId = attached.state.problemId!;
    const expectedProblemKey = attached.state.identity!;
    const thread = { id: "thread", type: "desk-add", expectedProblemKey, payload: { problemId, kind: "thread", text: "Try parity next." } };
    const saved = store.command(thread, "desktop", start);
    assert.equal(store.command(thread, "desktop", start).revision, saved.revision);
    const code = { id: "pin", type: "desk-add", expectedProblemKey, payload: { kind: "code", fileUri, text: "  return x % 2;" } };
    assert.throws(() => store.command(code, "desktop", start), /Pin code from VS Code/);
    assert.throws(() => store.command({ ...code, payload: { ...code.payload, fileUri: "file:///practice/other.cpp" } }, "vscode", start), /Link this solution/);
    store.command(code, "vscode", start);
    const attachment = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const screenshot = { id: "image", type: "desk-add", expectedProblemKey, payload: { kind: "screenshot", text: "", problemId, attachment } };
    assert.throws(() => store.command({ ...screenshot, payload: { ...screenshot.payload, attachment: "data:image/svg+xml;base64,PHN2Zz4=" } }, "desktop", start), /PNG or JPEG/);
    store.command(screenshot, "desktop", start);
    store.close();
    store = new CompanionStore(path);
    const reopened = store.snapshot();
    assert.equal(reopened.data.session, null);
    assert.deepEqual(reopened.state.thoughts, []);
    assert.deepEqual(reopened.state.desk?.map(item => item.text), ["Try parity next.", "  return x % 2;", ""]);
    const backup = store.backups.export({ scope: "companion", includeTutor: false }, start);
    const recovery = restored.backups.export({ scope: "companion", includeTutor: true }, start);
    restored.backups.restore(backup, { json: recovery, sha256: backupHash(recovery) }, start);
    assert.deepEqual(restored.snapshot().state.desk, reopened.state.desk);

    store.command({ id: "other-problem", type: "attach", payload: { url: "https://codeforces.com/contest/4/problem/B" } }, "desktop", start);
    assert.throws(() => store.command({ ...thread, id: "stale-thread" }, "desktop", start), /active problem changed/);
    const remove = { id: "remove", type: "desk-remove", expectedProblemKey, payload: { problemId, itemId: "image" } };
    assert.throws(() => store.command(remove, "desktop", start), /active problem changed/);
    store.command({ ...attach, id: "return" }, "desktop", start);
    store.command(remove, "desktop", start);
    assert.equal(store.exportCompanion().includes(attachment), false);
    assert.equal(store.command(screenshot, "desktop", start).state.desk?.some(item => item.id === "image"), false);
  } finally {
    store.close();
    restored.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test("only an explicitly matched session attaches pinned code to its saved attempt and backup", () => {
  const store = new CompanionStore(":memory:");
  const restored = new CompanionStore(":memory:");
  try {
    const fileUri = "file:///practice/a.cpp";
    const { state } = store.command({ ...attach, payload: { ...attach.payload, fileUri } }, "vscode", start);
    const { data } = store.command({ id: "start", type: "start", payload: {} }, "desktop", start);
    const sessionId = data.session!.id;
    const pin = { id: "unscoped", type: "desk-add", expectedProblemKey: state.identity!,
      payload: { kind: "code", fileUri, text: "  solve();" } };
    store.command(pin, "vscode", start + 1);
    assert.throws(() => store.command({ ...pin, id: "stale", expectedSessionId: "previous" }, "vscode", start + 2), /active session changed/);
    store.command({ ...pin, id: "scoped", expectedSessionId: sessionId }, "vscode", start + 3);
    const saved = store.command({ id: "reflect", type: "reflect", payload: { outcome: "independent" } }, "desktop", start + 4);
    assert.equal(saved.data.attempts[0].id, sessionId);
    assert.deepEqual(saved.state.desk?.map(item => [item.id, item.sessionId]), [["unscoped", undefined], ["scoped", sessionId]]);
    const backup = store.backups.export({ scope: "companion", includeTutor: false }, start + 5);
    const recovery = restored.backups.export({ scope: "companion", includeTutor: true }, start + 5);
    restored.backups.restore(backup, { json: recovery, sha256: backupHash(recovery) }, start + 5);
    assert.deepEqual(restored.snapshot().state.desk, saved.state.desk);
    const forged = JSON.parse(backup);
    forged.companion.desk[1].sessionId = "missing-session";
    assert.throws(() => restored.backups.preview(JSON.stringify(forged)), /original practice session/);
  } finally {
    store.close();
    restored.close();
  }
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
  const store=new CompanionStore(path);store.db.exec('PRAGMA user_version=7');store.close();
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
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,5);
  }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
