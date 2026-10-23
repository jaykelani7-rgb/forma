import type { TutorTurn } from '../../../packages/tutor/types';
export function tutorNearBottom(region:{scrollTop:number;scrollHeight:number;clientHeight:number}):boolean {
  return region.scrollHeight-region.clientHeight-region.scrollTop<=64;
}
/** Exposure acknowledgements and usage metadata are not new conversation content. */
export function tutorContentRevision(turns:TutorTurn[]):string {
  return turns.map(turn=>`${turn.id}:${turn.requestId}:${turn.status}:${turn.assistantText.length}`).join('|');
}
/** A late queued/partial snapshot may not erase already rendered text or a final state. */
export function mergeTutorTurns(previous:TutorTurn[],incoming:TutorTurn[]):TutorTurn[]{
  return incoming.map(turn=>{
    const seen=previous.find(item=>item.id===turn.id&&item.requestId===turn.requestId);
    if(!seen)return turn;
    if(['completed','interrupted','failed'].includes(seen.status)&&['queued','streaming'].includes(turn.status))return seen;
    const assistantText=seen.assistantText.startsWith(turn.assistantText)&&seen.assistantText.length>turn.assistantText.length?seen.assistantText:turn.assistantText;
    return {...turn,assistantText,exposed:turn.exposed||seen.exposed};
  });
}
