import { parentPort, workerData } from "node:worker_threads";
import { CompanionStore } from "./store";
import { applySubmissionEvidence } from "../../../packages/core/src/companion";
import { reconcileFollowups } from "../../../packages/core/src/verdict-followup";
import { ClockContinuity } from "./clock-continuity";
const store = new CompanionStore(workerData.path);
store.pauseForLifecycle('restart');
const continuity=new ClockContinuity(Date.now(),performance.now());
parentPort!.on('message', (request: {id:number;method:string;args:unknown[]}) => {
  try {
    const now=Date.now();
    if(continuity.sample(now,performance.now()))store.pauseForLifecycle('clock-discontinuity',now);
    const a=request.args;
    let value: unknown;
    switch (request.method) {
      case 'reconcile': value=store.reconcile(now); break;
      case 'followup-evidence': {
        const e=a[0] as {handle:string;submissions:Parameters<typeof reconcileFollowups>[2];checkedAt:string;error?:string};
        value=store.updateEvidence(String(a[1]),(data,state)=>({data,state:reconcileFollowups(state,e.handle,e.submissions,now,e.error??null,data)}),e,now); break;
      }
      case 'snapshot': value=store.snapshot(); break;
      case 'tutor-view': value=store.tutor.view(now); break;
      case 'tutor-open': value=store.tutor.open(a[0],now); break;
      case 'tutor-context': value=store.tutor.context(a[0]); break;
      case 'tutor-turns': value=store.tutor.turns(a[0]); break;
      case 'tutor-statement': value=store.tutor.statement(a[0],now); break;
      case 'tutor-code': value=store.tutor.code(a[0]); break;
      case 'tutor-prepare': value=store.tutor.prepare(a[0],a[1],now); break;
      case 'tutor-append': value=store.tutor.append(a[0]); break;
      case 'tutor-exposed': value=store.tutor.exposed(a[0]); break;
      case 'tutor-assistance': value=store.tutor.assistance(a[0]); break;
      case 'tutor-finalize': value=store.tutor.finalize(a[0],now); break;
      case 'tutor-delete': value=store.tutor.delete(a[0]); break;
      case 'tutor-export': value=store.tutor.export(a[0]); break;
      case 'tutor-settings': value=store.tutor.setSettings(a[0],now); break;
      case 'tutor-propose': value=store.tutor.propose(a[0],now); break;
      case 'tutor-approve': value=store.tutor.approve(a[0],now); break;
      case 'command': value=store.command(a[0],String(a[1]??'desktop'),now); break;
      case 'selectBinding': value=store.selectBinding(String(a[0]),String(a[1]),now); break;
      case 'preferences': value=store.preferences(); break;
      case 'setPreferences': value=store.setPreferences(a[0]); break;
      case 'pause': value=store.pauseForLifecycle(String(a[0])); break;
      case 'checkpoint': value=store.checkpoint(); break;
      case 'importNotebook': value=store.importNotebook(String(a[0])); break;
      case 'exportNotebook': value=store.exportNotebook(); break;
      case 'exportCompanion': value=store.exportCompanion(); break;
      case 'evidence': {
        const evidence=a[0] as Parameters<typeof applySubmissionEvidence>[2];
        value=store.updateEvidence(String(a[1]),(data,state)=>applySubmissionEvidence(data,state,evidence),evidence);
        break;
      }
      default: throw new Error('Unsupported storage operation.');
    }
    parentPort!.postMessage({id:request.id,value});
  } catch(error) {
    parentPort!.postMessage({id:request.id,error:error instanceof Error?error.message:'The local write did not complete.'});
  }
});
