"use client";
import { useState } from "react";
import { Check, CalendarDays } from "lucide-react";
import { DIFFICULTIES, Difficulty, Outcome, addDays, localDate } from "@/lib/model";
import { ImportedAttempt } from "@/lib/codeforces-types";
import { latestSubmission, proposedReview, reflectionFor, relevantSchedule, saveQuickReflection, skipReflection, verdictLabel } from "@/lib/codeforces";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";

export const QUICK_OUTCOMES:Record<Outcome,string>={independent:"Solved independently",hint:"Used a hint",editorial:"Used the editorial",unsolved:"Still need to understand it"};
export function QuickReflectionDialog({attempt,onClose}:{attempt:ImportedAttempt;onClose:()=>void}) {
  const {data,update,notify}=useWorkspace();
  const problem=data.problems.find(p=>p.id===attempt.problemId)!;
  const previous=reflectionFor(data,attempt.id);
  const [outcome,setOutcome]=useState<Outcome|null>(previous?.outcome??null);
  const [difficulty,setDifficulty]=useState<Difficulty|null>(previous?.difficulty??null);
  const [takeaway,setTakeaway]=useState(previous?.takeaway??"");
  const [date,setDate]=useState<string|null>(problem.reviewManual||problem.reviewAttemptId===attempt.id?problem.reviewAt:previous?proposedReview(data,problem,previous.outcome):null);
  const [override,setOverride]=useState(false);
  const [error,setError]=useState("");
  const relevant=relevantSchedule(data,attempt);
  const latest=latestSubmission(data,attempt);
  function choose(value:Outcome) {
    setOutcome(value);setError("");
    if(!problem.reviewManual&&!override) setDate(proposedReview(data,problem,value));
  }
  function save(event:React.FormEvent) {
    event.preventDefault();
    if(!outcome){setError("Choose the reflection that fits this attempt.");return;}
    const submitted=new FormData(event.currentTarget as HTMLFormElement);
    const chosen=date===null?null:String(submitted.get("reviewDate")??date);
    if(chosen!==null && (!/^\d{4}-\d{2}-\d{2}$/.test(chosen)||localDate(new Date(`${chosen}T12:00:00`))!==chosen)){setError("Choose a valid local calendar date, or no revisit.");return;}
    update(d=>saveQuickReflection(d,attempt.id,{outcome,difficulty,takeaway,reviewAt:chosen,overrideSchedule:override||chosen!==date}));
    notify(relevant?chosen?"Reflection saved. Your suggested revisit is in the queue.":"Reflection saved. No new revisit needed.":"Reflection saved. The newer attempt keeps its revisit date.");onClose();
  }
  return <Modal title="A moment to understand." onClose={onClose} className="quick-reflection-modal"><form onSubmit={save} className="form-stack">
    <div className="quick-context"><strong>{problem.title}</strong><span className="small muted">{attempt.handle} · #{problem.problemCode} · {verdictLabel(latest?.verdict??null)} · {attempt.submissionIds.length} submission{attempt.submissionIds.length===1?"":"s"}</span></div>
    <p className="small muted">Codeforces records the verdict. You tell the story of how you got there.</p>
    <fieldset><legend>How did you solve it?</legend><div className="outcome-options">{Object.entries(QUICK_OUTCOMES).map(([key,label],i)=><button data-initial-focus={i===0?"true":undefined} type="button" key={key} aria-pressed={outcome===key} className={outcome===key?"selected":""} onClick={()=>choose(key as Outcome)}><span className="option-radio">{outcome===key&&<Check size={13}/>}</span>{label}</button>)}</div></fieldset>
    <details className="quick-optional" open={!!previous?.difficulty}><summary>Where did you get stuck? <span className="optional">optional</span></summary><fieldset className="difficulty-options"><legend className="sr-only">Where did you get stuck?</legend><div>{Object.entries(DIFFICULTIES).map(([key,label])=><button type="button" key={key} className={difficulty===key?"selected":""} aria-pressed={difficulty===key} onClick={()=>setDifficulty(difficulty===key?null:key as Difficulty)}>{label}</button>)}</div></fieldset></details>
    <label>One thing to remember <span className="optional">optional</span><input value={takeaway} onChange={e=>setTakeaway(e.target.value)} maxLength={300} placeholder="Next time, I’ll…"/></label>
    {outcome&&relevant&&<div className="schedule-preview"><div><CalendarDays size={16}/><strong>Your next step</strong></div>{problem.reviewManual&&!override&&<p className="small muted">Keeping the revisit date you chose. Change it here only if you want to.</p>}<div className="schedule-choices" role="group" aria-label="Revisit choice"><button type="button" aria-pressed={date!==null} className={date!==null?"selected":""} onClick={()=>{setDate(date??localDate(addDays(new Date(),outcome==="independent"?7:data.settings.reviewDays[outcome])));setOverride(true);}}>Suggest a revisit{outcome==="independent"?" in 7 days":""}</button><button type="button" aria-pressed={date===null} className={date===null?"selected":""} onClick={()=>{setDate(null);setOverride(true);}}>No revisit</button></div>{date!==null&&<label>Proposed revisit date<input name="reviewDate" type="date" value={date} onChange={e=>{setDate(e.target.value);setOverride(true);}} required/></label>}<p className="tiny muted">A scheduling default, at your pace. Dates use your local calendar.</p></div>}
    {!relevant&&<p className="small muted">A newer reflected attempt sets this problem’s revisit. Editing this earlier reflection keeps that schedule.</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button type="button" className="text-link" onClick={()=>{if(!previous)update(d=>skipReflection(d,attempt.id));onClose();}}>{previous?"Cancel":"Skip for now"}</button><button type="submit" className="button primary">Save reflection<Check size={16}/></button></div>
  </form></Modal>;
}
