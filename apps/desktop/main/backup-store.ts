import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { elapsed, type Data } from '../../../src/lib/model';
import { validateCompanionState, type CompanionState } from '../../../packages/core/src/companion';
import { canonicalProblemIdentity } from '../../../packages/core/src/codeforces-identity';
import type { LocalSnapshot } from './store';
import { BACKUP_LIMIT, backupHash, portableState, validateLocalBackup, type LocalBackup, type TutorBackup } from './backup-schema';

interface BackupOwner {snapshot():LocalSnapshot;replace(data:Data,state:CompanionState,now:number):LocalSnapshot;rotateDraftEpoch():void}
const decode=<T>(v:unknown):T=>JSON.parse(String(v));
/** The existing synchronous database writer owns both validation and replacement. */
export class BackupStore {
  constructor(private db:DatabaseSync,private owner:BackupOwner){}
  private tutor():TutorBackup {
    const bodies=<T>(table:string):T[]=>this.db.prepare(`SELECT body FROM ${table} ORDER BY rowid`).all().map(r=>decode<T>(r.body));
    const draftState=this.db.prepare('SELECT last_conversation_id FROM tutor_draft_state WHERE id=1').get();
    return {conversations:bodies('tutor_conversations'),turns:bodies('tutor_turns'),requests:bodies('tutor_requests'),statements:bodies('tutor_statements'),codes:bodies('tutor_codes'),proposals:bodies('tutor_proposals'),drafts:bodies('tutor_drafts'),
      captures:this.db.prepare('SELECT * FROM tutor_statement_captures ORDER BY sequence').all().map(r=>({sequence:Number(r.sequence),id:String(r.id),statementId:String(r.statement_id),identity:String(r.identity),capturedAt:String(r.captured_at)})),
      current:this.db.prepare('SELECT c.identity,s.id FROM tutor_statement_current c JOIN tutor_statement_captures s ON c.capture_sequence=s.sequence').all().map(r=>({identity:String(r.identity),captureId:String(r.id)})),settings:bodies<TutorBackup['settings']>('tutor_settings')[0],lastConversationId:draftState?.last_conversation_id?String(draftState.last_conversation_id):null};
  }
  export(input:unknown={scope:'companion',includeTutor:false},now=Date.now()):string {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['scope','includeTutor'].includes(k)))throw new Error('Choose a notebook or companion backup.');
    const {scope,includeTutor}=input as {scope:unknown;includeTutor:unknown};
    if(!['notebook','companion'].includes(String(scope))||typeof includeTutor!=='boolean'||scope==='notebook'&&includeTutor)throw new Error('Tutor history is an explicit choice in a full companion backup.');
    const local=this.owner.snapshot(),data=local.data.session?{...local.data,session:{...local.data.session,elapsedMs:elapsed(local.data.session,now),runningSince:null}}:local.data;
    const backup:LocalBackup={format:'forma-local-backup',version:2,exportedAt:new Date(now).toISOString(),scope:scope as 'notebook'|'companion',notebook:data,...(scope==='companion'?{companion:portableState(local.state,data)}:{}),...(includeTutor?{tutor:this.tutor()}:{})};
    const json=JSON.stringify(backup,null,2);if(Buffer.byteLength(json)>BACKUP_LIMIT)throw new Error('This backup exceeds 64 MiB. Export Tutor conversations separately before reducing local history. No records were truncated.');
    validateLocalBackup(json,local.data);return json;
  }
  preview(json:string) {const valid=validateLocalBackup(json,this.owner.snapshot().data);this.checkPreserved(valid.backup);return valid.preview;}
  private checkPreserved(backup:LocalBackup) {
    const before=this.owner.snapshot(),data=backup.notebook??before.data;
    if(!backup.tutor){
      for(const row of this.db.prepare('SELECT body FROM tutor_conversations').all()){
        const c=decode<TutorBackup['conversations'][number]>(row.body),problem=data.problems.find(p=>p.id===c.problemId);
        if(!problem||canonicalProblemIdentity(problem)!==c.identity)throw new Error('This replacement would orphan existing Tutor history. Choose a matching full backup with Tutor included, or export and delete those conversations first.');
      }
    }
    if(backup.scope==='notebook'){
      try{validateCompanionState(before.state,data);}catch{throw new Error('This notebook replacement would orphan companion learning or session records. Use a full companion backup for this replacement.');}
    }
  }
  /** Receipt must be produced by rereading a durable recovery file, not by UI. */
  restore(json:string,receipt:{json:string;sha256:string},now=Date.now()) {
    const before=this.owner.snapshot(),valid=validateLocalBackup(json,before.data);this.checkPreserved(valid.backup);
    if(!receipt||backupHash(receipt.json)!==receipt.sha256)throw new Error('The pre-restore recovery backup could not be verified. Nothing was replaced.');
    const recovery=validateLocalBackup(receipt.json,before.data).backup;
    if(recovery.scope!=='companion'||!recovery.tutor)throw new Error('The recovery backup must include the full companion and Tutor data.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const backup=valid.backup;
      let data=backup.notebook??before.data;
      if(data.session)data={...data,session:{...data.session,elapsedMs:backup.notebook?data.session.elapsedMs:elapsed(data.session,now),runningSince:null}};
      const state=backup.companion??before.state;
      const restoredState=validateCompanionState({...state,lifecycle:data.session?'paused':state.lifecycle},data);
      // For notebook/Tutor-only scope, local bindings remain local and must
      // still validate. Imported bindings are never reactivated.
      if(backup.scope!=='companion')restoredState.bindings=state.bindings;
      if(backup.tutor)this.replaceTutor(backup.tutor,now);
      const snapshot=this.owner.replace(data,restoredState,now);
      if(backup.scope==='companion'){
        // Local command receipts are a replay fence, not imported authority.
        // Keep them across replacement so a lost integration acknowledgement
        // cannot duplicate a prior thought or restart a measured session.
        this.db.exec('DELETE FROM observations; DELETE FROM outbox;');
        this.db.prepare("INSERT INTO outbox VALUES(?,?,'local',?)").run(`restore:${randomUUID()}`,snapshot.revision,snapshot.savedAt);
      }
      this.owner.rotateDraftEpoch();
      this.db.exec('COMMIT');return snapshot;
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private replaceTutor(t:TutorBackup,now:number) {
    this.db.exec('DELETE FROM tutor_conversations; DELETE FROM tutor_statement_current; DELETE FROM tutor_statement_captures; DELETE FROM tutor_statements; DELETE FROM tutor_codes;');
    for(const c of t.conversations)this.db.prepare('INSERT INTO tutor_conversations VALUES(?,?,?,?)').run(c.id,c.identity,c.updatedAt,JSON.stringify(c));
    const interrupted=(turn:TutorBackup['turns'][number])=>['queued','streaming'].includes(turn.status)?{...turn,status:'interrupted' as const,completedAt:new Date(now).toISOString(),error:'Restored backup. Retry explicitly to send a new provider request.'}:turn;
    for(const raw of t.turns){const turn=interrupted(raw);this.db.prepare('INSERT INTO tutor_turns VALUES(?,?,?,?,?)').run(turn.id,turn.conversationId,turn.requestId,turn.status,JSON.stringify(turn));}
    for(const turn of t.requests)this.db.prepare('INSERT INTO tutor_requests VALUES(?,?,?)').run(turn.requestId,turn.id,JSON.stringify(interrupted(turn)));
    for(const s of t.statements)this.db.prepare('INSERT INTO tutor_statements VALUES(?,?,?,?)').run(s.id,s.identity,s.capturedAt,JSON.stringify(s));
    for(const c of t.captures)this.db.prepare('INSERT INTO tutor_statement_captures VALUES(?,?,?,?,?)').run(c.sequence,c.id,c.statementId,c.identity,c.capturedAt);
    for(const c of t.current)this.db.prepare('INSERT INTO tutor_statement_current VALUES(?,?)').run(c.identity,t.captures.find(s=>s.id===c.captureId)!.sequence);
    for(const c of t.codes)this.db.prepare('INSERT INTO tutor_codes VALUES(?,?,?)').run(c.id,c.identity,JSON.stringify(c));
    for(const p of t.proposals)this.db.prepare('INSERT INTO tutor_proposals VALUES(?,?,?)').run(p.id,p.conversationId,JSON.stringify(p));
    for(const d of t.drafts)this.db.prepare('INSERT INTO tutor_drafts VALUES(?,?,?)').run(d.conversationId,d.revision,JSON.stringify(d));
    this.db.prepare('UPDATE tutor_settings SET body=? WHERE id=1').run(JSON.stringify(t.settings));
    this.db.prepare('UPDATE tutor_draft_state SET last_conversation_id=? WHERE id=1').run(t.lastConversationId);
  }
}
