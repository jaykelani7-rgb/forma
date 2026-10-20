import type { CompanionState } from '../core/src/companion';
import { followupDue } from '../core/src/verdict-followup';
import type { SubmissionInput } from '../../src/lib/codeforces-types';
export interface FollowupEvidence {handle:string;submissions:SubmissionInput[];checkedAt:string;error?:string}
/** Bounded, injectable coordinator. A process shares a single paced API adapter. */
export class VerdictScheduler {
  private running:Promise<void>|null=null;
  private lastCheck=-Infinity;
  constructor(private readonly ports:{read:()=>Promise<CompanionState>;fetch:(handle:string,identities:string[])=>Promise<SubmissionInput[]>;write:(evidence:FollowupEvidence)=>Promise<unknown>;now:()=>number}){}
  run(manual=false):Promise<void>{
    if(this.running)return this.running;
    if(this.ports.now()-this.lastCheck<10_000)return Promise.resolve();
    this.running=this.check(manual).finally(()=>{this.running=null;});
    return this.running;
  }
  private async check(manual:boolean){
    const state=await this.ports.read(), now=this.ports.now();
    const due=(state.followups??[]).filter(f=>manual||followupDue(f,now)).sort((a,b)=>(a.checkedAt??'').localeCompare(b.checkedAt??''));
    const handles=[...new Set([...(manual&&state.handle?[state.handle]:[]),...due.map(f=>f.handle)].map(h=>h.toLowerCase()))].slice(0,4);
    if(!handles.length)return;
    this.lastCheck=now;
    for(const handle of handles){
      const identities=[...new Set([...due.filter(f=>f.handle.toLowerCase()===handle).map(f=>f.identity),...(state.handle?.toLowerCase()===handle&&state.identity?[state.identity]:[])])];
      let evidence:FollowupEvidence;
      try{evidence={handle,submissions:await this.ports.fetch(handle,identities),checkedAt:new Date(this.ports.now()).toISOString()};}
      catch(error){evidence={handle,submissions:[],checkedAt:new Date(this.ports.now()).toISOString(),error:error instanceof Error?error.message:'Temporary Codeforces failure. Saved evidence is unchanged.'};}
      await this.ports.write(evidence);
    }
  }
}
