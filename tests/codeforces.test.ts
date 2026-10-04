import test from "node:test";
import assert from "node:assert/strict";
import { createDemo, emptyData, localDate, reviewQueue, validateData, weekActivity } from "../src/lib/model";
import { ActivityPage, SubmissionInput } from "../src/lib/codeforces-types";
import { beginVisit, codeforcesIdentity, connectProfile, disconnectProfile, mergeActivity, profileStats, proposedReview, saveQuickReflection, withCodeforcesDemo } from "../src/lib/codeforces";
import { createCodeforcesAdapter, fetchActivityTransaction, parsePublicProfile, parseSubmissions } from "../src/lib/codeforces-api";

const now=new Date("2026-10-04T20:30:00Z");
const connected=(handle="jay")=>connectProfile(emptyData(),{handle,rating:null,rank:null},now);
const sub=(id:number,verdict:string|null="OK",minutes=0,key="contest:4:A"):SubmissionInput=>({id,submittedAt:new Date(now.getTime()+minutes*60000).toISOString(),verdict,language:"GNU C++20",problem:{key,title:"Watermelon",code:"4A",url:"https://codeforces.com/problemset/problem/4/A",rating:null,tags:[]}});
const page=(submissions:SubmissionInput[],handle="jay",from=1,count=50):ActivityPage=>({handle,from,count,submissions});
const reflect=(data:ReturnType<typeof connected>,id:string,outcome:"hint"|"editorial"|"independent"|"unsolved",date:string|null="2026-10-09",overrideSchedule=false)=>saveQuickReflection(data,id,{outcome,difficulty:"approach",takeaway:"Look for a complement.",reviewAt:date,overrideSchedule},now);

