import { createHash } from 'node:crypto';
import { validateData, type Data } from '../../../src/lib/model';
import { initialCompanionState, validateCompanionState, type CompanionState } from '../../../packages/core/src/companion';
import { canonicalProblemIdentity, normalizeCodeforcesIdentity } from '../../../packages/core/src/codeforces-identity';
import { parseSharedCode, parseStatementInput, tutorFields, tutorId, tutorObject, tutorText, tutorTime, validateStatement, TUTOR_BUDGET } from '../../../packages/tutor/context';
import { parseTutorAction } from '../../../packages/tutor/policy';
import type { SharedCode, StatementSnapshot, TutorContext, TutorConversation, TutorProposal, TutorSettings, TutorTurn } from '../../../packages/tutor/types';
import type { BackupRestorePreview } from '../../../packages/setup/status';

export const BACKUP_LIMIT=64*1024*1024;
export type BackupScope='notebook'|'companion'|'tutor';
export interface BackupDraft {conversationId:string;identity:string;problemId:string;workspaceId:string;revision:number;updatedAt:string;text:string;action:ReturnType<typeof parseTutorAction>;statementId:string|null;codeId:string|null;noteIds:string[]}
export interface TutorBackup {
  conversations:TutorConversation[];turns:TutorTurn[];requests:TutorTurn[];statements:StatementSnapshot[];
  captures:{sequence:number;id:string;statementId:string;identity:string;capturedAt:string}[];
  current:{identity:string;captureId:string}[];codes:SharedCode[];proposals:TutorProposal[];drafts:BackupDraft[];
  settings:TutorSettings;lastConversationId:string|null;
}
export interface LocalBackup {format:'forma-local-backup';version:2;exportedAt:string;scope:BackupScope;notebook?:Data;companion?:CompanionState;tutor?:TutorBackup}
export interface ValidatedBackup {backup:LocalBackup;warnings:string[];preview:Omit<BackupRestorePreview,'token'>}
const identity=(v:unknown)=>{const s=tutorText(v,100,1);if(!/^(contest|gym):[1-9]\d{0,8}:[A-Z]\d{0,8}$/.test(s))throw new Error('Invalid backup problem identity.');return s;};
const integer=(v:unknown,min=0,max=1_000_000)=>{if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new Error('Invalid backup count or revision.');return Number(v);};
const bool=(v:unknown)=>{if(typeof v!=='boolean')throw new Error('Invalid backup switch.');return v;};
const nullableId=(v:unknown)=>v===null?null:tutorId(v);
const list=<T>(v:unknown,max:number,parse:(v:unknown)=>T):T[]=>{if(!Array.isArray(v)||v.length>max)throw new Error('The backup exceeds a supported record count.');return v.map(parse);};
const unique=<T>(values:T[],key:(v:T)=>string)=>{if(new Set(values.map(key)).size!==values.length)throw new Error('The backup contains duplicate identifiers.');return values;};
export const backupHash=(json:string)=>createHash('sha256').update(json).digest('hex');
/** Bound allocation/depth before any domain validator traverses untrusted JSON. */
export function parseBackupJson(json:string):Record<string,unknown> {
  if(typeof json!=='string'||Buffer.byteLength(json)>BACKUP_LIMIT)throw new Error('Choose a local backup no larger than 64 MiB.');
  const value:unknown=JSON.parse(json);let nodes=0;const pending:{v:unknown;depth:number}[]=[{v:value,depth:0}];
  while(pending.length){const {v,depth}=pending.pop()!;if(++nodes>2_000_000||depth>32)throw new Error('The backup is too complex or deeply nested.');
    if(v&&typeof v==='object'){if(!Array.isArray(v)&&Object.keys(v).some(k=>['__proto__','prototype','constructor'].includes(k)))throw new Error('Unsafe backup fields.');for(const child of Object.values(v))pending.push({v:child,depth:depth+1});}}
  return tutorObject(value);
}
function statement(v:unknown):StatementSnapshot {
  const o=tutorObject(v);tutorFields(o,['identity','url','title','description','input','output','constraints','samples','explanation','complete','source','id','revision','capturedAt']);
  const {id,revision,capturedAt,...input}=o;const parsed=parseStatementInput(input),checked=validateStatement(parsed);
  if(revision!==checked.revision)throw new Error('A backup statement does not match its immutable revision.');
  return {...parsed,id:tutorId(id),revision:String(revision),capturedAt:tutorTime(capturedAt)};
}
function conversation(v:unknown):TutorConversation {
  const o=tutorObject(v);tutorFields(o,['id','identity','problemId','title','workspaceId','createdAt','updatedAt']);
  return {id:tutorId(o.id),identity:identity(o.identity),problemId:tutorText(o.problemId,200,1),title:tutorText(o.title,300,1),workspaceId:tutorId(o.workspaceId),createdAt:tutorTime(o.createdAt),updatedAt:tutorTime(o.updatedAt)};
}
function context(v:unknown):TutorContext {
  const o=tutorObject(v);tutorFields(o,['version','identity','problemId','title','url','workspaceId','conversationId','sessionId','statement','code','notes','evidence','frozenAt']);
  if(o.version!==1||normalizeCodeforcesIdentity(String(o.url))?.key!==o.identity)throw new Error('Invalid frozen Tutor context.');
  const e=tutorObject(o.evidence);tutorFields(e,['platform','checkedAt','localTests','submissions']);
  const notes=unique(list(o.notes,20,n=>{const p=tutorObject(n);tutorFields(p,['id','text']);return {id:tutorId(p.id),text:tutorText(p.text,10_300)};}),n=>n.id);
  if(notes.reduce((sum,n)=>sum+n.text.length,0)>TUTOR_BUDGET.notes)throw new Error('The frozen notes exceed their context budget.');
  const result:TutorContext={version:1,identity:identity(o.identity),problemId:tutorText(o.problemId,200,1),title:tutorText(o.title,300,1),url:tutorText(o.url,400,1),workspaceId:tutorId(o.workspaceId),conversationId:tutorId(o.conversationId),sessionId:nullableId(o.sessionId),statement:o.statement===null?null:statement(o.statement),code:o.code===null?null:parseSharedCode(o.code),notes,evidence:{platform:tutorText(e.platform,100),checkedAt:e.checkedAt===null?null:tutorTime(e.checkedAt),localTests:tutorText(e.localTests,100),submissions:list(e.submissions,10,s=>{const p=tutorObject(s);tutorFields(p,['id','verdict','observedAt']);return {id:integer(p.id,1,Number.MAX_SAFE_INTEGER),verdict:p.verdict===null?null:tutorText(p.verdict,100),observedAt:tutorTime(p.observedAt)};})},frozenAt:tutorTime(o.frozenAt)};
  if(result.statement&&result.statement.identity!==result.identity||result.code&&(result.code.identity!==result.identity||result.code.workspaceId!==result.workspaceId))throw new Error('Frozen source references belong to another problem or workspace.');
  return result;
}
function turn(v:unknown):TutorTurn {
  const o=tutorObject(v);tutorFields(o,['id','requestId','conversationId','action','userText','assistantText','context','status','createdAt','completedAt','error','hintLevel','exposed','usage','model','provider','responseModel']);
  if(!['queued','streaming','completed','interrupted','failed'].includes(String(o.status))||o.provider!==undefined&&!['gemini','openai'].includes(String(o.provider)))throw new Error('Invalid Tutor turn status or provider.');
  let usage:TutorTurn['usage']=null;if(o.usage!==null){const u=tutorObject(o.usage);tutorFields(u,['inputTokens','outputTokens','totalTokens']);usage={inputTokens:integer(u.inputTokens,0,100_000_000),outputTokens:integer(u.outputTokens,0,100_000_000),totalTokens:integer(u.totalTokens,0,100_000_000)};if(usage.totalTokens<usage.inputTokens+usage.outputTokens)throw new Error('Invalid usage totals.');}
  const t:TutorTurn={id:tutorId(o.id),requestId:tutorId(o.requestId),conversationId:tutorId(o.conversationId),action:parseTutorAction(o.action),userText:tutorText(o.userText,TUTOR_BUDGET.user,1),assistantText:tutorText(o.assistantText,TUTOR_BUDGET.response),context:context(o.context),status:o.status as TutorTurn['status'],createdAt:tutorTime(o.createdAt),completedAt:o.completedAt===null?null:tutorTime(o.completedAt),error:o.error===null?null:tutorText(o.error,500),hintLevel:integer(o.hintLevel,0,1000),exposed:bool(o.exposed),usage,model:tutorText(o.model,120,1),provider:(o.provider??'openai') as 'openai'|'gemini',...(o.responseModel===undefined?{}:{responseModel:tutorText(o.responseModel,120,1)})};
  if(t.context.conversationId!==t.conversationId)throw new Error('Invalid turn conversation reference.');return t;
}
function settings(v:unknown):TutorSettings {const o=tutorObject(v);tutorFields(o,['contestMode','retentionDays','voiceOutput']);return {contestMode:bool(o.contestMode),retentionDays:integer(o.retentionDays,1,3650),voiceOutput:bool(o.voiceOutput)};}
function draft(v:unknown):BackupDraft {
  const o=tutorObject(v);tutorFields(o,['conversationId','identity','problemId','workspaceId','revision','updatedAt','text','action','statementId','codeId','noteIds']);
  return {conversationId:tutorId(o.conversationId),identity:identity(o.identity),problemId:tutorText(o.problemId,200,1),workspaceId:tutorId(o.workspaceId),revision:integer(o.revision,0,1_000_000_000),updatedAt:tutorTime(o.updatedAt),text:tutorText(o.text,TUTOR_BUDGET.user),action:parseTutorAction(o.action),statementId:nullableId(o.statementId),codeId:nullableId(o.codeId),noteIds:unique(list(o.noteIds,20,tutorId),n=>n)};
}
function proposal(v:unknown):TutorProposal {
  const o=tutorObject(v);tutorFields(o,['id','conversationId','turnId','problemId','identity','sessionId','kind','text','createdAt','saved']);
  if(o.kind!=='thought'&&o.kind!=='takeaway')throw new Error('Invalid learning proposal.');
  return {id:tutorId(o.id),conversationId:tutorId(o.conversationId),turnId:tutorId(o.turnId),problemId:tutorText(o.problemId,200,1),identity:identity(o.identity),sessionId:nullableId(o.sessionId),kind:o.kind,text:tutorText(o.text,o.kind==='thought'?10_000:300,1),createdAt:tutorTime(o.createdAt),saved:bool(o.saved)};
}
function tutor(v:unknown,data:Data,state?:CompanionState):TutorBackup {
  const o=tutorObject(v);tutorFields(o,['conversations','turns','requests','statements','captures','current','codes','proposals','drafts','settings','lastConversationId']);
  const result:TutorBackup={conversations:unique(list(o.conversations,1000,conversation),c=>c.id),turns:unique(list(o.turns,20_000,turn),t=>t.id),requests:unique(list(o.requests,20_000,turn),t=>t.requestId),statements:unique(list(o.statements,20_000,statement),s=>s.id),codes:unique(list(o.codes,1000,parseSharedCode),c=>c.id),proposals:unique(list(o.proposals,20_000,proposal),p=>p.id),drafts:unique(list(o.drafts,1000,draft),d=>d.conversationId),settings:settings(o.settings),lastConversationId:nullableId(o.lastConversationId),captures:unique(list(o.captures,50_000,v=>{const p=tutorObject(v);tutorFields(p,['sequence','id','statementId','identity','capturedAt']);return {sequence:integer(p.sequence,1,1_000_000_000),id:tutorId(p.id),statementId:tutorId(p.statementId),identity:identity(p.identity),capturedAt:tutorTime(p.capturedAt)};}),c=>c.id),current:unique(list(o.current,1000,v=>{const p=tutorObject(v);tutorFields(p,['identity','captureId']);return {identity:identity(p.identity),captureId:tutorId(p.captureId)};}),c=>c.identity)};
  if(result.conversations.length>200)throw new Error('The backup exceeds the local 200-conversation limit.');
  for(const c of result.conversations)if(result.turns.filter(t=>t.conversationId===c.id).length>200||result.proposals.filter(p=>p.conversationId===c.id).length>200)throw new Error('A conversation exceeds the local 200-turn or 200-proposal limit.');
  const convs=new Map(result.conversations.map(c=>[c.id,c])),turns=new Map(result.turns.map(t=>[t.id,t])),sources=new Map(result.statements.map(s=>[s.id,s])),captures=new Map(result.captures.map(c=>[c.id,c])),codes=new Map(result.codes.map(c=>[c.id,c]));
  for(const c of result.conversations)if(canonicalProblemIdentity(data.problems.find(p=>p.id===c.problemId)??{url:''} as Data['problems'][number])!==c.identity)throw new Error('A Tutor conversation refers to a missing or different notebook problem. Restore the matching notebook first.');
  if(result.lastConversationId&&!convs.has(result.lastConversationId))throw new Error('The last Tutor conversation is missing.');
  unique(result.captures,c=>String(c.sequence));
  unique([...result.turns,...result.requests],t=>t.requestId);
  for(const t of [...result.turns,...result.requests]){const c=convs.get(t.conversationId);if(!c||t.context.problemId!==c.problemId||t.context.identity!==c.identity||t.context.workspaceId!==c.workspaceId)throw new Error('A Tutor turn refers to a missing or different conversation.');}
  for(const t of result.requests){
    const parent=turns.get(t.id);if(!parent)throw new Error('A previous provider request has no parent turn.');
    if(t.conversationId!==parent.conversationId||t.action!==parent.action||t.userText!==parent.userText||t.createdAt!==parent.createdAt||JSON.stringify(t.context)!==JSON.stringify(parent.context))throw new Error('A previous provider request does not match its parent turn’s immutable question and context.');
  }
  for(const c of result.captures)if(sources.get(c.statementId)?.identity!==c.identity)throw new Error('A statement capture has an invalid content reference.');
  for(const c of result.current)if(captures.get(c.captureId)?.identity!==c.identity)throw new Error('The current statement capture is invalid.');
  for(const d of result.drafts){
    const c=convs.get(d.conversationId);if(!c||d.identity!==c.identity||d.problemId!==c.problemId||d.workspaceId!==c.workspaceId)throw new Error('A draft belongs to a missing or different conversation.');
    const selectedStatement=d.statementId?captures.get(d.statementId):undefined,selectedCode=d.codeId?codes.get(d.codeId):undefined;
    if(selectedStatement&&selectedStatement.identity!==d.identity||selectedCode&&(selectedCode.identity!==d.identity||selectedCode.workspaceId!==d.workspaceId))throw new Error('A selected draft source belongs to a different problem or workspace.');
    for(const noteId of d.noteIds){
      const owners=[...data.attempts,...(state?.thoughts??[])].filter(note=>note.id===noteId);
      if(owners.some(note=>note.problemId!==d.problemId))throw new Error('A selected draft note belongs to a different problem.');
    }
  }
  // A draft may intentionally retain an expired source ID. It is restored as a
  // missing reference requiring review; this never grants access to a path.
  for(const p of result.proposals){const t=turns.get(p.turnId);if(!t||t.conversationId!==p.conversationId||t.context.problemId!==p.problemId||t.context.identity!==p.identity||t.context.sessionId!==p.sessionId)throw new Error('A learning proposal has an invalid frozen target.');}
  if(Buffer.byteLength(JSON.stringify(result))>32*1024*1024)throw new Error('Tutor data exceeds the local 32 MiB quota.');return result;
}
const notebook=(v:unknown)=>{const o=tutorObject(v);tutorFields(o,['schemaVersion','codeforces','problems','attempts','session','settings','learningLinks','discovery','tracks','trackStages','trackEntries','activeTrackId','revisions','practicePlans','contests']);return validateData(o);};
/** Domain validation predates backups and preserves extension fields. Backups
 * must reject those fields instead of importing unknown credentials or paths. */
