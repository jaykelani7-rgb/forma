import type { TutorDraftContent, TutorDraftSaveInput, TutorDraftSaveResult, TutorDraftView } from '../../../packages/tutor/types';

export type DraftSaveState='saved'|'saving'|'error';
interface Entry {draft:TutorDraftView;content:TutorDraftContent;generation:number;committed:number;timer:ReturnType<typeof setTimeout>|null;chain:Promise<unknown>;paused:boolean;deleted:boolean;uncertain:{revision:number;content:TutorDraftContent}[]}
const content=(draft:TutorDraftContent):TutorDraftContent=>({text:draft.text,action:draft.action,statementId:draft.statementId,codeId:draft.codeId,noteIds:[...draft.noteIds]});
/** One serialized writer per conversation. UI text stays local while a commit is pending. */
export class TutorDraftAutosave {
 private entries=new Map<string,Entry>();
 constructor(private readonly save:(input:TutorDraftSaveInput)=>Promise<TutorDraftSaveResult>,private readonly changed:(id:string,state:DraftSaveState,error?:string)=>void,private readonly delay=450){}
 seed(draft:TutorDraftView):void {const old=this.entries.get(draft.conversationId);if(old&&!old.deleted&&old.draft.epoch===draft.epoch)return;this.entries.set(draft.conversationId,{draft,content:content(draft),generation:0,committed:0,timer:null,chain:Promise.resolve(),paused:false,deleted:false,uncertain:[]});this.changed(draft.conversationId,'saved');}
 edit(id:string,draft:TutorDraftContent):void {const entry=this.entries.get(id);if(!entry||entry.deleted)return;entry.content=content(draft);entry.generation++;this.changed(id,'saving');this.schedule(id,entry);}
 private schedule(id:string,entry:Entry):void {if(entry.timer)clearTimeout(entry.timer);entry.timer=null;if(entry.paused||entry.deleted)return;entry.timer=setTimeout(()=>{entry.timer=null;void this.flush(id).catch(()=>{});},this.delay);}
 pause(id:string):number {const entry=this.entries.get(id);if(entry){entry.paused=true;if(entry.timer)clearTimeout(entry.timer);entry.timer=null;}return entry?.generation??0;}
 /** Returns the exact content captured when flush was requested, even if typing continues. */
 flush(id:string):Promise<TutorDraftView> {
  const entry=this.entries.get(id);if(!entry||entry.deleted)return Promise.reject(new Error('This draft is no longer available.'));
  if(entry.timer)clearTimeout(entry.timer);entry.timer=null;
  const generation=entry.generation,snapshot=content(entry.content);
  const operation=entry.chain.catch(()=>{}).then(async()=>{
   if(entry.deleted)throw new Error('This conversation was deleted.');
   if(generation<=entry.committed)return {...entry.draft,...snapshot};
   this.changed(id,'saving');
   try{
    const persist=async()=>{const revision=entry.draft.revision;try{return await this.save({conversationId:id,epoch:entry.draft.epoch,expectedRevision:revision,...snapshot});}catch(error){entry.uncertain.push({revision,content:snapshot});entry.uncertain=entry.uncertain.slice(-4);throw error;}};
    let result=await persist();
    if(entry.deleted)throw new Error('This conversation was deleted.');
    // A failed acknowledgement can hide a successful prior write. Rebase only
    // that exact owned content/revision, never an unrelated newer draft.
    if(!result.saved&&JSON.stringify(content(result.draft))!==JSON.stringify(snapshot)&&entry.uncertain.some(write=>result.draft.revision===write.revision+1&&JSON.stringify(content(result.draft))===JSON.stringify(write.content))){entry.draft=result.draft;result=await persist();}
    if(entry.deleted)throw new Error('This conversation was deleted.');
    if(!result.saved&&JSON.stringify(content(result.draft))!==JSON.stringify(snapshot))throw new Error('This draft changed elsewhere. Your question is kept here; reopen the conversation to review the saved version.');
    entry.uncertain=[];entry.draft=result.draft;entry.committed=generation;
    if(entry.generation===generation)this.changed(id,'saved');else {this.changed(id,'saving');this.schedule(id,entry);}
    return result.draft;
   }catch(error){if(!entry.deleted)this.changed(id,'error',error instanceof Error?error.message:'Draft could not be saved.');throw error;}
  });
  entry.chain=operation;return operation;
 }
 /** Called after Send settles, while autosaving is paused, before later edits resume. */
 resume(id:string,draft:TutorDraftView,submitted:TutorDraftContent,submittedGeneration?:number):TutorDraftContent {
  const entry=this.entries.get(id);if(!entry||entry.deleted)return content(draft);
  const unchanged=submittedGeneration===undefined?JSON.stringify(entry.content)===JSON.stringify(content(submitted)):entry.generation===submittedGeneration;
  entry.draft=draft;
  if(unchanged){entry.content=content(draft);entry.committed=entry.generation;}
  entry.paused=false;
  if(entry.generation>entry.committed){this.changed(id,'saving');this.schedule(id,entry);}else this.changed(id,'saved');
  return content(entry.content);
 }
 forget(id:string):void {const entry=this.entries.get(id);if(entry){entry.deleted=true;if(entry.timer)clearTimeout(entry.timer);}this.entries.delete(id);}
 reset():void {for(const id of this.entries.keys())this.forget(id);}
 flushAll():Promise<void>{return Promise.all([...this.entries.keys()].map(id=>this.flush(id))).then(()=>{});}
}
