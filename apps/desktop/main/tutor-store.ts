import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { canonicalProblemIdentity } from '../../../packages/core/src/codeforces-identity';
import { availableTutorNotes, freezeTutorContext, parseSharedCode, TUTOR_BUDGET, tutorFields, tutorHash, tutorId, tutorObject, tutorText, validateStatement } from '../../../packages/tutor/context';
import { buildProviderMessages, hintLevelForAction, parseTutorAction } from '../../../packages/tutor/policy';
import type { SharedCode, StatementSnapshot, TutorAction, TutorContextView, TutorConversation, TutorProposal, TutorSendInput, TutorSettings, TutorStoredView, TutorTurn, TutorUsage } from '../../../packages/tutor/types';
import type { LocalSnapshot } from './store';

interface TutorOwner {snapshot():LocalSnapshot;approveTutorLearning(proposal:TutorProposal,now:number):void}
const DEFAULT_SETTINGS:TutorSettings={contestMode:false,retentionDays:90,voiceOutput:false};
const MAX_LOCAL_BYTES=32*1024*1024;
const decode=<T>(value:unknown):T=>JSON.parse(String(value)) as T;

/** Uses only the existing worker's DatabaseSync. No network, credentials or raw audio enter this store. */
export class TutorStore {
  constructor(readonly db:DatabaseSync,private readonly owner:TutorOwner,now=Date.now()) {
    this.transaction(()=>{
      db.exec(`CREATE TABLE IF NOT EXISTS tutor_conversations (id TEXT PRIMARY KEY, identity TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE, request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_requests (id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES tutor_turns(id) ON DELETE CASCADE, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_statements (id TEXT PRIMARY KEY, identity TEXT NOT NULL, captured_at TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_codes (id TEXT PRIMARY KEY, identity TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_proposals (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS tutor_turn_conversation ON tutor_turns(conversation_id);
        CREATE INDEX IF NOT EXISTS tutor_turn_attempt ON tutor_turns(json_extract(body,'$.context.sessionId'),json_extract(body,'$.context.problemId'));
        PRAGMA user_version=3;`);
      db.prepare('INSERT OR IGNORE INTO tutor_settings VALUES(1,?)').run(JSON.stringify(DEFAULT_SETTINGS));
      for(const row of db.prepare("SELECT body FROM tutor_turns WHERE status IN ('queued','streaming')").all()){
        const turn=decode<TutorTurn>(row.body);
        this.writeTurn({...turn,status:'interrupted',completedAt:new Date(now).toISOString(),error:'The app closed before this response finished. Retry explicitly to send another request.'});
      }
      this.prune(now);
    });
  }
  private transaction<T>(work:()=>T):T {
    if(this.db.isTransaction)return work();
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private quota() {
    const total=this.db.prepare(`SELECT SUM(bytes) AS bytes FROM (
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) bytes FROM tutor_conversations UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_turns UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_requests UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_statements UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_codes UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_proposals)`).get();
    // Reserve worst-case UTF-8 room for the one permitted response up front;
    // streaming chunks then need no full-table size scan on every token.
    const active=Number(this.db.prepare("SELECT COUNT(*) n FROM tutor_turns WHERE status IN ('queued','streaming')").get()!.n);
    if(Number(total?.bytes)+active*TUTOR_BUDGET.response*4>MAX_LOCAL_BYTES)throw new Error('Local tutor storage reached 32 MiB. Export and delete an older conversation before continuing.');
  }
  private prune(now:number) {
    const cutoff=new Date(now-this.settings().retentionDays*86400000).toISOString();
    this.db.prepare("DELETE FROM tutor_conversations WHERE updated_at < ? AND id NOT IN (SELECT conversation_id FROM tutor_turns WHERE status IN ('queued','streaming'))").run(cutoff);
    this.db.prepare('DELETE FROM tutor_statements WHERE captured_at < ? AND identity NOT IN (SELECT identity FROM tutor_conversations)').run(cutoff);
    // A staged code share is a short-lived local draft, never an implicit future send.
    for(const row of this.db.prepare('SELECT id,body FROM tutor_codes').all())if(Date.parse(decode<SharedCode>(row.body).capturedAt)<now-86400000)this.db.prepare('DELETE FROM tutor_codes WHERE id=?').run(String(row.id));
  }
  settings():TutorSettings {return decode<TutorSettings>(this.db.prepare('SELECT body FROM tutor_settings WHERE id=1').get()!.body);}
  setSettings(input:unknown,now=Date.now()):TutorSettings {
    const value=tutorObject(input);tutorFields(value,['contestMode','retentionDays','voiceOutput']);
    if(value.contestMode!==undefined&&typeof value.contestMode!=='boolean'||value.voiceOutput!==undefined&&typeof value.voiceOutput!=='boolean'||value.retentionDays!==undefined&&(!Number.isInteger(value.retentionDays)||Number(value.retentionDays)<1||Number(value.retentionDays)>3650))throw new Error('Tutor settings need boolean switches and retention from 1 to 3,650 days.');
    return this.transaction(()=>{
      const settings={...this.settings(),...value} as TutorSettings;
      this.db.prepare('UPDATE tutor_settings SET body=? WHERE id=1').run(JSON.stringify(settings));
      if(settings.contestMode)for(const row of this.db.prepare("SELECT body FROM tutor_turns WHERE status IN ('queued','streaming')").all())this.writeTurn({...decode<TutorTurn>(row.body),status:'interrupted',completedAt:new Date(now).toISOString(),error:'Contest mode stopped assistance.'});
      this.prune(now);return settings;
    });
  }
  view(now=Date.now()):TutorStoredView {
    this.prune(now);
    return {conversations:this.db.prepare('SELECT body FROM tutor_conversations ORDER BY updated_at DESC,id LIMIT 200').all().map(row=>decode<TutorConversation>(row.body)),settings:this.settings(),pendingCode:this.pendingCode()};
  }
  private conversation(id:unknown):TutorConversation {
    const row=this.db.prepare('SELECT body FROM tutor_conversations WHERE id=?').get(tutorId(id));
    if(!row)throw new Error('This local conversation is no longer available.');
    return decode<TutorConversation>(row.body);
  }
  open(input:unknown={},now=Date.now()):TutorConversation {
    const value=tutorObject(input);tutorFields(value,['conversationId','problemId','workspaceId']);
    if(value.conversationId!==undefined)return this.conversation(value.conversationId);
    const snapshot=this.owner.snapshot();
    const problem=snapshot.data.problems.find(problem=>problem.id===(value.problemId??snapshot.state.problemId));
    const identity=problem&&canonicalProblemIdentity(problem);
    if(!problem||!identity)throw new Error('Recognise or attach a Codeforces problem before opening its tutor.');
    const binding=snapshot.state.bindings.find(binding=>binding.problemId===problem.id);
    const workspaceId=tutorId(value.workspaceId??binding?.workspaceId??'personal');
    const existing=this.db.prepare('SELECT body FROM tutor_conversations WHERE identity=? ORDER BY updated_at DESC').all(identity).map(row=>decode<TutorConversation>(row.body)).find(conversation=>conversation.problemId===problem.id&&conversation.workspaceId===workspaceId);
    if(existing)return existing;
    if(Number(this.db.prepare('SELECT COUNT(*) n FROM tutor_conversations').get()!.n)>=200)throw new Error('There are 200 local conversations. Export and delete an older one before opening another.');
    const stamp=new Date(now).toISOString();
    const conversation:TutorConversation={id:randomUUID(),identity,problemId:problem.id,title:problem.title,workspaceId,createdAt:stamp,updatedAt:stamp};
    this.db.prepare('INSERT INTO tutor_conversations VALUES(?,?,?,?)').run(conversation.id,identity,stamp,JSON.stringify(conversation));
    return conversation;
  }
  turns(conversationId:unknown):TutorTurn[] {
    const conversation=this.conversation(conversationId);
    return this.db.prepare('SELECT body FROM tutor_turns WHERE conversation_id=? ORDER BY rowid').all(conversation.id).map(row=>decode<TutorTurn>(row.body));
  }
  statement(input:unknown,now=Date.now()):StatementSnapshot|null {
    const value=tutorObject(input);
    if(Object.keys(value).length===1&&typeof value.identity==='string'){
      if(!/^(contest|gym):[1-9]\d{0,8}:[A-Z]\d{0,8}$/.test(value.identity))throw new Error('Invalid statement identity.');
      const row=this.db.prepare('SELECT body FROM tutor_statements WHERE identity=? ORDER BY captured_at DESC,rowid DESC LIMIT 1').get(value.identity);
      return row?decode<StatementSnapshot>(row.body):null;
    }
    const statement=validateStatement(value,now);
    if(!this.owner.snapshot().data.problems.some(problem=>canonicalProblemIdentity(problem)===statement.identity))throw new Error('Attach this problem before keeping its statement.');
    return this.transaction(()=>{
      this.db.prepare('INSERT OR IGNORE INTO tutor_statements VALUES(?,?,?,?)').run(statement.id,statement.identity,statement.capturedAt,JSON.stringify(statement));this.quota();
      return decode<StatementSnapshot>(this.db.prepare('SELECT body FROM tutor_statements WHERE id=?').get(statement.id)!.body);
    });
  }
  code(input:unknown):SharedCode {
    const code=parseSharedCode(input),snapshot=this.owner.snapshot();
    if(!snapshot.state.bindings.some(binding=>binding.identity===code.identity&&binding.fileUri===code.fileUri&&binding.clientId===code.clientId&&binding.workspaceId===code.workspaceId))throw new Error('This code is not associated with that problem in the approved VS Code workspace. Confirm its association before sharing.');
    return this.transaction(()=>{
      const existing=this.db.prepare('SELECT body FROM tutor_codes WHERE id=?').get(code.id);
      if(existing&&String(existing.body)!==JSON.stringify(code))throw new Error('The shared-code identifier already refers to a different source snapshot.');
      const frozen=this.db.prepare("SELECT body FROM tutor_turns WHERE json_extract(body,'$.context.code.id')=? LIMIT 1").get(code.id);
      if(frozen&&JSON.stringify(decode<TutorTurn>(frozen.body).context.code)!==JSON.stringify(code))throw new Error('This shared-code identifier already belongs to an immutable request snapshot.');
      // Only one unsent selection is retained. Frozen turns hold their own immutable copy.
      this.db.prepare('DELETE FROM tutor_codes WHERE id<>?').run(code.id);
      this.db.prepare('INSERT OR IGNORE INTO tutor_codes VALUES(?,?,?)').run(code.id,code.identity,JSON.stringify(code));this.quota();return code;
    });
  }
  private pendingCode():SharedCode|null {const row=this.db.prepare('SELECT body FROM tutor_codes ORDER BY rowid DESC LIMIT 1').get();return row?decode<SharedCode>(row.body):null;}
  context(conversationId:unknown):TutorContextView {
    const conversation=this.conversation(conversationId),snapshot=this.owner.snapshot(),pending=this.pendingCode();
    const statement=this.statement({identity:conversation.identity});
    const frozen=freezeTutorContext(snapshot,conversation,{statement,code:null,noteIds:[]});
    return {conversation,statement,pendingCode:pending?.identity===conversation.identity&&pending.workspaceId===conversation.workspaceId?pending:null,notes:availableTutorNotes(snapshot,conversation.problemId),sessionId:frozen.sessionId,evidence:frozen.evidence};
  }
  private readTurn(id:unknown):TutorTurn {const row=this.db.prepare('SELECT body FROM tutor_turns WHERE id=?').get(tutorId(id));if(!row)throw new Error('This tutor turn is no longer available.');return decode<TutorTurn>(row.body);}
  private writeTurn(turn:TutorTurn) {
    this.db.prepare('UPDATE tutor_turns SET request_id=?,status=?,body=? WHERE id=?').run(turn.requestId,turn.status,JSON.stringify(turn),turn.id);
  }
  prepare(input:unknown,model:unknown,now=Date.now()):TutorTurn {
    const value=tutorObject(input);tutorFields(value,['turnId','requestId','conversationId','action','text','statementId','codeId','noteIds']);
    const request:TutorSendInput={turnId:tutorId(value.turnId),requestId:tutorId(value.requestId),conversationId:tutorId(value.conversationId),action:parseTutorAction(value.action),text:tutorText(value.text,TUTOR_BUDGET.user,1),statementId:value.statementId===null?null:tutorId(value.statementId),codeId:value.codeId===null?null:tutorId(value.codeId),noteIds:Array.isArray(value.noteIds)?value.noteIds.map(tutorId):[]};
    if(!request.text.trim()||!Array.isArray(value.noteIds))throw new Error('Write a question and explicitly select its context.');
    const selectedModel=tutorText(model,120,1);
    return this.transaction(()=>{
      if(this.settings().contestMode)throw new Error('Contest mode disables problem-specific tutor assistance. Tracking and notes remain available.');
      const conversation=this.conversation(request.conversationId);
      const previousRow=this.db.prepare('SELECT body FROM tutor_turns WHERE id=?').get(request.turnId);
      if(previousRow){
        const previous=decode<TutorTurn>(previousRow.body);
        const old={conversationId:previous.conversationId,action:previous.action,text:previous.userText,statementId:previous.context.statement?.id??null,codeId:previous.context.code?.id??null,noteIds:previous.context.notes.map(note=>note.id).sort()};
        const incoming={conversationId:request.conversationId,action:request.action,text:request.text,statementId:request.statementId,codeId:request.codeId,noteIds:[...request.noteIds].sort()};
        if(JSON.stringify(old)!==JSON.stringify(incoming))throw new Error('This user turn already has a different frozen question or context. Create a new turn.');
        if(previous.requestId===request.requestId)return previous;
        if(!['interrupted','failed'].includes(previous.status))throw new Error('Only a stopped or failed turn can be retried explicitly.');
        if(this.db.prepare("SELECT id FROM tutor_turns WHERE status IN ('queued','streaming') AND id<>? LIMIT 1").get(previous.id))throw new Error('Stop the current tutor response before retrying another request.');
        if(this.db.prepare('SELECT id FROM tutor_requests WHERE id=?').get(request.requestId)||this.db.prepare('SELECT id FROM tutor_turns WHERE request_id=?').get(request.requestId))throw new Error('This provider request ID has already been used.');
        this.db.prepare('INSERT OR IGNORE INTO tutor_requests VALUES(?,?,?)').run(previous.requestId,previous.id,JSON.stringify(previous));
        const retry={...previous,requestId:request.requestId,assistantText:'',status:'queued' as const,completedAt:null,error:null,usage:null,model:selectedModel};
        this.writeTurn(retry);this.quota();return retry;
      }
      if(this.db.prepare("SELECT id FROM tutor_turns WHERE status IN ('queued','streaming') LIMIT 1").get())throw new Error('Stop the current tutor response before sending another request.');
      if(this.db.prepare('SELECT id FROM tutor_requests WHERE id=?').get(request.requestId)||this.db.prepare('SELECT id FROM tutor_turns WHERE request_id=?').get(request.requestId))throw new Error('This provider request ID has already been used.');
      if(this.turns(conversation.id).length>=200)throw new Error('This conversation reached its 200-turn limit. Export and delete it before starting again.');
      let statement:StatementSnapshot|null=null,code:SharedCode|null=null;
      if(request.statementId){const row=this.db.prepare('SELECT body FROM tutor_statements WHERE id=?').get(request.statementId);if(!row)throw new Error('The selected statement snapshot is unavailable.');statement=decode<StatementSnapshot>(row.body);}
      if(request.codeId){const row=this.db.prepare('SELECT body FROM tutor_codes WHERE id=?').get(request.codeId);if(!row)throw new Error('The selected source snapshot changed. Review the new code before sending.');code=decode<SharedCode>(row.body);}
      if(request.action!=='discuss'&&!statement?.complete)throw new Error('Include a complete statement before requesting problem-specific hints, code review, or an explanation. A URL or title is not the statement.');
      if(request.action==='check-code'&&!code)throw new Error('Explicitly share and include selected code before asking for a code check.');
      const context=freezeTutorContext(this.owner.snapshot(),conversation,{statement,code,noteIds:request.noteIds},now);
      const turn:TutorTurn={id:request.turnId,requestId:request.requestId,conversationId:conversation.id,action:request.action,userText:request.text,assistantText:'',context,status:'queued',createdAt:new Date(now).toISOString(),completedAt:null,error:null,hintLevel:hintLevelForAction(request.action,this.turns(conversation.id)),exposed:false,usage:null,model:selectedModel};
      buildProviderMessages(turn,this.turns(conversation.id));
      this.db.prepare('INSERT INTO tutor_turns VALUES(?,?,?,?,?)').run(turn.id,turn.conversationId,turn.requestId,turn.status,JSON.stringify(turn));
      const updated={...conversation,updatedAt:new Date(now).toISOString()};
      this.db.prepare('UPDATE tutor_conversations SET updated_at=?,body=? WHERE id=?').run(updated.updatedAt,JSON.stringify(updated),updated.id);this.quota();return turn;
    });
  }
  append(input:unknown):TutorTurn|null {
    const value=tutorObject(input);tutorFields(value,['turnId','requestId','text']);const turn=this.readTurn(value.turnId),requestId=tutorId(value.requestId),text=tutorText(value.text,TUTOR_BUDGET.response);
    if(turn.requestId!==requestId||!['queued','streaming'].includes(turn.status)||this.settings().contestMode)return null;
    if(turn.assistantText.length+text.length>TUTOR_BUDGET.response)throw new Error('The tutor response reached its 24,000 character limit. Stop and ask a focused follow-up.');
    if(!text)return turn;
    const next={...turn,assistantText:turn.assistantText+text,status:'streaming' as const};
    this.writeTurn(next);return next;
  }
  /** Rendering acknowledgement, separate from provider delivery/persistence. */
  exposed(input:unknown):TutorTurn|null {
    const value=tutorObject(input);tutorFields(value,['turnId','requestId']);const turn=this.readTurn(value.turnId),requestId=tutorId(value.requestId);
    if(turn.requestId===requestId){
      if(!turn.assistantText.trim())return null;
      const exposed={...turn,exposed:true};this.writeTurn(exposed);return exposed;
    }
    // A visible partial may be acknowledged just after an explicit retry. Keep
    // that factual exposure against its archived request and original turn.
    const row=this.db.prepare('SELECT body FROM tutor_requests WHERE id=? AND turn_id=?').get(requestId,turn.id);
    if(!row)return null;
    const previous=decode<TutorTurn>(row.body);if(!previous.assistantText.trim())return null;
    this.db.prepare('UPDATE tutor_requests SET body=? WHERE id=?').run(JSON.stringify({...previous,exposed:true}),requestId);
    const exposed={...turn,exposed:true};this.writeTurn(exposed);return exposed;
  }
  assistance(input:unknown):{shown:number;hintLevels:number[];actions:TutorAction[]} {
    const value=tutorObject(input);tutorFields(value,['problemId','sessionId']);
    const problemId=tutorId(value.problemId),sessionId=tutorId(value.sessionId);
    const rows=this.db.prepare("SELECT json_extract(body,'$.action') action,json_extract(body,'$.hintLevel') hintLevel FROM tutor_turns WHERE json_extract(body,'$.context.sessionId')=? AND json_extract(body,'$.context.problemId')=? AND json_extract(body,'$.exposed')=1").all(sessionId,problemId);
    return {shown:rows.length,hintLevels:[...new Set(rows.map(row=>Number(row.hintLevel)).filter(level=>level>0))].sort((a,b)=>a-b),actions:[...new Set(rows.map(row=>parseTutorAction(row.action)))]};
  }
  finalize(input:unknown,now=Date.now()):TutorTurn|null {
    const value=tutorObject(input);tutorFields(value,['turnId','requestId','status','error','usage']);const turn=this.readTurn(value.turnId),requestId=tutorId(value.requestId);
    if(turn.requestId!==requestId||!['queued','streaming'].includes(turn.status))return null;
    if(!['completed','interrupted','failed'].includes(String(value.status)))throw new Error('Invalid tutor completion status.');
    let usage:TutorUsage|null=null;
    if(value.usage!==null&&value.usage!==undefined){const u=tutorObject(value.usage);tutorFields(u,['inputTokens','outputTokens','totalTokens']);if(![u.inputTokens,u.outputTokens,u.totalTokens].every(n=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=100_000_000)||Number(u.totalTokens)<Number(u.inputTokens)+Number(u.outputTokens))throw new Error('Invalid provider usage.');usage={inputTokens:Number(u.inputTokens),outputTokens:Number(u.outputTokens),totalTokens:Number(u.totalTokens)};}
    const status=this.settings().contestMode?'interrupted':value.status as 'completed'|'interrupted'|'failed';
    if(status==='completed'&&!turn.assistantText.trim())throw new Error('An empty provider response cannot be marked complete.');
    const next={...turn,status,completedAt:new Date(now).toISOString(),error:value.error===null||value.error===undefined?null:tutorText(value.error,500),usage};this.writeTurn(next);return next;
  }
  delete(conversationId:unknown) {
    const conversation=this.conversation(conversationId);
    this.transaction(()=>{
      this.db.prepare('DELETE FROM tutor_conversations WHERE id=?').run(conversation.id);
      if(!this.db.prepare('SELECT id FROM tutor_conversations WHERE identity=?').get(conversation.identity))this.db.prepare('DELETE FROM tutor_statements WHERE identity=?').run(conversation.identity);
      this.db.prepare('DELETE FROM tutor_codes WHERE identity=?').run(conversation.identity);
    });return {deleted:true};
  }
  export(conversationId?:unknown):string {
    const conversations=conversationId===undefined?this.view().conversations:[this.conversation(conversationId)];
    return JSON.stringify({format:'forma-tutor',version:1,exportedAt:new Date().toISOString(),conversations:conversations.map(conversation=>({conversation,turns:this.turns(conversation.id),previousRequests:this.db.prepare('SELECT body FROM tutor_requests WHERE turn_id IN (SELECT id FROM tutor_turns WHERE conversation_id=?) ORDER BY rowid').all(conversation.id).map(row=>decode<TutorTurn>(row.body)),proposals:this.db.prepare('SELECT body FROM tutor_proposals WHERE conversation_id=?').all(conversation.id).map(row=>decode<TutorProposal>(row.body))}))},null,2);
  }
  propose(input:unknown,now=Date.now()):TutorProposal {
    const value=tutorObject(input);tutorFields(value,['id','turnId','kind','text']);const id=tutorId(value.id),turn=this.readTurn(value.turnId);
    if(!['thought','takeaway'].includes(String(value.kind)))throw new Error('Choose a supported learning-note destination.');
    if(!turn.exposed||!turn.assistantText.trim())throw new Error('There is no shown tutor response to save.');
    const text=tutorText(value.text,value.kind==='takeaway'?300:10_000,1).trim();if(!text)throw new Error('Review the proposed note text before saving.');
    const proposal:TutorProposal={id,conversationId:turn.conversationId,turnId:turn.id,problemId:turn.context.problemId,identity:turn.context.identity,sessionId:turn.context.sessionId,kind:value.kind as TutorProposal['kind'],text,createdAt:new Date(now).toISOString(),saved:false};
    const existing=this.db.prepare('SELECT body FROM tutor_proposals WHERE id=?').get(id);
    if(existing){const old=decode<TutorProposal>(existing.body);if(tutorHash(JSON.stringify({...old,saved:false,createdAt:null}))!==tutorHash(JSON.stringify({...proposal,createdAt:null})))throw new Error('This proposal ID already belongs to different text or a different destination.');return old;}
    return this.transaction(()=>{
      if(Number(this.db.prepare('SELECT COUNT(*) n FROM tutor_proposals WHERE conversation_id=?').get(proposal.conversationId)!.n)>=200)throw new Error('This conversation reached its 200-proposal limit. Export and delete older conversations before continuing.');
      this.db.prepare('INSERT INTO tutor_proposals VALUES(?,?,?)').run(id,proposal.conversationId,JSON.stringify(proposal));this.quota();return proposal;
    });
  }
  approve(proposalId:unknown,now=Date.now()):TutorProposal {
    const id=tutorId(proposalId);
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT body FROM tutor_proposals WHERE id=?').get(id);if(!row)throw new Error('This proposed note is unavailable.');
      const proposal=decode<TutorProposal>(row.body);if(proposal.saved)return proposal;
      this.owner.approveTutorLearning(proposal,now);
      const saved={...proposal,saved:true};this.db.prepare('UPDATE tutor_proposals SET body=? WHERE id=?').run(JSON.stringify(saved),id);return saved;
    });
  }
}
