/** Local-only Tutor boundary. Provider keys/audio never belong in these records. */
export const TUTOR_VERSION = 1 as const;
export const TUTOR_ACTIONS = ['discuss','small-hint','stronger-hint','check-code','explain','full-explanation'] as const;
export type TutorAction = typeof TUTOR_ACTIONS[number];
export interface StatementInput {
  identity:string; url:string; title:string; description:string; input:string; output:string;
  constraints:string; samples:{input:string;output:string}[]; explanation:string;
  complete:boolean; source:'browser'|'manual';
}
export interface StatementSnapshot extends StatementInput { id:string;revision:string;capturedAt:string }
export interface SharedCode {
  id:string; identity:string; workspaceId:string; clientId:string; fileUri:string; filename:string;
  language:string; startLine:number; endLine:number; text:string; revision:string; capturedAt:string;
}
export interface TutorContext {
  version:1; identity:string; problemId:string; title:string; url:string; workspaceId:string;
  conversationId:string; sessionId:string|null; statement:StatementSnapshot|null; code:SharedCode|null;
  notes:{id:string;text:string}[]; evidence:{platform:string;checkedAt:string|null;localTests:string;submissions:{id:number;verdict:string|null;observedAt:string}[]};
  frozenAt:string;
}
export interface TutorConversation { id:string;identity:string;problemId:string;title:string;workspaceId:string;createdAt:string;updatedAt:string }
export type TutorTurnStatus='queued'|'streaming'|'completed'|'interrupted'|'failed';
export interface TutorUsage {inputTokens:number;outputTokens:number;totalTokens:number}
export interface TutorTurn {
  id:string;requestId:string;conversationId:string;action:TutorAction;userText:string;assistantText:string;
  context:TutorContext;status:TutorTurnStatus;createdAt:string;completedAt:string|null;error:string|null;
  hintLevel:number;exposed:boolean;usage:TutorUsage|null;model:string;
}
export interface TutorSettings {contestMode:boolean;retentionDays:number;voiceOutput:boolean}
export interface TutorStoredView { conversations:TutorConversation[];settings:TutorSettings;pendingCode:SharedCode|null }
export interface TutorContextView {conversation:TutorConversation;statement:StatementSnapshot|null;pendingCode:SharedCode|null;notes:{id:string;text:string}[];sessionId:string|null;evidence:TutorContext['evidence']}
export interface TutorProviderStatus {configured:boolean;model:string;transcriptionModel:string;speechModel:string;message:string}
export interface TutorView extends TutorStoredView {provider:TutorProviderStatus;activeRequestId:string|null}
export interface TutorSendInput {
  turnId:string;requestId:string;conversationId:string;action:TutorAction;text:string;
  statementId:string|null;codeId:string|null;noteIds:string[];
}
export type TutorEvent={kind:'delta'|'updated';conversationId:string;turnId:string;requestId:string;text?:string};
export interface TutorProposal {id:string;conversationId:string;turnId:string;problemId:string;identity:string;sessionId:string|null;kind:'thought'|'takeaway';text:string;createdAt:string;saved:boolean}
