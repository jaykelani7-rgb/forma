import { createHash } from 'node:crypto';
import { canonicalProblemIdentity, normalizeCodeforcesIdentity } from '../core/src/codeforces-identity';
import type { CompanionSnapshot } from '../core/src/companion';
import type { SharedCode, StatementInput, StatementSnapshot, TutorContext, TutorConversation } from './types';

/** Character budgets bound both local IPC and selected provider context. No source is silently truncated. */
export const TUTOR_BUDGET = { statement: 40_000, code: 24_000, notes: 6_000, user: 6_000, history: 14_000, total: 90_000, response: 24_000, historyTurns: 8 } as const;
export const tutorHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function tutorObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tutor message.');
  return value as Record<string, unknown>;
}
export function tutorFields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported tutor fields.');
}
export function tutorText(value: unknown, max: number, min = 0): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0')) throw new Error(`Tutor text must contain ${min} to ${max} characters.`);
  return value;
}
export function tutorId(value: unknown): string {
  const id = tutorText(value, 120, 1);
  if (!/^[A-Za-z0-9:_.-]+$/.test(id)) throw new Error('Invalid tutor identifier.');
  return id;
}
export function tutorTime(value: unknown): string {
  const stamp = tutorText(value, 40, 20);
  if (!Number.isFinite(Date.parse(stamp))) throw new Error('Invalid tutor timestamp.');
  return stamp;
}
export function parseStatementInput(value: unknown): StatementInput {
  const v = tutorObject(value);
  tutorFields(v, ['identity','url','title','description','input','output','constraints','samples','explanation','complete','source']);
  const identity = normalizeCodeforcesIdentity(tutorText(v.url, 400, 1));
  if (!identity || v.identity !== identity.key) throw new Error('The statement URL does not match its canonical problem identity.');
  if (!Array.isArray(v.samples) || v.samples.length > 10) throw new Error('Include at most ten statement samples.');
  const samples = v.samples.map(sample => {
    const s = tutorObject(sample); tutorFields(s,['input','output']);
    return {input:tutorText(s.input,TUTOR_BUDGET.statement),output:tutorText(s.output,TUTOR_BUDGET.statement)};
  });
  if (typeof v.complete !== 'boolean' || !['browser','manual'].includes(String(v.source))) throw new Error('The statement needs explicit completeness and provenance.');
  const parsed: StatementInput = {identity:identity.key,url:identity.url,title:tutorText(v.title,300,1),description:tutorText(v.description,TUTOR_BUDGET.statement),input:tutorText(v.input,TUTOR_BUDGET.statement),output:tutorText(v.output,TUTOR_BUDGET.statement),constraints:tutorText(v.constraints,TUTOR_BUDGET.statement),samples,explanation:tutorText(v.explanation,TUTOR_BUDGET.statement),complete:v.complete,source:v.source as StatementInput['source']};
  if (JSON.stringify(parsed).length > TUTOR_BUDGET.statement) throw new Error('The statement exceeds the 40,000 character budget. Include a smaller relevant statement snapshot.');
  if (parsed.complete && (!parsed.description.trim() || !parsed.input.trim() || !parsed.output.trim() || !parsed.samples.length || parsed.samples.some(sample=>!sample.input.trim()||!sample.output.trim()))) throw new Error('A complete statement needs a description, input/output requirements, and samples. Mark an incomplete capture honestly.');
  return parsed;
}
export function validateStatement(value: unknown, now = Date.now()): StatementSnapshot {
  const parsed = parseStatementInput(value);
  const revision = `sha256:${tutorHash(JSON.stringify(parsed))}`;
  return {...parsed,id:`statement:${revision.slice(7)}`,revision,capturedAt:new Date(now).toISOString()};
}
export function parseSharedCode(value: unknown): SharedCode {
  const v = tutorObject(value);
  tutorFields(v,['id','identity','workspaceId','clientId','fileUri','filename','language','startLine','endLine','text','revision','capturedAt']);
  const fileUri=tutorText(v.fileUri,2000,1), filename=tutorText(v.filename,250,1), revision=tutorText(v.revision,160,1);
  let url:URL; try { url=new URL(fileUri); } catch { throw new Error('Share a local file from the approved workspace.'); }
  if (url.protocol!=='file:' || url.hostname || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/') || /[/\\]/.test(filename) || filename==='.' || filename==='..') throw new Error('Share a local file with a filename label.');
  let actualFilename:string;try{actualFilename=decodeURIComponent(url.pathname.split('/').at(-1)??'');}catch{throw new Error('Invalid shared file URI.');}
  if(actualFilename!==filename)throw new Error('The filename label does not match the shared source.');
  if (typeof v.identity!=='string' || !/^(contest|gym):[1-9]\d{0,8}:[A-Z]\d{0,8}$/.test(v.identity)) throw new Error('The code needs a canonical Codeforces problem identity.');
  if (!/^(?:version:\d+:)?sha256:[a-f0-9]{64}$/.test(revision)) throw new Error('The shared code needs a source revision.');
  if (!Number.isInteger(v.startLine) || !Number.isInteger(v.endLine) || Number(v.startLine)<1 || Number(v.endLine)<Number(v.startLine) || Number(v.endLine)>10_000_000) throw new Error('Invalid selected code line range.');
  const text=tutorText(v.text,TUTOR_BUDGET.code,1);
  if(!revision.endsWith(`sha256:${tutorHash(text)}`))throw new Error('The shared code does not match its source revision. Review the selection again.');
  return {id:tutorId(v.id),identity:v.identity,workspaceId:tutorId(v.workspaceId),clientId:tutorId(v.clientId),fileUri,filename,language:tutorText(v.language,80),startLine:Number(v.startLine),endLine:Number(v.endLine),text,revision,capturedAt:tutorTime(v.capturedAt)};
}
export const validateSharedCode = parseSharedCode;

/** Explicit choices only: this enumeration is for local inspection, never automatic inclusion. */
export function availableTutorNotes(snapshot: CompanionSnapshot, problemId: string): {id:string;text:string}[] {
  const thoughts=snapshot.state.thoughts.filter(note=>note.problemId===problemId).map(note=>({id:note.id,text:note.text}));
  const attempts=snapshot.data.attempts.filter(attempt=>attempt.problemId===problemId).map(attempt=>({id:attempt.id,text:[attempt.takeaway,attempt.notes].filter(Boolean).join('\n')})).filter(note=>note.text.trim());
  return [...thoughts,...attempts];
}
export function freezeTutorContext(snapshot: CompanionSnapshot, conversation: TutorConversation, selected: {statement:StatementSnapshot|null;code:SharedCode|null;noteIds:string[]}, now=Date.now()): TutorContext {
  const problem=snapshot.data.problems.find(row=>row.id===conversation.problemId);
  if (!problem || canonicalProblemIdentity(problem)!==conversation.identity) throw new Error('The conversation problem is missing or changed. Reopen its original context.');
  const statement=selected.statement, code=selected.code;
  if (statement && statement.identity!==conversation.identity) throw new Error('The selected statement belongs to another problem.');
  if (code && (code.identity!==conversation.identity || code.workspaceId!==conversation.workspaceId)) throw new Error('The shared code does not match this conversation and workspace.');
  if (!Array.isArray(selected.noteIds) || selected.noteIds.length>20 || new Set(selected.noteIds).size!==selected.noteIds.length) throw new Error('Choose at most twenty distinct prior notes explicitly.');
  const available=availableTutorNotes(snapshot,conversation.problemId);
  const notes=selected.noteIds.map(id=>{
    tutorId(id); const found=available.find(note=>note.id===id);
    if (!found) throw new Error('A selected note no longer belongs to this problem.');
    return {...found};
  });
  if (notes.reduce((n,note)=>n+note.text.length,0)>TUTOR_BUDGET.notes) throw new Error('The selected notes exceed the 6,000 character context budget. Include fewer notes.');
  const current=snapshot.state.identity===conversation.identity && snapshot.state.problemId===conversation.problemId;
  const session=snapshot.data.session?.problemId===conversation.problemId?snapshot.data.session:null;
  const handle=problem.cfHandle??snapshot.state.handle;
  return structuredClone({version:1,identity:conversation.identity,problemId:conversation.problemId,title:conversation.title,url:normalizeCodeforcesIdentity(problem.url)!.url,workspaceId:conversation.workspaceId,conversationId:conversation.id,sessionId:session?.id??null,statement,code,notes,evidence:{platform:current?snapshot.state.platform:'unknown',checkedAt:current?snapshot.state.checkedAt:null,localTests:current?snapshot.state.localTests:'unknown',submissions:snapshot.state.submissions.filter(row=>row.identity===conversation.identity&&handle&&row.handle.toLowerCase()===handle.toLowerCase()&&(!session||row.sessionId===session.id)).slice(-10).map(row=>({id:row.id,verdict:row.verdict,observedAt:row.observedAt}))},frozenAt:new Date(now).toISOString()} satisfies TutorContext);
}
/** No absolute file URI, workspace identity, client identity or local notebook IDs leave this boundary. */
export function providerContext(context: TutorContext) {
  const {statement,code}=context;
  return {problem:{identity:context.identity,title:context.title,url:context.url},statement:statement?{revision:statement.revision,source:statement.source,complete:statement.complete,capturedAt:statement.capturedAt,description:statement.description,input:statement.input,output:statement.output,constraints:statement.constraints,samples:statement.samples,explanation:statement.explanation}:null,code:code?{filename:code.filename,language:code.language,startLine:code.startLine,endLine:code.endLine,text:code.text,revision:code.revision,capturedAt:code.capturedAt}:null,explicitlyIncludedNotes:context.notes.map(note=>({text:note.text})),evidence:context.evidence,frozenAt:context.frozenAt};
}
