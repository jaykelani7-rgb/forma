import { CodeforcesError, fetchActivityTransaction } from "./codeforces-api";
import { ActivityPage, PublicProfile } from "./codeforces-types";

export async function codeforcesRequest<T>(action:"profile"|"activity",handle:string,from=1,signal?:AbortSignal):Promise<T> {
  try {
    const params=new URLSearchParams({action,handle,...(action==="activity"?{from:String(from)}:{})});
    const response=await fetch(`/api/codeforces?${params}`,{cache:"no-store",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000)});
    const body=await response.json();
    if (!response.ok) throw new CodeforcesError(body.error??"Activity could not be read.",body.code??"temporary",response.status);
    return body as T;
  } catch(e) {
    if (e instanceof CodeforcesError) throw e;
    throw new CodeforcesError("The sync service could not be reached. Your saved activity is still available.","temporary");
  }
}
export const previewPublicProfile=(handle:string,signal?:AbortSignal)=>codeforcesRequest<PublicProfile>("profile",handle,1,signal);
export const collectActivity=(handle:string,nextFrom:number,newestId:number,older:boolean,signal?:AbortSignal)=>fetchActivityTransaction(handle,nextFrom,newestId,older,(h,from)=>codeforcesRequest<ActivityPage>("activity",h,from,signal));
export interface SyncState { busy:boolean; phase:"preview"|"refresh"|"older"|null; error:string|null; code:string|null; }
export const idleSync:SyncState={busy:false,phase:null,error:null,code:null};
