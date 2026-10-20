import { parentPort, workerData } from "node:worker_threads";
import { CompanionStore } from "./store";
import { applySubmissionEvidence } from "../../../packages/core/src/companion";
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
      case 'snapshot': value=store.snapshot(); break;
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
