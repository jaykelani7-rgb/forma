import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalProblemIdentity } from '../../../packages/core/src/codeforces-identity';
import { MAX_MESSAGE_BYTES } from '../../../packages/integrations/protocol';
import { availableTutorNotes, freezeTutorContext, parseSharedCode, TUTOR_BUDGET, tutorFields, tutorHash, tutorId, tutorObject, tutorText, validateStatement } from '../../../packages/tutor/context';
import { buildProviderMessages, hintLevelForAction, parseTutorAction, parseTutorDraftAction } from '../../../packages/tutor/policy';
import { IDEA_LIMITS, readIdeaChallenge, readIdeaOutline, readIdeaQuestion } from '../../../packages/tutor/idea';
import {
  CHALLENGE_RUN_LIMIT, FIRST_CHALLENGE_CASE_ID, challengeOutputEqual, challengeSampleOutput, parseChallengeRunRequest,
  readChallengeCaseId, readChallengeFeedback, readChallengeRunReceipt,
  type ChallengeCaseState, type ChallengeReferenceBatchPlan, type ChallengeReferenceBatchSubmission,
  type ChallengeRunPlan, type ChallengeRunReceipt,
} from '../../../packages/tutor/challenge-run';
import { challengeRankingFeatures, type ChallengeRankingDataset } from '../../../packages/tutor/challenge-ranking';
import { isDeskIdeaAction } from '../../../packages/tutor/types';
import type { DeskHintReview, DeskHintTarget, DeskIdeaReview, IdeaChallengeCase, SharedCode, StatementSnapshot, TutorAction, TutorContextView, TutorConversation, TutorProposal, TutorProviderStatus, TutorSendInput, TutorSettings, TutorStoredView, TutorTurn, TutorUsage, TutorDraft, TutorDraftView, TutorDraftSaveInput, TutorDraftSaveResult } from '../../../packages/tutor/types';
import type { LocalSnapshot } from './store';

interface TutorOwner {snapshot():LocalSnapshot;approveTutorLearning(proposal:TutorProposal,now:number):void}
const DEFAULT_SETTINGS:TutorSettings={contestMode:false,retentionDays:90,voiceOutput:false};
const MAX_LOCAL_BYTES=32*1024*1024;
const decode=<T>(value:unknown):T=>JSON.parse(String(value)) as T;
const decodeTurn=(value:unknown):TutorTurn=>{const turn=decode<TutorTurn>(value);return {...turn,provider:turn.provider??'openai'};};
const canAcknowledgeReply = (turn: TutorTurn) => !!turn.assistantText.trim() &&
  (!isDeskIdeaAction(turn.action) || turn.status === 'completed');
function deskReviewTarget(input:unknown):DeskHintTarget {
  const value=tutorObject(input);
  tutorFields(value,['problemId','sessionId','recoveryEpoch','provider','model']);
  if(value.provider!=='gemini'&&value.provider!=='openai')throw new Error('Review the current Tutor provider before sending a request.');
  return {
    problemId:tutorText(value.problemId,200,1),
    sessionId:value.sessionId===null?null:tutorId(value.sessionId),
    recoveryEpoch:tutorId(value.recoveryEpoch),
    provider:value.provider,
    model:tutorText(value.model,120,1),
  };
}