function companion(v:unknown,data:Data):CompanionState {
  const o=tutorObject(v);tutorFields(o,['version','problemId','identity','lifecycle','localTests','platform','learning','thoughts','bindings','submissions','handle','checkedAt','followups']);
  unique(list(o.thoughts,1000,v=>{const n=tutorObject(v);tutorFields(n,['id','problemId','text','createdAt']);return {id:tutorText(n.id,200,1)};}),n=>n.id);
  unique(list(o.bindings,500,v=>{const n=tutorObject(v);tutorFields(n,['id','problemId','identity','fileUri','confirmedAt','workspaceId','clientId','source','adapterVersion']);return {id:tutorText(n.id,200,1)};}),n=>n.id);
  unique(list(o.submissions,1000,v=>{const n=tutorObject(v);tutorFields(n,['id','handle','identity','verdict','submittedAt','observedAt','sessionId']);return {key:`${String(n.handle).toLowerCase()}:${String(n.id)}`};}),n=>n.key);
  if(o.followups!==undefined)list(o.followups,1000,v=>{const n=tutorObject(v);tutorFields(n,['id','problemId','identity','handle','startedAt','finishedAt','discoveryUntil','pendingUntil','checkedAt','nextCheckAt','status','error']);if(n.error!==null)tutorText(n.error,1000);return n;});
  return validateCompanionState(o,data);
}
export function portableState(state:CompanionState,data:Data):CompanionState {
  return validateCompanionState({...state,bindings:[],lifecycle:data.session?'paused':state.lifecycle==='working'?'ready':state.lifecycle,localTests:'unknown',followups:(state.followups??[]).map(f=>({...f,status:'expired',error:'Restored backup. Check Codeforces explicitly to refresh evidence.'}))},data);
}
export function validateLocalBackup(json:string,current:Data):ValidatedBackup {
  const o=parseBackupJson(json),warnings:string[]=[];let raw:Record<string,unknown>;
  if(o.format==='forma-local-backup'){
    tutorFields(o,['format','version','exportedAt','scope','notebook','companion','tutor']);if(o.version!==2)throw new Error('Unsupported local backup version. Update Forma before restoring this file.');raw=o;
  }else if(o.format==='forma-companion'&&o.version===1){
    tutorFields(o,['format','version','exportedAt','data','state','revision','savedAt','preferences','observations','commands','outbox','recoveries']);
    raw={format:'forma-local-backup',version:2,scope:'companion',exportedAt:o.exportedAt,notebook:o.data,companion:o.state};warnings.push('Legacy companion export: local journals, preferences, machine bindings and recovery history are not imported. This format did not include Tutor data.');
  }else if(o.format==='forma-tutor'&&o.version===1){
    tutorFields(o,['format','version','exportedAt','conversations']);const rows=list(o.conversations,1000,v=>{const p=tutorObject(v);tutorFields(p,['conversation','turns','previousRequests','proposals']);return p;});
    raw={format:'forma-local-backup',version:2,scope:'tutor',exportedAt:o.exportedAt,tutor:{conversations:rows.map(r=>r.conversation),turns:rows.flatMap(r=>list(r.turns,200,turn)),requests:rows.flatMap(r=>list(r.previousRequests,20_000,turn)),proposals:rows.flatMap(r=>list(r.proposals,200,proposal)),drafts:[],statements:[],captures:[],current:[],codes:[],lastConversationId:null,settings:{contestMode:false,retentionDays:90,voiceOutput:false}}};warnings.push('Legacy Tutor export restores frozen conversation history only. Unsent drafts and available source captures were not included.');
  }else if(o.schemaVersion===1||o.schemaVersion===2){
    raw={format:'forma-local-backup',version:2,scope:'notebook',exportedAt:new Date(0).toISOString(),notebook:o};warnings.push('Legacy notebook export: companion thoughts and Tutor data were not included.');
  }else throw new Error('This is not a supported Forma local, notebook, companion or Tutor backup.');
  if(!['notebook','companion','tutor'].includes(String(raw.scope)))throw new Error('Invalid backup replacement scope.');
  const scope=raw.scope as BackupScope;if(scope==='tutor'&&(raw.notebook!==undefined||raw.companion!==undefined)||scope==='notebook'&&raw.companion!==undefined||scope==='companion'&&raw.companion===undefined||scope!=='tutor'&&raw.notebook===undefined)throw new Error('Backup records do not match their declared replacement scope.');
  const data=raw.notebook===undefined?current:notebook(raw.notebook),state=raw.companion===undefined?undefined:portableState(companion(raw.companion,data),data);
  const backup:LocalBackup={format:'forma-local-backup',version:2,exportedAt:tutorTime(raw.exportedAt),scope,...(raw.notebook===undefined?{}:{notebook:data}),...(state?{companion:state}:{}),...(raw.tutor===undefined?{}:{tutor:tutor(raw.tutor,data,state)})};
  if(scope==='tutor'&&!backup.tutor)throw new Error('A Tutor backup needs conversation records.');
  warnings.push('Restored timers are paused. Requests and audio are never replayed. Folder approval, pairing, credentials, login settings and executable paths are not restored.');
  if(backup.tutor)warnings.push('Code paths in frozen provenance are labels only. Review missing or expired draft references before sending. Existing retention still applies: old conversations and one-day code shares can expire after restore. The chosen backup file remains unchanged.');
  const replacement=scope==='tutor'?['Replace all Tutor conversations, drafts, source captures and Tutor preferences.','Keep the notebook, companion learning records and device settings.']:scope==='notebook'?['Replace the canonical notebook: problems, attempts, plans, contests, revisions and notebook settings.','Keep companion learning records and Tutor history only if their problem/session references remain valid.']:['Replace the canonical notebook and companion thoughts, evidence and selected problem.','Discard imported machine file bindings. Keep this device’s pairing, integration permissions and app preferences.'];
  if(scope!=='tutor')replacement.push(backup.tutor?'Replace all Tutor conversations, drafts, source captures and Tutor preferences.':'Keep existing Tutor conversations and drafts; reject restore if their notebook targets would become invalid.');
  if(scope==='companion')replacement.push('Reset the local observation journal and pending sync projection. Keep command replay receipts; device journals are not imported.');
  return {backup,warnings,preview:{scope,includeTutor:!!backup.tutor,counts:{problems:backup.notebook?.problems.length??0,attempts:backup.notebook?.attempts.length??0,thoughts:backup.companion?.thoughts.length??0,conversations:backup.tutor?.conversations.length??0,turns:backup.tutor?.turns.length??0,drafts:backup.tutor?.drafts.filter(d=>d.text||d.statementId||d.codeId||d.noteIds.length).length??0},warnings,replacement}};
}
export function emptyPortableState(data:Data):CompanionState {return {...initialCompanionState(),handle:data.codeforces.connectedHandle};}
