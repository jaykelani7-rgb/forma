import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { emptyData, elapsed, validateData, type Data, type Session } from "../../../src/lib/model";
import { decodeBackup, encodeBackup, mergeWorkspaces, type MergeResult } from "../../../src/lib/concurrency";
import { applyCompanionCommand, applySessionFollowup, initialCompanionState, recordPracticeReflection, validateCompanionState, type CompanionState } from "../../../packages/core/src/companion";
import { canonicalProblemIdentity } from "../../../packages/core/src/codeforces-identity";
import type { TutorProposal } from "../../../packages/tutor/types";
import { parseCommand, parseEvent } from "../../../packages/contracts/src/index";
import { reconcilePracticePlan } from "../../../src/lib/practice-plan";
import { isHandoffAccountId, isHandoffId, isHandoffKey, makeSessionHandoffPacket, parseSessionHandoffPacket, type SessionHandoffPacket } from "../../../src/lib/session-handoff";
import { DISCOVERY_MS, expireFollowups } from "../../../packages/core/src/verdict-followup";
import type { CommitResult, Recovery, WorkspaceRevision } from "../../../src/lib/storage";
import { defaultPreferences, validatePreferences } from "./preferences";
import { TutorStore } from './tutor-store';
import { BackupStore } from './backup-store';

export interface LocalSnapshot { data: Data; state: CompanionState; revision: number; savedAt: string }
type PersonalRevision = WorkspaceRevision & { key: "personal"; recoveryEpoch: string };
export interface PendingSessionHandoff {
  id: string;
  sourceKey: string;
  claimKey: string;
  origin: string;
  packet: SessionHandoffPacket;
  offered: boolean;
  accountId?: string;
}
const HANDOFF_SCHEMA_VERSION = 6;
const HANDOFF_PENDING = "Finish or cancel the web handoff before changing this session.";
const MAX_DEVICE_BYTES = 8 * 1024 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sessionClock = (session: Session) => [session.phase, session.runningSince, session.elapsedMs];

/** A running checkpoint moves the clock origin without changing measured time. */
function mergeDesktopWorkspace(base: Data, proposed: Data, current: Data): MergeResult {
  const prior = base.session;
  const local = proposed.session;
  const remote = current.session;
  if (prior && local && (
    local.id !== prior.id || local.problemId !== prior.problemId || local.startedAt !== prior.startedAt ||
    !same(local.trackContext, prior.trackContext) || !same(local.takeawayPractice, prior.takeawayPractice) ||
    local.elapsedMs < prior.elapsedMs || (remote && remote.id !== prior.id && !same(prior, local))
  )) return { data: current, conflicts: ["workspace.session.identity"] };
  if (!prior || !remote) return mergeWorkspaces(base, proposed, current);

  const checkpoint = prior.id === remote.id && prior.phase === remote.phase && prior.runningSince !== null &&
    remote.runningSince !== null && remote.runningSince >= prior.runningSince &&
    remote.elapsedMs - prior.elapsedMs === remote.runningSince - prior.runningSince;
  const equivalentRemote = checkpoint
    ? { ...remote, elapsedMs: prior.elapsedMs, runningSince: prior.runningSince }
    : remote;
  if (local && prior.id === remote.id && !same(sessionClock(prior), sessionClock(local)) &&
    !same(sessionClock(prior), sessionClock(equivalentRemote)) && !same(sessionClock(local), sessionClock(equivalentRemote))) {
    return { data: current, conflicts: ["workspace.session.timer"] };
  }
  const merged = mergeWorkspaces(base, proposed, checkpoint ? { ...current, session: equivalentRemote } : current);
  if (!merged.conflicts.length && checkpoint && merged.data.session?.id === remote.id &&
    same(sessionClock(merged.data.session), sessionClock(equivalentRemote))) {
    merged.data = { ...merged.data, session: { ...merged.data.session, elapsedMs: remote.elapsedMs, runningSince: remote.runningSince } };
  }
  return merged;
}

function validHandoffOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch {
    return false;
  }
}

/** One instance, in the database worker, owns all notebook writes. */
export class CompanionStore {
  readonly db: DatabaseSync;
  readonly tutor: TutorStore;
  readonly backups: BackupStore;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version??0);
    if(version>HANDOFF_SCHEMA_VERSION){this.db.close();throw new Error('This notebook was written by a newer Forma Companion. Upgrade the app before opening it; the original file is preserved.');}
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, notebook TEXT NOT NULL, device TEXT NOT NULL, saved_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applied_commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recoveries (id TEXT PRIMARY KEY, notebook TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_handoff_pending (
        slot INTEGER PRIMARY KEY CHECK(slot=1), id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
        origin TEXT NOT NULL, source_key TEXT NOT NULL, claim_key TEXT NOT NULL, packet TEXT NOT NULL, account_id TEXT
      );
      CREATE TABLE IF NOT EXISTS session_handoff_completed (id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS sync_checkpoints (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO workspace VALUES(1,0,?,?,?)').run(encodeBackup(emptyData()), JSON.stringify(initialCompanionState()), new Date().toISOString());
    this.tutor=new TutorStore(this.db,this);
    this.backups=new BackupStore(this.db,{
      snapshot:()=>this.snapshot(),
      replace:(data,state,now)=>this.persist({data,state},this.snapshot().revision+1,now),
      rotateDraftEpoch:()=>{this.tutor.rotateRecoveryEpoch();},
      checkExport:()=>this.assertNoPendingHandoff("Finish or cancel the web handoff before exporting this notebook."),
      checkReplacement:data=>{
        this.assertNoPendingHandoff("Finish or cancel the web handoff before restoring a backup.");
        this.assertSessionWasNotTransferred(data);
      },
    });
  }
  close() { this.db.close(); }
  snapshot(): LocalSnapshot {
    const row = this.db.prepare('SELECT * FROM workspace WHERE id=1').get()!;
    const data=validateData(JSON.parse(String(row.notebook)));
    return {data, state: validateCompanionState(JSON.parse(String(row.device)),data), revision:Number(row.revision), savedAt:String(row.saved_at)};
  }
  private workspaceRecord({ data, revision, savedAt }: LocalSnapshot): PersonalRevision {
    const recoveryEpoch = String(this.db.prepare('SELECT epoch FROM tutor_draft_state WHERE id=1').get()!.epoch);
    return { key: "personal", data, revision, savedAt, recoveryEpoch };
  }
  readWorkspace(): PersonalRevision {
    return this.workspaceRecord(this.snapshot());
  }
  private saveWorkspaceRecovery(data: Data, reason: string, now: number): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO recoveries VALUES(?,?,?,?)').run(id, encodeBackup(data), reason, new Date(now).toISOString());
    return id;
  }
  workspaceRecoveries(): Recovery[] {
    return this.db.prepare('SELECT * FROM recoveries ORDER BY created_at DESC, rowid DESC').all().map(row => ({
      id: String(row.id), key: "personal", data: decodeBackup(String(row.notebook)), createdAt: String(row.created_at), reason: String(row.reason),
    }));
  }
  preserveWorkspaceRecovery(input: unknown, now = Date.now()): void {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid recovery copy.");
    const { data, reason } = input as { data: unknown; reason: unknown };
    if (typeof reason !== "string" || !reason.trim() || reason.length > 2000) throw new Error("Choose a valid reason for this recovery copy.");
    this.saveWorkspaceRecovery(validateData(data), reason, now);
  }
  commitWorkspace(input: unknown, now = Date.now()): CommitResult {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid workspace edit.");
    const { base, proposed, replace } = input as { base?: PersonalRevision; proposed?: Data; replace?: unknown };
    if (base?.key !== "personal" || !Number.isSafeInteger(base.revision) || base.revision < 0 ||
      typeof base.recoveryEpoch !== "string" || typeof replace !== "boolean") throw new Error("Invalid workspace revision.");
    const baseline = validateData(base.data);
    const proposal = validateData(proposed);
    return this.transaction(() => {
      const before = this.snapshot();
      const record = this.workspaceRecord(before);
      const conflict = (conflicts: string[]): CommitResult => ({
        record, conflicts, recoveryId: this.saveWorkspaceRecovery(proposal, conflicts.join(", "), now),
      });
      if (base.recoveryEpoch !== record.recoveryEpoch) return conflict(["The notebook was restored while this edit was pending"]);
      if (base.revision > record.revision) return conflict(["The workspace revision is no longer current"]);
      if (replace && base.revision !== record.revision) return conflict(["Workspace changed while replacement was pending"]);
      if (replace && before.data.session) return conflict(["Finish the active session before replacing this notebook"]);
      const merged = replace ? { data: proposal, conflicts: [] } : mergeDesktopWorkspace(baseline, proposal, before.data);
      if (merged.conflicts.length) return conflict(merged.conflicts);
      const data = replace && merged.data.session ? { ...merged.data, session: { ...merged.data.session, runningSince: null } } : merged.data;
      if (this.pendingSession() && (replace || !same(data.session, before.data.session))) return conflict([HANDOFF_PENDING]);
      if (before.data.session && data.codeforces.connectedHandle?.toLowerCase() !== before.data.codeforces.connectedHandle?.toLowerCase()) {
        return conflict(["Finish the active session before changing the Codeforces profile"]);
      }
      let state: CompanionState;
      try {
        state = this.reconcileWorkspaceState(before, data, now);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return conflict([error.message]);
      }
      if (same(data, before.data) && same(state, before.state) && !replace) return { record, conflicts: [] };
      const recoveryId = replace ? this.saveWorkspaceRecovery(before.data, "Before backup replacement", now) : undefined;
      const saved = this.persist({ data, state }, before.revision + 1, now);
      if (replace) this.tutor.rotateRecoveryEpoch();
      return { record: this.workspaceRecord(saved), conflicts: [], ...(recoveryId ? { recoveryId } : {}) };
    });
  }
  private reconcileWorkspaceState(before: LocalSnapshot, data: Data, now: number): CompanionState {
    const previous = before.data.session;
    const session = data.session;
    const handle = data.codeforces.connectedHandle;
    const problems = new Map(data.problems.map(problem => [problem.id, problem]));
    const chosen = problems.get(session?.problemId ?? previous?.problemId ?? before.state.problemId ?? "");
    const foreign = !!chosen?.cfHandle && chosen.cfHandle.toLowerCase() !== handle?.toLowerCase();
    if (session && foreign) throw new Error("This session belongs to another Codeforces profile");
    const problem = foreign ? undefined : chosen;
    const problemId = problem?.id ?? null;
    const identity = problem ? canonicalProblemIdentity(problem) ?? null : null;
    const changedProblem = problemId !== before.state.problemId || identity !== before.state.identity;
    const changedHandle = handle?.toLowerCase() !== before.state.handle?.toLowerCase();
    const started = !!session && session.id !== previous?.id;
    const ended = !!previous && !session;
    const attempt = ended ? data.attempts.find(row => row.id === previous.id && row.problemId === previous.problemId) : undefined;
    const reset = changedProblem || started || (ended && !attempt);
    let state: CompanionState = {
      ...before.state, problemId, identity, handle,
      lifecycle: session ? (session.runningSince === null ? "paused" : "working")
        : attempt ? "closed" : reset ? "ready" : before.state.lifecycle,
      learning: attempt?.outcome ?? (reset ? "unrecorded" : before.state.learning),
      platform: reset || changedHandle ? "unknown" : before.state.platform,
      localTests: reset ? "unknown" : before.state.localTests,
      checkedAt: changedHandle ? null : before.state.checkedAt,
    };
    if (ended && !attempt) {
      const withoutSession = <T extends { sessionId?: string }>(item: T): T => {
        if (item.sessionId !== previous.id) return item;
        const result = { ...item };
        delete result.sessionId;
        return result;
      };
      state = {
        ...state,
        ...(state.desk ? { desk: state.desk.map(withoutSession) } : {}),
        ...(state.followups ? { followups: state.followups.filter(row => row.id !== previous.id) } : {}),
        submissions: state.submissions.map(withoutSession),
      };
    }
    if (started && session.phase !== "reflection") state = applySessionFollowup(data, state, now).state;
    if (previous?.phase === "reflection" && session?.phase === "focus" && state.followups) {
      state = {
        ...state,
        followups: state.followups.map(row => row.id === session.id ? {
          ...row, finishedAt: null, discoveryUntil: null, nextCheckAt: new Date(now).toISOString(),
          status: row.status === "expired" ? "searching" : row.status,
        } : row),
      };
    }
    const finishing = session?.phase === "reflection" && previous?.phase !== "reflection";
    const finishedAt = attempt?.completedAt ?? (finishing ? new Date(Math.max(now, Date.parse(session.startedAt))).toISOString() : undefined);
    const finishingId = attempt?.id ?? (finishing ? session.id : undefined);
    if (finishedAt && state.followups) {
      state = {
        ...state,
        followups: state.followups.map(row => row.id === finishingId && !row.finishedAt ? {
          ...row, finishedAt, discoveryUntil: new Date(Date.parse(finishedAt) + DISCOVERY_MS).toISOString(), nextCheckAt: finishedAt,
        } : row),
      };
    }
    if (finishedAt && finishingId) {
      state = {
        ...state,
        submissions: state.submissions.map(row => {
          if (row.sessionId !== finishingId || row.submittedAt <= finishedAt) return row;
          const evidence = { ...row };
          delete evidence.sessionId;
          return evidence;
        }),
      };
    }
    if (!same(data.problems, before.data.problems)) {
      const oldProblems = new Map(before.data.problems.map(problem => [problem.id, problem]));
      const capturedIds = new Set([...state.thoughts, ...(state.desk ?? [])].map(item => item.problemId));
      for (const id of capturedIds) {
        const old = oldProblems.get(id);
        const next = problems.get(id);
        if (!old || !next) throw new Error("This edit would disconnect saved Ribbon notes or code from their problem");
        const oldIdentity = canonicalProblemIdentity(old);
        const newIdentity = canonicalProblemIdentity(next);
        const sameIdentity = oldIdentity || newIdentity ? oldIdentity === newIdentity
          : old.platform.toLowerCase() === next.platform.toLowerCase() && old.url === next.url && old.problemCode === next.problemCode;
        if (!sameIdentity) throw new Error("This edit would disconnect saved Ribbon notes or code from their problem");
      }
      for (const row of this.db.prepare('SELECT body FROM tutor_conversations').all()) {
        const conversation = JSON.parse(String(row.body)) as { problemId: string; identity: string };
        const linked = problems.get(conversation.problemId);
        if (!linked || canonicalProblemIdentity(linked) !== conversation.identity) {
          throw new Error("This edit would disconnect saved Tutor history from its problem");
        }
      }
    }
    try {
      return validateCompanionState(state, data);
    } catch {
      throw new Error("This edit would disconnect saved Ribbon notes, code, or practice evidence from their records");
    }
  }
  private transaction<T>(work: () => T): T {
    // Tutor approval joins this same synchronous writer transaction so a note and
    // its explicit approval receipt are committed together.
    if(this.db.isTransaction)return work();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private persist(next: {data:Data;state:CompanionState}, revision:number, now:number, capture=true) {
    const frozen = this.pendingSession();
    if (frozen && (next.data.session?.id !== frozen || next.data.session?.runningSince !== null || next.data.session?.phase !== "focus"))
      throw new Error(HANDOFF_PENDING);
    this.assertSessionWasNotTransferred(next.data);
    next = { data: reconcilePracticePlan(next.data, new Date(now)), state: next.state };
    const device=JSON.stringify(validateCompanionState(next.state,next.data));
    if (Buffer.byteLength(device) > MAX_DEVICE_BYTES) throw new Error('The companion capture store is full. Export a companion backup before continuing. Nothing was truncated.');
    const at=new Date(now).toISOString();
    this.db.prepare('UPDATE workspace SET revision=?, notebook=?, device=?, saved_at=? WHERE id=1').run(revision,encodeBackup(next.data),device,at);
    if(capture)this.db.prepare("INSERT INTO outbox VALUES('notebook',?,'local',?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, created_at=excluded.created_at").run(revision,at);
    return {...next, revision, savedAt:at};
  }
  private pendingSession() {
    return this.db.prepare("SELECT session_id FROM session_handoff_pending WHERE slot=1").get()?.session_id;
  }
  private assertNoPendingHandoff(message = HANDOFF_PENDING) {
    if (this.pendingSession()) throw new Error(message);
  }
  private assertSessionWasNotTransferred(data: Data) {
    if (data.session && this.db.prepare("SELECT 1 FROM session_handoff_completed WHERE session_id=?").get(data.session.id))
      throw new Error("This session was handed off to Forma on the web. Continue it from the receiving workspace.");
  }
  /** Capabilities stay inside the worker and host. Portable backups never include them. */
  currentHandoff(): PendingSessionHandoff | null {
    const row = this.db.prepare("SELECT * FROM session_handoff_pending WHERE slot=1").get();
    if (!row) return null;
    const packet = parseSessionHandoffPacket(JSON.parse(String(row.packet)));
    if (packet.session.id !== row.session_id) throw new Error("The pending web handoff has a mismatched session.");
    const accountId = row.account_id === null ? undefined : String(row.account_id);
    return {
      id: String(row.id),
      origin: String(row.origin),
      sourceKey: String(row.source_key),
      claimKey: String(row.claim_key),
      packet,
      offered: !!accountId,
      ...(accountId ? { accountId } : {}),
    };
  }
  beginHandoff({ id, origin, sourceKey, claimKey, sessionId }: {
    id: unknown; origin: unknown; sourceKey: unknown; claimKey: unknown; sessionId?: unknown;
  }): PendingSessionHandoff {
    if (!isHandoffId(id) || !validHandoffOrigin(origin) || !isHandoffKey(sourceKey) || !isHandoffKey(claimKey) || sourceKey === claimKey)
      throw new Error("The web handoff could not be started. Try opening it again.");
    return this.transaction(() => {
      this.assertNoPendingHandoff();
      if (this.db.prepare("SELECT 1 FROM session_handoff_completed WHERE id=?").get(id))
        throw new Error("This web handoff already finished.");
      const { data, state } = this.snapshot();
      if (sessionId !== undefined && data.session?.id !== sessionId) throw new Error("The active practice session changed. Reopen the web handoff.");
      this.assertSessionWasNotTransferred(data);
      const packet = makeSessionHandoffPacket(data, state);
      this.db.prepare("INSERT INTO session_handoff_pending VALUES(1,?,?,?,?,?,?,NULL)")
        .run(id, packet.session.id, origin, sourceKey, claimKey, JSON.stringify(packet));
      // The older app has no ownership checks. It may read a notebook with
      // empty handoff tables, but must refuse a notebook with handoff history.
      this.db.exec("PRAGMA user_version=" + HANDOFF_SCHEMA_VERSION);
      return { id, origin, sourceKey, claimKey, packet, offered: false };
    });
  }
  markHandoffSending({ id, accountId }: { id: unknown; accountId: unknown }): PendingSessionHandoff {
    if (!isHandoffId(id) || !isHandoffAccountId(accountId)) throw new Error("Link the destination Forma workspace first.");
    return this.transaction(() => {
      const pending = this.currentHandoff();
      if (!pending || pending.id !== id) throw new Error("This web handoff is no longer active.");
      if (pending.accountId && pending.accountId !== accountId) throw new Error("The linked Forma workspace changed.");
      this.db.prepare("UPDATE session_handoff_pending SET account_id=? WHERE slot=1").run(accountId);
      return { ...pending, offered: true, accountId };
    });
  }
  completeHandoff({ id, sessionId }: { id: unknown; sessionId: unknown }, now = Date.now()): LocalSnapshot {
    if (!isHandoffId(id) || typeof sessionId !== "string" || !sessionId || sessionId.length > 100)
      throw new Error("The web receipt does not identify a practice session.");
    return this.transaction(() => {
      const before = this.snapshot();
      if (this.db.prepare("SELECT 1 FROM session_handoff_completed WHERE id=? AND session_id=?").get(id, sessionId)) return before;
      const pending = this.currentHandoff();
      if (!pending?.offered || pending.id !== id || pending.packet.session.id !== sessionId ||
        before.data.session?.id !== sessionId || before.data.session.runningSince !== null || before.data.session.phase !== "focus")
        throw new Error("The web receipt does not match this paused session.");
      const { data, state } = before;
      function withoutSession<T extends {sessionId?: string}>(item: T): T {
        if (item.sessionId !== sessionId) return item;
        const next = { ...item };
        delete next.sessionId;
        return next;
      }
      this.db.prepare("INSERT INTO session_handoff_completed VALUES(?,?)").run(id, sessionId);
      this.db.prepare("DELETE FROM session_handoff_pending WHERE slot=1").run();
      return this.persist({
        data: {
          ...data,
          session: null,
          ...(data.contests ? { contests: data.contests.map(contest => ({
            ...contest,
            problems: contest.problems.map(problem => problem.upsolve?.sessionId === sessionId
              ? { ...problem, upsolve: withoutSession(problem.upsolve) } : problem),
          })) } : {}),
        },
        state: {
          ...state,
          lifecycle: "ready",
          localTests: "unknown",
          platform: "unknown",
          learning: "unrecorded",
          ...(state.desk ? { desk: state.desk.map(withoutSession) } : {}),
          ...(state.followups ? { followups: state.followups.filter(row => row.id !== sessionId) } : {}),
          submissions: state.submissions.map(withoutSession),
        },
      }, before.revision + 1, now);
    });
  }
  cancelHandoff({ id, terminal }: { id: unknown; terminal: unknown }): LocalSnapshot {
    if (!isHandoffId(id) || typeof terminal !== "boolean") throw new Error("The cancellation did not identify a web handoff.");
    return this.transaction(() => {
      const pending = this.currentHandoff();
      if (pending) {
        if (pending.id !== id) throw new Error("This web handoff is no longer active.");
        if (pending.offered && !terminal) throw new Error("Confirm cancellation on the web before resuming this session.");
        this.db.prepare("DELETE FROM session_handoff_pending WHERE slot=1").run();
      }
      return this.snapshot();
    });
  }
  reconcile(now=Date.now()) {
    const before=this.snapshot();
    const data=reconcilePracticePlan(before.data,new Date(now));
    const restored=before.data.session&&before.data.session.phase!=="reflection"&&!(before.state.followups??[]).some(f=>f.id===before.data.session!.id)
      ? applySessionFollowup(before.data,before.state,now).state : before.state;
    const state=expireFollowups(restored,now);
    if(JSON.stringify(data)===JSON.stringify(before.data)&&JSON.stringify(state)===JSON.stringify(before.state))return before;
    return this.transaction(()=>this.persist({data,state},before.revision+1,now,false));
  }
  /** A live focus projection is not a new association, capture, or outbox obligation. */
  selectBinding(fileUri:string,clientId:string,now=Date.now()):LocalSnapshot {
    return this.transaction(()=>{
      const before=this.snapshot(),binding=before.state.bindings.find(b=>b.fileUri===fileUri&&(!b.clientId||b.clientId===clientId));
      if(!binding)throw new Error('This solution association is no longer available.');
      const problem=before.data.problems.find(p=>p.id===binding.problemId)!;
      if(problem.cfHandle&&problem.cfHandle.toLowerCase()!==before.state.handle?.toLowerCase())throw new Error('Confirm this file for the selected Codeforces profile before continuing.');
      if(before.data.session&&before.data.session.problemId!==problem.id)throw new Error('Finish the open session before switching problems.');
      if(before.state.problemId===problem.id)return before;
      return this.persist({data:before.data,state:{...before.state,problemId:problem.id,identity:binding.identity,lifecycle:'ready',localTests:'unknown',platform:'unknown',learning:'unrecorded'}},before.revision+1,now,false);
    });
  }
  command(input: unknown, producer = 'desktop', now=Date.now()): LocalSnapshot {
    const command = parseCommand(input,now);
    const deskCapture = command.type === "desk-add" || command.type === "desk-remove";
    if (deskCapture && ((producer === "vscode") !== (command.type === "desk-add" && command.payload.kind === "code"))) {
      throw new Error("Pin code from VS Code and manage other desk items in the Ribbon.");
    }
    const fingerprint=hash(JSON.stringify(command));
    return this.transaction(() => {
      const previous=this.db.prepare('SELECT * FROM applied_commands WHERE id=?').get(command.id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('This command ID was already used for a different action.');
        return this.snapshot();
      }
      if (["start", "resume", "finish", "reflect", "plan-select", "desk-add", "desk-remove"].includes(command.type))
        this.assertNoPendingHandoff();
      const before=this.snapshot();
      if (!deskCapture) {
        const journal=this.db.prepare('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM observations').get()!;
        if(Number(journal.bytes)>32*1024*1024)throw new Error('The local observation journal is full. Export a companion backup before continuing. Saved captures are preserved.');
      }
      const next=applyCompanionCommand(before.data,before.state,command,now);
      const saved=this.persist(next,before.revision+1,now);
      this.db.prepare('INSERT INTO applied_commands VALUES(?,?,?)').run(command.id,fingerprint,saved.revision);
      // Desk entries are private, removable working material. Keep the receipt without a second copy.
      if (deskCapture) return saved;
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
        const event=parseEvent({eventId:id,eventVersion:1,eventType:'SubmissionBatchObserved',deviceId:this.deviceId(),producer:'codeforces',producerVersion:'public-api-v1',workspaceKey:'personal',occurredAt:saved.savedAt,receivedAt:saved.savedAt,correlationId:id,payload:{handle:(body as {handle:string}).handle,checkedAt:(body as {checkedAt:string}).checkedAt,submissions}});
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
    this.assertNoPendingHandoff("Finish or cancel the web handoff before importing a notebook.");
    const imported=decodeBackup(json);
    this.assertSessionWasNotTransferred(imported);
    const before=this.snapshot();
    if (before.data.session || imported.session) throw new Error('Finish open sessions before importing. Keep the original backup to preserve an unfinished session.');
    const merged=mergeWorkspaces(emptyData(),before.data,imported);
    if (merged.conflicts.length) {
      this.db.prepare('INSERT INTO recoveries VALUES(?,?,?,?)').run(randomUUID(),encodeBackup(imported),'Import conflicts: '+merged.conflicts.join(', '),new Date(now).toISOString());
      throw new Error('Some records conflict. The imported copy is preserved in your companion backup; the current notebook is unchanged.');
    }
    return this.transaction(() => {
      this.db.prepare('INSERT INTO recoveries VALUES(?,?,?,?)').run(randomUUID(),encodeBackup(before.data),'Before notebook import',new Date(now).toISOString());
      const handle=merged.data.codeforces.connectedHandle;
      const next=before.state.handle===handle ? {data:merged.data,state:before.state} : applyCompanionCommand(merged.data,before.state,{id:randomUUID(),type:'set-handle',payload:{handle}},now);
      const saved=this.persist(next,before.revision+1,now);
      this.db.prepare('INSERT INTO outbox VALUES(?,?,?,?)').run(randomUUID(),saved.revision,'local',saved.savedAt);
      return saved;
    });
  }
  exportNotebook() {
    this.assertNoPendingHandoff("Finish or cancel the web handoff before exporting this notebook.");
    return encodeBackup(this.snapshot().data);
  }
  /** Called only by TutorStore.approve, after the renderer shows a reviewed proposal. */
  approveTutorLearning(proposal:TutorProposal,now:number) {
    return this.transaction(()=>{
      const id=`tutor:${hash(proposal.id)}`,fingerprint=hash(JSON.stringify(proposal));
      const receipt=this.db.prepare('SELECT fingerprint FROM applied_commands WHERE id=?').get(id);
      if(receipt){if(receipt.fingerprint!==fingerprint)throw new Error('This tutor approval was already used for different text.');return;}
      const before=this.snapshot(),problem=before.data.problems.find(row=>row.id===proposal.problemId);
      if(!problem||canonicalProblemIdentity(problem)!==proposal.identity)throw new Error('The original problem is unavailable. The proposed note is preserved.');
      const attempt=proposal.sessionId?before.data.attempts.find(row=>row.id===proposal.sessionId&&row.problemId===proposal.problemId):null;
      if(before.data.session&&before.data.session.id!==proposal.sessionId)throw new Error('Another session is active. Finish it before saving a note to the original session.');
      if(proposal.sessionId&&!attempt&&before.data.session?.id!==proposal.sessionId)throw new Error('The original session is unavailable. The proposed note is preserved.');
      if(proposal.kind==='thought'){
        if(before.state.problemId!==proposal.problemId||before.state.identity!==proposal.identity)throw new Error('Return to the original problem before approving this thought. The proposed text is preserved.');
        this.command({id,type:'thought',expectedProblemKey:proposal.identity,...(before.data.session?{expectedSessionId:before.data.session.id}:{}),payload:{text:proposal.text}},'desktop',now);
        return;
      }
      if(!proposal.sessionId)throw new Error('This untimed conversation has no saved attempt. Save it as a thought instead; no attempt or elapsed time will be invented.');
      if(!attempt||before.data.session)throw new Error('Finish and save the original reflection before saving this takeaway. The proposed draft is preserved.');
      // Reuse reflection validation while retaining the user's outcome, time,
      // notes, review dates and all scheduling metadata exactly as approved.
      const validated=recordPracticeReflection(before.data,{...attempt,takeaway:proposal.text},{reviewAt:problem.reviewAt,reviewCount:problem.reviewCount},{reviewManual:problem.reviewManual});
      const data=validateData({...validated,problems:before.data.problems});
      const saved=this.persist({data,state:before.state},before.revision+1,now);
      this.db.prepare('INSERT INTO applied_commands VALUES(?,?,?)').run(id,fingerprint,saved.revision);
      this.db.prepare('INSERT INTO observations VALUES(?,?,?,?)').run(id,'TutorTakeawayApproved',JSON.stringify({version:1,id,problemId:proposal.problemId,sessionId:proposal.sessionId,text:proposal.text,approvedAt:saved.savedAt}),saved.savedAt);
      this.db.prepare('INSERT INTO outbox VALUES(?,?,?,?)').run(id,saved.revision,'local',saved.savedAt);
    });
  }
  exportCompanion() {
    this.assertNoPendingHandoff("Finish or cancel the web handoff before exporting this notebook.");
    return JSON.stringify({format:'forma-companion',version:1,exportedAt:new Date().toISOString(),...this.snapshot(),preferences:this.preferences(),observations:this.db.prepare('SELECT * FROM observations').all(),commands:this.db.prepare('SELECT * FROM applied_commands').all(),outbox:this.db.prepare('SELECT * FROM outbox').all(),recoveries:this.db.prepare('SELECT * FROM recoveries').all()},null,2);
  }
}
