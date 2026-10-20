import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { emptyData, elapsed, validateData, type Data } from "../../../src/lib/model";
import { decodeBackup, encodeBackup, mergeWorkspaces } from "../../../src/lib/concurrency";
import { applyCompanionCommand, initialCompanionState, validateCompanionState, type CompanionState } from "../../../packages/core/src/companion";
import { parseCommand, parseEvent } from "../../../packages/contracts/src/index";
import { defaultPreferences, validatePreferences } from "./preferences";

export interface LocalSnapshot { data: Data; state: CompanionState; revision: number; savedAt: string }
const MAX_DEVICE_BYTES = 8 * 1024 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** One instance, in the database worker, owns all notebook writes. */
export class CompanionStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version??0);
    if(version>1){this.db.close();throw new Error('This notebook was written by a newer Forma Companion. Upgrade the app before opening it; the original file is preserved.');}
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, notebook TEXT NOT NULL, device TEXT NOT NULL, saved_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applied_commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recoveries (id TEXT PRIMARY KEY, notebook TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_checkpoints (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1;`);
    this.db.prepare('INSERT OR IGNORE INTO workspace VALUES(1,0,?,?,?)').run(encodeBackup(emptyData()), JSON.stringify(initialCompanionState()), new Date().toISOString());
  }
  close() { this.db.close(); }
  snapshot(): LocalSnapshot {
    const row = this.db.prepare('SELECT * FROM workspace WHERE id=1').get()!;
    const data=validateData(JSON.parse(String(row.notebook)));
    return {data, state: validateCompanionState(JSON.parse(String(row.device)),data), revision:Number(row.revision), savedAt:String(row.saved_at)};
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private persist(next: {data:Data;state:CompanionState}, revision:number, now:number) {
    const device=JSON.stringify(validateCompanionState(next.state,next.data));
    if (Buffer.byteLength(device) > MAX_DEVICE_BYTES) throw new Error('The companion capture store is full. Export a companion backup before continuing. Nothing was truncated.');
    const at=new Date(now).toISOString();
    this.db.prepare('UPDATE workspace SET revision=?, notebook=?, device=?, saved_at=? WHERE id=1').run(revision,encodeBackup(next.data),device,at);
    this.db.prepare("INSERT INTO outbox VALUES('notebook',?,'local',?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, created_at=excluded.created_at").run(revision,at);
    return {...next, revision, savedAt:at};
  }
  command(input: unknown, producer = 'desktop', now=Date.now()): LocalSnapshot {
    const command = parseCommand(input,now);
    const fingerprint=hash(JSON.stringify(command));
    return this.transaction(() => {
      const previous=this.db.prepare('SELECT * FROM applied_commands WHERE id=?').get(command.id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('This command ID was already used for a different action.');
        return this.snapshot();
      }
      const before=this.snapshot();
      const journal=this.db.prepare('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM observations').get()!;
      if(Number(journal.bytes)>32*1024*1024)throw new Error('The local observation journal is full. Export a companion backup before continuing. Saved captures are preserved.');
      const next=applyCompanionCommand(before.data,before.state,command,now);
      const saved=this.persist(next,before.revision+1,now);
      this.db.prepare('INSERT INTO applied_commands VALUES(?,?,?)').run(command.id,fingerprint,saved.revision);
      const event=parseEvent({eventId:command.id,eventVersion:1,eventType:'CommandReceived',deviceId:this.deviceId(),producer:['vscode','desktop','user'].includes(producer)?producer:'desktop',producerVersion:'0.1.0',workspaceKey:'personal',occurredAt:command.occurredAt ?? saved.savedAt,receivedAt:saved.savedAt,correlationId:command.id,payload:command});
      this.db.prepare('INSERT INTO observations VALUES(?,?,?,?)').run(command.id,command.type,JSON.stringify(event),saved.savedAt);
      this.db.prepare('INSERT INTO outbox VALUES(?,?,?,?)').run(command.id,saved.revision,'local',saved.savedAt);
      return saved;
    });
  }
  private deviceId(){
    let row=this.db.prepare('SELECT value FROM preferences WHERE id=?').get('device-id');
    if(!row){this.db.prepare('INSERT INTO preferences VALUES(?,?)').run('device-id',randomUUID());row=this.db.prepare('SELECT value FROM preferences WHERE id=?').get('device-id');}
    return String(row!.value);
  }
  /** Platform evidence is a separate projection; it never awards learning credit. */
  updateEvidence(id:string, update:(data:Data,state:CompanionState)=>{data:Data;state:CompanionState}, body:unknown, now=Date.now()) {
    // The updater emits validated, attributable rows. Raw upstream payloads are
    // deliberately not copied into the journal.
    void body;
    return this.transaction(() => {
      if (this.db.prepare('SELECT id FROM observations WHERE id=?').get(id)) return this.snapshot();
      const before=this.snapshot();
      const next=update(before.data,before.state);
      const stable=(state:CompanionState)=>JSON.stringify(state.submissions.map(submission=>({...submission,observedAt:undefined})));
      const changed=stable(before.state)!==stable(next.state);
      if(changed){
        const journal=this.db.prepare("SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM observations WHERE kind='platform'").get()!;
        if(Number(journal.bytes)>16*1024*1024)throw new Error('Platform history has reached its local journal limit. Export a companion backup. Notes and reflections remain available.');
      }
      const saved=this.persist(next,before.revision+1,now);
      if(changed){
        const previous=new Map(before.state.submissions.map(s=>[`${s.handle.toLowerCase()}:${s.id}`,s]));
        const submissions=next.state.submissions.filter(s=>{const old=previous.get(`${s.handle.toLowerCase()}:${s.id}`);return !old||JSON.stringify({...old,observedAt:undefined})!==JSON.stringify({...s,observedAt:undefined});});
        const event=parseEvent({eventId:id,eventVersion:1,eventType:'SubmissionBatchObserved',deviceId:this.deviceId(),producer:'codeforces',producerVersion:'public-api-v1',workspaceKey:'personal',occurredAt:saved.savedAt,receivedAt:saved.savedAt,correlationId:id,payload:{handle:next.state.handle,checkedAt:next.state.checkedAt,submissions}});
        this.db.prepare('INSERT INTO observations VALUES(?,?,?,?)').run(id,'platform',JSON.stringify(event),saved.savedAt);
      }
      return saved;
    });
  }
  pauseForLifecycle(reason:string, now=Date.now()) {
    const before=this.snapshot();
    if (before.data.session?.runningSince === null || !before.data.session) return before;
    // Session checkpoints cannot establish time across a process crash; omit the
    // uncheckpointed interval instead of inventing an overnight work duration.
    if (reason==='restart'||reason==='clock-discontinuity') {
      return this.transaction(() => this.persist({data:{...before.data,session:{...before.data.session!,elapsedMs:elapsed(before.data.session!,Date.parse(before.savedAt)),runningSince:null}},state:{...before.state,lifecycle:'paused'}},before.revision+1,now));
    }
    return this.command({id:randomUUID(),type:'pause',payload:{}},reason,now);
  }
  checkpoint(now=Date.now()) {
    const before=this.snapshot();
    if(!before.data.session||before.data.session.runningSince===null)return before;
    return this.transaction(()=>this.persist({data:{...before.data,session:{...before.data.session!,elapsedMs:elapsed(before.data.session!,now),runningSince:now}},state:before.state},before.revision+1,now));
  }
  preferences() {
    const row=this.db.prepare('SELECT value FROM preferences WHERE id=?').get('companion');
    return row ? validatePreferences(JSON.parse(String(row.value))) : defaultPreferences();
  }
  setPreferences(value:unknown) {
    const valid=validatePreferences(value);
    this.db.prepare('INSERT INTO preferences VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('companion',JSON.stringify(valid));
    return valid;
  }
  importNotebook(json:string, now=Date.now()) {
    const imported=decodeBackup(json);
    const before=this.snapshot();
    if (before.data.session || imported.session) throw new Error('Finish open sessions before importing. Keep the original backup to preserve an unfinished session.');
    const merged=mergeWorkspaces(emptyData(),before.data,imported);
    if (merged.conflicts.length) {
      this.db.prepare('INSERT INTO recoveries VALUES(?,?,?,?)').run(randomUUID(),encodeBackup(imported),'Import conflicts: '+merged.conflicts.join(', '),new Date(now).toISOString());
      throw new Error('Some records conflict. The imported copy is preserved in your companion backup; the current notebook is unchanged.');
    }
    return this.transaction(() => {
      this.db.prepare('INSERT INTO recoveries VALUES(?,?,?,?)').run(randomUUID(),encodeBackup(before.data),'Before notebook import',new Date(now).toISOString());
      const saved=this.persist({data:merged.data,state:before.state},before.revision+1,now);
      this.db.prepare('INSERT INTO outbox VALUES(?,?,?,?)').run(randomUUID(),saved.revision,'local',saved.savedAt);
      return saved;
    });
  }
  exportNotebook() { return encodeBackup(this.snapshot().data); }
  exportCompanion() {
    return JSON.stringify({format:'forma-companion',version:1,exportedAt:new Date().toISOString(),...this.snapshot(),preferences:this.preferences(),observations:this.db.prepare('SELECT * FROM observations').all(),commands:this.db.prepare('SELECT * FROM applied_commands').all(),outbox:this.db.prepare('SELECT * FROM outbox').all(),recoveries:this.db.prepare('SELECT * FROM recoveries').all()},null,2);
  }
}