test("sync is idempotent, accepted problems are unique, and wrong answers group with acceptance",()=>{
  let data=mergeActivity(connected(),"jay",[page([sub(1,"WRONG_ANSWER",-20),sub(2),sub(3,"OK",180)])],"refresh",now);
  assert.equal(data.problems.length,1);
  assert.equal(data.codeforces.practiceAttempts.length,2);
  assert.deepEqual(data.codeforces.practiceAttempts[0].submissionIds,[1,2]);
  const original=data.codeforces.practiceAttempts.map(a=>a.id);
  data=mergeActivity(data,"JAY",[page([sub(3,"OK",180),sub(2),sub(1,"WRONG_ANSWER",-20)],"JAY")],"refresh",now);
  assert.equal(data.codeforces.submissions.length,3);
  assert.equal(data.problems.length,1);
  assert.deepEqual(data.codeforces.practiceAttempts.map(a=>a.id),original);
  assert.equal(profileStats(data,"jay").accepted,1);
  assert.equal(profileStats(data,"jay").independent,0);
  assert.equal(data.attempts.length,0);
  assert.equal(weekActivity(data,now).reduce((n,d)=>n+d.count,0),0);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))),data);
});
test("pending verdicts update without moving membership or erasing a reflection",()=>{
  let data=mergeActivity(connected(),"jay",[page([sub(1,"TESTING")])],"refresh",now);
  const id=data.codeforces.practiceAttempts[0].id;
  data=reflect(data,id,"hint");
  const saved=data.codeforces.reflections[0];
  data=mergeActivity(data,"jay",[page([sub(1,"OK")])],"refresh",now);
  assert.equal(data.codeforces.submissions[0].verdict,"OK");
  assert.deepEqual(data.codeforces.reflections[0],saved);
  assert.equal(profileStats(data,"jay").independent,0);
  assert.equal(profileStats(data,"jay").assisted,1);
  assert.equal(reviewQueue(data).length,1);
});
test("partial page failure leaves the previous transaction intact",async()=>{
  const original=mergeActivity(connected(),"jay",[page([sub(1)])],"refresh",now);
  const before=JSON.stringify(original);
  await assert.rejects(fetchActivityTransaction("jay",1,1,false,async(_handle,from)=>{
    if(from>1)throw new Error("temporary page failure");
    return page(Array.from({length:50},(_,i)=>sub(200-i)),"jay",from);
  }),/temporary page failure/);
  assert.equal(JSON.stringify(original),before);
  assert.equal(original.codeforces.profiles[0].lastSyncAt,now.toISOString());
});
test("bounded import exposes a gap, older pages reconcile it and do not add inbox tasks",()=>{
  let data=mergeActivity(connected(),"jay",[page([sub(1)])],"refresh",now);
  data=mergeActivity(data,"jay",[page(Array.from({length:50},(_,i)=>sub(200-i)))],"refresh",now);
  assert.equal(data.codeforces.profiles[0].gapUntilId,1);
  assert.equal(data.codeforces.profiles[0].historyComplete,false);
  const tasks=profileStats(data,"jay").pending;
  data=mergeActivity(data,"jay",[page([sub(1),sub(2,"OK",-300)],"jay",41)],"older",now);
  assert.equal(data.codeforces.profiles[0].gapUntilId,null);
  assert.equal(data.codeforces.profiles[0].historyComplete,true);
  assert.equal(profileStats(data,"jay").pending,tasks);
});
test("one schedule per problem; reflection edits respect manual dates and newer attempts",()=>{
  let data=mergeActivity(connected(),"jay",[page([sub(1),sub(2,"OK",180)])],"refresh",now);
  const [old,recent]=data.codeforces.practiceAttempts;
  data=reflect(data,old.id,"editorial","2026-10-07");
  data=reflect(data,recent.id,"hint","2026-10-09");
  assert.equal(reviewQueue(data).length,1);
  data=reflect(data,old.id,"unsolved","2026-10-05");
  assert.equal(data.problems[0].reviewAt,"2026-10-09");
  data={...data,problems:data.problems.map(p=>({...p,reviewManual:true,reviewAt:"2026-10-25"}))};
  data=reflect(data,recent.id,"editorial","2026-10-07");
  assert.equal(data.problems[0].reviewAt,"2026-10-25");
  data=reflect(data,recent.id,"independent",null,true);
  assert.equal(reviewQueue(data).length,0);
  assert.equal(profileStats(data,"jay").revisits,1);
});
test("handle changes and disconnect retain scoped history, notes and schedules",()=>{
  let data=mergeActivity(connected(),"jay",[page([sub(1)])],"refresh",now);
  data=reflect(data,data.codeforces.practiceAttempts[0].id,"hint");
  data=connectProfile(data,{handle:"other",rating:1400,rank:"specialist"},now);
  data=mergeActivity(data,"other",[page([sub(1)],"other")],"refresh",now);
  assert.equal(data.problems.length,2);
  assert.equal(profileStats(data,"jay").reflected,1);
  assert.equal(profileStats(data,"other").reflected,0);
  assert.equal(profileStats(data,"other").independent,0);
  assert.equal(reviewQueue(data).length,0);
  data=disconnectProfile(data);
  assert.equal(data.codeforces.submissions.length,2);
  assert.equal(data.codeforces.reflections[0].takeaway,"Look for a complement.");
  data=connectProfile(data,{handle:"Jay",rating:null,rank:null},now);
  assert.equal(reviewQueue(data).length,1);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))),data);
});
test("older pagination prepends related failures without losing the saved attempt anchor",()=>{
  let data=mergeActivity(connected(),"jay",[page([sub(2)])],"refresh",now);
  const id=data.codeforces.practiceAttempts[0].id;
  data=reflect(data,id,"hint");
  data=mergeActivity(data,"jay",[page([sub(1,"WRONG_ANSWER",-15)],"jay",2)],"older",now);
  assert.equal(data.codeforces.practiceAttempts.length,1);
  assert.equal(data.codeforces.practiceAttempts[0].id,id);
  assert.deepEqual(data.codeforces.practiceAttempts[0].submissionIds,[1,2]);
  assert.equal(data.codeforces.reflections[0].attemptId,id);
});
test("version one data migrates with timer, notes, history and deliberate dates preserved",()=>{
  const old:Record<string,unknown>=JSON.parse(JSON.stringify(createDemo(now)));
  old.schemaVersion=1;delete old.codeforces;
  const settings=old.settings as Record<string,unknown>;delete settings.reviewDays;
  old.session={id:"old-session",problemId:"diagonal",startedAt:now.toISOString(),runningSince:null,elapsedMs:60000,targetMinutes:30,notes:"An edge case to try.",timerVisible:false,phase:"focus"};
  const migrated=validateData(old);
  assert.equal(migrated.schemaVersion,2);
  assert.deepEqual(migrated.attempts,old.attempts);
  assert.deepEqual(migrated.session,old.session);
  assert.equal(migrated.codeforces.submissions.length,0);
  assert.deepEqual(migrated.settings.reviewDays,{unsolved:1,editorial:3,hint:5});
  assert.ok(migrated.problems.filter(p=>p.reviewAt).every(p=>p.reviewManual));
  assert.deepEqual(validateData(migrated),migrated);
  assert.equal(withCodeforcesDemo(emptyData(),now).codeforces.submissions.length,4);
  assert.equal(emptyData().codeforces.submissions.length,0);
});
test("backup validation rejects broken platform relationships and duplicate identities",()=>{
  const data=mergeActivity(connected(),"jay",[page([sub(1)])],"refresh",now);
  assert.throws(()=>validateData({...data,codeforces:{...data.codeforces,submissions:[...data.codeforces.submissions,...data.codeforces.submissions]}}),/Codeforces/);
  assert.throws(()=>validateData({...data,codeforces:{...data.codeforces,reflections:[{attemptId:"missing",outcome:"independent",difficulty:null,takeaway:"",savedAt:now.toISOString()}]}}),/Codeforces/);
  assert.throws(()=>validateData({...data,problems:[...data.problems,{...data.problems[0],id:"duplicate"}]}),/duplicate platform/);
  assert.throws(()=>validateData({...data,settings:{...data.settings,reviewDays:{unsolved:0,hint:5,editorial:3}}}),/defaults/);
});
test("local dates and visit cutoffs separate activity events from daily scheduling",()=>{
  const date=new Date(2026,9,4,23,59);
  let data=mergeActivity(connected(),"jay",[page([sub(1)])],"refresh",date);
  data=beginVisit(data,new Date(date.getTime()+120000));
  assert.equal(data.codeforces.profiles[0].sinceAt,now.toISOString());
  assert.equal(localDate(new Date(2026,9,5,0,1)),"2026-10-05");
  assert.equal(proposedReview(data,data.problems[0],"unsolved",date),"2026-10-05");
  assert.equal(proposedReview(data,data.problems[0],"hint",date),"2026-10-09");
  assert.equal(proposedReview(data,data.problems[0],"independent",date),null);
  assert.equal(proposedReview(data,data.problems[0],"unsolved",new Date(2026,2,7,23,59)),"2026-03-08");
});
test("an empty successful import does not mark a later bounded import as complete",()=>{
  let data=mergeActivity(connected(),"jay",[page([])],"refresh",now);
  assert.equal(data.codeforces.profiles[0].historyComplete,true);
  data=mergeActivity(data,"jay",[page(Array.from({length:50},(_,i)=>sub(100-i)))],"refresh",now);
  assert.equal(data.codeforces.profiles[0].historyComplete,false);
  assert.equal(profileStats(data,"jay").pending,5);
});
test("API normalization preserves missing metadata and matches alternate URL formats",()=>{
  const raw={id:3,creationTimeSeconds:1791108000,problem:{contestId:4,index:"A",name:"Watermelon",tags:[]},programmingLanguage:"GNU C++20"};
  const parsed=parseSubmissions([raw])[0];
  assert.equal(parsed.problem.rating,null);assert.equal(parsed.verdict,null);
  assert.deepEqual(parseSubmissions([{...raw,problem:{...raw.problem,tags:undefined}}])[0].problem.tags,[]);
  assert.equal(parsed.problem.key,codeforcesIdentity("https://codeforces.com/contest/4/problem/A"));
  assert.equal(parsed.problem.key,codeforcesIdentity("https://codeforces.com/problemset/problem/4/A"));
  assert.equal(codeforcesIdentity("https://evil.com/contest/4/problem/A"),null);
  assert.deepEqual(parsePublicProfile([{handle:"jay"}]),{handle:"jay",rating:null,rank:null});
  assert.throws(()=>parseSubmissions([raw,{...raw,id:4,problem:{index:"A",name:"Unknown",tags:[]}}]),/incomplete/);
});
test("adapter paces requests, retries only bounded transient failures, and restricts methods",async()=>{
  let clock=10000;const starts:number[]=[];const urls:string[]=[];let failures=1;
  const adapter=createCodeforcesAdapter({now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async url=>{
    starts.push(clock);urls.push(url);
    if(failures-- >0)return Response.json({status:"FAILED",comment:"Call limit exceeded"});
    return Response.json({status:"OK",result:[{handle:"jay"}]});
  }});
  await Promise.all([adapter.profile("jay"),adapter.profile("other")]);
  assert.equal(starts.length,3);
  assert.ok(starts.slice(1).every((time,i)=>time-starts[i]>=2100));
  assert.ok(urls.every(url=>new URL(url).origin==="https://codeforces.com"&&new URL(url).pathname==="/api/user.info"));
  let calls=0;
  const invalid=createCodeforcesAdapter({wait:async()=>{},fetcher:async()=>{calls++;return Response.json({status:"FAILED",comment:"handles: User with handle missing not found"});}});
  await assert.rejects(invalid.profile("missing"),/not found/);assert.equal(calls,1);
});

test("route rejects arbitrary upstream parameters, invalid pagination and malformed handles",async()=>{
  const {GET}=await import("../src/app/api/codeforces/route");
  for(const query of ["action=profile&handle=jay&url=https://example.com","action=activity&handle=jay&from=0","action=profile&handle=jay%3Bother","action=other&handle=jay"]){
    const response=await GET(new Request(`http://localhost/api/codeforces?${query}`));
    assert.equal(response.status,400);assert.equal((await response.json()).code,"invalid_request");
  }
});
