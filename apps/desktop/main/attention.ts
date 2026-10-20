import type { CompanionState } from '../../../packages/core/src/companion';
import type { RecognitionView } from '../../../packages/integrations/recognition';
export interface VerdictNotice { id:string; title:string; message:string }
/** A single quiet slot. Routine recognition cannot interrupt active coding. */
export class AttentionPolicy {
  private initialized=false;
  private seen=new Set<string>();
  private active:{id:string;until:number;verdict:VerdictNotice}|null=null;
  dismiss(id:string){this.seen.add(id);if(this.active?.id===id)this.active=null;}
  view(state:CompanionState, recognition:RecognitionView, snoozed:boolean, now:number){
    for(const f of state.followups??[]){
      if(f.status!=='final')continue;
      const rows=state.submissions.filter(s=>s.sessionId===f.id);
      const result=rows.map(s=>`${s.id}:${s.verdict}`).sort().join(',');
      const id=`verdict:${f.id}:${result}`;
      if(this.seen.has(id))continue;
      this.seen.add(id);
      if(this.initialized&&!snoozed)this.active={id,until:now+8000,verdict:{id,title:`${f.handle} · ${f.identity.replace(/^contest:(\d+):/, "$1").replace(/^gym:(\d+):/, "Gym $1")}`,message:rows.some(s=>s.verdict==='OK')?'Accepted on Codeforces. Your reflection is unchanged.':`Verdict: ${rows.at(-1)?.verdict ?? 'pending'}. Your reflection is unchanged.`}};
    }
    this.initialized=true;
    if(this.seen.size>2000)this.seen=new Set([...this.seen].slice(-1000));
    if(snoozed)return {recognition:null,verdict:null};
    if(recognition && (state.lifecycle!=='working'||recognition.status!=='recognised'))return {recognition,verdict:null};
    return {recognition:null,verdict:this.active&&now<this.active.until?this.active.verdict:null};
  }
}