/** Uses only the existing worker's DatabaseSync. No network, credentials or raw audio enter this store. */
export class TutorStore {
  constructor(readonly db:DatabaseSync,private readonly owner:TutorOwner,now=Date.now()) {
    this.transaction(()=>{
      const version=Number(db.prepare('PRAGMA user_version').get()?.user_version??0);
      db.exec(`CREATE TABLE IF NOT EXISTS tutor_conversations (id TEXT PRIMARY KEY, identity TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE, request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_requests (id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES tutor_turns(id) ON DELETE CASCADE, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_statements (id TEXT PRIMARY KEY, identity TEXT NOT NULL, captured_at TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_statement_captures (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, statement_id TEXT NOT NULL REFERENCES tutor_statements(id) ON DELETE CASCADE, identity TEXT NOT NULL, captured_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_statement_current (identity TEXT PRIMARY KEY, capture_sequence INTEGER NOT NULL UNIQUE REFERENCES tutor_statement_captures(sequence) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS tutor_codes (id TEXT PRIMARY KEY, identity TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_proposals (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_drafts (conversation_id TEXT PRIMARY KEY REFERENCES tutor_conversations(id) ON DELETE CASCADE, revision INTEGER NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tutor_draft_state (id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL, last_conversation_id TEXT);
        CREATE TABLE IF NOT EXISTS tutor_settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS tutor_turn_conversation ON tutor_turns(conversation_id);
        CREATE INDEX IF NOT EXISTS tutor_turn_attempt ON tutor_turns(json_extract(body,'$.context.sessionId'),json_extract(body,'$.context.problemId'));
        CREATE INDEX IF NOT EXISTS tutor_statement_capture_identity ON tutor_statement_captures(identity,sequence);`);
      if(version<5)db.exec('PRAGMA user_version=5');
      if(version<4){
        // Content-addressed rows are immutable. The old timestamp + rowid order
        // provides a deterministic initial selection, then capture sequence is
        // the sole ordering authority (including equal/backwards wall clocks).
        for(const row of db.prepare('SELECT id,identity,captured_at FROM tutor_statements ORDER BY captured_at,rowid').all()){
          db.prepare('INSERT OR IGNORE INTO tutor_statement_captures(id,statement_id,identity,captured_at) VALUES(?,?,?,?)').run(row.id,row.id,row.identity,row.captured_at);
        }
        db.exec(`INSERT OR IGNORE INTO tutor_statement_current(identity,capture_sequence)
          SELECT identity,MAX(sequence) FROM tutor_statement_captures GROUP BY identity;`);
        // Pre-provider records belong to OpenAI. Normalize only provenance;
        // immutable request contexts and their original capture metadata survive.
        for(const table of ['tutor_turns','tutor_requests'])db.exec(`UPDATE ${table} SET body=json_set(body,'$.provider','openai') WHERE json_extract(body,'$.provider') IS NULL;`);
      }
      db.prepare('INSERT OR IGNORE INTO tutor_draft_state VALUES(1,?,NULL)').run(randomUUID());
      db.prepare('INSERT OR IGNORE INTO tutor_settings VALUES(1,?)').run(JSON.stringify(DEFAULT_SETTINGS));
      for(const row of db.prepare("SELECT body FROM tutor_turns WHERE status IN ('queued','streaming')").all()){
        const turn=decodeTurn(row.body);
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
      SELECT COALESCE(SUM(length(id)+length(statement_id)+length(identity)+length(captured_at)+16),0) FROM tutor_statement_captures UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_codes UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_proposals UNION ALL
      SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM tutor_drafts)`).get();
    // Reserve worst-case UTF-8 room for the one permitted response up front;
    // streaming chunks then need no full-table size scan on every token.
    const active=Number(this.db.prepare("SELECT COUNT(*) n FROM tutor_turns WHERE status IN ('queued','streaming')").get()!.n);
    if(Number(total?.bytes)+active*TUTOR_BUDGET.response*4>MAX_LOCAL_BYTES)throw new Error('Local tutor storage reached 32 MiB. Export and delete an older conversation before continuing.');
  }
  private prune(now:number) {
    this.transaction(()=>{
      const cutoff=new Date(now-this.settings().retentionDays*86400000).toISOString();
      this.db.prepare("DELETE FROM tutor_conversations WHERE updated_at < ? AND id NOT IN (SELECT conversation_id FROM tutor_turns WHERE status IN ('queued','streaming'))").run(cutoff);
      this.db.prepare('DELETE FROM tutor_statement_captures WHERE captured_at < ? AND identity NOT IN (SELECT identity FROM tutor_conversations)').run(cutoff);
      this.db.prepare('DELETE FROM tutor_statements WHERE id NOT IN (SELECT statement_id FROM tutor_statement_captures)').run();
      // Staged shares remain selectable for a day, including a draft's older
      // explicit selection after a newer snapshot becomes available.
      for(const row of this.db.prepare('SELECT id,body FROM tutor_codes').all())if(Date.parse(decode<SharedCode>(row.body).capturedAt)<now-86400000)this.db.prepare('DELETE FROM tutor_codes WHERE id=?').run(String(row.id));
    });
  }
  settings():TutorSettings {return decode<TutorSettings>(this.db.prepare('SELECT body FROM tutor_settings WHERE id=1').get()!.body);}
  setSettings(input:unknown,now=Date.now()):TutorSettings {
    const value=tutorObject(input);tutorFields(value,['contestMode','retentionDays','voiceOutput']);
    if(value.contestMode!==undefined&&typeof value.contestMode!=='boolean'||value.voiceOutput!==undefined&&typeof value.voiceOutput!=='boolean'||value.retentionDays!==undefined&&(!Number.isInteger(value.retentionDays)||Number(value.retentionDays)<1||Number(value.retentionDays)>3650))throw new Error('Tutor settings need boolean switches and retention from 1 to 3,650 days.');
    return this.transaction(()=>{
      const settings={...this.settings(),...value} as TutorSettings;
      this.db.prepare('UPDATE tutor_settings SET body=? WHERE id=1').run(JSON.stringify(settings));
      if(settings.contestMode)for(const row of this.db.prepare("SELECT body FROM tutor_turns WHERE status IN ('queued','streaming')").all())this.writeTurn({...decodeTurn(row.body),status:'interrupted',completedAt:new Date(now).toISOString(),error:'Contest mode stopped assistance.'});
      this.prune(now);return settings;
    });
  }
  view(now=Date.now()):TutorStoredView {
    this.prune(now);
    return {conversations:this.db.prepare('SELECT body FROM tutor_conversations ORDER BY updated_at DESC,id LIMIT 200').all().map(row=>decode<TutorConversation>(row.body)),settings:this.settings(),pendingCode:this.pendingCode(),lastConversationId:this.db.prepare('SELECT last_conversation_id FROM tutor_draft_state WHERE id=1').get()?.last_conversation_id as string|null};
  }
  private conversation(id:unknown):TutorConversation {
    const row=this.db.prepare('SELECT body FROM tutor_conversations WHERE id=?').get(tutorId(id));
    if(!row)throw new Error('This local conversation is no longer available.');
    return decode<TutorConversation>(row.body);
  }
  private scopedConversation(snapshot: LocalSnapshot, problemId: string, identity: string, requestedWorkspace?: unknown) {
    const binding = snapshot.state.bindings.find(item => item.problemId === problemId);
    const rememberedId = this.db.prepare('SELECT last_conversation_id FROM tutor_draft_state WHERE id=1').get()?.last_conversation_id;
    const rememberedRow = rememberedId ? this.db.prepare('SELECT body FROM tutor_conversations WHERE id=?').get(rememberedId) : null;
    const remembered = rememberedRow ? decode<TutorConversation>(rememberedRow.body) : null;
    const workspaceId = tutorId(requestedWorkspace ?? binding?.workspaceId ??
      (remembered?.problemId === problemId && remembered.identity === identity ? remembered.workspaceId : 'personal'));
    const existing = this.db.prepare('SELECT body FROM tutor_conversations WHERE identity=? ORDER BY updated_at DESC').all(identity)
      .map(row => decode<TutorConversation>(row.body))
      .find(conversation => conversation.problemId === problemId && conversation.workspaceId === workspaceId);
    return { workspaceId, existing };
  }
  open(input:unknown={},now=Date.now(),remember=true):TutorConversation {
    const value=tutorObject(input);tutorFields(value,['conversationId','problemId','workspaceId']);
    if(value.conversationId!==undefined){const found=this.conversation(value.conversationId);if(remember)this.remember(found.id);return found;}
    const snapshot=this.owner.snapshot();
    const problem=snapshot.data.problems.find(problem=>problem.id===(value.problemId??snapshot.state.problemId));
    const identity=problem&&canonicalProblemIdentity(problem);
    if(!problem||!identity){const remembered=this.db.prepare('SELECT last_conversation_id FROM tutor_draft_state WHERE id=1').get()?.last_conversation_id;if(remembered&&this.db.prepare('SELECT id FROM tutor_conversations WHERE id=?').get(remembered))return this.conversation(remembered);}
    if(!problem||!identity)throw new Error('Recognise or attach a Codeforces problem before opening its tutor.');
    const { workspaceId, existing } = this.scopedConversation(snapshot, problem.id, identity, value.workspaceId);
    if(existing){if(remember)this.remember(existing.id);return existing;}
    if(Number(this.db.prepare('SELECT COUNT(*) n FROM tutor_conversations').get()!.n)>=200)throw new Error('There are 200 local conversations. Export and delete an older one before opening another.');
    const stamp=new Date(now).toISOString();
    const conversation:TutorConversation={id:randomUUID(),identity,problemId:problem.id,title:problem.title,workspaceId,createdAt:stamp,updatedAt:stamp};
    this.db.prepare('INSERT INTO tutor_conversations VALUES(?,?,?,?)').run(conversation.id,identity,stamp,JSON.stringify(conversation));
    if(remember)this.remember(conversation.id);return conversation;
  }
  private remember(id:string){this.db.prepare('UPDATE tutor_draft_state SET last_conversation_id=? WHERE id=1').run(id);}
  /** Rotate after replacement so callbacks from the prior database state cannot write. */
  rotateRecoveryEpoch():string {const epoch=randomUUID();this.db.prepare('UPDATE tutor_draft_state SET epoch=? WHERE id=1').run(epoch);return epoch;}
  turns(conversationId:unknown):TutorTurn[] {
    const conversation=this.conversation(conversationId);
    return this.db.prepare('SELECT body FROM tutor_turns WHERE conversation_id=? ORDER BY rowid').all(conversation.id).map(row=>decodeTurn(row.body));
  }
  private capturedStatement(id:string):StatementSnapshot|null {
    const row=this.db.prepare(`SELECT content.body,capture.id,capture.captured_at FROM tutor_statement_captures capture
      JOIN tutor_statements content ON content.id=capture.statement_id WHERE capture.id=?`).get(id);
    return row?{...decode<StatementSnapshot>(row.body),id:String(row.id),capturedAt:String(row.captured_at)}:null;
  }
  statement(input:unknown,now=Date.now()):StatementSnapshot|null {
    const value=tutorObject(input);
    if(Object.keys(value).length===1&&typeof value.identity==='string'){
      if(!/^(contest|gym):[1-9]\d{0,8}:[A-Z]\d{0,8}$/.test(value.identity))throw new Error('Invalid statement identity.');
      const row=this.db.prepare(`SELECT capture.id FROM tutor_statement_current current
        JOIN tutor_statement_captures capture ON capture.sequence=current.capture_sequence WHERE current.identity=?`).get(value.identity);
      return row?this.capturedStatement(String(row.id)):null;
    }
    const statement=validateStatement(value,now);
    if(!this.owner.snapshot().data.problems.some(problem=>canonicalProblemIdentity(problem)===statement.identity))throw new Error('Attach this problem before keeping its statement.');
    return this.transaction(()=>{
      this.db.prepare('INSERT OR IGNORE INTO tutor_statements VALUES(?,?,?,?)').run(statement.id,statement.identity,statement.capturedAt,JSON.stringify(statement));
      const id=`statement-capture:${randomUUID()}`;
      const capture=this.db.prepare('INSERT INTO tutor_statement_captures(id,statement_id,identity,captured_at) VALUES(?,?,?,?)').run(id,statement.id,statement.identity,statement.capturedAt);
      this.db.prepare('INSERT INTO tutor_statement_current VALUES(?,?) ON CONFLICT(identity) DO UPDATE SET capture_sequence=excluded.capture_sequence').run(statement.identity,capture.lastInsertRowid);
      this.quota();return this.capturedStatement(id)!;
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
      // A new share is available context, not permission to replace a draft's
      // existing explicit selection. Retention bounds unsent snapshots.
      this.db.prepare('INSERT OR IGNORE INTO tutor_codes VALUES(?,?,?)').run(code.id,code.identity,JSON.stringify(code));this.quota();return code;
    });
  }
  private pendingCode(identity?:string,workspaceId?:string):SharedCode|null {
    const row=identity===undefined?this.db.prepare('SELECT body FROM tutor_codes ORDER BY rowid DESC LIMIT 1').get():this.db.prepare("SELECT body FROM tutor_codes WHERE identity=? AND json_extract(body,'$.workspaceId')=? ORDER BY rowid DESC LIMIT 1").get(identity,workspaceId!);
    return row?decode<SharedCode>(row.body):null;
  }
  context(conversationId:unknown):TutorContextView {
    const conversation=this.conversation(conversationId),snapshot=this.owner.snapshot(),pending=this.pendingCode(conversation.identity,conversation.workspaceId);
    const statement=this.statement({identity:conversation.identity});
    const frozen=freezeTutorContext(snapshot,conversation,{statement,code:null,noteIds:[]});
    return {conversation,statement,pendingCode:pending?.identity===conversation.identity&&pending.workspaceId===conversation.workspaceId?pending:null,notes:availableTutorNotes(snapshot,conversation.problemId),sessionId:frozen.sessionId,evidence:frozen.evidence};
  }
  private activeDeskProblem(snapshot:LocalSnapshot,problemId:string) {
    const problem=snapshot.data.problems.find(row=>row.id===problemId);
    const identity=problem&&canonicalProblemIdentity(problem);
    if(!identity||snapshot.state.problemId!==problemId||snapshot.state.identity!==identity)
      throw new Error('The active problem changed. Reopen the request from its Problem Desk.');
    return {identity,sessionId:snapshot.data.session?.problemId===problemId?snapshot.data.session.id:null};
  }
  private reviewDeskContext(input:unknown,provider:TutorProviderStatus) {
    const value=tutorObject(input);
    tutorFields(value,['problemId']);
    const problemId=tutorText(value.problemId,200,1);
    const {identity,sessionId}=this.activeDeskProblem(this.owner.snapshot(),problemId);
    const target={problemId,sessionId,recoveryEpoch:this.draftEpoch(),provider:provider.provider,model:provider.model};
    const {contestMode}=this.settings();
    const statement=contestMode?null:this.statement({identity});
    return {contestMode,statement,target};
  }
  deskHintReview(input:unknown,provider:TutorProviderStatus,now=Date.now()):Omit<DeskHintReview,'provider'|'activeRequestId'> {
    const review = this.reviewDeskContext(input, provider);
    const conversationId = review.statement?.complete && provider.configured && provider.capabilities.text
      ? this.open({ problemId: review.target.problemId }, now, false).id : null;
    return { ...review, conversationId };
  }
  deskIdeaReview(input:unknown,provider:TutorProviderStatus,now=Date.now()):Omit<DeskIdeaReview,'provider'|'activeRequestId'> {
    const review = this.reviewDeskContext(input, provider);
    let conversation: TutorConversation | null = null;
    if (!review.contestMode) {
      if (provider.configured && provider.capabilities.text) {
        conversation = this.open({ problemId: review.target.problemId }, now, false);
      } else {
        const snapshot = this.owner.snapshot();
        if (snapshot.state.identity) {
          conversation = this.scopedConversation(snapshot, review.target.problemId, snapshot.state.identity).existing ?? null;
        }
      }
    }
    const code = conversation ? this.pendingCode(conversation.identity, conversation.workspaceId) : null;
    return { ...review, statement: review.statement?.complete ? review.statement : null, conversationId: conversation?.id ?? null, code };
  }
  private activeChallengeCases(turn: TutorTurn, snapshot: LocalSnapshot) {
    if (this.settings().contestMode) throw new Error('Contest mode disables challenge verification.');
    if (turn.action !== 'challenge-assumption' || turn.status !== 'completed' || !turn.standalone || !turn.context.statement?.complete) {
      throw new Error('Open a completed challenge in the Problem Desk first.');
    }
    const { identity, sessionId } = this.activeDeskProblem(snapshot, turn.context.problemId);
    if (turn.context.identity !== identity || turn.context.sessionId !== sessionId) {
      throw new Error('The practice session changed. Review a challenge for the active session.');
    }
    const { cases } = readIdeaChallenge(turn.assistantText);
    return { cases, samples: turn.context.statement.samples };
  }

  private reviewedChallenge(value: Record<string, unknown>) {
    const turn = this.readTurn(value.turnId);
    if (turn.requestId !== tutorId(value.requestId)) throw new Error('The challenge request changed. Reopen it in the Problem Desk.');
    const { cases } = this.activeChallengeCases(turn, this.owner.snapshot());
    return { turn, cases };
  }

  private challengeCaseState(turn: TutorTurn, cases: IdeaChallengeCase[]): ChallengeCaseState {
    return { caseId: turn.challengeCaseId ?? cases[0]?.id ?? null, runs: turn.challengeRuns ?? [], feedback: turn.challengeFeedback ?? [] };
  }

  deskChallengeState(input: unknown): ChallengeCaseState {
    const value = tutorObject(input);
    tutorFields(value, ['turnId', 'requestId']);
    const { turn, cases } = this.reviewedChallenge(value);
    return this.challengeCaseState(turn, cases);
  }

  deskChallengeRuns(input: unknown): ChallengeRunReceipt[] {
    return this.deskChallengeState(input).runs;
  }

  updateDeskChallenge(input: unknown, action: 'select' | 'feedback', now = Date.now()) {
    const value = tutorObject(input);
    tutorFields(value, action === 'select' ? ['turnId', 'requestId', 'caseId'] : ['turnId', 'requestId', 'caseId', 'label']);
    const caseId = readChallengeCaseId(value.caseId);
    const stamp = new Date(now).toISOString();
    return this.transaction(() => {
      const { turn, cases } = this.reviewedChallenge(value);
      if (!cases.some(item => item.id === caseId)) throw new Error('This case is no longer available. Reopen the challenge.');
      const state = this.challengeCaseState(turn, cases);
      let next = turn;
      if (action === 'select' && caseId !== state.caseId) {
        next = { ...turn, challengeCaseId: caseId };
      }
      if (action === 'feedback') {
        const selected = value.label === null ? null : readChallengeFeedback({ caseId, label: value.label, recordedAt: stamp });
        const previous = state.feedback.find(item => item.caseId === caseId);
        if (previous?.label !== selected?.label) {
          const others = state.feedback.filter(item => item.caseId !== caseId);
          next = { ...turn, challengeFeedback: selected ? [...others, selected] : others };
        }
      }
      if (next !== turn) this.writeChallengeTurn(next, stamp);
      return { state: this.challengeCaseState(next, cases), conversationId: turn.conversationId, turnId: turn.id, requestId: turn.requestId, changed: next !== turn };
    });
  }

  private writeChallengeTurn(turn: TutorTurn, stamp: string) {
    this.writeTurn(turn);
    const conversation = this.conversation(turn.conversationId);
    const updated = { ...conversation, updatedAt: stamp };
    this.db.prepare('UPDATE tutor_conversations SET updated_at=?,body=? WHERE id=?').run(stamp, JSON.stringify(updated), updated.id);
    this.quota();
  }

  private recordChallengeBatch(turn: TutorTurn, cases: IdeaChallengeCase[], batch: ChallengeReferenceBatchSubmission, fileName: string, ranAt: string): ChallengeRunReceipt[] {
    if (batch.cases.length !== cases.length || batch.cases.some((item, index) => item.caseId !== cases[index].id)) {
      throw new Error('The batch no longer matches all the reviewed cases in order. Reopen the challenge.');
    }
    const batchReceipts = batch.cases.map((item, index) => readChallengeRunReceipt({
      id: tutorHash(JSON.stringify(['challenge-reference-batch', batch.id, item.caseId])),
      batchId: batch.id, caseId: item.caseId, input: cases[index].input, expectedOutput: item.expectedOutput,
      expectedSource: 'reference', reference: batch.reference, sourceHash: batch.sourceHash, fileName, output: item.output,
      outcome: item.outcome === 'exited'
        ? challengeOutputEqual(item.output, item.expectedOutput) ? 'match' : 'mismatch'
        : item.outcome,
      diagnostic: '', ranAt, ...(item.referenceFailed ? { referenceFailed: true } : {}),
    }));
    const runs = turn.challengeRuns ?? [];
    const previous = runs.filter(run => run.batchId === batch.id);
    if (previous.length) {
      if (previous.length !== batchReceipts.length || previous.some((run, index) =>
        JSON.stringify(readChallengeRunReceipt(run)) !== JSON.stringify({ ...batchReceipts[index], ranAt: run.ranAt }))) {
        throw new Error('This batch already belongs to different saved results.');
      }
      return previous;
    }
    if (batchReceipts.some(item => runs.some(run => run.id === item.id))) {
      throw new Error('A result identifier already belongs to another run.');
    }
    this.checkChallengeRunCapacity(runs, cases.map(item => item.id));
    // Use the largest possible acknowledgement envelope before saving the batch.
    const response = { version: 1, id: 'x'.repeat(128), ok: true, revision: Number.MAX_SAFE_INTEGER, batchReceipts };
    if (Buffer.byteLength(JSON.stringify(response)) > MAX_MESSAGE_BYTES) {
      throw new Error('The batch results exceed the local message limit. Run the cases individually.');
    }
    this.writeChallengeTurn({ ...turn, challengeRuns: [...runs, ...batchReceipts] }, ranAt);
    return batchReceipts;
  }

  private checkChallengeRunCapacity(runs: ChallengeRunReceipt[], caseIds: string[]) {
    if (caseIds.some(caseId => runs.filter(item => (item.caseId ?? FIRST_CHALLENGE_CASE_ID) === caseId).length >= CHALLENGE_RUN_LIMIT)) {
      throw new Error('A case has reached its local run limit. Choose an available case for an individual run or request a new challenge.');
    }
  }

  challengeRun(input: unknown, now = Date.now()):
    { plan: ChallengeRunPlan } | { receipt: ChallengeRunReceipt; conversationId: string } |
    { batchPlan: ChallengeReferenceBatchPlan } | { batchReceipts: ChallengeRunReceipt[]; conversationId: string } {
    const request = parseChallengeRunRequest(input);
    const { target } = request;
    return this.transaction(() => {
      if (this.settings().contestMode) throw new Error('Contest mode disables challenge verification.');
      const snapshot = this.owner.snapshot();
      const binding = snapshot.state.bindings.find(item => item.problemId === snapshot.state.problemId &&
        item.identity === snapshot.state.identity && item.fileUri === target.fileUri &&
        item.workspaceId === target.workspaceId && item.clientId === target.clientId);
      if (!binding) throw new Error('Open the approved VS Code solution for the active Forma problem.');
      const { sessionId } = this.activeDeskProblem(snapshot, binding.problemId);
      if (snapshot.data.session && !sessionId) throw new Error('Return to the problem with the current practice session.');
      const recoveryEpoch = this.draftEpoch();

      if (request.operation === 'review' || request.operation === 'review-reference-batch') {
        const row = this.db.prepare(`SELECT body FROM tutor_turns
          WHERE status='completed' AND json_extract(body,'$.action')='challenge-assumption'
            AND json_extract(body,'$.exposed')=1 AND json_extract(body,'$.context.problemId')=?
            AND json_extract(body,'$.context.workspaceId')=? AND json_extract(body,'$.context.sessionId') IS ?
          ORDER BY rowid DESC LIMIT 1`).get(binding.problemId, target.workspaceId, sessionId);
        if (!row) throw new Error('Open an assumption challenge with a suggested case in the Problem Desk for this solution.');
        const turn = decodeTurn(row.body);
        const { cases, samples } = this.activeChallengeCases(turn, snapshot);
        const { caseId, runs } = this.challengeCaseState(turn, cases);
        const planContext = {
          turnId: turn.id, requestId: turn.requestId, problemTitle: turn.context.title,
          assumption: readIdeaQuestion(turn.userText).assumption, recoveryEpoch, sessionId,
        };
        if (request.operation === 'review-reference-batch') {
          if (!cases.length) throw new Error('The current challenge has no suggested case to run.');
          this.checkChallengeRunCapacity(runs, cases.map(item => item.id));
          return { batchPlan: { ...planContext, cases: cases.map(item => ({ caseId: item.id, input: item.input })) } };
        }
        const selected = cases.find(item => item.id === caseId);
        if (!selected) throw new Error('The current challenge has no suggested case to run.');
        this.checkChallengeRunCapacity(runs, [selected.id]);
        return { plan: {
          ...planContext, caseId: selected.id, input: selected.input, sampleOutput: challengeSampleOutput(selected.input, samples),
        } };
      }

      const submission = request.operation === 'record' ? request.run : request.batch;
      if (submission.recoveryEpoch !== recoveryEpoch) throw new Error('The notebook was restored. Review the challenge again before running it.');
      const turn = this.readTurn(submission.turnId);
      if (turn.requestId !== submission.requestId || !turn.exposed || turn.context.workspaceId !== target.workspaceId) {
        throw new Error('The reviewed challenge no longer matches this solution.');
      }
      const { cases, samples } = this.activeChallengeCases(turn, snapshot);
      const fileName = basename(fileURLToPath(target.fileUri));
      const ranAt = new Date(now).toISOString();
      if (request.operation === 'record-reference-batch') {
        return { batchReceipts: this.recordChallengeBatch(turn, cases, request.batch, fileName, ranAt), conversationId: turn.conversationId };
      }
      const { run } = request;
      const caseId = run.caseId ?? FIRST_CHALLENGE_CASE_ID;
      const selected = cases.find(item => item.id === caseId);
      if (!selected) throw new Error('The reviewed challenge case is no longer available.');
      const { input } = selected;
      if (run.expectedSource === 'statement-sample' && challengeSampleOutput(input, samples) !== run.expectedOutput) {
        throw new Error('The expected output does not match the captured statement sample.');
      }
      const receipt = readChallengeRunReceipt({
        id: run.id, caseId, input, expectedOutput: run.expectedOutput, expectedSource: run.expectedSource,
        sourceHash: run.sourceHash, fileName, output: run.output,
        outcome: run.outcome === 'exited'
          ? challengeOutputEqual(run.output, run.expectedOutput) ? 'match' : 'mismatch'
          : run.outcome,
        diagnostic: run.diagnostic, ranAt,
        ...(run.reference ? { reference: run.reference } : {}),
      });
      const runs = turn.challengeRuns ?? [];
      const previous = runs.find(item => item.id === run.id);
      if (previous) {
        const normalized = readChallengeRunReceipt({ ...previous, caseId: previous.caseId ?? FIRST_CHALLENGE_CASE_ID });
        if (JSON.stringify(normalized) !== JSON.stringify({ ...receipt, ranAt: previous.ranAt })) {
          throw new Error('This run already belongs to a different saved result.');
        }
        return { receipt: previous, conversationId: turn.conversationId };
      }
      this.checkChallengeRunCapacity(runs, [caseId]);
      this.writeChallengeTurn({ ...turn, challengeRuns: [...runs, receipt] }, receipt.ranAt);
      return { receipt, conversationId: turn.conversationId };
    });
  }
  private draftEpoch():string {return String(this.db.prepare('SELECT epoch FROM tutor_draft_state WHERE id=1').get()!.epoch);}
  private writeDraft(draft:TutorDraft) {
    const {conversationId,identity,problemId,workspaceId,revision,updatedAt,text,action,statementId,codeId,noteIds}=draft;
    const stored={conversationId,identity,problemId,workspaceId,revision,updatedAt,text,action,statementId,codeId,noteIds};
    this.db.prepare('INSERT INTO tutor_drafts VALUES(?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(conversationId,revision,JSON.stringify(stored));
  }
  draft(conversationId:unknown,now=Date.now()):TutorDraftView {
    this.prune(now);
    const conversation=this.conversation(conversationId),row=this.db.prepare('SELECT body FROM tutor_drafts WHERE conversation_id=?').get(conversation.id);
    let draft:TutorDraft;
    if(row)draft={...decode<TutorDraft>(row.body),epoch:this.draftEpoch()};
    else {
      const ctx=this.context(conversation.id);
      draft={conversationId:conversation.id,identity:conversation.identity,problemId:conversation.problemId,workspaceId:conversation.workspaceId,epoch:this.draftEpoch(),revision:0,updatedAt:new Date(now).toISOString(),text:'',action:'discuss',statementId:ctx.statement?.id??null,codeId:ctx.pendingCode?.id??null,noteIds:[]};
      this.transaction(()=>{this.writeDraft(draft);this.quota();});
    }
    const statement=draft.statementId?this.capturedStatement(draft.statementId):null;
    const codeRow=draft.codeId?this.db.prepare('SELECT body FROM tutor_codes WHERE id=?').get(draft.codeId):null;
    const code=codeRow?decode<SharedCode>(codeRow.body):null;
    const notes=availableTutorNotes(this.owner.snapshot(),conversation.problemId);
    const missingReferences:TutorDraftView['missingReferences']=[];
    if(draft.statementId&&!statement)missingReferences.push({kind:'statement',id:draft.statementId});
    if(draft.codeId&&!code)missingReferences.push({kind:'code',id:draft.codeId});
    for(const id of draft.noteIds)if(!notes.some(note=>note.id===id))missingReferences.push({kind:'note',id});
    return {...draft,statement,code,missingReferences};
  }
  saveDraft(input:unknown,now=Date.now()):TutorDraftSaveResult {
    const value=tutorObject(input);tutorFields(value,['conversationId','epoch','expectedRevision','text','action','statementId','codeId','noteIds']);
    if(!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<0||!Array.isArray(value.noteIds)||value.noteIds.length>20)throw new Error('Invalid draft revision or note selection.');
    const parsed:TutorDraftSaveInput={conversationId:tutorId(value.conversationId),epoch:tutorId(value.epoch),expectedRevision:Number(value.expectedRevision),text:tutorText(value.text,TUTOR_BUDGET.user),action:parseTutorDraftAction(value.action),statementId:value.statementId===null?null:tutorId(value.statementId),codeId:value.codeId===null?null:tutorId(value.codeId),noteIds:value.noteIds.map(tutorId)};
    if(new Set(parsed.noteIds).size!==parsed.noteIds.length)throw new Error('Choose distinct note references.');
    return this.transaction(()=>{
      if(parsed.epoch!==this.draftEpoch())throw new Error('The notebook was restored. Reopen this draft before saving.');
      const current=this.draft(parsed.conversationId,now);
      if(current.revision!==parsed.expectedRevision)return {saved:false,draft:current};
      // Unavailable references are allowed only when retained from this draft;
      // this preserves the question while requiring an explicit review before Send.
      const conversation=this.conversation(parsed.conversationId),notes=availableTutorNotes(this.owner.snapshot(),conversation.problemId);
      if(parsed.statementId&&parsed.statementId!==current.statementId){const statement=this.capturedStatement(parsed.statementId);if(!statement||statement.identity!==conversation.identity)throw new Error('Review the selected statement.');}
      if(parsed.codeId&&parsed.codeId!==current.codeId){const row=this.db.prepare('SELECT body FROM tutor_codes WHERE id=?').get(parsed.codeId);const code=row?decode<SharedCode>(row.body):null;if(!code||code.identity!==conversation.identity||code.workspaceId!==conversation.workspaceId)throw new Error('Review the selected code snapshot.');}
      if(parsed.noteIds.some(id=>!current.noteIds.includes(id)&&!notes.some(note=>note.id===id)))throw new Error('Review the selected notes.');
      this.writeDraft({...current,...parsed,revision:current.revision+1,updatedAt:new Date(now).toISOString()});
      this.quota();return {saved:true,draft:this.draft(parsed.conversationId,now)};
    });
  }
  private readTurn(id:unknown):TutorTurn {const row=this.db.prepare('SELECT body FROM tutor_turns WHERE id=?').get(tutorId(id));if(!row)throw new Error('This tutor turn is no longer available.');return decodeTurn(row.body);}
  private writeTurn(turn:TutorTurn) {
    this.db.prepare('UPDATE tutor_turns SET request_id=?,status=?,body=? WHERE id=?').run(turn.requestId,turn.status,JSON.stringify(turn),turn.id);
  }
  prepare(input:unknown,model:unknown,providerOrNow:unknown='openai',timestamp=Date.now()):TutorTurn {
    // Keep direct pre-provider callers' third timestamp argument compatible.
    const now=typeof providerOrNow==='number'?providerOrNow:timestamp;
    const provider=typeof providerOrNow==='number'?'openai':providerOrNow;
    if(provider!=='gemini'&&provider!=='openai')throw new Error('Choose a supported tutor provider.');
    const value=tutorObject(input);tutorFields(value,['turnId','requestId','conversationId','action','text','statementId','codeId','noteIds','draft','deskHint','deskIdea']);
    const request:TutorSendInput={turnId:tutorId(value.turnId),requestId:tutorId(value.requestId),conversationId:tutorId(value.conversationId),action:parseTutorAction(value.action),text:tutorText(value.text,TUTOR_BUDGET.user,1),statementId:value.statementId===null?null:tutorId(value.statementId),codeId:value.codeId===null?null:tutorId(value.codeId),noteIds:Array.isArray(value.noteIds)?value.noteIds.map(tutorId):[]};
    if(!request.text.trim()||!Array.isArray(value.noteIds))throw new Error('Write a question and explicitly select its context.');
    let submittedDraft:{epoch:string;revision:number}|undefined;
    if(value.draft!==undefined){const d=tutorObject(value.draft);tutorFields(d,['epoch','revision']);if(!Number.isSafeInteger(d.revision)||Number(d.revision)<0)throw new Error('Invalid draft revision.');submittedDraft={epoch:tutorId(d.epoch),revision:Number(d.revision)};}
    const deskHint=value.deskHint===undefined?null:deskReviewTarget(value.deskHint);
    if(deskHint&&(request.action!=='small-hint'||!request.statementId||request.codeId||request.noteIds.length||submittedDraft))
      throw new Error('A Desk hint uses one small hint with only its reviewed statement and question.');
    const deskIdea = value.deskIdea === undefined ? null : deskReviewTarget(value.deskIdea);
    if (Boolean(deskIdea) !== isDeskIdeaAction(request.action) || (deskIdea && deskHint))
      throw new Error('Open Explain my idea from the Problem Desk.');
    if (deskIdea && (submittedDraft || request.noteIds.length || (request.action === 'outline-idea' && request.codeId)))
      throw new Error('Explain my idea uses only your reviewed explanation, statement and code choices.');
    if (request.action === 'outline-idea') tutorText(request.text, IDEA_LIMITS.explanation, 1);
    if (request.action === 'challenge-assumption') {
      if (!request.statementId) throw new Error('Review a complete problem statement before asking for a challenge.');
      readIdeaQuestion(request.text);
    }
    const deskTarget = deskHint ?? deskIdea;
    const selectedModel=tutorText(model,120,1);
    return this.transaction(()=>{
      if(submittedDraft&&submittedDraft.epoch!==this.draftEpoch())throw new Error('This draft belongs to an earlier restore. Reopen the conversation before sending.');
      if(this.settings().contestMode)throw new Error('Contest mode disables problem-specific tutor assistance. Tracking and notes remain available.');
      const conversation=this.conversation(request.conversationId);
      const deskSnapshot=deskTarget?this.owner.snapshot():null;
      if(deskTarget&&deskSnapshot){
        if(deskTarget.recoveryEpoch!==this.draftEpoch())throw new Error('The notebook was restored. Review the request again.');
        if(deskTarget.provider!==provider||deskTarget.model!==selectedModel)throw new Error('The Tutor provider changed. Review the request again.');
        const {identity,sessionId}=this.activeDeskProblem(deskSnapshot,deskTarget.problemId);
        if(sessionId!==deskTarget.sessionId||conversation.problemId!==deskTarget.problemId||conversation.identity!==identity)
          throw new Error('The practice session changed. Review the request again.');
        const statement=this.statement({identity});
        if(request.statementId&&(!statement?.complete||statement.id!==request.statementId))throw new Error('The problem statement changed. Review the request again.');
        if (deskIdea && request.codeId && this.pendingCode(identity, conversation.workspaceId)?.id !== request.codeId)
          throw new Error('The shared code selection changed. Review the request again.');
      }
      const previousRow=this.db.prepare('SELECT body FROM tutor_turns WHERE id=?').get(request.turnId);
      if(previousRow){
        const previous=decodeTurn(previousRow.body);
        if(!!previous.standalone!==!!deskTarget)throw new Error('Review this request from the Problem Desk before retrying.');
        if(deskTarget&&previous.context.sessionId!==deskTarget.sessionId)throw new Error('The practice session changed. Review a new request.');
        const old={conversationId:previous.conversationId,action:previous.action,text:previous.userText,statementId:previous.context.statement?.id??null,codeId:previous.context.code?.id??null,noteIds:previous.context.notes.map(note=>note.id).sort()};
        const incoming={conversationId:request.conversationId,action:request.action,text:request.text,statementId:request.statementId,codeId:request.codeId,noteIds:[...request.noteIds].sort()};
        if(JSON.stringify(old)!==JSON.stringify(incoming))throw new Error('This user turn already has a different frozen question or context. Create a new turn.');
        if(previous.requestId===request.requestId)return previous;
        if(!['interrupted','failed'].includes(previous.status))throw new Error('Only a stopped or failed turn can be retried explicitly.');
        if(this.db.prepare("SELECT id FROM tutor_turns WHERE status IN ('queued','streaming') AND id<>? LIMIT 1").get(previous.id))throw new Error('Stop the current tutor response before retrying another request.');
        if(this.db.prepare('SELECT id FROM tutor_requests WHERE id=?').get(request.requestId)||this.db.prepare('SELECT id FROM tutor_turns WHERE request_id=?').get(request.requestId))throw new Error('This provider request ID has already been used.');
        this.db.prepare('INSERT OR IGNORE INTO tutor_requests VALUES(?,?,?)').run(previous.requestId,previous.id,JSON.stringify(previous));
        const retry:TutorTurn={...previous,requestId:request.requestId,assistantText:'',status:'queued',completedAt:null,error:null,usage:null,model:selectedModel,provider};
        delete retry.responseModel;
        this.writeTurn(retry);this.quota();return retry;
      }
      if(this.db.prepare("SELECT id FROM tutor_turns WHERE status IN ('queued','streaming') LIMIT 1").get())throw new Error('Stop the current tutor response before sending another request.');
      if(this.db.prepare('SELECT id FROM tutor_requests WHERE id=?').get(request.requestId)||this.db.prepare('SELECT id FROM tutor_turns WHERE request_id=?').get(request.requestId))throw new Error('This provider request ID has already been used.');
      if(this.turns(conversation.id).length>=200)throw new Error('This conversation reached its 200-turn limit. Export and delete it before starting again.');
      let statement:StatementSnapshot|null=null,code:SharedCode|null=null;
      if(request.statementId){statement=this.capturedStatement(request.statementId);if(!statement)throw new Error('The selected statement snapshot is unavailable.');}
      if(request.codeId){const row=this.db.prepare('SELECT body FROM tutor_codes WHERE id=?').get(request.codeId);if(!row)throw new Error('The selected source snapshot changed. Review the new code before sending.');code=decode<SharedCode>(row.body);}
      if(request.action!=='discuss'&&request.action!=='outline-idea'&&!statement?.complete)throw new Error('Include a complete statement before requesting problem-specific hints, code review, or an explanation. A URL or title is not the statement.');
      if(request.action==='check-code'&&!code)throw new Error('Explicitly share and include selected code before asking for a code check.');
      const context=freezeTutorContext(deskSnapshot??this.owner.snapshot(),conversation,{statement,code,noteIds:request.noteIds},now);
      if (deskIdea) context.evidence = { platform: 'unknown', checkedAt: null, localTests: 'unknown', submissions: [] };
      const turn:TutorTurn={id:request.turnId,requestId:request.requestId,conversationId:conversation.id,action:request.action,userText:request.text,assistantText:'',context,status:'queued',createdAt:new Date(now).toISOString(),completedAt:null,error:null,hintLevel:hintLevelForAction(request.action,this.turns(conversation.id)),exposed:false,usage:null,model:selectedModel,provider,...(deskTarget?{standalone:true as const}:{})};
      buildProviderMessages(turn,this.turns(conversation.id));
      if(submittedDraft){
        const saved=this.draft(request.conversationId,now);
        if(saved.revision===submittedDraft.revision){
          const same=JSON.stringify([saved.text,saved.action,saved.statementId,saved.codeId,[...saved.noteIds].sort()])===JSON.stringify([request.text,request.action,request.statementId,request.codeId,[...request.noteIds].sort()]);
          if(!same)throw new Error('The submitted draft changed. Review it before sending.');
          this.writeDraft({...saved,text:'',revision:saved.revision+1,updatedAt:new Date(now).toISOString()});
        }else if(saved.revision<submittedDraft.revision)throw new Error('Save this draft before sending it.');
      }
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
      if(!canAcknowledgeReply(turn))return null;
      const exposed={...turn,exposed:true};this.writeTurn(exposed);return exposed;
    }
    // A visible partial may be acknowledged just after an explicit retry. Keep
    // that factual exposure against its archived request and original turn.
    const row=this.db.prepare('SELECT body FROM tutor_requests WHERE id=? AND turn_id=?').get(requestId,turn.id);
    if(!row)return null;
    const previous=decodeTurn(row.body);if(!canAcknowledgeReply(previous))return null;
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
    const value=tutorObject(input);tutorFields(value,['turnId','requestId','status','error','usage','responseModel']);const turn=this.readTurn(value.turnId),requestId=tutorId(value.requestId);
    if(turn.requestId!==requestId||!['queued','streaming'].includes(turn.status))return null;
    if(!['completed','interrupted','failed'].includes(String(value.status)))throw new Error('Invalid tutor completion status.');
    let usage:TutorUsage|null=null;
    if(value.usage!==null&&value.usage!==undefined){const u=tutorObject(value.usage);tutorFields(u,['inputTokens','outputTokens','totalTokens']);if(![u.inputTokens,u.outputTokens,u.totalTokens].every(n=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=100_000_000)||Number(u.totalTokens)<Number(u.inputTokens)+Number(u.outputTokens))throw new Error('Invalid provider usage.');usage={inputTokens:Number(u.inputTokens),outputTokens:Number(u.outputTokens),totalTokens:Number(u.totalTokens)};}
    let status=this.settings().contestMode?'interrupted':value.status as 'completed'|'interrupted'|'failed';
    let error = value.error === null || value.error === undefined ? null : tutorText(value.error, 500);
    if (status === 'completed') {
      if (!turn.assistantText.trim()) throw new Error('An empty provider response cannot be marked complete.');
      if (isDeskIdeaAction(turn.action)) {
        try {
          if (turn.action === 'outline-idea') readIdeaOutline(turn.assistantText);
          else readIdeaChallenge(turn.assistantText);
        } catch (reason) {
          status = 'failed';
          error = reason instanceof Error ? reason.message : 'Tutor returned an unreadable result. Try the request again.';
        }
      }
    }
    const next:TutorTurn={...turn,status,completedAt:new Date(now).toISOString(),error,usage,...(value.responseModel===undefined?{}:{responseModel:tutorText(value.responseModel,120,1)})};this.writeTurn(next);return next;
  }
  delete(conversationId:unknown) {
    const conversation=this.conversation(conversationId);
    this.transaction(()=>{
      this.db.prepare('DELETE FROM tutor_conversations WHERE id=?').run(conversation.id);
      this.db.prepare('UPDATE tutor_draft_state SET last_conversation_id=NULL WHERE last_conversation_id=?').run(conversation.id);
      if(!this.db.prepare('SELECT id FROM tutor_conversations WHERE identity=?').get(conversation.identity)){
        // Content deletion cascades capture history and its current pointer.
        this.db.prepare('DELETE FROM tutor_statements WHERE identity=?').run(conversation.identity);
        this.db.prepare('DELETE FROM tutor_codes WHERE identity=?').run(conversation.identity);
      }
    });return {deleted:true};
  }
  export(conversationId?:unknown):string {
    const conversations=conversationId===undefined?this.view().conversations:[this.conversation(conversationId)];
    return JSON.stringify({format:'forma-tutor',version:1,exportedAt:new Date().toISOString(),conversations:conversations.map(conversation=>({conversation,turns:this.turns(conversation.id),previousRequests:this.db.prepare('SELECT body FROM tutor_requests WHERE turn_id IN (SELECT id FROM tutor_turns WHERE conversation_id=?) ORDER BY rowid').all(conversation.id).map(row=>decodeTurn(row.body)),proposals:this.db.prepare('SELECT body FROM tutor_proposals WHERE conversation_id=?').all(conversation.id).map(row=>decode<TutorProposal>(row.body))}))},null,2);
  }
  exportChallengeRanking(): ChallengeRankingDataset {
    const groups: ChallengeRankingDataset['groups'] = [];
    const challenges = this.db.prepare(`
      SELECT body FROM tutor_turns
      WHERE status = 'completed'
        AND json_extract(body, '$.action') = 'challenge-assumption'
        AND json_extract(body, '$.exposed') = 1
      ORDER BY rowid
    `);
    for (const row of challenges.iterate()) {
      const turn = decodeTurn(row.body);
      const { cases } = readIdeaChallenge(turn.assistantText);
      groups.push({
        id: tutorHash(JSON.stringify(['forma-challenge-ranking:challenge', turn.id, turn.requestId])),
        problemKey: tutorHash(`forma-challenge-ranking:problem:${turn.context.identity}`),
        split: null,
        cases: cases.map(candidate => ({
          id: candidate.id,
          ...challengeRankingFeatures(candidate),
          runs: (turn.challengeRuns ?? [])
            .filter(run => !run.referenceFailed && (run.caseId ?? FIRST_CHALLENGE_CASE_ID) === candidate.id)
            .map(({ outcome, expectedSource }) => ({ outcome, expectedSource })),
          feedback: turn.challengeFeedback?.find(item => item.caseId === candidate.id)?.label ?? null,
          targetedMismatch: null,
        })),
      });
    }
    return { format: 'forma-challenge-ranking', version: 1, source: 'practice', groups };
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
