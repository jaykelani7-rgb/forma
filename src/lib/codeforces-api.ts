import { ActivityPage, CF_PAGE_SIZE, PublicProfile, SubmissionInput, validHandle } from "./codeforces-types";

export class CodeforcesError extends Error {
  constructor(message:string, public code:"invalid_handle"|"temporary"|"invalid_request", public status=503) { super(message); }
}
const object=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length>0&&v.length<=max;
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const malformed=()=>new CodeforcesError("Codeforces returned incomplete activity. Nothing was imported. Try again later.","temporary");
export function parsePublicProfile(result:unknown):PublicProfile {
  if (!Array.isArray(result)||result.length!==1||!object(result[0])||!text(result[0].handle,24)||!validHandle(result[0].handle)) throw malformed();
  const p=result[0];
  if (!(p.rating===undefined||integer(p.rating,0,10000))||!(p.rank===undefined||text(p.rank,100))) throw malformed();
  return {handle:p.handle as string,rating:p.rating as number|undefined??null,rank:p.rank as string|undefined??null};
}
export function parseSubmissions(result:unknown):SubmissionInput[] {
  if (!Array.isArray(result)||result.length>CF_PAGE_SIZE) throw malformed();
  const ids=new Set<number>();
  return result.map(s=>{
    if (!object(s)||!integer(s.id,1)||ids.has(s.id)||!integer(s.creationTimeSeconds,0,8640000000000)||!object(s.problem)||!text(s.programmingLanguage,120)||!(s.verdict===undefined||(text(s.verdict,80)&&/^[A-Z_0-9]+$/.test(s.verdict)))) throw malformed();
    ids.add(s.id);
    const p=s.problem;
    if (!text(p.index,20)||!/^[A-Za-z0-9]+$/.test(p.index)||!text(p.name,240)||!(p.contestId===undefined||integer(p.contestId,1))||!(p.problemsetName===undefined||text(p.problemsetName,60))||!(p.rating===undefined||integer(p.rating,0,10000))||!(p.tags===undefined||(Array.isArray(p.tags)&&p.tags.length<=20&&p.tags.every(t=>text(t,60))))) throw malformed();
    // A contest ID may be absent for an alternate problemset. Retain the
    // published set/index identity; a missing link stays missing.
    const index=p.index.toUpperCase();
    const key=p.contestId?`contest:${p.contestId}:${index}`:p.problemsetName?`set:${p.problemsetName}:${index}`:null;
    if (!key) throw malformed();
    return {id:s.id,submittedAt:new Date(s.creationTimeSeconds*1000).toISOString(),verdict:s.verdict as string|undefined??null,language:s.programmingLanguage,problem:{key,title:p.name,code:p.contestId?`${p.contestId}${index}`:index,url:p.contestId?`https://codeforces.com/${p.contestId>=100000?"gym":"contest"}/${p.contestId}/problem/${encodeURIComponent(index)}`:"",rating:p.rating as number|undefined??null,tags:p.tags===undefined?[]:[...p.tags as string[]]}};
  });
}
type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
export function createCodeforcesAdapter({fetcher=fetch,wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)),now=Date.now,interval=2100}:{fetcher?:Fetcher;wait?:(ms:number)=>Promise<void>;now?:()=>number;interval?:number}={}) {
  let tail=Promise.resolve();
  let lastStarted=-Infinity;
  let queued=0;
  async function paced<T>(fn:()=>Promise<T>):Promise<T> {
    if (queued>=12) throw new CodeforcesError("The sync service is busy. Try again in a moment.","temporary",429);
    queued++;
    const operation=tail.then(async()=>{
      const delay=Math.max(0,lastStarted+interval-now());
      if (delay) await wait(delay);
      lastStarted=now();
      return fn();
    });
    tail=operation.then(()=>{},()=>{});
    try { return await operation; } finally {queued--;}
  }
  async function request(method:"user.info"|"user.status",params:Record<string,string>):Promise<unknown> {
    for (let attempt=0;attempt<2;attempt++) {
      try {
        return await paced(async()=>{
          const url=new URL(`https://codeforces.com/api/${method}`);
          Object.entries({...params,lang:"en"}).forEach(([k,v])=>url.searchParams.set(k,v));
          const response=await fetcher(url.toString(),{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000),headers:{Accept:"application/json"}});
          let body:unknown;
          try { body=await response.json(); } catch {throw malformed();}
          if (object(body)&&body.status==="FAILED"&&typeof body.comment==="string"&&/not found|invalid handle/i.test(body.comment)) throw new CodeforcesError("That Codeforces handle was not found. Check its spelling.","invalid_handle",404);
          if (!response.ok||!object(body)||body.status!=="OK"||!Object.hasOwn(body,"result")) throw new CodeforcesError("Codeforces is temporarily unavailable. Your saved activity is safe; try again shortly.","temporary",response.status===429?429:503);
          return body.result;
        });
      } catch (e) {
        const error=e instanceof CodeforcesError?e:new CodeforcesError("Codeforces could not be reached. Your saved activity is safe; try again later.","temporary");
        if (error.code!=="temporary"||attempt===1) throw error;
        await wait(2200);
      }
    }
    throw malformed();
  }
  return {
    async profile(handle:string) {return parsePublicProfile(await request("user.info",{handles:handle,checkHistoricHandles:"false"}));},
    async activity(handle:string,from:number):Promise<ActivityPage> {return {handle,from,count:CF_PAGE_SIZE,submissions:parseSubmissions(await request("user.status",{handle,from:String(from),count:String(CF_PAGE_SIZE)}))};},
  };
}

export async function fetchActivityTransaction(handle:string, nextFrom:number, newestId:number, older:boolean, fetchPage:(handle:string,from:number)=>Promise<ActivityPage>) {
  if (older) return [await fetchPage(handle,Math.max(1,nextFrom-10))]; // overlap handles moving API offsets
  const pages:ActivityPage[]=[];
  for (let i=0;i<(newestId?3:1);i++) {
    const page=await fetchPage(handle,1+i*CF_PAGE_SIZE);
    pages.push(page);
    if (page.submissions.length<CF_PAGE_SIZE || page.submissions.some(s=>s.id<=newestId)) break;
  }
  return pages;
}
